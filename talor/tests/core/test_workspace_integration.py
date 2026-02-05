"""Integration tests for workspace restrictions with tools."""

import pytest
from pathlib import Path
from src.core import workspace
from src.tool.builtin.read import read_execute, ReadParams
from src.tool.builtin.write import write_execute, WriteParams
from src.tool import ToolContext


@pytest.fixture(autouse=True)
def reset_workspace():
    """Reset workspace configuration before each test."""
    workspace._workspaces = []
    yield
    workspace._workspaces = []


@pytest.fixture
def tool_context(tmp_path):
    """Create a tool context for testing."""
    ctx = ToolContext(
        session_id="test-session",
        message_id="test-message",
        agent="test-agent",
    )
    ctx._worktree = tmp_path
    return ctx


@pytest.mark.asyncio
async def test_read_tool_allowed(tmp_path, tool_context):
    """Test that read tool works within workspace."""
    workspace.configure([tmp_path])

    # Create test file
    test_file = tmp_path / "test.txt"
    test_file.write_text("Hello, World!")

    # Read should succeed
    params = ReadParams(file_path="test.txt")
    result = await read_execute(params, tool_context)

    assert "Hello, World!" in result.output
    assert result.metadata is not None


@pytest.mark.asyncio
async def test_read_tool_denied(tmp_path, tool_context):
    """Test that read tool is blocked outside workspace."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    workspace.configure([ws])

    # Create file outside workspace
    outside = tmp_path / "outside"
    outside.mkdir()
    outside_file = outside / "secret.txt"
    outside_file.write_text("Secret data")

    # Read should fail
    params = ReadParams(file_path=str(outside_file))
    result = await read_execute(params, tool_context)

    assert "Access denied" in result.output
    assert result.title == "Access Denied"


@pytest.mark.asyncio
async def test_write_tool_allowed(tmp_path, tool_context):
    """Test that write tool works within workspace."""
    workspace.configure([tmp_path])

    # Write should succeed
    params = WriteParams(file_path="new_file.txt", content="Test content")
    result = await write_execute(params, tool_context)

    assert "Successfully wrote" in result.output
    assert (tmp_path / "new_file.txt").exists()


@pytest.mark.asyncio
async def test_write_tool_denied(tmp_path, tool_context):
    """Test that write tool is blocked outside workspace."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    workspace.configure([ws])

    # Try to write outside workspace
    outside = tmp_path / "outside"
    outside.mkdir()

    params = WriteParams(
        file_path=str(outside / "bad.txt"),
        content="Should not work"
    )
    result = await write_execute(params, tool_context)

    assert "Access denied" in result.output
    assert result.title == "Access Denied"
    assert not (outside / "bad.txt").exists()


@pytest.mark.asyncio
async def test_no_workspace_config_allows_all(tmp_path, tool_context):
    """Test backward compatibility: no config allows all paths."""
    # Don't configure workspace

    # Create file anywhere
    test_file = tmp_path / "test.txt"
    test_file.write_text("Content")

    # Read should succeed
    params = ReadParams(file_path=str(test_file))
    result = await read_execute(params, tool_context)

    assert "Content" in result.output


@pytest.mark.asyncio
async def test_multiple_workspaces(tmp_path, tool_context):
    """Test that multiple workspaces are supported."""
    ws1 = tmp_path / "ws1"
    ws2 = tmp_path / "ws2"
    ws1.mkdir()
    ws2.mkdir()

    workspace.configure([ws1, ws2])

    # Create files in both workspaces
    file1 = ws1 / "file1.txt"
    file2 = ws2 / "file2.txt"
    file1.write_text("WS1")
    file2.write_text("WS2")

    # Both should be accessible
    ctx1 = ToolContext(session_id="test", message_id="msg1", agent="test")
    ctx1._worktree = ws1
    ctx2 = ToolContext(session_id="test", message_id="msg2", agent="test")
    ctx2._worktree = ws2

    result1 = await read_execute(ReadParams(file_path="file1.txt"), ctx1)
    result2 = await read_execute(ReadParams(file_path="file2.txt"), ctx2)

    assert "WS1" in result1.output
    assert "WS2" in result2.output


@pytest.mark.asyncio
async def test_error_message_clarity(tmp_path, tool_context):
    """Test that error messages are clear and helpful."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    workspace.configure([ws])

    outside = tmp_path / "outside" / "file.txt"

    params = ReadParams(file_path=str(outside))
    result = await read_execute(params, tool_context)

    # Error should mention workspace restriction
    assert "Access denied" in result.output
    assert "outside the workspace" in result.output
    assert str(ws) in result.output  # Should show allowed workspace
