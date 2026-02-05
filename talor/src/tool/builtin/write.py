"""Write Tool for Talor.

This module provides the write tool for writing file content.
"""

from __future__ import annotations

import logging
from pathlib import Path

from pydantic import BaseModel, Field

from src.tool import Tool, ToolContext, ToolOutput
from src.core import workspace


logger = logging.getLogger(__name__)


class WriteParams(BaseModel):
    """Parameters for write tool."""

    file_path: str = Field(
        description="Path to the file to write (relative to workspace or absolute)"
    )
    content: str = Field(
        description="Content to write to the file"
    )


async def write_execute(params: WriteParams, ctx: ToolContext) -> ToolOutput:
    """Execute the write tool.

    Args:
        params: Write parameters
        ctx: Tool execution context

    Returns:
        ToolOutput with result
    """
    # Resolve file path
    file_path = Path(params.file_path)
    if not file_path.is_absolute():
        file_path = ctx.worktree / file_path

    # Validate workspace access
    try:
        file_path = workspace.validate_path(file_path)
    except PermissionError as e:
        return ToolOutput.error(
            str(e),
            title="Access Denied"
        )

    try:
        # Create parent directories if needed
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # Check if file exists (for metadata)
        existed = file_path.exists()
        old_size = file_path.stat().st_size if existed else 0

        # Write content
        file_path.write_text(params.content, encoding="utf-8")

        new_size = file_path.stat().st_size
        lines = len(params.content.splitlines())

        # Build metadata
        metadata = {
            "file_path": str(file_path),
            "created": not existed,
            "old_size": old_size,
            "new_size": new_size,
            "lines": lines,
        }

        action = "Created" if not existed else "Updated"

        return ToolOutput(
            title=f"{action} {params.file_path} ({lines} lines)",
            output=f"Successfully wrote {new_size} bytes to {params.file_path}",
            metadata=metadata,
        )

    except PermissionError:
        return ToolOutput.error(
            f"Permission denied: {params.file_path}",
            title="Write Error"
        )
    except Exception as e:
        logger.error(f"Error writing file {params.file_path}: {e}")
        return ToolOutput.error(
            f"Error writing file: {e}",
            title="Write Error"
        )


# Define the write tool
WriteTool = Tool.define(
    id="write",
    description="""Write content to a file in the workspace.

Use this tool to create or overwrite a file with new content.
Parent directories will be created automatically if they don't exist.

IMPORTANT: This will completely replace the file content. For partial
modifications, use the 'edit' tool instead.

Examples:
- Create new file: {"file_path": "src/new_file.py", "content": "print('hello')"}
- Overwrite file: {"file_path": "README.md", "content": "# My Project\\n..."}
""",
    parameters=WriteParams,
    execute=write_execute,
)
