"""Tests for workspace validation module."""

import pytest
from pathlib import Path
from src.core import workspace


@pytest.fixture(autouse=True)
def reset_workspace():
    """Reset workspace configuration before each test."""
    workspace._workspaces = []
    yield
    workspace._workspaces = []


def test_configure_single_workspace(tmp_path):
    """Test configuring a single workspace."""
    workspace.configure([tmp_path])

    workspaces = workspace.get_workspaces()
    assert len(workspaces) == 1
    assert workspaces[0] == tmp_path.resolve()


def test_configure_multiple_workspaces(tmp_path):
    """Test configuring multiple workspaces."""
    ws1 = tmp_path / "workspace1"
    ws2 = tmp_path / "workspace2"
    ws1.mkdir()
    ws2.mkdir()

    workspace.configure([ws1, ws2])

    workspaces = workspace.get_workspaces()
    assert len(workspaces) == 2
    assert ws1.resolve() in workspaces
    assert ws2.resolve() in workspaces


def test_is_path_allowed_no_config():
    """Test that all paths are allowed when no workspace is configured."""
    assert workspace.is_path_allowed("/any/path")
    assert workspace.is_path_allowed("/tmp/test")


def test_is_path_allowed_within_workspace(tmp_path):
    """Test that paths within workspace are allowed."""
    workspace.configure([tmp_path])

    # Create test file
    test_file = tmp_path / "test.txt"
    test_file.touch()

    assert workspace.is_path_allowed(test_file)
    assert workspace.is_path_allowed(tmp_path / "subdir" / "file.txt")


def test_is_path_allowed_outside_workspace(tmp_path):
    """Test that paths outside workspace are denied."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    workspace.configure([ws])

    outside = tmp_path / "outside"
    outside.mkdir()

    assert not workspace.is_path_allowed(outside)
    assert not workspace.is_path_allowed("/tmp/other")


def test_is_path_allowed_multiple_workspaces(tmp_path):
    """Test path validation with multiple workspaces."""
    ws1 = tmp_path / "ws1"
    ws2 = tmp_path / "ws2"
    ws1.mkdir()
    ws2.mkdir()

    workspace.configure([ws1, ws2])

    # Files in both workspaces should be allowed
    assert workspace.is_path_allowed(ws1 / "file.txt")
    assert workspace.is_path_allowed(ws2 / "file.txt")

    # Files outside should be denied
    outside = tmp_path / "outside"
    outside.mkdir()
    assert not workspace.is_path_allowed(outside / "file.txt")


def test_validate_path_success(tmp_path):
    """Test successful path validation."""
    workspace.configure([tmp_path])

    test_file = tmp_path / "test.txt"
    test_file.touch()

    validated = workspace.validate_path(test_file)
    assert validated == test_file.resolve()


def test_validate_path_failure(tmp_path):
    """Test path validation failure."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    workspace.configure([ws])

    outside = tmp_path / "outside" / "file.txt"

    with pytest.raises(PermissionError) as exc_info:
        workspace.validate_path(outside)

    assert "Access denied" in str(exc_info.value)
    assert "outside the workspace" in str(exc_info.value)


def test_validate_paths_all_valid(tmp_path):
    """Test validating multiple valid paths."""
    workspace.configure([tmp_path])

    paths = [
        tmp_path / "file1.txt",
        tmp_path / "subdir" / "file2.txt",
        tmp_path / "file3.txt",
    ]

    validated = workspace.validate_paths(paths)
    assert len(validated) == 3
    assert all(isinstance(p, Path) for p in validated)


def test_validate_paths_one_invalid(tmp_path):
    """Test that validation fails if any path is invalid."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    workspace.configure([ws])

    paths = [
        ws / "file1.txt",
        tmp_path / "outside" / "file2.txt",  # Invalid
        ws / "file3.txt",
    ]

    with pytest.raises(PermissionError):
        workspace.validate_paths(paths)


def test_relative_path_resolution(tmp_path):
    """Test that relative paths are resolved correctly."""
    workspace.configure([tmp_path])

    # Create a subdirectory
    subdir = tmp_path / "subdir"
    subdir.mkdir()

    # Validate path using Path object (typical usage in tools)
    validated = workspace.validate_path(subdir)
    assert validated.is_absolute()
    assert validated == subdir.resolve()


def test_symlink_handling(tmp_path):
    """Test handling of symbolic links."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    workspace.configure([ws])

    # Create a file inside workspace
    real_file = ws / "real.txt"
    real_file.touch()

    # Create symlink inside workspace pointing to file inside workspace
    link_inside = ws / "link.txt"
    link_inside.symlink_to(real_file)

    # Should be allowed (resolves to workspace)
    assert workspace.is_path_allowed(link_inside)

    # Create file outside workspace
    outside = tmp_path / "outside"
    outside.mkdir()
    outside_file = outside / "outside.txt"
    outside_file.touch()

    # Create symlink inside workspace pointing to file outside
    link_outside = ws / "link_outside.txt"
    link_outside.symlink_to(outside_file)

    # Should be denied (resolves outside workspace)
    assert not workspace.is_path_allowed(link_outside)


def test_add_workspace(tmp_path):
    """Test adding a workspace directory."""
    ws1 = tmp_path / "ws1"
    ws1.mkdir()

    # Initially empty
    assert len(workspace.get_workspaces()) == 0

    # Add first workspace
    workspace.add_workspace(ws1)
    workspaces = workspace.get_workspaces()
    assert len(workspaces) == 1
    assert ws1.resolve() in workspaces

    # Add second workspace
    ws2 = tmp_path / "ws2"
    ws2.mkdir()
    workspace.add_workspace(ws2)
    workspaces = workspace.get_workspaces()
    assert len(workspaces) == 2
    assert ws2.resolve() in workspaces


def test_add_workspace_duplicate(tmp_path):
    """Test that adding duplicate workspace doesn't create duplicates."""
    ws = tmp_path / "workspace"
    ws.mkdir()

    workspace.add_workspace(ws)
    workspace.add_workspace(ws)  # Add again

    workspaces = workspace.get_workspaces()
    assert len(workspaces) == 1
    assert ws.resolve() in workspaces


def test_add_workspace_string_path(tmp_path):
    """Test adding workspace using string path."""
    ws = tmp_path / "workspace"
    ws.mkdir()

    workspace.add_workspace(str(ws))
    workspaces = workspace.get_workspaces()
    assert len(workspaces) == 1
    assert ws.resolve() in workspaces


def test_remove_workspace(tmp_path):
    """Test removing a workspace directory."""
    ws1 = tmp_path / "ws1"
    ws2 = tmp_path / "ws2"
    ws1.mkdir()
    ws2.mkdir()

    workspace.configure([ws1, ws2])
    assert len(workspace.get_workspaces()) == 2

    # Remove one workspace
    workspace.remove_workspace(ws1)
    workspaces = workspace.get_workspaces()
    assert len(workspaces) == 1
    assert ws1.resolve() not in workspaces
    assert ws2.resolve() in workspaces


def test_remove_workspace_not_found(tmp_path):
    """Test removing a workspace that doesn't exist."""
    ws1 = tmp_path / "ws1"
    ws2 = tmp_path / "ws2"
    ws1.mkdir()
    ws2.mkdir()

    workspace.configure([ws1])

    # Try to remove workspace that's not in the list
    with pytest.raises(ValueError) as exc_info:
        workspace.remove_workspace(ws2)

    assert "Workspace not found" in str(exc_info.value)


def test_remove_workspace_string_path(tmp_path):
    """Test removing workspace using string path."""
    ws = tmp_path / "workspace"
    ws.mkdir()

    workspace.configure([ws])
    workspace.remove_workspace(str(ws))

    assert len(workspace.get_workspaces()) == 0


def test_is_enabled_no_workspaces():
    """Test is_enabled returns False when no workspaces configured."""
    assert not workspace.is_enabled()


def test_is_enabled_with_workspaces(tmp_path):
    """Test is_enabled returns True when workspaces are configured."""
    ws = tmp_path / "workspace"
    ws.mkdir()

    workspace.configure([ws])
    assert workspace.is_enabled()


def test_is_enabled_after_remove_all(tmp_path):
    """Test is_enabled returns False after removing all workspaces."""
    ws = tmp_path / "workspace"
    ws.mkdir()

    workspace.configure([ws])
    assert workspace.is_enabled()

    workspace.remove_workspace(ws)
    assert not workspace.is_enabled()


def test_get_relative_path_single_workspace(tmp_path):
    """Test getting relative path with single workspace."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    workspace.configure([ws])

    # Test file in workspace
    file_path = ws / "subdir" / "file.txt"
    relative = workspace.get_relative_path(file_path)
    assert relative == "subdir/file.txt"

    # Test workspace root
    relative = workspace.get_relative_path(ws)
    assert relative == "."


def test_get_relative_path_multiple_workspaces(tmp_path):
    """Test getting relative path with multiple workspaces."""
    ws1 = tmp_path / "ws1"
    ws2 = tmp_path / "ws2"
    ws1.mkdir()
    ws2.mkdir()
    workspace.configure([ws1, ws2])

    # File in first workspace
    file1 = ws1 / "file.txt"
    relative1 = workspace.get_relative_path(file1)
    assert relative1 == "file.txt"

    # File in second workspace
    file2 = ws2 / "subdir" / "file.txt"
    relative2 = workspace.get_relative_path(file2)
    assert relative2 == "subdir/file.txt"


def test_get_relative_path_with_specific_workspace(tmp_path):
    """Test getting relative path with specific workspace."""
    ws1 = tmp_path / "ws1"
    ws2 = tmp_path / "ws2"
    ws1.mkdir()
    ws2.mkdir()
    workspace.configure([ws1, ws2])

    file_path = ws2 / "subdir" / "file.txt"

    # Get relative to specific workspace
    relative = workspace.get_relative_path(file_path, workspace=ws2)
    assert relative == "subdir/file.txt"


def test_get_relative_path_outside_workspace(tmp_path):
    """Test getting relative path for file outside workspace."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    workspace.configure([ws])

    outside = tmp_path / "outside" / "file.txt"

    with pytest.raises(ValueError) as exc_info:
        workspace.get_relative_path(outside)

    assert "not within any configured workspace" in str(exc_info.value)


def test_get_relative_path_wrong_workspace(tmp_path):
    """Test getting relative path with wrong workspace specified."""
    ws1 = tmp_path / "ws1"
    ws2 = tmp_path / "ws2"
    ws1.mkdir()
    ws2.mkdir()
    workspace.configure([ws1, ws2])

    file_path = ws1 / "file.txt"

    # Try to get relative to wrong workspace
    with pytest.raises(ValueError) as exc_info:
        workspace.get_relative_path(file_path, workspace=ws2)

    assert "not within workspace" in str(exc_info.value)


def test_get_relative_path_string_paths(tmp_path):
    """Test getting relative path using string paths."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    workspace.configure([ws])

    file_path = ws / "subdir" / "file.txt"

    # Use string paths
    relative = workspace.get_relative_path(str(file_path), workspace=str(ws))
    assert relative == "subdir/file.txt"
