"""Workspace validation module for Talor.

This module provides workspace directory validation to restrict file access
for security purposes.
"""

from __future__ import annotations

import logging
from pathlib import Path


logger = logging.getLogger(__name__)

# Module-level state
_workspaces: list[Path] = []


def configure(workspaces: list[Path | str]) -> None:
    """Configure workspace directory whitelist.

    Args:
        workspaces: List of workspace directories
    """
    global _workspaces
    _workspaces = [Path(w).resolve() for w in workspaces]
    logger.info(f"Configured workspaces: {_workspaces}")


def get_workspaces() -> list[Path]:
    """Get the list of configured workspace directories.

    Returns:
        List of workspace Path objects
    """
    return _workspaces.copy()


def is_path_allowed(path: Path | str) -> bool:
    """Check if a path is within the workspace directories.

    Args:
        path: Path to check

    Returns:
        True if allowed, False otherwise
    """
    if not _workspaces:
        # No workspaces configured - allow all paths (backward compatibility)
        return True

    try:
        resolved_path = Path(path).resolve()

        # Check if path is within any workspace
        for workspace in _workspaces:
            try:
                resolved_path.relative_to(workspace)
                return True
            except ValueError:
                continue

        return False
    except Exception as e:
        logger.error(f"Error checking path {path}: {e}")
        return False


def validate_path(path: Path | str) -> Path:
    """Validate a path and return the resolved Path object.

    Args:
        path: Path to validate

    Returns:
        Resolved Path object

    Raises:
        PermissionError: If path is outside workspace directories
    """
    resolved_path = Path(path).resolve()

    if not is_path_allowed(resolved_path):
        workspace_list = ", ".join(str(w) for w in _workspaces)
        raise PermissionError(
            f"Access denied: {path} is outside the workspace directory. "
            f"Allowed workspaces: {workspace_list}"
        )

    return resolved_path


def validate_paths(paths: list[Path | str]) -> list[Path]:
    """Validate multiple paths.

    Args:
        paths: List of paths to validate

    Returns:
        List of resolved Path objects

    Raises:
        PermissionError: If any path is outside workspace directories
    """
    return [validate_path(p) for p in paths]


def add_workspace(path: Path | str) -> None:
    """Add a workspace directory to the whitelist.

    Args:
        path: Workspace directory to add
    """
    global _workspaces
    resolved_path = Path(path).resolve()

    # Avoid duplicates
    if resolved_path not in _workspaces:
        _workspaces.append(resolved_path)
        logger.info(f"Added workspace: {resolved_path}")


def remove_workspace(path: Path | str) -> None:
    """Remove a workspace directory from the whitelist.

    Args:
        path: Workspace directory to remove

    Raises:
        ValueError: If the workspace is not in the list
    """
    global _workspaces
    resolved_path = Path(path).resolve()

    try:
        _workspaces.remove(resolved_path)
        logger.info(f"Removed workspace: {resolved_path}")
    except ValueError:
        raise ValueError(f"Workspace not found: {resolved_path}")


def is_enabled() -> bool:
    """Check if workspace restrictions are enabled.

    Returns:
        True if workspace restrictions are enabled (workspaces configured),
        False otherwise (backward compatibility mode)
    """
    return len(_workspaces) > 0


def get_relative_path(path: Path | str, workspace: Path | str | None = None) -> str:
    """Get the relative path from a workspace directory.

    Args:
        path: Path to convert to relative
        workspace: Specific workspace to use (optional). If None, uses the first
                  workspace that contains the path.

    Returns:
        Relative path as string

    Raises:
        ValueError: If path is not within any workspace or specified workspace
    """
    resolved_path = Path(path).resolve()

    if workspace is not None:
        # Use specified workspace
        resolved_workspace = Path(workspace).resolve()
        try:
            return str(resolved_path.relative_to(resolved_workspace))
        except ValueError:
            raise ValueError(
                f"Path {path} is not within workspace {workspace}"
            )

    # Find first workspace that contains the path
    for ws in _workspaces:
        try:
            return str(resolved_path.relative_to(ws))
        except ValueError:
            continue

    # Path not in any workspace
    raise ValueError(
        f"Path {path} is not within any configured workspace"
    )
