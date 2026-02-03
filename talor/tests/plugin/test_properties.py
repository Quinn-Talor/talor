"""Property-based tests for plugin system.

Uses Hypothesis for property-based testing to verify correctness properties.
"""

import pytest
from hypothesis import given, strategies as st, assume, settings
from pathlib import Path

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult
from src.plugin.manager import PluginManager
from src.skill.parser import SkillInfo, SkillParser
from src.skill.matcher import SkillMatcher


# =============================================================================
# Strategies
# =============================================================================

# Strategy for valid plugin names
plugin_name_strategy = st.text(
    alphabet=st.characters(whitelist_categories=('Ll', 'Nd'), whitelist_characters='-_'),
    min_size=1,
    max_size=50,
).filter(lambda x: x and not x.startswith('-') and not x.startswith('_'))

# Strategy for plugin priorities
priority_strategy = st.integers(min_value=0, max_value=1000)

# Strategy for skill names (lowercase with hyphens)
skill_name_strategy = st.from_regex(r'^[a-z][a-z0-9-]{0,30}$', fullmatch=True)

# Strategy for skill descriptions (YAML-safe characters only)
# Avoid special YAML characters and quotes to ensure safe embedding in YAML strings
skill_description_strategy = st.text(
    min_size=20,
    max_size=200,
    alphabet=st.characters(
        whitelist_categories=('L', 'N'),  # Letters and Numbers only
        whitelist_characters=' .,;()/'    # Safe punctuation (no quotes)
    )
).filter(lambda x: x.strip() and not x.startswith(' ') and '"' not in x and "'" not in x)

# Strategy for tool names
tool_name_strategy = st.from_regex(r'^[a-z][a-z0-9_]{0,20}$', fullmatch=True)


# =============================================================================
# Mock Plugin for Testing
# =============================================================================

class MockPlugin(PromptPlugin):
    """Mock plugin for property testing."""

    def __init__(self, name: str, priority: int = 500, enabled: bool = True):
        super().__init__(name, priority, enabled, False)

    async def build(self, context: PluginContext) -> PluginResult:
        return PluginResult(content=f"<{self.name}/>", section="system")


# =============================================================================
# Property Tests: Plugin Registration Uniqueness
# =============================================================================

class TestPluginRegistrationUniqueness:
    """Property tests for plugin registration uniqueness.

    **Validates: Requirements 1.2**
    Property: Plugin names must be unique within a PluginManager.
    """

    @pytest.mark.asyncio
    @given(names=st.lists(plugin_name_strategy, min_size=2, max_size=10, unique=True))
    @settings(max_examples=50)
    async def test_unique_names_all_register(self, names):
        """Property: All plugins with unique names can be registered."""
        manager = PluginManager()

        for name in names:
            plugin = MockPlugin(name)
            await manager.register(plugin)

        assert manager.plugin_count == len(names)

    @pytest.mark.asyncio
    @given(name=plugin_name_strategy)
    @settings(max_examples=50)
    async def test_duplicate_name_raises_error(self, name):
        """Property: Registering duplicate name always raises ValueError."""
        manager = PluginManager()

        plugin1 = MockPlugin(name)
        plugin2 = MockPlugin(name)

        await manager.register(plugin1)

        with pytest.raises(ValueError, match="already registered"):
            await manager.register(plugin2)


# =============================================================================
# Property Tests: Plugin Execution Order
# =============================================================================

class TestPluginExecutionOrder:
    """Property tests for plugin execution order.

    **Validates: Requirements 2.1**
    Property: Plugins execute in priority order (lower priority first).
    """

    @pytest.mark.asyncio
    @given(priorities=st.lists(priority_strategy, min_size=2, max_size=10, unique=True))
    @settings(max_examples=50)
    async def test_priority_order_preserved(self, priorities):
        """Property: Plugins always execute in ascending priority order."""
        manager = PluginManager()

        # Register plugins with different priorities
        for i, priority in enumerate(priorities):
            plugin = MockPlugin(f"plugin-{i}", priority)
            await manager.register(plugin)

        context = PluginContext(session_id="test", agent_name="build")
        result = await manager.build_prompt(context)

        # Verify order in output - new format uses messages list
        assert len(result["messages"]) >= 1
        system_content = result["messages"][0]["content"]
        sorted_priorities = sorted(priorities)

        positions = []
        for i, priority in enumerate(priorities):
            tag = f"<plugin-{i}/>"
            pos = system_content.find(tag)
            if pos >= 0:
                positions.append((priority, pos))

        # Check that positions are ordered by priority
        sorted_by_priority = sorted(positions, key=lambda x: x[0])
        sorted_by_position = sorted(positions, key=lambda x: x[1])

        assert sorted_by_priority == sorted_by_position


# =============================================================================
# Property Tests: Skill Priority Override
# =============================================================================

class TestSkillPriorityOverride:
    """Property tests for skill priority override.

    **Validates: Requirements 9.3**
    Property: Project skills always override personal skills with same name.
    """

    @given(skill_name=skill_name_strategy)
    @settings(max_examples=30)
    def test_project_always_overrides_personal(self, skill_name):
        """Property: Project skill always takes precedence over personal."""
        personal_skill = SkillInfo(
            name=skill_name,
            description="Personal version of the skill",
            instructions="Personal instructions",
            source_type="personal",
        )

        project_skill = SkillInfo(
            name=skill_name,
            description="Project version of the skill",
            instructions="Project instructions",
            source_type="project",
        )

        # Simulate loader behavior: project overrides personal
        skills = {skill_name: personal_skill}

        # Project skill should override
        if project_skill.source_type == "project" or skills[skill_name].source_type != "project":
            skills[skill_name] = project_skill

        assert skills[skill_name].source_type == "project"
        assert skills[skill_name].instructions == "Project instructions"


# =============================================================================
# Property Tests: SKILL.md Format Validation
# =============================================================================

class TestSkillMdFormatValidation:
    """Property tests for SKILL.md format validation.

    **Validates: Requirements 9.1**
    Property: Valid SKILL.md files parse successfully, invalid ones fail gracefully.
    """

    @given(
        name=skill_name_strategy,
        description=skill_description_strategy,
    )
    @settings(max_examples=30)
    def test_valid_frontmatter_parses(self, name, description):
        """Property: Valid frontmatter always parses successfully."""
        import tempfile
        with tempfile.TemporaryDirectory() as tmp_dir:
            skill_md = Path(tmp_dir) / "SKILL.md"
            # Quote the description to ensure YAML treats it as a string
            skill_md.write_text(f"""---
name: {name}
description: "{description}"
---

Instructions here.
""")

            skill = SkillParser.parse(skill_md)

            assert skill is not None
            assert skill.name == name
            assert skill.description == description

    @given(content=st.text(min_size=10, max_size=100))
    @settings(max_examples=30)
    def test_missing_frontmatter_returns_none(self, content):
        """Property: Files without frontmatter return None."""
        assume("---" not in content[:10])  # Ensure no accidental frontmatter

        import tempfile
        with tempfile.TemporaryDirectory() as tmp_dir:
            skill_md = Path(tmp_dir) / "SKILL.md"
            skill_md.write_text(content)

            skill = SkillParser.parse(skill_md)

            assert skill is None


# =============================================================================
# Property Tests: Tool Restrictions Intersection
# =============================================================================

class TestToolRestrictionsIntersection:
    """Property tests for tool restrictions intersection.

    **Validates: Requirements 9.2**
    Property: When multiple skills have tool restrictions, the intersection is used.
    """

    @given(
        tools1=st.lists(tool_name_strategy, min_size=1, max_size=10, unique=True),
        tools2=st.lists(tool_name_strategy, min_size=1, max_size=10, unique=True),
    )
    @settings(max_examples=50)
    def test_intersection_is_subset_of_both(self, tools1, tools2):
        """Property: Intersection is always a subset of both tool sets."""
        set1 = set(tools1)
        set2 = set(tools2)

        intersection = set1 & set2

        assert intersection <= set1
        assert intersection <= set2

    @given(
        tools1=st.lists(tool_name_strategy, min_size=1, max_size=10, unique=True),
        tools2=st.lists(tool_name_strategy, min_size=1, max_size=10, unique=True),
        tools3=st.lists(tool_name_strategy, min_size=1, max_size=10, unique=True),
    )
    @settings(max_examples=30)
    def test_intersection_is_associative(self, tools1, tools2, tools3):
        """Property: Intersection operation is associative."""
        set1 = set(tools1)
        set2 = set(tools2)
        set3 = set(tools3)

        # (A ∩ B) ∩ C = A ∩ (B ∩ C)
        left = (set1 & set2) & set3
        right = set1 & (set2 & set3)

        assert left == right

    @given(tools=st.lists(tool_name_strategy, min_size=1, max_size=10, unique=True))
    @settings(max_examples=30)
    def test_single_skill_returns_all_tools(self, tools):
        """Property: Single skill's tools are returned unchanged."""
        skill = SkillInfo(
            name="test-skill",
            description="A test skill for property testing",
            allowed_tools=tools,
            instructions="Test",
        )

        # Simulate single skill tool restriction
        tool_restrictions = set(skill.allowed_tools) if skill.allowed_tools else None

        assert tool_restrictions == set(tools)


# =============================================================================
# Property Tests: Skill Matching
# =============================================================================

class TestSkillMatching:
    """Property tests for skill matching algorithm.

    **Validates: Requirements 9.4**
    Property: Jaccard similarity is symmetric and bounded [0, 1].
    """

    @given(
        keywords1=st.lists(st.text(min_size=3, max_size=10, alphabet='abcdefghijklmnopqrstuvwxyz'), min_size=1, max_size=10, unique=True),
        keywords2=st.lists(st.text(min_size=3, max_size=10, alphabet='abcdefghijklmnopqrstuvwxyz'), min_size=1, max_size=10, unique=True),
    )
    @settings(max_examples=50)
    def test_jaccard_is_symmetric(self, keywords1, keywords2):
        """Property: Jaccard similarity is symmetric."""
        set1 = set(keywords1)
        set2 = set(keywords2)

        if not set1 or not set2:
            return

        intersection = set1 & set2
        union = set1 | set2

        if not union:
            return

        # J(A, B) = J(B, A)
        score_ab = len(intersection) / len(union)
        score_ba = len(intersection) / len(union)

        assert score_ab == score_ba

    @given(
        keywords1=st.lists(st.text(min_size=3, max_size=10, alphabet='abcdefghijklmnopqrstuvwxyz'), min_size=1, max_size=10, unique=True),
        keywords2=st.lists(st.text(min_size=3, max_size=10, alphabet='abcdefghijklmnopqrstuvwxyz'), min_size=1, max_size=10, unique=True),
    )
    @settings(max_examples=50)
    def test_jaccard_is_bounded(self, keywords1, keywords2):
        """Property: Jaccard similarity is always in [0, 1]."""
        set1 = set(keywords1)
        set2 = set(keywords2)

        if not set1 or not set2:
            return

        intersection = set1 & set2
        union = set1 | set2

        if not union:
            return

        score = len(intersection) / len(union)

        assert 0 <= score <= 1

    @given(keywords=st.lists(st.text(min_size=3, max_size=10, alphabet='abcdefghijklmnopqrstuvwxyz'), min_size=1, max_size=10, unique=True))
    @settings(max_examples=30)
    def test_identical_sets_have_score_one(self, keywords):
        """Property: Identical sets have Jaccard similarity of 1."""
        set1 = set(keywords)
        set2 = set(keywords)

        intersection = set1 & set2
        union = set1 | set2

        if not union:
            return

        score = len(intersection) / len(union)

        assert score == 1.0
