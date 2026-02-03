"""Skill System for Talor.

This module provides the skill system following Claude Agent Skills specification.

Features:
- SKILL.md parsing with YAML frontmatter
- Skill loading from personal and project directories
- Skill matching based on description keywords
- Hot-reloading support

Example:
    ```python
    from src.skill import SkillLoader, SkillMatcher

    # Load skills
    loader = SkillLoader()
    await loader.initialize()

    # Match skills to request
    skills = await loader.get_all_skills()
    matcher = SkillMatcher(skills)
    matches = matcher.match("review code for style")
    ```
"""

from src.skill.parser import SkillInfo, SkillParser
from src.skill.loader import SkillLoader
from src.skill.matcher import SkillMatcher, SkillMatch

__all__ = [
    "SkillInfo",
    "SkillParser",
    "SkillLoader",
    "SkillMatcher",
    "SkillMatch",
]
