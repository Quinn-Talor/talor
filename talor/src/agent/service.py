"""Agent Service for Talor.

This module provides the application service for Agent operations.
The service is an object instance, not a class with static methods.

Following DDD principles:
- Service orchestrates use cases (loading, caching, listing)
- Business logic delegated to Agent entity
- No business rules in service layer

Example:
    ```python
    service = AgentService(config_service=config)

    agents = await service.list_agents()
    agent = await service.get_agent("build")
    default = await service.get_default_agent()
    ```
"""

from __future__ import annotations

import logging
from typing import Any, TYPE_CHECKING

from src.agent.agent import (
    Agent,
    ModelConfig,
    PROMPT_EXPLORE,
    PROMPT_PLAN,
    PROMPT_SUMMARY,
    PROMPT_TITLE,
)
from src.agent.permission import Permission

if TYPE_CHECKING:
    from src.config.service import ConfigService


logger = logging.getLogger(__name__)


class AgentService:
    """Application service for Agent operations.

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
        self._config_service = config_service
        self._agents_cache: dict[str, Agent] | None = None

    def clear_cache(self) -> None:
        """Clear agent cache."""
        self._agents_cache = None

    # =========================================================================
    # Agent Loading
    # =========================================================================

    async def _load_agents(self) -> dict[str, Agent]:
        """Load all agents from config and defaults."""
        if self._agents_cache is not None:
            return self._agents_cache

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
            "title": Agent(
                name="title",
                description="Generate conversation titles.",
                mode="primary",
                native=True,
                hidden=True,
                temperature=0.5,
                prompt=PROMPT_TITLE,
                permission=[r.model_dump() for r in Permission.from_config({"*": "deny"})],
            ),
            "summary": Agent(
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
        if self._config_service:
            config = await self._config_service.get()
            for name, agent_config in config.get("agent", {}).items():
                if agent_config.get("disable"):
                    agents.pop(name, None)
                    continue

                if name in agents:
                    # Use entity's update_from_config method (DDD pattern)
                    agents[name] = agents[name].update_from_config(agent_config)
                else:
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
                        permission=[
                            r.model_dump() for r in Permission.merge(
                                default_rules,
                                Permission.from_config(agent_config.get("permission", {})),
                            )
                        ],
                    )

        self._agents_cache = agents
        return agents

    # =========================================================================
    # Agent Operations
    # =========================================================================

    async def get_agent(self, name: str) -> Agent | None:
        """Get an agent by name.

        Args:
            name: Agent name

        Returns:
            Agent or None
        """
        agents = await self._load_agents()
        return agents.get(name)

    async def list_agents(self, include_hidden: bool = False) -> list[Agent]:
        """List all agents.

        Args:
            include_hidden: Include hidden agents

        Returns:
            List of Agent
        """
        agents = await self._load_agents()
        result = list(agents.values())

        if not include_hidden:
            result = [a for a in result if not a.hidden]

        # Sort: default agent first, then by name
        default_name = "build"
        if self._config_service:
            config = await self._config_service.get()
            default_name = config.get("default_agent", "build")

        result.sort(key=lambda a: (a.name != default_name, a.name))

        return result

    async def get_default_agent(self) -> str:
        """Get the default agent name.

        Returns:
            Default agent name

        Raises:
            ValueError: If no valid default agent found
        """
        default_name = "build"

        if self._config_service:
            config = await self._config_service.get()
            default_name = config.get("default_agent", "build")

        agents = await self._load_agents()

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

    async def list_agents_for_mode(self, mode: str) -> list[Agent]:
        """List agents for a specific mode.

        Args:
            mode: "primary" or "subagent"

        Returns:
            List of matching agents
        """
        agents = await self.list_agents(include_hidden=False)
        return [a for a in agents if a.mode == mode or a.mode == "all"]
