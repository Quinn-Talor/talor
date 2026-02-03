"""Agent Management for Talor.

This module provides agent configuration and management for the ReAct loop.

Features:
- Agent configuration with model, prompt, permissions
- Built-in agents (build, plan, general, explore)
- Agent listing and selection
- Custom agent support
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
# Agent Info
# =============================================================================

class AgentModel(BaseModel):
    """Agent model configuration."""
    model_id: str
    provider_id: str


class AgentInfo(BaseModel):
    """Agent configuration.

    Defines an agent's behavior, permissions, and model settings.

    Attributes:
        name: Agent unique identifier
        description: Agent description
        mode: Agent mode (primary, subagent, all)
        native: Whether this is a built-in agent
        hidden: Whether agent is hidden from UI
        top_p: Top-p sampling parameter
        temperature: Temperature parameter
        color: Display color
        permission: Permission ruleset
        model: Optional model override
        prompt: Optional system prompt
        options: Additional options
        steps: Maximum steps
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
    model: AgentModel | None = None
    prompt: str | None = None
    options: dict[str, Any] = Field(default_factory=dict)
    steps: int | None = None

    def get_permission_ruleset(self) -> Ruleset:
        """Get permission ruleset from config."""
        rules = []
        for rule_dict in self.permission:
            rules.append(PermissionRule(**rule_dict))
        return rules


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


# =============================================================================
# Agent Namespace
# =============================================================================

class Agent:
    """Agent management namespace.

    Provides methods for agent configuration, listing, and selection.
    """

    # Class-level state
    _config: Any | None = None
    _agents_cache: dict[str, AgentInfo] | None = None

    @classmethod
    def configure(cls, config: Any = None) -> None:
        """Configure the agent system.

        Args:
            config: Config instance
        """
        cls._config = config
        cls._agents_cache = None

    @classmethod
    async def _load_agents(cls) -> dict[str, AgentInfo]:
        """Load all agents from config and defaults."""
        if cls._agents_cache is not None:
            return cls._agents_cache

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
        agents: dict[str, AgentInfo] = {
            "build": AgentInfo(
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
            "plan": AgentInfo(
                name="plan",
                description="Plan mode. Disallows all edit tools.",
                mode="primary",
                native=True,
                prompt=PROMPT_PLAN,
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
            "general": AgentInfo(
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
            "explore": AgentInfo(
                name="explore",
                description="Fast agent specialized for exploring and gathering information.",
                mode="subagent",
                native=True,
                prompt=PROMPT_EXPLORE,
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
            "title": AgentInfo(
                name="title",
                description="Generate conversation titles.",
                mode="primary",
                native=True,
                hidden=True,
                temperature=0.5,
                prompt=PROMPT_TITLE,
                permission=[r.model_dump() for r in Permission.from_config({"*": "deny"})],
            ),
            "summary": AgentInfo(
                name="summary",
                description="Summarize conversations.",
                mode="primary",
                native=True,
                hidden=True,
                prompt=PROMPT_SUMMARY,
                permission=[r.model_dump() for r in Permission.from_config({"*": "deny"})],
            ),
        }

        # Load custom agents from config
        if cls._config:
            config = await cls._config.get()
            for name, agent_config in config.get("agent", {}).items():
                if agent_config.get("disable"):
                    agents.pop(name, None)
                    continue

                if name in agents:
                    # Update existing agent
                    agent = agents[name]
                    if "model" in agent_config:
                        agent.model = AgentModel(**agent_config["model"])
                    if "prompt" in agent_config:
                        agent.prompt = agent_config["prompt"]
                    if "description" in agent_config:
                        agent.description = agent_config["description"]
                    if "temperature" in agent_config:
                        agent.temperature = agent_config["temperature"]
                    if "top_p" in agent_config:
                        agent.top_p = agent_config["top_p"]
                    if "mode" in agent_config:
                        agent.mode = agent_config["mode"]
                    if "color" in agent_config:
                        agent.color = agent_config["color"]
                    if "hidden" in agent_config:
                        agent.hidden = agent_config["hidden"]
                    if "steps" in agent_config:
                        agent.steps = agent_config["steps"]
                    if "permission" in agent_config:
                        user_rules = Permission.from_config(agent_config["permission"])
                        agent.permission = [
                            r.model_dump() for r in Permission.merge(
                                agent.get_permission_ruleset(),
                                user_rules,
                            )
                        ]
                else:
                    # Create new agent
                    agents[name] = AgentInfo(
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
                        permission=[
                            r.model_dump() for r in Permission.merge(
                                default_rules,
                                Permission.from_config(agent_config.get("permission", {})),
                            )
                        ],
                    )

        cls._agents_cache = agents
        return agents

    @classmethod
    async def get(cls, name: str) -> AgentInfo | None:
        """Get an agent by name.

        Args:
            name: Agent name

        Returns:
            AgentInfo or None
        """
        agents = await cls._load_agents()
        return agents.get(name)

    @classmethod
    async def list(cls, include_hidden: bool = False) -> list[AgentInfo]:
        """List all agents.

        Args:
            include_hidden: Include hidden agents

        Returns:
            List of AgentInfo
        """
        agents = await cls._load_agents()
        result = list(agents.values())

        if not include_hidden:
            result = [a for a in result if not a.hidden]

        # Sort: default agent first, then by name
        default_name = "build"
        if cls._config:
            config = await cls._config.get()
            default_name = config.get("default_agent", "build")

        result.sort(key=lambda a: (a.name != default_name, a.name))

        return result

    @classmethod
    async def default_agent(cls) -> str:
        """Get the default agent name.

        Returns:
            Default agent name
        """
        default_name = "build"

        if cls._config:
            config = await cls._config.get()
            default_name = config.get("default_agent", "build")

        agents = await cls._load_agents()

        if default_name in agents:
            agent = agents[default_name]
            if agent.mode == "subagent":
                raise ValueError(f"Default agent '{default_name}' is a subagent")
            if agent.hidden:
                raise ValueError(f"Default agent '{default_name}' is hidden")
            return default_name

        # Find first primary visible agent
        for agent in agents.values():
            if agent.mode != "subagent" and not agent.hidden:
                return agent.name

        raise ValueError("No primary visible agent found")

    @classmethod
    async def list_for_mode(cls, mode: str) -> list[AgentInfo]:
        """List agents for a specific mode.

        Args:
            mode: "primary" or "subagent"

        Returns:
            List of matching agents
        """
        agents = await cls.list(include_hidden=False)
        return [a for a in agents if a.mode == mode or a.mode == "all"]

    @classmethod
    def clear_cache(cls) -> None:
        """Clear agent cache (for testing)."""
        cls._agents_cache = None
