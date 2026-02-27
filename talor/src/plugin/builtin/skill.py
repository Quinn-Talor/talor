"""Skill Plugin for Talor.

Implements Claude Code's two-stage skill loading:
- Stage 1: Description index always injected into system prompt
- Stage 2: Full instructions loaded on-demand via Skill tool

The LLM sees all skill descriptions and decides which to invoke.
When invoked, the Skill tool loads full instructions into context.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult
from src.skill.registry import SkillRegistry

logger = logging.getLogger(__name__)


class SkillPlugin(PromptPlugin):
    """Skill Plugin using two-stage loading (Claude Code style).

    Stage 1: Injects skill description index into system prompt.
    Stage 2: Full instructions loaded via Skill tool (on-demand).
    """

    def __init__(self) -> None:
        super().__init__(
            name="skill",
            priority=PluginPriority.SKILL,
            enabled=True,
            required=True,
        )
        self._registry: SkillRegistry | None = None
        self._initialized = False

    async def initialize(self, worktree: Path | None = None) -> None:
        """Initialize the skill registry."""
        if self._initialized:
            return
        self._registry = SkillRegistry(worktree=worktree)
        await self._registry.initialize()
        self._initialized = True

    async def build(self, context: PluginContext) -> PluginResult | None:
        """Build Stage 1: inject skill description index into system prompt."""
        if not self._registry:
            self._registry = SkillRegistry(worktree=context.worktree)
            await self._registry.initialize()
            self._initialized = True

        description_index = await self._registry.build_description_index()
        if not description_index:
            return None

        content = (
            "## Available Skills\n\n"
            "You have access to the following skills. Use the `skill` tool to load "
            "a skill's full instructions when the user's request matches its purpose.\n\n"
            f"{description_index}"
        )

        return PluginResult(
            content=content,
            section="skill",
            metadata={
                "skill_count": self._registry.skill_count,
                "stage": "description_index",
            },
        )

    async def list_skills(self) -> list[dict[str, Any]]:
        """List all available skills."""
        if not self._registry:
            return []
        skills = await self._registry.get_all_skills()
        return [
            {
                "name": s.name,
                "description": s.description,
                "allowed_tools": s.allowed_tools,
                "source_type": s.source_type,
                "user_invocable": s.user_invocable,
                "disable_model_invocation": s.disable_model_invocation,
            }
            for s in skills
        ]

    async def get_skill(self, name: str) -> dict[str, Any] | None:
        """Get a skill by name."""
        if not self._registry:
            return None
        skill = await self._registry.get_skill(name)
        if not skill:
            return None
        return {
            "name": skill.name,
            "description": skill.description,
            "allowed_tools": skill.allowed_tools,
            "instructions": skill.instructions,
            "source_type": skill.source_type,
            "supporting_files": list(skill.supporting_files.keys()),
        }

    async def reload_skills(self) -> None:
        """Reload all skills."""
        if self._registry:
            await self._registry.reload()

    @property
    def registry(self) -> SkillRegistry | None:
        """Get the skill registry."""
        return self._registry

    @property
    def skill_count(self) -> int:
        """Get the number of loaded skills."""
        return self._registry.skill_count if self._registry else 0
