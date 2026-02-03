"""Tests for SkillMatcher."""

import pytest

from src.skill.parser import SkillInfo
from src.skill.matcher import SkillMatcher, SkillMatch


class TestSkillMatcher:
    """Tests for SkillMatcher."""

    @pytest.fixture
    def skills(self):
        """Create test skills."""
        return [
            SkillInfo(
                name="python-testing",
                description="Python unit testing with pytest and coverage",
                instructions="Use pytest for testing",
            ),
            SkillInfo(
                name="docker-deploy",
                description="Docker container deployment and orchestration",
                instructions="Use docker-compose",
            ),
            SkillInfo(
                name="api-design",
                description="REST API design and documentation with OpenAPI",
                instructions="Follow REST conventions",
            ),
        ]

    def test_match_single_keyword(self, skills):
        """Test matching with single keyword."""
        matcher = SkillMatcher(skills)
        matches = matcher.match("python")

        assert len(matches) >= 1
        assert matches[0].skill.name == "python-testing"

    def test_match_multiple_keywords(self, skills):
        """Test matching with multiple keywords."""
        matcher = SkillMatcher(skills)
        matches = matcher.match("python testing pytest")

        assert len(matches) >= 1
        assert matches[0].skill.name == "python-testing"
        assert matches[0].score > 0

    def test_match_no_results(self, skills):
        """Test matching with no results."""
        matcher = SkillMatcher(skills)
        matches = matcher.match("completely unrelated topic xyz")

        # May or may not have matches depending on threshold
        for match in matches:
            assert match.score >= 0.1  # Default threshold

    def test_match_threshold(self, skills):
        """Test matching with custom threshold."""
        matcher = SkillMatcher(skills)

        # High threshold should return fewer results
        high_matches = matcher.match("docker", threshold=0.5)
        low_matches = matcher.match("docker", threshold=0.01)

        assert len(low_matches) >= len(high_matches)

    def test_match_max_results(self, skills):
        """Test matching with max results limit."""
        matcher = SkillMatcher(skills)
        matches = matcher.match("testing deployment api", max_results=2)

        assert len(matches) <= 2

    def test_match_empty_request(self, skills):
        """Test matching with empty request."""
        matcher = SkillMatcher(skills)
        matches = matcher.match("")

        assert len(matches) == 0

    def test_match_stopwords_only(self, skills):
        """Test matching with only stopwords."""
        matcher = SkillMatcher(skills)
        matches = matcher.match("the a an is are")

        assert len(matches) == 0

    def test_match_by_name(self, skills):
        """Test finding skill by exact name."""
        matcher = SkillMatcher(skills)

        skill = matcher.match_by_name("python-testing")
        assert skill is not None
        assert skill.name == "python-testing"

        skill = matcher.match_by_name("nonexistent")
        assert skill is None

    def test_get_keywords(self, skills):
        """Test getting cached keywords."""
        matcher = SkillMatcher(skills)

        keywords = matcher.get_keywords("python-testing")

        assert "python" in keywords
        assert "testing" in keywords
        assert "pytest" in keywords

    def test_skill_count(self, skills):
        """Test skill count property."""
        matcher = SkillMatcher(skills)

        assert matcher.skill_count == 3


class TestJaccardSimilarity:
    """Tests for Jaccard similarity calculation."""

    def test_identical_sets(self):
        """Test similarity of identical keyword sets."""
        skills = [
            SkillInfo(
                name="test-skill",
                description="python testing pytest coverage",
                instructions="",
            ),
        ]
        matcher = SkillMatcher(skills)
        matches = matcher.match("python testing pytest coverage")

        assert len(matches) == 1
        assert matches[0].score > 0.5  # High similarity

    def test_partial_overlap(self):
        """Test similarity with partial overlap."""
        skills = [
            SkillInfo(
                name="test-skill",
                description="python testing pytest",
                instructions="",
            ),
        ]
        matcher = SkillMatcher(skills)
        matches = matcher.match("python java testing")

        assert len(matches) >= 1
        # Score should be moderate due to partial overlap
        assert 0 < matches[0].score < 1

    def test_no_overlap(self):
        """Test similarity with no overlap."""
        skills = [
            SkillInfo(
                name="test-skill",
                description="python testing pytest",
                instructions="",
            ),
        ]
        matcher = SkillMatcher(skills)
        matches = matcher.match("java spring boot", threshold=0.0)

        # Either no matches or very low score
        if matches:
            assert matches[0].score < 0.1
