"""End-to-end test for config and workspace integration.

This test verifies that the complete flow from config loading to workspace
validation works correctly.
"""

import pytest
from pathlib import Path
from src.config import config
from src.core import workspace


@pytest.fixture(autouse=True)
def reset_state():
    """Reset config and workspace state before each test."""
    config.clear_cache()
    workspace.configure([])
    yield
    config.clear_cache()
    workspace.configure([])


@pytest.mark.asyncio
async def test_e2e_config_loads_workspace_and_validates_paths(tmp_path):
    """Test complete flow: config load → workspace init → path validation."""
    # Setup: Create config with workspace
    config_dir = tmp_path / ".talor"
    config_dir.mkdir()
    config_file = config_dir / "config.json"

    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()

    config_file.write_text(f'{{"workspace": ["{workspace_dir}"]}}')

    # Create test files
    allowed_file = workspace_dir / "allowed.txt"
    allowed_file.write_text("This file is allowed")

    denied_file = tmp_path / "denied.txt"
    denied_file.write_text("This file is denied")

    # Step 1: Configure and load config
    config.configure(workspace=tmp_path, worktree=tmp_path)
    cfg = await config.get()

    # Verify config loaded workspace
    assert cfg["workspace"] == [str(workspace_dir)]

    # Verify workspace module was initialized
    assert workspace.is_enabled()
    assert workspace_dir.resolve() in workspace.get_workspaces()

    # Step 2: Test path validation with allowed path
    validated_path = workspace.validate_path(allowed_file)
    assert validated_path == allowed_file.resolve()
    assert workspace.is_path_allowed(allowed_file)

    # Step 3: Test path validation with denied path
    assert not workspace.is_path_allowed(denied_file)
    with pytest.raises(PermissionError, match="Access denied"):
        workspace.validate_path(denied_file)


@pytest.mark.asyncio
async def test_e2e_config_reload_updates_workspace_restrictions(tmp_path):
    """Test that reloading config updates workspace restrictions."""
    # Setup: Create initial config with no workspace
    config_dir = tmp_path / ".talor"
    config_dir.mkdir()
    config_file = config_dir / "config.json"
    config_file.write_text('{}')

    # Create test file
    test_file = tmp_path / "test.txt"
    test_file.write_text("test content")

    # Step 1: Load config without workspace (backward compatibility)
    config.configure(workspace=tmp_path, worktree=tmp_path)
    cfg = await config.get()

    # Verify no workspace restrictions
    assert cfg["workspace"] == []
    assert not workspace.is_enabled()

    # File should be accessible (no restrictions)
    assert workspace.is_path_allowed(test_file)

    # Step 2: Update config to add workspace restriction
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    config_file.write_text(f'{{"workspace": ["{workspace_dir}"]}}')

    # Reload config
    cfg = await config.reload()

    # Verify workspace restrictions are now active
    assert cfg["workspace"] == [str(workspace_dir)]
    assert workspace.is_enabled()

    # File outside workspace should now be denied
    assert not workspace.is_path_allowed(test_file)
    with pytest.raises(PermissionError, match="Access denied"):
        workspace.validate_path(test_file)


@pytest.mark.asyncio
async def test_e2e_multiple_workspaces_from_config(tmp_path):
    """Test that multiple workspaces from config work correctly."""
    # Setup: Create config with multiple workspaces
    config_dir = tmp_path / ".talor"
    config_dir.mkdir()
    config_file = config_dir / "config.json"

    workspace1 = tmp_path / "workspace1"
    workspace2 = tmp_path / "workspace2"
    workspace1.mkdir()
    workspace2.mkdir()

    config_file.write_text(
        f'{{"workspace": ["{workspace1}", "{workspace2}"]}}'
    )

    # Create test files in both workspaces
    file1 = workspace1 / "file1.txt"
    file2 = workspace2 / "file2.txt"
    file1.write_text("content 1")
    file2.write_text("content 2")

    # Load config
    config.configure(workspace=tmp_path, worktree=tmp_path)
    await config.get()

    # Verify both workspaces are configured
    workspaces = workspace.get_workspaces()
    assert len(workspaces) == 2
    assert workspace1.resolve() in workspaces
    assert workspace2.resolve() in workspaces

    # Verify files in both workspaces are accessible
    assert workspace.is_path_allowed(file1)
    assert workspace.is_path_allowed(file2)

    validated1 = workspace.validate_path(file1)
    assert validated1 == file1.resolve()

    validated2 = workspace.validate_path(file2)
    assert validated2 == file2.resolve()

    # Verify file outside both workspaces is denied
    outside_file = tmp_path / "outside.txt"
    outside_file.write_text("outside content")

    assert not workspace.is_path_allowed(outside_file)
    with pytest.raises(PermissionError, match="Access denied"):
        workspace.validate_path(outside_file)
