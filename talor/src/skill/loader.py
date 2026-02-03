"""Skill Loader for Talor.

This module provides skill loading from personal and project directories.

Features:
- Personal skills from ~/.talor/skills/
- Project skills from .talor/skills/
- Priority-based override (project > personal)
- Hot-reloading support
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from src.skill.parser import SkillInfo, SkillParser

logger = logging.getLogger(__name__)


class SkillLoader:
    """Skill loader with hot-reloading support.

    Loads skills from personal and project directories following
    Claude Agent Skills specification.

    Priority order:
    1. Project skills (.talor/skills/) - highest priority
    2. Personal skills (~/.talor/skills/) - lower priority
    """

    # Default directories
    PERSONAL_DIR = Path.home() / ".talor" / "skills"
    PROJECT_DIR_NAME = ".talor/skills"

    def __init__(self, worktree: Path | None = None) -> None:
        """Initialize the skill loader.

        Args:
            worktree: Project root directory
        """
        self._worktree = worktree or Path.cwd()
        self._skills: dict[str, SkillInfo] = {}
        self._lock = asyncio.Lock()
        self._initialized = False

    async def initialize(self) -> None:
        """Initialize and load all skills."""
        if self._initialized:
            return

        await self._scan_all_directories()
        self._initialized = True

        logger.info(f"Skill loader initialized with {len(self._skills)} skills")

    async def _scan_all_directories(self) -> None:
        """Scan all skill directories."""
        # Load personal skills first (lower priority)
        if self.PERSONAL_DIR.exists():
            await self._scan_directory(self.PERSONAL_DIR, "personal")

        # Load project skills (higher priority, will override)
        project_dir = self._worktree / self.PROJECT_DIR_NAME
        if project_dir.exists():
            await self._scan_directory(project_dir, "project")

    async def _scan_directory(
        self,
        base_dir: Path,
        source_type: str,
    ) -> None:
        """Scan a single directory for skills.

        Args:
            base_dir: Base directory to scan
            source_type: "project" or "personal"
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
                    # Project skills override personal skills
                    if skill.name in self._skills:
                        existing = self._skills[skill.name]
                        if source_type == "project" or existing.source_type != "project":
                            self._skills[skill.name] = skill
                            logger.info(
                                f"Loaded skill: {skill.name} ({source_type}) "
                                f"[overriding {existing.source_type}]"
                            )
                    else:
                        self._skills[skill.name] = skill
                        logger.info(f"Loaded skill: {skill.name} ({source_type})")

    async def reload(self) -> None:
        """Reload all skills."""
        async with self._lock:
            self._skills.clear()

        await self._scan_all_directories()
        logger.info(f"Skills reloaded: {len(self._skills)} skills")

    async def get_all_skills(self) -> list[SkillInfo]:
        """Get all loaded skills.

        Returns:
            List of all skills
        """
        async with self._lock:
            return list(self._skills.values())

    async def get_skill(self, name: str) -> SkillInfo | None:
        """Get a skill by name.

        Args:
            name: Skill name

        Returns:
            SkillInfo or None if not found
        """
        async with self._lock:
            return self._skills.get(name)

    async def list_skills(self) -> list[dict[str, Any]]:
        """List all skills with metadata.

        Returns:
            List of skill metadata dictionaries
        """
        async with self._lock:
            return [
                {
                    "name": s.name,
                    "description": s.description,
                    "allowed_tools": s.allowed_tools,
                    "source_type": s.source_type,
                    "has_supporting_files": len(s.supporting_files) > 0,
                }
                for s in self._skills.values()
            ]

    @property
    def skill_count(self) -> int:
        """Get the number of loaded skills."""
        return len(self._skills)

    @property
    def initialized(self) -> bool:
        """Check if the loader is initialized."""
        return self._initialized
