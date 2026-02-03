"""Skill Matcher for Talor.

This module provides skill matching based on description keywords.

Features:
- Keyword extraction from text
- Jaccard similarity calculation
- Threshold-based filtering
- Score-based ranking
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from src.skill.parser import SkillInfo


@dataclass
class SkillMatch:
    """Skill match result.

    Attributes:
        skill: Matched skill
        score: Match score (0-1)
        matched_keywords: Keywords that matched
    """
    skill: SkillInfo
    score: float
    matched_keywords: list[str]


class SkillMatcher:
    """Skill matcher based on description keywords.

    Uses Jaccard similarity to match user requests against skill descriptions.
    """

    # Common stopwords to filter out
    STOPWORDS = {
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
        'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
        'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
        'below', 'between', 'under', 'again', 'further', 'then', 'once',
        'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few',
        'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
        'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but',
        'if', 'or', 'because', 'until', 'while', 'although', 'though',
        'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
        'use', 'using', 'used',
    }

    # Minimum keyword length
    MIN_KEYWORD_LENGTH = 3

    def __init__(self, skills: list[SkillInfo]) -> None:
        """Initialize the matcher.

        Args:
            skills: List of skills to match against
        """
        self._skills = skills
        self._keyword_cache: dict[str, set[str]] = {}

        # Pre-compute keywords for all skills
        for skill in skills:
            self._keyword_cache[skill.name] = set(
                self._extract_keywords(skill.description)
            )

    def _extract_keywords(self, text: str) -> list[str]:
        """Extract keywords from text.

        Args:
            text: Text to extract keywords from

        Returns:
            List of keywords
        """
        # Extract words
        words = re.findall(r'\b\w+\b', text.lower())

        # Filter stopwords and short words
        keywords = [
            w for w in words
            if w not in self.STOPWORDS and len(w) >= self.MIN_KEYWORD_LENGTH
        ]

        return keywords

    def match(
        self,
        request: str,
        threshold: float = 0.1,
        max_results: int = 10,
    ) -> list[SkillMatch]:
        """Match a request against skills.

        Args:
            request: User request text
            threshold: Minimum score threshold (0-1)
            max_results: Maximum number of results

        Returns:
            List of matching skills sorted by score
        """
        request_keywords = set(self._extract_keywords(request))

        if not request_keywords:
            return []

        matches: list[SkillMatch] = []

        for skill in self._skills:
            skill_keywords = self._keyword_cache.get(skill.name, set())

            if not skill_keywords:
                continue

            # Calculate Jaccard similarity
            intersection = request_keywords & skill_keywords
            union = request_keywords | skill_keywords

            if not union:
                continue

            score = len(intersection) / len(union)

            if score >= threshold:
                matches.append(SkillMatch(
                    skill=skill,
                    score=score,
                    matched_keywords=list(intersection),
                ))

        # Sort by score (descending)
        matches.sort(key=lambda m: m.score, reverse=True)

        return matches[:max_results]

    def match_by_name(self, name: str) -> SkillInfo | None:
        """Find a skill by exact name match.

        Args:
            name: Skill name

        Returns:
            SkillInfo or None if not found
        """
        for skill in self._skills:
            if skill.name == name:
                return skill
        return None

    def get_keywords(self, skill_name: str) -> set[str]:
        """Get cached keywords for a skill.

        Args:
            skill_name: Skill name

        Returns:
            Set of keywords
        """
        return self._keyword_cache.get(skill_name, set())

    @property
    def skill_count(self) -> int:
        """Get the number of skills."""
        return len(self._skills)
