"""Tests for SkillTool - Stage 2 on-demand instruction loading."""

import asyncio
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from src.skill.tool import SkillParams, skill_execute, create_skill_tool
from src.skill.registry import SkillRegistry
from src.skill.parser import SkillInfo
from src.tool.context import ToolContext


def make_tool_context(session_id: str = "test-session",
                      skill_registry: SkillRegistry | None = None) -> ToolContext:
    """Helper: create a minimal ToolContext."""
    abort = asyncio.Event()
    extra = {}
    if skill_registry is not None:
        extra["skill_registry"] = skill_registry
    return ToolContext(
        session_id=session_id,
        message_id="msg-001",
        agent="build",
        abort=abort,
        extra=extra,
    )


def make_skill_dir(base: Path, name: str, description: str,
                   instructions: str = "Do the task.") -> Path:
    """Helper: create a skill directory with SKILL.md."""
    skill_dir = base / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n\n{instructions}"
    )
    return skill_dir


class TestSkillToolDefinition:
    """Tests for SkillTool definition structure."""

    def test_tool_has_correct_id(self):
        """Skill tool has id='skill'."""
        tool = create_skill_tool()
        assert tool.id == "skill"

    def test_tool_has_description(self):
        """Skill tool has a non-empty description."""
        tool = create_skill_tool()
        assert len(tool.description) > 20

    def test_tool_parameters_schema(self):
        """Skill tool parameters include skill_name and arguments."""
        tool = create_skill_tool()
        schema = tool.get_parameters_schema()
        props = schema.get("properties", {})
        assert "skill_name" in props
        assert "arguments" in props


class TestSkillToolExecution:
    """Tests for skill_execute function."""

    @pytest.mark.asyncio
    async def test_no_registry_returns_error(self):
        """Returns error output when no registry in context."""
        ctx = make_tool_context(skill_registry=None)
        params = SkillParams(skill_name="any-skill")

        result = await skill_execute(params, ctx)

        assert "error" in result.metadata
        assert "registry" in result.metadata["error"].lower()

    @pytest.mark.asyncio
    async def test_skill_not_found(self, tmp_path):
        """Returns error when skill name not found in registry."""
        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        ctx = make_tool_context(skill_registry=registry)
        params = SkillParams(skill_name="nonexistent-skill")

        result = await skill_execute(params, ctx)

        assert "error" in result.metadata
        assert "not found" in result.metadata["error"].lower()

    @pytest.mark.asyncio
    async def test_loads_skill_instructions(self, tmp_path):
        """Returns full instructions when skill found."""
        skills_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(skills_dir, "my-skill",
                       "A skill for testing instruction loading",
                       instructions="Step 1: Do this. Step 2: Do that.")

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        ctx = make_tool_context(skill_registry=registry)
        params = SkillParams(skill_name="my-skill")

        result = await skill_execute(params, ctx)

        assert "error" not in result.metadata
        assert "Step 1" in result.output
        assert "Step 2" in result.output

    @pytest.mark.asyncio
    async def test_arguments_substituted(self, tmp_path):
        """$ARGUMENTS in instructions replaced with provided arguments."""
        skills_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(skills_dir, "fix-issue",
                       "Fix a GitHub issue by its number",
                       instructions="Fix issue #$ARGUMENTS in the repo.")

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        ctx = make_tool_context(skill_registry=registry)
        params = SkillParams(skill_name="fix-issue", arguments="99")

        result = await skill_execute(params, ctx)

        assert "error" not in result.metadata
        assert "#99" in result.output
        assert "$ARGUMENTS" not in result.output

    @pytest.mark.asyncio
    async def test_activates_skill_for_session(self, tmp_path):
        """Skill is activated in registry after successful load."""
        skills_dir = tmp_path / ".talor" / "skills"
        make_skill_dir(skills_dir, "activate-me",
                       "Skill that should be activated on load")

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        ctx = make_tool_context(session_id="sess-xyz", skill_registry=registry)
        params = SkillParams(skill_name="activate-me")

        await skill_execute(params, ctx)

        assert "activate-me" in registry.get_active_skills("sess-xyz")

    @pytest.mark.asyncio
    async def test_disable_model_invocation_blocked(self, tmp_path):
        """Skill with disable-model-invocation=true cannot be loaded by tool."""
        skills_dir = tmp_path / ".talor" / "skills"
        skill_dir = skills_dir / "manual-only"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            "---\nname: manual-only\ndescription: Manual only skill for user invocation\n"
            "disable-model-invocation: true\n---\n\nSecret instructions."
        )

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        ctx = make_tool_context(skill_registry=registry)
        params = SkillParams(skill_name="manual-only")

        result = await skill_execute(params, ctx)

        assert "error" in result.metadata
        assert "disable-model-invocation" in result.metadata["error"]

    @pytest.mark.asyncio
    async def test_metadata_includes_skill_info(self, tmp_path):
        """Result metadata contains skill name and allowed_tools."""
        skills_dir = tmp_path / ".talor" / "skills"
        skill_dir = skills_dir / "meta-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            "---\nname: meta-skill\ndescription: Skill with metadata for testing\n"
            "allowed-tools: bash, read\n---\n\nDo the thing."
        )

        registry = SkillRegistry(worktree=tmp_path)
        await registry.initialize()

        ctx = make_tool_context(skill_registry=registry)
        params = SkillParams(skill_name="meta-skill")

        result = await skill_execute(params, ctx)

        assert result.metadata.get("skill_name") == "meta-skill"
        assert result.metadata.get("allowed_tools") == ["bash", "read"]
