"""Skill Plugin for Talor.

This plugin provides skill-based prompt enhancement following
Claude Agent Skills specification.

Features:
- Automatic skill discovery based on request
- Skill content injection
- Tool restrictions from skills
- Skill listing API
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult
from src.skill.loader import SkillLoader
from src.skill.matcher import SkillMatcher


class SkillPlugin(PromptPlugin):
    """Skill Plugin following Claude Agent Skills specification.

    Responsibilities:
    - Load skills from personal and project directories
    - Match skills to user requests
    - Inject skill content into prompts
    - Apply tool restrictions from skills
    """

    # Maximum number of skills to include
    MAX_SKILLS = 3

    def __init__(self) -> None:
        """Initialize the skill plugin."""
        super().__init__(
            name="skill",
            priority=PluginPriority.SKILL,
            enabled=True,
            required=True,
        )
        self._loader: SkillLoader | None = None
        self._initialized = False

    async def initialize(self, worktree: Path | None = None) -> None:
        """Initialize the skill loader.

        Args:
            worktree: Project root directory
        """
        if self._initialized:
            return

        self._loader = SkillLoader(worktree)
        await self._loader.initialize()
        self._initialized = True

    async def build(self, context: PluginContext) -> PluginResult | None:
        """Build skill prompt content.

        Args:
            context: Plugin execution context

        Returns:
            PluginResult with skill content, or None if no skills match
        """
        # Initialize loader if needed
        if not self._loader:
            self._loader = SkillLoader(context.worktree)
            await self._loader.initialize()
            self._initialized = True

        # Get all skills
        all_skills = await self._loader.get_all_skills()

        if not all_skills:
            return None

        # Match skills to user request
        matcher = SkillMatcher(all_skills)
        matches = matcher.match(context.user_request)

        if not matches:
            return None

        # Build skill content
        skill_contents = []
        tool_restrictions: set[str] | None = None
        matched_skill_names = []

        for match in matches[:self.MAX_SKILLS]:
            skill = match.skill
            matched_skill_names.append(skill.name)

            # Format skill content
            skill_contents.append(
                f'<skill name="{skill.name}">\n{skill.instructions}\n</skill>'
            )

            # Collect tool restrictions (intersection)
            if skill.allowed_tools:
                if tool_restrictions is None:
                    tool_restrictions = set(skill.allowed_tools)
                else:
                    tool_restrictions &= set(skill.allowed_tools)

        return PluginResult(
            content="\n\n".join(skill_contents),
            section="skill",
            tool_restrictions=list(tool_restrictions) if tool_restrictions else None,
            metadata={
                "matched_skills": matched_skill_names,
                "match_scores": {m.skill.name: m.score for m in matches[:self.MAX_SKILLS]},
            },
        )

    async def list_skills(self) -> list[dict[str, Any]]:
        """List all available skills.

        Returns:
            List of skill metadata
        """
        if not self._loader:
            return []

        return await self._loader.list_skills()

    async def get_skill(self, name: str) -> dict[str, Any] | None:
        """Get a skill by name.

        Args:
            name: Skill name

        Returns:
            Skill metadata or None if not found
        """
        if not self._loader:
            return None

        skill = await self._loader.get_skill(name)
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
        if self._loader:
            await self._loader.reload()

    @property
    def skill_count(self) -> int:
        """Get the number of loaded skills."""
        if self._loader:
            return self._loader.skill_count
        return 0
