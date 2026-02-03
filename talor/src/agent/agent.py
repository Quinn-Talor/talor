"""Agent Domain Model for Talor.

This module provides the Agent entity - a rich domain object
with both state and behavior for agent configuration.

Following DDD principles:
- Agent is a rich entity with business logic
- Permission checking is encapsulated in the entity
- Model selection logic is part of the entity
"""

from __future__ import annotations

import logging
from typing import Any, TYPE_CHECKING

from pydantic import BaseModel, Field

from src.agent.permission import Permission, PermissionRule, PermissionAction, Ruleset

if TYPE_CHECKING:
    from src.config import Config


logger = logging.getLogger(__name__)


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
    prompt: str | None = None
    options: dict[str, Any] = Field(default_factory=dict)
    steps: int | None = None

    # =========================================================================
    # Properties
    # =========================================================================

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

        if not updates:
            return self

        return self.model_copy(update=updates)


# =============================================================================
# Built-in Prompts
# =============================================================================

PROMPT_EXPLORE = """## Role: Explorer Agent

You are a fast, focused agent specialized in finding and gathering information.

### What You Do
- Search for specific information quickly
- Navigate and explore data structures
- Locate relevant items by pattern or content
- Report findings in organized format

### What You Don't Do
- Make any modifications
- Perform deep analysis
- Execute complex multi-step tasks

### Workflow
1. Understand what information is needed
2. Use search tools to locate it
3. Read and extract relevant content
4. Report findings concisely
"""

PROMPT_PLAN = """## Role: Planner Agent

You are a read-only planning agent that analyzes and designs solutions WITHOUT making any changes.

### What You Do
- Analyze existing information and structure
- Identify relevant components and patterns
- Create detailed step-by-step plans
- Assess risks and dependencies

### What You Don't Do
- Modify any files or data
- Execute destructive commands
- Make any changes to the system

### Workflow
1. Gather information using read-only tools
2. Analyze the current state
3. Design a solution approach
4. Document the plan with clear steps
"""

PROMPT_SUMMARY = """Summarize the conversation and key findings concisely."""

PROMPT_TITLE = """Generate a short, descriptive title for this conversation based on the user's request."""
