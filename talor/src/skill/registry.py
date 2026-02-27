"""Skill Registry for Talor.

This module provides centralized skill management following Claude Code's
two-stage loading mechanism:

1. Description Index: All skill descriptions are always in context
2. Full Instructions: Loaded on-demand via Skill tool

Reference: https://docs.claude.com/en/docs/claude-code/skills
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, TYPE_CHECKING

from src.skill.parser import SkillInfo, SkillParser
from src.skill.preprocessor import SkillPreprocessor

if TYPE_CHECKING:
    from src.bus import Bus

logger = logging.getLogger(__name__)


# Default token budget for skill descriptions (2% of context or 16000 chars)
DEFAULT_DESCRIPTION_BUDGET = 16000


class SkillRegistry:
    """Central registry for all skills.

    Implements Claude Code's two-stage loading:
    - Stage 1: Description index always in system prompt
    - Stage 2: Full instructions loaded via Skill tool

    Features:
    - Multi-source loading (enterprise, personal, project, plugin)
    - Priority-based override (enterprise > personal > project)
    - Token budget management for descriptions
    - Active skill state tracking
    """

    # Skill directories by priority (higher priority first)
    PERSONAL_DIR = Path.home() / ".talor" / "skills"
    PROJECT_DIR_NAME = ".talor/skills"

    def __init__(
        self,
        worktree: Path | None = None,
        bus: Any | None = None,
        description_budget: int = DEFAULT_DESCRIPTION_BUDGET,
    ) -> None:
        """Initialize the skill registry.

        Args:
            worktree: Project root directory
            bus: Optional Bus instance for events
            description_budget: Max chars for description index
        """
        self._worktree = worktree or Path.cwd()
        self._bus = bus
        self._description_budget = description_budget

        # Skill storage
        self._skills: dict[str, SkillInfo] = {}
        self._lock = asyncio.Lock()
        self._initialized = False

        # Active skill state (per session)
        self._active_skills: dict[str, list[str]] = {}  # session_id -> [skill_names]

    async def initialize(self) -> None:
        """Initialize and load all skills from configured directories."""
        if self._initialized:
            return

        await self._scan_all_directories()
        self._initialized = True

        logger.info(f"Skill registry initialized with {len(self._skills)} skills")

    async def _scan_all_directories(self) -> None:
        """Scan all skill directories in priority order."""
        # Load personal skills first (lower priority)
        if self.PERSONAL_DIR.exists():
            await self._scan_directory(self.PERSONAL_DIR, "personal")

        # Load project skills (higher priority, will override)
        project_dir = self._worktree / self.PROJECT_DIR_NAME
        if project_dir.exists():
            await self._scan_directory(project_dir, "project")

        # Scan nested directories for monorepo support
        await self._scan_nested_directories()

    async def _scan_directory(
        self,
        base_dir: Path,
        source_type: str,
    ) -> None:
        """Scan a single directory for skills.

        Args:
            base_dir: Base directory to scan
            source_type: "enterprise" | "personal" | "project" | "plugin"
        """
        if not base_dir.is_dir():
            return

        for skill_dir in base_dir.iterdir():
            if not skill_dir.is_dir():
                continue

            skill_md = skill_dir / "SKILL.md"
            skill = SkillParser.parse(skill_md)

            if skill:
                skill.source_type = source_type
                skill.supporting_files = SkillParser.scan_supporting_files(skill_dir)

                # Validate and log warnings
                warnings = SkillParser.validate(skill)
                for warning in warnings:
                    logger.warning(f"Skill '{skill.name}': {warning}")

                async with self._lock:
                    # Higher priority sources override lower priority
                    if skill.name in self._skills:
                        existing = self._skills[skill.name]
                        if self._should_override(source_type, existing.source_type):
                            self._skills[skill.name] = skill
                            logger.info(
                                f"Loaded skill: {skill.name} ({source_type}) "
                                f"[overriding {existing.source_type}]"
                            )
                    else:
                        self._skills[skill.name] = skill
                        logger.info(f"Loaded skill: {skill.name} ({source_type})")

    async def _scan_nested_directories(self) -> None:
        """Scan nested .talor/skills directories for monorepo support."""
        if not self._worktree.exists():
            return
        for subdir in self._worktree.iterdir():
            if subdir.is_dir() and not subdir.name.startswith('.'):
                nested_skills = subdir / self.PROJECT_DIR_NAME
                if nested_skills.exists():
                    await self._scan_directory(nested_skills, "project")

    def _should_override(self, new_type: str, existing_type: str) -> bool:
        """Check if new source type should override existing.

        Priority: enterprise > project > personal > plugin
        (project-level skills take precedence over personal ones)
        """
        priority = {"enterprise": 4, "project": 3, "personal": 2, "plugin": 1}
        return priority.get(new_type, 0) >= priority.get(existing_type, 0)

    # =========================================================================
    # Skill Access
    # =========================================================================

    async def get_skill(self, name: str) -> SkillInfo | None:
        """Get a skill by name.

        Args:
            name: Skill name

        Returns:
            SkillInfo or None if not found
        """
        async with self._lock:
            return self._skills.get(name)

    async def get_all_skills(self) -> list[SkillInfo]:
        """Get all loaded skills.

        Returns:
            List of all skills
        """
        async with self._lock:
            return list(self._skills.values())

    async def get_model_invocable_skills(self) -> list[SkillInfo]:
        """Get skills that LLM can automatically invoke.

        Returns:
            List of skills where disable_model_invocation is False
        """
        async with self._lock:
            return [s for s in self._skills.values() if s.is_model_invocable]

    async def get_user_invocable_skills(self) -> list[SkillInfo]:
        """Get skills that user can invoke via /skill-name.

        Returns:
            List of skills where user_invocable is True
        """
        async with self._lock:
            return [s for s in self._skills.values() if s.is_user_invocable]

    # =========================================================================
    # Description Index (Stage 1)
    # =========================================================================

    async def build_description_index(
        self,
        budget: int | None = None,
    ) -> str:
        """Build description index for system prompt.

        Only includes skills that LLM can invoke (is_model_invocable=True).
        Respects token budget to avoid context overflow.

        Args:
            budget: Max characters for descriptions (default: 16000)

        Returns:
            Formatted description index string
        """
        budget = budget or self._description_budget
        skills = await self.get_model_invocable_skills()

        if not skills:
            return ""

        # Sort by name for consistency
        skills.sort(key=lambda s: s.name)

        # Build entries within budget
        entries = []
        total_chars = 0

        for skill in skills:
            entry = skill.to_description_entry()
            if total_chars + len(entry) + 1 > budget:
                logger.warning(
                    f"Skill descriptions exceed budget ({budget} chars), "
                    f"some skills excluded"
                )
                break
            entries.append(entry)
            total_chars += len(entry) + 1

        if not entries:
            return ""

        return "\n".join(entries)

    # =========================================================================
    # Full Instructions (Stage 2)
    # =========================================================================

    async def load_skill_instructions(
        self,
        name: str,
        arguments: str = "",
        session_id: str | None = None,
    ) -> str | None:
        """Load full skill instructions with preprocessing.

        Called by Skill tool when LLM or user invokes a skill.

        Args:
            name: Skill name
            arguments: Arguments passed to skill
            session_id: Current session ID

        Returns:
            Processed instructions or None if skill not found
        """
        skill = await self.get_skill(name)
        if not skill:
            return None

        # Process instructions with variable substitution
        instructions = await SkillPreprocessor.process_async(
            skill.instructions,
            arguments=arguments,
            session_id=session_id,
            cwd=str(self._worktree),
        )

        return instructions

    # =========================================================================
    # Active Skill Management
    # =========================================================================

    def activate_skill(self, session_id: str, skill_name: str) -> None:
        """Mark a skill as active for a session.

        Args:
            session_id: Session ID
            skill_name: Skill name to activate
        """
        if session_id not in self._active_skills:
            self._active_skills[session_id] = []
        if skill_name not in self._active_skills[session_id]:
            self._active_skills[session_id].append(skill_name)

    def deactivate_skill(self, session_id: str, skill_name: str) -> None:
        """Deactivate a skill for a session.

        Args:
            session_id: Session ID
            skill_name: Skill name to deactivate
        """
        if session_id in self._active_skills:
            if skill_name in self._active_skills[session_id]:
                self._active_skills[session_id].remove(skill_name)

    def get_active_skills(self, session_id: str) -> list[str]:
        """Get active skill names for a session.

        Args:
            session_id: Session ID

        Returns:
            List of active skill names
        """
        return self._active_skills.get(session_id, [])

    async def get_active_skill_tools(
        self,
        session_id: str,
    ) -> set[str] | None:
        """Get allowed tools from active skills.

        Returns intersection of all active skills' allowed_tools.

        Args:
            session_id: Session ID

        Returns:
            Set of allowed tool names, or None if no restrictions
        """
        active_names = self.get_active_skills(session_id)
        if not active_names:
            return None

        allowed: set[str] | None = None

        for name in active_names:
            skill = await self.get_skill(name)
            if skill and skill.allowed_tools:
                if allowed is None:
                    allowed = set(skill.allowed_tools)
                else:
                    allowed &= set(skill.allowed_tools)

        return allowed

    def clear_session(self, session_id: str) -> None:
        """Clear active skills for a session.

        Args:
            session_id: Session ID
        """
        self._active_skills.pop(session_id, None)

    # =========================================================================
    # Reload and Management
    # =========================================================================

    async def reload(self) -> None:
        """Reload all skills from directories."""
        async with self._lock:
            self._skills.clear()

        await self._scan_all_directories()
        logger.info(f"Skills reloaded: {len(self._skills)} skills")

    @property
    def skill_count(self) -> int:
        """Get the number of loaded skills."""
        return len(self._skills)

    @property
    def initialized(self) -> bool:
        """Check if the registry is initialized."""
        return self._initialized
