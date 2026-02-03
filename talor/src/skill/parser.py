"""Skill Parser for Talor.

This module provides SKILL.md parsing following Claude Agent Skills specification.

Features:
- YAML frontmatter parsing
- Required field validation (name, description)
- Optional allowed-tools parsing
- Supporting file scanning
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)


@dataclass
class SkillInfo:
    """Skill information following Claude Agent Skills specification.

    Attributes:
        name: Unique identifier (lowercase, hyphens)
        description: Description for discovery matching
        allowed_tools: Optional list of allowed tools
        instructions: Markdown instruction content
        source_path: Path to SKILL.md file
        source_type: "project" or "personal"
        supporting_files: Dictionary of supporting files
    """

    # Required fields
    name: str
    description: str

    # Optional fields
    allowed_tools: list[str] | None = None

    # Content
    instructions: str = ""

    # Metadata
    source_path: Path | None = None
    source_type: str = "project"  # "project" | "personal"
    supporting_files: dict[str, Path] = field(default_factory=dict)


class SkillParser:
    """SKILL.md parser following Claude Agent Skills specification."""

    # Pattern to match YAML frontmatter
    FRONTMATTER_PATTERN = re.compile(
        r'^---\s*\n(.*?)\n---\s*\n(.*)$',
        re.DOTALL
    )


    @classmethod
    def parse(cls, path: Path) -> SkillInfo | None:
        """Parse a SKILL.md file.

        Args:
            path: Path to SKILL.md file

        Returns:
            SkillInfo or None if parsing fails
        """
        if not path.exists():
            logger.warning(f"SKILL.md not found: {path}")
            return None

        try:
            content = path.read_text(encoding='utf-8')
        except Exception as e:
            logger.error(f"Failed to read SKILL.md: {path}, error: {e}")
            return None

        # Match frontmatter pattern
        match = cls.FRONTMATTER_PATTERN.match(content)
        if not match:
            logger.warning(f"Invalid SKILL.md format (no frontmatter): {path}")
            return None

        frontmatter_str, instructions = match.groups()

        # Parse YAML frontmatter
        try:
            frontmatter = yaml.safe_load(frontmatter_str)
        except yaml.YAMLError as e:
            logger.error(f"Failed to parse YAML frontmatter: {path}, error: {e}")
            return None

        if not isinstance(frontmatter, dict):
            logger.warning(f"Invalid frontmatter format: {path}")
            return None

        # Validate required fields
        name = frontmatter.get('name')
        description = frontmatter.get('description')

        if not name:
            logger.warning(f"Missing required field 'name': {path}")
            return None

        if not description:
            logger.warning(f"Missing required field 'description': {path}")
            return None

        # Parse allowed-tools (optional)
        allowed_tools = None
        if 'allowed-tools' in frontmatter:
            tools_str = frontmatter['allowed-tools']
            if isinstance(tools_str, str):
                allowed_tools = [t.strip() for t in tools_str.split(',')]
            elif isinstance(tools_str, list):
                allowed_tools = tools_str

        return SkillInfo(
            name=name,
            description=description,
            allowed_tools=allowed_tools,
            instructions=instructions.strip(),
            source_path=path,
        )

    @classmethod
    def scan_supporting_files(cls, skill_dir: Path) -> dict[str, Path]:
        """Scan a skill directory for supporting files.

        Args:
            skill_dir: Path to skill directory

        Returns:
            Dictionary mapping relative paths to absolute paths
        """
        files: dict[str, Path] = {}

        if not skill_dir.is_dir():
            return files

        for item in skill_dir.rglob('*'):
            if item.is_file() and item.name != 'SKILL.md':
                rel_path = item.relative_to(skill_dir)
                files[str(rel_path)] = item

        return files

    @classmethod
    def validate(cls, skill: SkillInfo) -> list[str]:
        """Validate a skill and return any warnings.

        Args:
            skill: SkillInfo to validate

        Returns:
            List of warning messages
        """
        warnings = []

        # Check name format (lowercase, hyphens)
        if not re.match(r'^[a-z][a-z0-9-]*$', skill.name):
            warnings.append(
                f"Skill name '{skill.name}' should be lowercase with hyphens"
            )

        # Check description length
        if len(skill.description) < 20:
            warnings.append(
                f"Skill description is too short ({len(skill.description)} chars)"
            )

        # Check for empty instructions
        if not skill.instructions:
            warnings.append("Skill has no instructions")

        return warnings
