"""Skill Parser for Talor.

This module provides SKILL.md parsing following Claude Agent Skills specification.

Features:
- YAML frontmatter parsing with all Claude Code fields
- Required field validation (name, description)
- Optional fields: allowed-tools, model, context, agent, hooks
- Invocation control: disable-model-invocation, user-invocable
- Supporting file scanning
- $ARGUMENTS and !`command` preprocessing support

Reference: https://docs.claude.com/en/docs/claude-code/skills
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
        name: Unique identifier (lowercase, hyphens, max 64 chars)
        description: Description for discovery matching (used by LLM)
        argument_hint: Hint shown during autocomplete (e.g., "[issue-number]")
        disable_model_invocation: If True, only user can invoke via /name
        user_invocable: If False, hidden from / menu (background knowledge)
        allowed_tools: Tools allowed when skill is active (e.g., "Bash(python *)")
        model: Model to use when skill is active
        context: "fork" to run in subagent context
        agent: Subagent type when context=fork (e.g., "Explore", "Plan")
        hooks: Hooks scoped to skill lifecycle
        instructions: Markdown instruction content (supports $ARGUMENTS, !`cmd`)
        source_path: Path to SKILL.md file
        source_type: "enterprise" | "personal" | "project" | "plugin"
        supporting_files: Dictionary of supporting files (scripts, templates)
    """

    # Required fields
    name: str
    description: str

    # Invocation control
    argument_hint: str | None = None
    disable_model_invocation: bool = False
    user_invocable: bool = True

    # Tool and model control
    allowed_tools: list[str] | None = None
    model: str | None = None

    # Subagent execution
    context: str | None = None  # "fork" or None
    agent: str | None = None    # "Explore", "Plan", "general-purpose", or custom

    # Lifecycle hooks
    hooks: dict[str, Any] | None = None

    # Content
    instructions: str = ""

    # Metadata
    source_path: Path | None = None
    source_type: str = "project"  # "enterprise" | "personal" | "project" | "plugin"
    supporting_files: dict[str, Path] = field(default_factory=dict)

    # Runtime state (set when skill is activated)
    _active: bool = field(default=False, repr=False)
    _processed_instructions: str | None = field(default=None, repr=False)

    @property
    def is_model_invocable(self) -> bool:
        """Check if LLM can automatically invoke this skill."""
        return not self.disable_model_invocation

    @property
    def is_user_invocable(self) -> bool:
        """Check if user can invoke via /skill-name."""
        return self.user_invocable

    @property
    def runs_in_fork(self) -> bool:
        """Check if skill runs in forked subagent context."""
        return self.context == "fork"

    @property
    def skill_dir(self) -> Path | None:
        """Get the skill directory path."""
        if self.source_path:
            return self.source_path.parent
        return None

    def get_processed_instructions(self, arguments: str = "") -> str:
        """Get instructions with $ARGUMENTS replaced.

        Args:
            arguments: Arguments passed when invoking skill

        Returns:
            Processed instructions string
        """
        from src.skill.preprocessor import SkillPreprocessor
        return SkillPreprocessor.process(self.instructions, arguments)

    def to_description_entry(self) -> str:
        """Format skill for description index in system prompt.

        Returns:
            Formatted description entry
        """
        entry = f"- {self.name}: {self.description}"
        if self.argument_hint:
            entry += f" {self.argument_hint}"
        if self.disable_model_invocation:
            entry += " (manual invocation only)"
        return entry


class SkillParser:
    """SKILL.md parser following Claude Agent Skills specification.

    Parses all frontmatter fields defined in Claude Code:
    - name, description (required, but name defaults to directory name)
    - argument-hint, disable-model-invocation, user-invocable
    - allowed-tools, model, context, agent, hooks
    """

    # Pattern to match YAML frontmatter
    FRONTMATTER_PATTERN = re.compile(
        r'^---\s*\n(.*?)\n---\s*\n(.*)',
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

        # Get name (use directory name if not specified)
        name = frontmatter.get('name')
        if not name:
            name = path.parent.name

        # Get description (use first paragraph if not specified)
        description = frontmatter.get('description')
        if not description:
            # Extract first paragraph from instructions
            first_para = instructions.strip().split('\n\n')[0]
            # Remove markdown headers
            first_para = re.sub(r'^#+\s*', '', first_para)
            description = first_para[:200] if first_para else f"Skill: {name}"

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
            argument_hint=frontmatter.get('argument-hint'),
            disable_model_invocation=frontmatter.get('disable-model-invocation', False),
            user_invocable=frontmatter.get('user-invocable', True),
            allowed_tools=allowed_tools,
            model=frontmatter.get('model'),
            context=frontmatter.get('context'),
            agent=frontmatter.get('agent'),
            hooks=frontmatter.get('hooks'),
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

        # Check name format (lowercase, hyphens, max 64 chars)
        if not re.match(r'^[a-z][a-z0-9-]*$', skill.name):
            warnings.append(
                f"Skill name '{skill.name}' should be lowercase with hyphens"
            )

        if len(skill.name) > 64:
            warnings.append(
                f"Skill name '{skill.name}' exceeds 64 characters"
            )

        # Check description length
        if len(skill.description) < 20:
            warnings.append(
                f"Skill description is too short ({len(skill.description)} chars)"
            )

        # Check for empty instructions
        if not skill.instructions:
            warnings.append("Skill has no instructions")

        # Validate context field
        if skill.context and skill.context != "fork":
            warnings.append(
                f"Invalid context value '{skill.context}', must be 'fork' or omitted"
            )

        return warnings
