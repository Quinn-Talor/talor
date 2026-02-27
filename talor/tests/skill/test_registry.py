"""Tests for SkillRegistry - two-stage loading mechanism."""

import pytest
from pathlib import Path

from src.skill.registry import SkillRegistry
from src.skill.parser import SkillInfo


def make_skill_dir(base: Path, name: str, description: str, instructions: str = "Do the task.",
                   allowed_tools: str | None = None, disable_model_invocation: bool = False,
                   user_invocable: bool = True) -> Path:
    """Helper: create a skill directory with SKILL.md."""
    skill_dir = base / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    frontmatter = f"name: {name}\ndescription: {description}\n"
    if allowed_tools:
        frontmatter += f"allowed-tools: {allowed_tools}\n"
    if disable_model_invocation:
        frontmatter += "disable-model-invocation: true\n"
    if not user_invocable:
        frontmatter += "user-invocable: false\n"
    (skill_dir / "SKILL.md").write_text(f"---\n{frontmatter}---\n\n{instructions}")
    return skill_dir


class TestSkillRegistryInit:
    """Tests for registry initialization and skill loading."""

    @pytest.mark.asyncio
    async def test_loads_project_skills(self, tmp_path):
        """Registry loads skills from .talor/skills directory."""
        skills_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(skills_dir, "code-review", "Review code for quality and style")

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        assert registry.skill_count == 1
        skill = await registry.get_skill("code-review")
        assert skill is not None
        assert skill.name == "code-review"

    @pytest.mark.asyncio
    async def test_loads_multiple_skills(self, tmp_path):
        """Registry loads all skills from directory."""
        skills_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(skills_dir, "skill-a", "First skill for testing purposes")
        make_skill_dir(skills_dir, "skill-b", "Second skill for testing purposes")
        make_skill_dir(skills_dir, "skill-c", "Third skill for testing purposes")

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        assert registry.skill_count == 3

    @pytest.mark.asyncio
    async def test_empty_directory(self, tmp_path):
        """Registry handles empty skills directory gracefully."""
        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        assert registry.skill_count == 0
        assert registry.initialized

    @pytest.mark.asyncio
    async def test_initialize_idempotent(self, tmp_path):
        """Calling initialize twice is safe."""
        skills_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(skills_dir, "my-skill", "A skill for idempotency testing")

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()
        await registry.initialize()  # second call should be no-op

        assert registry.skill_count == 1


class TestDescriptionIndex:
    """Tests for Stage 1: description index building."""

    @pytest.mark.asyncio
    async def test_build_description_index(self, tmp_path):
        """Description index contains all model-invocable skills."""
        skills_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(skills_dir, "review-code", "Review code for quality and style issues")
        make_skill_dir(skills_dir, "write-tests", "Write unit tests for the given code")

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        index = await registry.build_description_index()

        assert "review-code" in index
        assert "write-tests" in index
        assert "Review code" in index

    @pytest.mark.asyncio
    async def test_description_index_excludes_non_model_invocable(self, tmp_path):
        """Skills with disable-model-invocation=true excluded from index."""
        skills_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(skills_dir, "auto-skill", "Automatically invocable skill description")
        make_skill_dir(skills_dir, "manual-only", "Manual only skill description here",
                       disable_model_invocation=True)

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        index = await registry.build_description_index()

        assert "auto-skill" in index
        assert "manual-only" not in index

    @pytest.mark.asyncio
    async def test_empty_index_when_no_skills(self, tmp_path):
        """Empty string returned when no skills available."""
        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        index = await registry.build_description_index()
        assert index == ""

    @pytest.mark.asyncio
    async def test_description_budget_respected(self, tmp_path):
        """Description index respects character budget."""
        skills_dir = tmp_path / ".talor" / "skills"
        for i in range(10):
            make_skill_dir(skills_dir, f"skill-{i:02d}",
                           f"Description for skill number {i:02d} used in budget test")

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        # Very small budget - should only include a few skills
        index = await registry.build_description_index(budget=100)
        assert len(index) <= 100


class TestFullInstructionsLoading:
    """Tests for Stage 2: full instructions loading."""

    @pytest.mark.asyncio
    async def test_load_skill_instructions(self, tmp_path):
        """Full instructions loaded with preprocessing applied."""
        skills_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(skills_dir, "fix-issue",
                       "Fix GitHub issue by number",
                       instructions="Fix issue number $ARGUMENTS in the repository.")

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        instructions = await registry.load_skill_instructions("fix-issue", arguments="42")

        assert instructions is not None
        assert "42" in instructions
        assert "$ARGUMENTS" not in instructions

    @pytest.mark.asyncio
    async def test_load_nonexistent_skill(self, tmp_path):
        """Loading nonexistent skill returns None."""
        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        result = await registry.load_skill_instructions("does-not-exist")
        assert result is None

    @pytest.mark.asyncio
    async def test_load_instructions_with_session_id(self, tmp_path):
        """Session ID substituted in instructions."""
        skills_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(skills_dir, "session-skill",
                       "Skill that uses session ID for context",
                       instructions="Session: ${CLAUDE_SESSION_ID}")

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        instructions = await registry.load_skill_instructions(
            "session-skill", session_id="test-session-xyz"
        )

        assert instructions is not None
        assert "test-session-xyz" in instructions


class TestActiveSkillManagement:
    """Tests for active skill state tracking per session."""

    @pytest.mark.asyncio
    async def test_activate_skill(self, tmp_path):
        """Skill can be activated for a session."""
        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        registry.activate_skill("session-1", "my-skill")

        assert "my-skill" in registry.get_active_skills("session-1")

    @pytest.mark.asyncio
    async def test_deactivate_skill(self, tmp_path):
        """Skill can be deactivated for a session."""
        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        registry.activate_skill("session-1", "my-skill")
        registry.deactivate_skill("session-1", "my-skill")

        assert "my-skill" not in registry.get_active_skills("session-1")

    @pytest.mark.asyncio
    async def test_active_skills_isolated_per_session(self, tmp_path):
        """Active skills are isolated between sessions."""
        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        registry.activate_skill("session-1", "skill-a")
        registry.activate_skill("session-2", "skill-b")

        assert "skill-a" in registry.get_active_skills("session-1")
        assert "skill-a" not in registry.get_active_skills("session-2")
        assert "skill-b" in registry.get_active_skills("session-2")

    @pytest.mark.asyncio
    async def test_get_active_skill_tools_no_restrictions(self, tmp_path):
        """Returns None when active skills have no allowed_tools."""
        skills_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(skills_dir, "unrestricted", "Skill with no tool restrictions at all")

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()
        registry.activate_skill("sess", "unrestricted")

        tools = await registry.get_active_skill_tools("sess")
        assert tools is None

    @pytest.mark.asyncio
    async def test_get_active_skill_tools_with_restrictions(self, tmp_path):
        """Returns allowed tools set when active skill has restrictions."""
        skills_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(skills_dir, "restricted",
                       "Skill with tool restrictions for safety",
                       allowed_tools="bash, read")

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()
        registry.activate_skill("sess", "restricted")

        tools = await registry.get_active_skill_tools("sess")
        assert tools == {"bash", "read"}

    @pytest.mark.asyncio
    async def test_clear_session(self, tmp_path):
        """Clearing session removes all active skills."""
        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        registry.activate_skill("session-1", "skill-a")
        registry.activate_skill("session-1", "skill-b")
        registry.clear_session("session-1")

        assert registry.get_active_skills("session-1") == []


class TestSkillPriorityOverride:
    """Tests for priority-based skill override (project > personal)."""

    @pytest.mark.asyncio
    async def test_project_overrides_personal(self, tmp_path, monkeypatch):
        """Project skills override personal skills with same name."""
        # Mock personal dir to be inside tmp_path
        personal_dir = tmp_path / "personal_skills"
        make_skill_dir(personal_dir, "shared-skill",
                       "Personal version of the shared skill")

        project_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(project_dir, "shared-skill",
                       "Project version of the shared skill")

        # Patch PERSONAL_DIR
        monkeypatch.setattr(SkillRegistry, "PERSONAL_DIR", personal_dir)

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        skill = await registry.get_skill("shared-skill")
        assert skill is not None
        assert skill.source_type == "project"
        assert "Project version" in skill.description

    @pytest.mark.asyncio
    async def test_reload_refreshes_skills(self, tmp_path):
        """Reload picks up new skills added after initialization."""
        skills_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(skills_dir, "original-skill",
                       "Original skill loaded at startup time")

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()
        assert registry.skill_count == 1

        # Add a new skill
        make_skill_dir(skills_dir, "new-skill",
                       "New skill added after initialization")

        await registry.reload()
        assert registry.skill_count == 2
