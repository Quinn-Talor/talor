"""Skill System for Talor.

This module provides the skill system following Claude Agent Skills specification.

Features:
- SKILL.md parsing with YAML frontmatter
- Two-stage loading: description index + on-demand full instructions
- Skill registry with multi-source support
- Variable substitution ($ARGUMENTS, !`command`)
- Skill tool for LLM invocation

Example:
    ```python
    from src.skill import SkillRegistry, SkillTool

    # Initialize registry
    registry = SkillRegistry(worktree=Path("."))
    await registry.initialize()

    # Get description index for system prompt (Stage 1)
    index = await registry.build_description_index()

    # Load full instructions via Skill tool (Stage 2)
    instructions = await registry.load_skill_instructions("my-skill", arguments="arg1")
    ```
"""

from src.skill.parser import SkillInfo, SkillParser
from src.skill.loader import SkillLoader
from src.skill.matcher import SkillMatcher, SkillMatch
from src.skill.preprocessor import SkillPreprocessor
from src.skill.registry import SkillRegistry
from src.skill.tool import SkillTool, create_skill_tool

__all__ = [
    "SkillInfo",
    "SkillParser",
    "SkillLoader",
    "SkillMatcher",
    "SkillMatch",
    "SkillPreprocessor",
    "SkillRegistry",
    "SkillTool",
    "create_skill_tool",
]
