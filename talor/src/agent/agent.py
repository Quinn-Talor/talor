"""Agent Domain Model for Talor.

This module provides the Agent entity - a rich domain object
with both state and behavior for agent configuration.

Following DDD principles:
- Agent is a rich entity with business logic
- Permission checking is encapsulated in the entity
- Model selection logic is part of the entity

Permission system is also included in this module for controlling tool access.

Module-level functions (merged from service.py):
- configure(): Initialize module state
- clear_cache(): Clear agent cache (for testing)
- get_agent(): Get agent by name
- list_agents(): List all agents
- get_default_agent(): Get default agent name
- list_agents_for_mode(): List agents for a specific mode
"""

from __future__ import annotations

import fnmatch
import logging
from enum import Enum
from typing import Any, Callable, Awaitable, TYPE_CHECKING

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from src.config import Config


logger = logging.getLogger(__name__)


# =============================================================================
# Module-level State (merged from service.py)
# =============================================================================

# Config getter function - should return config dict when called
_config_getter: Callable[[], Awaitable[dict[str, Any]]] | None = None

# Agents cache - stores loaded agents
_agents_cache: dict[str, "Agent"] | None = None


def configure(config_getter: Callable[[], Awaitable[dict[str, Any]]] | None = None) -> None:
    """Configure module-level state.

    Args:
        config_getter: Async function that returns config dict
    """
    global _config_getter
    _config_getter = config_getter


def clear_cache() -> None:
    """Clear agent cache (for testing)."""
    global _agents_cache
    _agents_cache = None


# =============================================================================
# Permission System (merged from permission.py)
# =============================================================================

class PermissionAction(str, Enum):
    """Permission action types."""
    ALLOW = "allow"
    DENY = "deny"
    ASK = "ask"


class PermissionRule(BaseModel):
    """A single permission rule.

    Defines access control for a specific tool or pattern.

    Attributes:
        permission: Permission type (tool name or category)
        action: Action to take (allow, deny, ask)
        pattern: Pattern to match (glob-style)
    """

    permission: str
    action: PermissionAction
    pattern: str = "*"

    def matches(self, tool: str, path: str | None = None) -> bool:
        """Check if this rule matches the given tool and path.

        Args:
            tool: Tool name
            path: Optional path for file-based permissions

        Returns:
            True if rule matches
        """
        # Check permission match
        if self.permission != "*" and self.permission != tool:
            # Check if it's a category match
            if not fnmatch.fnmatch(tool, self.permission):
                return False

        # Check pattern match
        if path and self.pattern != "*":
            if not fnmatch.fnmatch(path, self.pattern):
                return False

        return True


# Type alias for ruleset
Ruleset = list[PermissionRule]


class Permission:
    """Permission management namespace.

    Provides methods for creating, merging, and checking permissions.
    """

    @staticmethod
    def from_config(config: dict[str, Any]) -> Ruleset:
        """Create ruleset from configuration dictionary.

        Args:
            config: Configuration dictionary like:
                {
                    "*": "allow",
                    "bash": "ask",
                    "read": {"*": "allow", "*.env": "ask"},
                }

        Returns:
            List of PermissionRule
        """
        rules: Ruleset = []

        for permission, value in config.items():
            if isinstance(value, str):
                # Simple action
                action = PermissionAction(value)
                rules.append(PermissionRule(
                    permission=permission,
                    action=action,
                    pattern="*",
                ))
            elif isinstance(value, dict):
                # Pattern-based rules
                for pattern, action_str in value.items():
                    action = PermissionAction(action_str)
                    rules.append(PermissionRule(
                        permission=permission,
                        action=action,
                        pattern=pattern,
                    ))

        return rules

    @staticmethod
    def merge(*rulesets: Ruleset) -> Ruleset:
        """Merge multiple rulesets.

        Later rulesets override earlier ones.
        When a simple rule (pattern=*) is added, it removes all existing rules
        for that permission to ensure complete override.

        Args:
            *rulesets: Rulesets to merge

        Returns:
            Merged ruleset
        """
        result: Ruleset = []

        for ruleset in rulesets:
            for rule in ruleset:
                # If this is a simple rule (pattern=*), remove ALL rules for this permission
                # This ensures "read": "allow" completely overrides default read rules
                if rule.pattern == "*":
                    result = [r for r in result if r.permission != rule.permission]
                else:
                    # Remove only exact matches (same permission and pattern)
                    result = [
                        r for r in result
                        if not (r.permission == rule.permission and r.pattern == rule.pattern)
                    ]
                result.append(rule)

        return result

    @staticmethod
    def check(
        ruleset: Ruleset,
        tool: str,
        path: str | None = None,
    ) -> PermissionAction:
        """Check permission for a tool and path.

        Args:
            ruleset: Permission ruleset
            tool: Tool name
            path: Optional path for file-based permissions

        Returns:
            Permission action (allow, deny, ask)
        """
        # Find matching rules (most specific first)
        matching_rules = []

        for rule in ruleset:
            if rule.matches(tool, path):
                matching_rules.append(rule)

        if not matching_rules:
            # Default to ask if no rules match
            return PermissionAction.ASK

        # Sort by specificity (more specific patterns first)
        def specificity(rule: PermissionRule) -> int:
            score = 0
            if rule.permission != "*":
                score += 10
            if rule.pattern != "*":
                score += 5
            return score

        matching_rules.sort(key=specificity, reverse=True)

        return matching_rules[0].action

    @staticmethod
    def is_allowed(
        ruleset: Ruleset,
        tool: str,
        path: str | None = None,
    ) -> bool:
        """Check if action is allowed.

        Args:
            ruleset: Permission ruleset
            tool: Tool name
            path: Optional path

        Returns:
            True if allowed
        """
        action = Permission.check(ruleset, tool, path)
        return action == PermissionAction.ALLOW

    @staticmethod
    def needs_ask(
        ruleset: Ruleset,
        tool: str,
        path: str | None = None,
    ) -> bool:
        """Check if action needs user confirmation.

        Args:
            ruleset: Permission ruleset
            tool: Tool name
            path: Optional path

        Returns:
            True if needs ask
        """
        action = Permission.check(ruleset, tool, path)
        return action == PermissionAction.ASK


# =============================================================================
# Value Objects
# =============================================================================

class ModelConfig(BaseModel):
    """Model configuration for an agent (Value Object)."""
    model_id: str
    provider_id: str

    def to_string(self) -> str:
        """Convert to provider/model string format."""
        return f"{self.provider_id}/{self.model_id}"


# =============================================================================
# Agent Entity (Rich Domain Model)
# =============================================================================

class AgentPluginConfig(BaseModel):
    """Single plugin configuration for an agent (Value Object).

    Attributes:
        enabled: Whether the plugin is enabled
        priority: Optional priority override
        path: Path to custom plugin file (for custom plugins)
    """
    enabled: bool = True
    priority: int | None = None
    path: str | None = None


class Agent(BaseModel):
    """Agent entity with state and behavior.

    A rich domain model that encapsulates:
    - Agent configuration (state)
    - Permission checking (behavior)
    - Model selection (behavior)
    - Validation rules (behavior)
    """

    name: str
    description: str | None = None
    mode: str = "primary"  # "primary", "subagent", "all"
    native: bool = False
    hidden: bool = False
    top_p: float | None = None
    temperature: float | None = None
    color: str | None = None
    permission: list[dict[str, Any]] = Field(default_factory=list)
    model: ModelConfig | None = None
    prompt: str | None = None  # Path to prompt file (e.g., "prompts/agents/build.md")
    options: dict[str, Any] = Field(default_factory=dict)
    steps: int | None = None
    plugins: dict[str, AgentPluginConfig] | None = None

    # =========================================================================
    # Properties
    # =========================================================================

    @property
    def prompt_path(self) -> str:
        """Get prompt file path.

        Returns default path for native agents if not specified.
        """
        if self.prompt:
            return self.prompt
        # Default path for native agents
        return f"prompts/agents/{self.name}.md"

    @property
    def is_primary(self) -> bool:
        """Check if this is a primary agent."""
        return self.mode in ("primary", "all")

    @property
    def is_subagent(self) -> bool:
        """Check if this is a subagent."""
        return self.mode in ("subagent", "all")

    @property
    def is_visible(self) -> bool:
        """Check if agent is visible in UI."""
        return not self.hidden

    @property
    def has_custom_model(self) -> bool:
        """Check if agent has a custom model override."""
        return self.model is not None

    @property
    def max_steps(self) -> int:
        """Get maximum steps (default 50)."""
        return self.steps or 50

    @property
    def has_custom_plugins(self) -> bool:
        """Check if agent has custom plugin configuration."""
        return self.plugins is not None and len(self.plugins) > 0

    @property
    def custom_plugin_paths(self) -> dict[str, str]:
        """Get custom plugin paths for this agent.

        Returns:
            Dict of plugin_name -> path for plugins with custom paths
        """
        if not self.plugins:
            return {}
        return {
            name: cfg.path
            for name, cfg in self.plugins.items()
            if cfg.path is not None
        }

    @property
    def disabled_plugins(self) -> list[str]:
        """Get list of disabled plugin names for this agent."""
        if not self.plugins:
            return []
        return [name for name, cfg in self.plugins.items() if not cfg.enabled]

    @property
    def enabled_plugins(self) -> list[str]:
        """Get list of explicitly enabled plugin names for this agent."""
        if not self.plugins:
            return []
        return [name for name, cfg in self.plugins.items() if cfg.enabled]

    def get_plugin_config(self, plugin_name: str) -> AgentPluginConfig | None:
        """Get plugin configuration for a specific plugin.

        Args:
            plugin_name: Name of the plugin

        Returns:
            Plugin config or None if not configured
        """
        if not self.plugins:
            return None
        return self.plugins.get(plugin_name)

    # =========================================================================
    # Permission Behavior
    # =========================================================================

    def get_permission_ruleset(self) -> Ruleset:
        """Get permission ruleset from config."""
        rules = []
        for rule_dict in self.permission:
            rules.append(PermissionRule(**rule_dict))
        return rules

    def check_permission(self, tool_name: str, path: str | None = None) -> PermissionAction:
        """Check permission for a tool.

        Args:
            tool_name: Name of the tool
            path: Optional file path for path-based rules

        Returns:
            PermissionAction (allow, deny, ask)
        """
        ruleset = self.get_permission_ruleset()
        return Permission.check(ruleset, tool_name, path)

    def is_tool_allowed(self, tool_name: str, path: str | None = None) -> bool:
        """Check if a tool is allowed.

        Args:
            tool_name: Name of the tool
            path: Optional file path

        Returns:
            True if allowed
        """
        action = self.check_permission(tool_name, path)
        return action == PermissionAction.ALLOW

    def is_tool_denied(self, tool_name: str, path: str | None = None) -> bool:
        """Check if a tool is denied.

        Args:
            tool_name: Name of the tool
            path: Optional file path

        Returns:
            True if denied
        """
        action = self.check_permission(tool_name, path)
        return action == PermissionAction.DENY

    def requires_permission(self, tool_name: str, path: str | None = None) -> bool:
        """Check if a tool requires user permission.

        Args:
            tool_name: Name of the tool
            path: Optional file path

        Returns:
            True if requires asking
        """
        action = self.check_permission(tool_name, path)
        return action == PermissionAction.ASK

    def merge_permissions(self, additional_rules: dict[str, Any]) -> "Agent":
        """Create a new agent with merged permissions.

        Args:
            additional_rules: Additional permission rules

        Returns:
            New Agent with merged permissions
        """
        current_rules = self.get_permission_ruleset()
        new_rules = Permission.from_config(additional_rules)
        merged = Permission.merge(current_rules, new_rules)

        return self.model_copy(update={
            "permission": [r.model_dump() for r in merged]
        })

    # =========================================================================
    # Model Selection Behavior
    # =========================================================================

    def get_model_string(self, default_model: str = "ollama/deepseek-v3.1:671b-cloud") -> str:
        """Get the model string for LLM calls.

        Args:
            default_model: Default model if none configured

        Returns:
            Model string in "provider/model" format
        """
        if self.model:
            return self.model.to_string()
        return default_model

    def with_model(self, provider_id: str, model_id: str) -> "Agent":
        """Create a new agent with a different model.

        Args:
            provider_id: Provider ID
            model_id: Model ID

        Returns:
            New Agent with updated model
        """
        return self.model_copy(update={
            "model": ModelConfig(provider_id=provider_id, model_id=model_id)
        })

    # =========================================================================
    # Configuration Behavior
    # =========================================================================

    def with_prompt(self, prompt: str) -> "Agent":
        """Create a new agent with a different prompt.

        Args:
            prompt: New system prompt

        Returns:
            New Agent with updated prompt
        """
        return self.model_copy(update={"prompt": prompt})

    def with_temperature(self, temperature: float) -> "Agent":
        """Create a new agent with different temperature.

        Args:
            temperature: New temperature value

        Returns:
            New Agent with updated temperature

        Raises:
            ValueError: If temperature out of range
        """
        if not 0.0 <= temperature <= 2.0:
            raise ValueError("Temperature must be between 0.0 and 2.0")
        return self.model_copy(update={"temperature": temperature})

    def with_max_steps(self, steps: int) -> "Agent":
        """Create a new agent with different max steps.

        Args:
            steps: Maximum steps

        Returns:
            New Agent with updated steps

        Raises:
            ValueError: If steps invalid
        """
        if steps < 1:
            raise ValueError("Steps must be at least 1")
        return self.model_copy(update={"steps": steps})

    # =========================================================================
    # Validation Behavior
    # =========================================================================

    def validate_as_default(self) -> None:
        """Validate that this agent can be used as default.

        Raises:
            ValueError: If agent cannot be default
        """
        if self.mode == "subagent":
            raise ValueError(f"Agent '{self.name}' is a subagent and cannot be default")
        if self.hidden:
            raise ValueError(f"Agent '{self.name}' is hidden and cannot be default")

    def validate_for_mode(self, required_mode: str) -> None:
        """Validate that agent matches required mode.

        Args:
            required_mode: Required mode ("primary" or "subagent")

        Raises:
            ValueError: If mode doesn't match
        """
        if self.mode != "all" and self.mode != required_mode:
            raise ValueError(
                f"Agent '{self.name}' has mode '{self.mode}', "
                f"but '{required_mode}' is required"
            )

    # =========================================================================
    # Configuration Update Behavior
    # =========================================================================

    def update_from_config(self, config: dict[str, Any]) -> "Agent":
        """Update agent from configuration dict.

        Creates a new Agent with updated values from config.
        This is the proper DDD way to apply configuration changes.

        Args:
            config: Configuration dict with optional keys:
                - model: {"provider_id": str, "model_id": str}
                - prompt: str
                - description: str
                - temperature: float
                - top_p: float
                - mode: str
                - color: str
                - hidden: bool
                - steps: int
                - permission: dict
                - plugins: {"enabled": [], "disabled": [], "custom": []}

        Returns:
            New Agent with updated configuration
        """
        updates: dict[str, Any] = {}

        if "model" in config:
            updates["model"] = ModelConfig(**config["model"])

        if "prompt" in config:
            updates["prompt"] = config["prompt"]

        if "description" in config:
            updates["description"] = config["description"]

        if "temperature" in config:
            updates["temperature"] = config["temperature"]

        if "top_p" in config:
            updates["top_p"] = config["top_p"]

        if "mode" in config:
            updates["mode"] = config["mode"]

        if "color" in config:
            updates["color"] = config["color"]

        if "hidden" in config:
            updates["hidden"] = config["hidden"]

        if "steps" in config:
            updates["steps"] = config["steps"]

        if "permission" in config:
            # Merge permissions using entity's method
            merged_agent = self.merge_permissions(config["permission"])
            updates["permission"] = merged_agent.permission

        if "plugins" in config:
            plugins_dict = {}
            for name, cfg in config["plugins"].items():
                if isinstance(cfg, dict):
                    plugins_dict[name] = AgentPluginConfig(**cfg)
                else:
                    plugins_dict[name] = AgentPluginConfig(enabled=bool(cfg))
            updates["plugins"] = plugins_dict

        if not updates:
            return self

        return self.model_copy(update=updates)


# =============================================================================
# Module-level Functions (merged from service.py)
# =============================================================================

async def _load_agents() -> dict[str, Agent]:
    """Load all agents from config and defaults.

    Returns:
        Dictionary of agent name to Agent instance
    """
    global _agents_cache

    if _agents_cache is not None:
        return _agents_cache

    # Default permission rules
    default_rules = Permission.from_config({
        "*": "allow",
        "doom_loop": "ask",
        "external_directory": "ask",
        "question": "deny",
        "plan_enter": "deny",
        "plan_exit": "deny",
        "read": {
            "*": "allow",
            "*.env": "ask",
            "*.env.*": "ask",
            "*.env.example": "allow",
        },
    })

    # Built-in agents
    agents: dict[str, Agent] = {
        "build": Agent(
            name="build",
            description="The default agent. Executes tools based on configured permissions.",
            mode="primary",
            native=True,
            permission=[r.model_dump() for r in Permission.merge(
                default_rules,
                Permission.from_config({
                    "question": "allow",
                    "plan_enter": "allow",
                }),
            )],
        ),
        "plan": Agent(
            name="plan",
            description="Plan mode. Disallows all edit tools.",
            mode="primary",
            native=True,
            # Prompt loaded by AgentPromptPlugin from prompts/agents/plan.md
            permission=[r.model_dump() for r in Permission.merge(
                default_rules,
                Permission.from_config({
                    "question": "allow",
                    "plan_exit": "allow",
                    "edit": "deny",
                    "write": "deny",
                }),
            )],
        ),
        "general": Agent(
            name="general",
            description="General-purpose agent for researching complex questions and executing multi-step tasks.",
            mode="subagent",
            native=True,
            permission=[r.model_dump() for r in Permission.merge(
                default_rules,
                Permission.from_config({
                    "todoread": "deny",
                    "todowrite": "deny",
                }),
            )],
        ),
        "explore": Agent(
            name="explore",
            description="Fast agent specialized for exploring and gathering information.",
            mode="subagent",
            native=True,
            # Prompt loaded by AgentPromptPlugin from prompts/agents/explore.md
            permission=[r.model_dump() for r in Permission.merge(
                default_rules,
                Permission.from_config({
                    "*": "deny",
                    "grep": "allow",
                    "glob": "allow",
                    "ls": "allow",
                    "bash": "allow",
                    "read": "allow",
                }),
            )],
        ),
        "title": Agent(
            name="title",
            description="Generate conversation titles.",
            mode="primary",
            native=True,
            hidden=True,
            temperature=0.5,
            # Simple inline prompt for title generation
            prompt="Generate a short, descriptive title for this conversation based on the user's request.",
            permission=[r.model_dump() for r in Permission.from_config({"*": "deny"})],
        ),
        "summary": Agent(
            name="summary",
            description="Summarize conversations.",
            mode="primary",
            native=True,
            hidden=True,
            # Simple inline prompt for summary generation
            prompt="Summarize the conversation and key findings concisely.",
            permission=[r.model_dump() for r in Permission.from_config({"*": "deny"})],
        ),
    }

    # Load custom agents from config
    if _config_getter:
        config = await _config_getter()
        for name, agent_config in config.get("agent", {}).items():
            if agent_config.get("disable"):
                agents.pop(name, None)
                continue

            if name in agents:
                # Use entity's update_from_config method (DDD pattern)
                agents[name] = agents[name].update_from_config(agent_config)
            else:
                # Parse plugins config if present
                plugins_dict = None
                if "plugins" in agent_config:
                    plugins_dict = {}
                    for pname, pcfg in agent_config["plugins"].items():
                        if isinstance(pcfg, dict):
                            plugins_dict[pname] = AgentPluginConfig(**pcfg)
                        else:
                            plugins_dict[pname] = AgentPluginConfig(enabled=bool(pcfg))

                # Parse model config if present
                model_config = None
                if "model" in agent_config:
                    model_cfg = agent_config["model"]
                    if isinstance(model_cfg, dict):
                        model_config = ModelConfig(**model_cfg)

                agents[name] = Agent(
                    name=name,
                    description=agent_config.get("description"),
                    mode=agent_config.get("mode", "all"),
                    native=False,
                    prompt=agent_config.get("prompt"),
                    temperature=agent_config.get("temperature"),
                    top_p=agent_config.get("top_p"),
                    color=agent_config.get("color"),
                    hidden=agent_config.get("hidden", False),
                    steps=agent_config.get("steps"),
                    model=model_config,
                    plugins=plugins_dict,
                    permission=[
                        r.model_dump() for r in Permission.merge(
                            default_rules,
                            Permission.from_config(agent_config.get("permission", {})),
                        )
                    ],
                )

    _agents_cache = agents
    return agents


async def get_agent(name: str) -> Agent | None:
    """Get an agent by name.

    Args:
        name: Agent name

    Returns:
        Agent or None if not found
    """
    agents = await _load_agents()
    return agents.get(name)


async def list_agents(include_hidden: bool = False) -> list[Agent]:
    """List all agents.

    Args:
        include_hidden: Include hidden agents

    Returns:
        List of Agent instances
    """
    agents = await _load_agents()
    result = list(agents.values())

    if not include_hidden:
        result = [a for a in result if not a.hidden]

    # Sort: default agent first, then by name
    default_name = "build"
    if _config_getter:
        config = await _config_getter()
        default_name = config.get("default_agent", "build")

    result.sort(key=lambda a: (a.name != default_name, a.name))

    return result


async def get_default_agent() -> str:
    """Get the default agent name.

    Returns:
        Default agent name

    Raises:
        ValueError: If no valid default agent found
    """
    default_name = "build"

    if _config_getter:
        config = await _config_getter()
        default_name = config.get("default_agent", "build")

    agents = await _load_agents()

    if default_name in agents:
        agent = agents[default_name]
        # Use entity's validation method (DDD pattern)
        agent.validate_as_default()
        return default_name

    # Find first primary visible agent
    for agent in agents.values():
        if agent.is_primary and agent.is_visible:
            return agent.name

    raise ValueError("No primary visible agent found")


async def list_agents_for_mode(mode: str) -> list[Agent]:
    """List agents for a specific mode.

    Args:
        mode: "primary" or "subagent"

    Returns:
        List of matching agents
    """
    agents = await list_agents(include_hidden=False)
    return [a for a in agents if a.mode == mode or a.mode == "all"]


# =============================================================================
# Backward-compatible AgentService class
# =============================================================================

class AgentService:
    """Application service for Agent operations (backward-compatible wrapper).

    This class wraps module-level functions for backward compatibility.
    New code should use module-level functions directly.

    Manages:
    - Agent configuration and listing
    - Default agent selection
    - Permission rule management
    """

    def __init__(
        self,
        config_service: Any | None = None,
    ) -> None:
        """Initialize service.

        Args:
            config_service: Config service for loading agent settings
        """
        # Configure module-level state if config_service provided
        if config_service is not None:
            configure(config_getter=config_service.get)

    def clear_cache(self) -> None:
        """Clear agent cache."""
        clear_cache()

    async def _load_agents(self) -> dict[str, Agent]:
        """Load all agents from config and defaults."""
        return await _load_agents()

    async def get_agent(self, name: str) -> Agent | None:
        """Get an agent by name.

        Args:
            name: Agent name

        Returns:
            Agent or None
        """
        return await get_agent(name)

    async def list_agents(self, include_hidden: bool = False) -> list[Agent]:
        """List all agents.

        Args:
            include_hidden: Include hidden agents

        Returns:
            List of Agent
        """
        return await list_agents(include_hidden)

    async def get_default_agent(self) -> str:
        """Get the default agent name.

        Returns:
            Default agent name

        Raises:
            ValueError: If no valid default agent found
        """
        return await get_default_agent()

    async def list_agents_for_mode(self, mode: str) -> list[Agent]:
        """List agents for a specific mode.

        Args:
            mode: "primary" or "subagent"

        Returns:
            List of matching agents
        """
        return await list_agents_for_mode(mode)
