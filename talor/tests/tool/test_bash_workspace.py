"""Tests for bash tool workspace integration."""

import tempfile
from pathlib import Path

import pytest

from src.core import workspace
from src.tool import ToolContext
from src.tool.builtin.bash import bash_execute, BashParams


@pytest.fixture
def temp_workspaces():
    """Create temporary workspace directories."""
    with tempfile.TemporaryDirectory() as tmpdir1, tempfile.TemporaryDirectory() as tmpdir2:
        workspace1 = Path(tmpdir1)
        workspace2 = Path(tmpdir2)

        # Create test files
        (workspace1 / "test1.txt").write_text("workspace1")
        (workspace2 / "test2.txt").write_text("workspace2")

        yield workspace1, workspace2


@pytest.mark.asyncio
async def test_bash_default_cwd_uses_first_workspace(temp_workspaces):
    """Test that bash tool uses first workspace as default cwd."""
    workspace1, workspace2 = temp_workspaces

    # Configure workspaces
    workspace.configure([workspace1, workspace2])

    # Create context
    ctx = ToolContext(
        session_id="test-session",
        message_id="test-message",
        agent="test-agent",
        _worktree=workspace1
    )

    # Execute bash without workdir - should use first workspace
    params = BashParams(
        command="pwd",
        description="Print working directory"
    )

    result = await bash_execute(params, ctx)

    # Should execute in first workspace (resolve both paths for comparison)
    assert str(workspace1.resolve()) in result.output or str(workspace1) in result.output
    assert Path(result.metadata["workdir"]).resolve() == workspace1.resolve()


@pytest.mark.asyncio
async def test_bash_workdir_validation(temp_workspaces):
    """Test that bash tool validates workdir against workspace."""
    workspace1, workspace2 = temp_workspaces

    # Configure only workspace1
    workspace.configure([workspace1])

    # Create context
    ctx = ToolContext(
        session_id="test-session",
        message_id="test-message",
        agent="test-agent",
        _worktree=workspace1
    )

    # Try to use workspace2 as workdir (should be denied)
    params = BashParams(
        command="pwd",
        description="Print working directory",
        workdir=str(workspace2)
    )

    result = await bash_execute(params, ctx)

    # Should be denied
    assert "Access denied" in result.output or "Access Denied" in result.title


@pytest.mark.asyncio
async def test_bash_no_workspace_config_uses_worktree(temp_workspaces):
    """Test that bash tool uses worktree when no workspaces configured."""
    workspace1, _ = temp_workspaces

    # Clear workspace configuration
    workspace.configure([])

    # Create context
    ctx = ToolContext(
        session_id="test-session",
        message_id="test-message",
        agent="test-agent",
        _worktree=workspace1
    )

    # Execute bash without workdir
    params = BashParams(
        command="pwd",
        description="Print working directory"
    )

    result = await bash_execute(params, ctx)

    # Should use worktree
    assert str(workspace1) in result.output


@pytest.mark.asyncio
async def test_bash_relative_workdir(temp_workspaces):
    """Test that bash tool handles relative workdir correctly."""
    workspace1, _ = temp_workspaces

    # Create subdirectory
    subdir = workspace1 / "subdir"
    subdir.mkdir()

    # Configure workspace
    workspace.configure([workspace1])

    # Create context
    ctx = ToolContext(
        session_id="test-session",
        message_id="test-message",
        agent="test-agent",
        _worktree=workspace1
    )

    # Use relative workdir
    params = BashParams(
        command="pwd",
        description="Print working directory",
        workdir="subdir"
    )

    result = await bash_execute(params, ctx)

    # Should execute in subdirectory (resolve both paths for comparison)
    assert str(subdir.resolve()) in result.output or str(subdir) in result.output
    assert Path(result.metadata["workdir"]).resolve() == subdir.resolve()
