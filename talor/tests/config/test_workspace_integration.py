"""Tests for workspace configuration integration.

This module tests that workspace directories are properly loaded from
configuration and initialized in the workspace module.
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
async def test_workspace_initialized_from_config(tmp_path):
    """Test that workspace is initialized when loading config with workspace directories."""
    # Create a test config file with workspace directories
    config_dir = tmp_path / ".talor"
    config_dir.mkdir()
    config_file = config_dir / "config.json"

    test_workspace1 = tmp_path / "workspace1"
    test_workspace2 = tmp_path / "workspace2"
    test_workspace1.mkdir()
    test_workspace2.mkdir()

    config_file.write_text(
        f'{{"workspace": ["{test_workspace1}", "{test_workspace2}"]}}'
    )

    # Configure config module to use test directory
    config.configure(workspace=tmp_path, worktree=tmp_path)

    # Load config
    cfg = await config.get()

    # Verify workspace field in config
    assert "workspace" in cfg
    assert len(cfg["workspace"]) == 2
    assert str(test_workspace1) in cfg["workspace"]
    assert str(test_workspace2) in cfg["workspace"]

    # Verify workspace module was initialized
    workspaces = workspace.get_workspaces()
    assert len(workspaces) == 2
    assert test_workspace1.resolve() in workspaces
    assert test_workspace2.resolve() in workspaces

    # Verify workspace restrictions are enabled
    assert workspace.is_enabled()


@pytest.mark.asyncio
async def test_workspace_empty_config_backward_compatibility(tmp_path):
    """Test that empty workspace config maintains backward compatibility."""
    # Create a test config file without workspace field
    config_dir = tmp_path / ".talor"
    config_dir.mkdir()
    config_file = config_dir / "config.json"
    config_file.write_text('{"default_agent": "build"}')

    # Configure config module to use test directory
    config.configure(workspace=tmp_path, worktree=tmp_path)

    # Load config
    cfg = await config.get()

    # Verify workspace field exists but is empty
    assert "workspace" in cfg
    assert cfg["workspace"] == []

    # Verify workspace module has no restrictions (backward compatibility)
    workspaces = workspace.get_workspaces()
    assert len(workspaces) == 0
    assert not workspace.is_enabled()

    # Verify all paths are allowed when no workspaces configured
    test_path = tmp_path / "any_file.txt"
    assert workspace.is_path_allowed(test_path)


@pytest.mark.asyncio
async def test_workspace_reload_updates_workspace_module(tmp_path):
    """Test that reloading config updates the workspace module."""
    # Create initial config with one workspace
    config_dir = tmp_path / ".talor"
    config_dir.mkdir()
    config_file = config_dir / "config.json"

    test_workspace1 = tmp_path / "workspace1"
    test_workspace1.mkdir()

    config_file.write_text(f'{{"workspace": ["{test_workspace1}"]}}')

    # Configure and load initial config
    config.configure(workspace=tmp_path, worktree=tmp_path)
    await config.get()

    # Verify initial workspace
    workspaces = workspace.get_workspaces()
    assert len(workspaces) == 1
    assert test_workspace1.resolve() in workspaces

    # Update config file with additional workspace
    test_workspace2 = tmp_path / "workspace2"
    test_workspace2.mkdir()
    config_file.write_text(
        f'{{"workspace": ["{test_workspace1}", "{test_workspace2}"]}}'
    )

    # Reload config
    cfg = await config.reload()

    # Verify workspace module was updated
    workspaces = workspace.get_workspaces()
    assert len(workspaces) == 2
    assert test_workspace1.resolve() in workspaces
    assert test_workspace2.resolve() in workspaces


@pytest.mark.asyncio
async def test_workspace_paths_validated_after_config_load(tmp_path):
    """Test that workspace path validation works after config is loaded."""
    # Create config with workspace directory
    config_dir = tmp_path / ".talor"
    config_dir.mkdir()
    config_file = config_dir / "config.json"

    test_workspace = tmp_path / "workspace"
    test_workspace.mkdir()

    config_file.write_text(f'{{"workspace": ["{test_workspace}"]}}')

    # Configure and load config
    config.configure(workspace=tmp_path, worktree=tmp_path)
    await config.get()

    # Test path validation
    allowed_path = test_workspace / "file.txt"
    denied_path = tmp_path / "outside" / "file.txt"

    # Allowed path should pass validation
    assert workspace.is_path_allowed(allowed_path)
    validated = workspace.validate_path(allowed_path)
    assert validated == allowed_path.resolve()

    # Denied path should fail validation
    assert not workspace.is_path_allowed(denied_path)
    with pytest.raises(PermissionError, match="Access denied"):
        workspace.validate_path(denied_path)


@pytest.mark.asyncio
async def test_workspace_default_config_has_empty_workspace(tmp_path):
    """Test that default config includes empty workspace list."""
    # Configure with no config files
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()

    config.configure(workspace=empty_dir, worktree=empty_dir)

    # Load config (will use defaults)
    cfg = await config.get()

    # Verify workspace field exists in default config
    assert "workspace" in cfg
    assert cfg["workspace"] == []

    # Verify workspace module is not restricted
    assert not workspace.is_enabled()
