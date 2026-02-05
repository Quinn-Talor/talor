"""List Tool for Talor.

This module provides the ls tool for listing directory contents.
"""

from __future__ import annotations

import logging
import stat
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, Field

from src.tool import Tool, ToolContext, ToolOutput
from src.core import workspace


logger = logging.getLogger(__name__)


class ListParams(BaseModel):
    """Parameters for list tool."""

    path: str | None = Field(
        default=None,
        description="Path to list (relative to workspace, default: workspace root)"
    )
    depth: int = Field(
        default=1,
        description="Depth of recursive listing (1 = current dir only)"
    )
    show_hidden: bool = Field(
        default=False,
        description="Whether to show hidden files (starting with .)"
    )


def format_size(size: int) -> str:
    """Format file size in human-readable format."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:>6.1f}{unit}" if unit != "B" else f"{size:>6d}{unit}"
        size /= 1024
    return f"{size:>6.1f}TB"


def format_mode(mode: int) -> str:
    """Format file mode as permission string."""
    is_dir = stat.S_ISDIR(mode)
    perms = ""
    perms += "d" if is_dir else "-"
    perms += "r" if mode & stat.S_IRUSR else "-"
    perms += "w" if mode & stat.S_IWUSR else "-"
    perms += "x" if mode & stat.S_IXUSR else "-"
    perms += "r" if mode & stat.S_IRGRP else "-"
    perms += "w" if mode & stat.S_IWGRP else "-"
    perms += "x" if mode & stat.S_IXGRP else "-"
    perms += "r" if mode & stat.S_IROTH else "-"
    perms += "w" if mode & stat.S_IWOTH else "-"
    perms += "x" if mode & stat.S_IXOTH else "-"
    return perms


async def list_execute(params: ListParams, ctx: ToolContext) -> ToolOutput:
    """Execute the list tool.

    Args:
        params: List parameters
        ctx: Tool execution context

    Returns:
        ToolOutput with directory listing
    """
    # Determine path
    if params.path:
        list_path = Path(params.path)
        if not list_path.is_absolute():
            list_path = ctx.worktree / list_path
    else:
        list_path = ctx.worktree

    # Validate workspace access
    try:
        list_path = workspace.validate_path(list_path)
    except PermissionError as e:
        return ToolOutput.error(
            str(e),
            title="Access Denied"
        )

    # Validate path
    if not list_path.exists():
        return ToolOutput.error(
            f"Path not found: {params.path or '.'}",
            title="List Error"
        )

    if not list_path.is_dir():
        return ToolOutput.error(
            f"Not a directory: {params.path or '.'}",
            title="List Error"
        )

    try:
        # Collect entries
        entries = []

        def collect_entries(path: Path, current_depth: int, prefix: str = ""):
            if current_depth > params.depth:
                return

            try:
                items = sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
            except PermissionError:
                return

            for item in items:
                # Skip hidden files unless requested
                if not params.show_hidden and item.name.startswith("."):
                    continue

                try:
                    stat_info = item.stat()
                    mode = format_mode(stat_info.st_mode)
                    size = format_size(stat_info.st_size) if item.is_file() else "     -"
                    mtime = datetime.fromtimestamp(stat_info.st_mtime).strftime("%Y-%m-%d %H:%M")

                    try:
                        rel_path = item.relative_to(ctx.worktree)
                    except ValueError:
                        rel_path = item

                    name = str(rel_path)
                    if item.is_dir():
                        name += "/"

                    entries.append({
                        "mode": mode,
                        "size": size,
                        "mtime": mtime,
                        "name": prefix + name,
                        "is_dir": item.is_dir(),
                    })

                    # Recurse into directories
                    if item.is_dir() and current_depth < params.depth:
                        collect_entries(item, current_depth + 1, prefix)

                except (PermissionError, OSError):
                    continue

        collect_entries(list_path, 1)

        # Format output
        if not entries:
            return ToolOutput(
                title=f"List {params.path or '.'} (empty)",
                output="(empty directory)",
                metadata={"path": str(list_path), "entries_count": 0},
            )

        # Build output lines
        output_lines = []
        for entry in entries:
            output_lines.append(
                f"{entry['mode']} {entry['size']} {entry['mtime']} {entry['name']}"
            )

        output = "\n".join(output_lines)

        # Count dirs and files
        dirs_count = sum(1 for e in entries if e["is_dir"])
        files_count = len(entries) - dirs_count

        # Build metadata
        metadata = {
            "path": str(list_path),
            "entries_count": len(entries),
            "directories": dirs_count,
            "files": files_count,
            "depth": params.depth,
        }

        return ToolOutput(
            title=f"List {params.path or '.'} ({len(entries)} entries)",
            output=output,
            metadata=metadata,
        )

    except Exception as e:
        logger.error(f"Error listing directory: {e}")
        return ToolOutput.error(
            f"Error listing directory: {e}",
            title="List Error"
        )


# Define the list tool
ListTool = Tool.define(
    id="ls",
    description="""List directory contents.

Use this tool to see files and directories in the workspace.
Shows permissions, size, modification time, and name.

Options:
- depth: How deep to recurse (1 = current dir only)
- show_hidden: Include files starting with .

Examples:
- List workspace root: {"path": null}
- List src directory: {"path": "src"}
- Recursive listing: {"path": ".", "depth": 2}
- Show hidden files: {"path": ".", "show_hidden": true}
""",
    parameters=ListParams,
    execute=list_execute,
)
