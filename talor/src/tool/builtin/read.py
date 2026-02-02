"""Read Tool for Talor.

This module provides the read tool for reading file content.
"""

from __future__ import annotations

import logging
from pathlib import Path

from pydantic import BaseModel, Field

from src.tool import Tool, ToolContext, ToolOutput


logger = logging.getLogger(__name__)


class ReadParams(BaseModel):
    """Parameters for read tool."""

    file_path: str = Field(
        description="Path to the file to read (relative to workspace or absolute)"
    )
    offset: int | None = Field(
        default=None,
        description="Line offset to start reading from (1-indexed)"
    )
    limit: int | None = Field(
        default=None,
        description="Maximum number of lines to read"
    )


async def read_execute(params: ReadParams, ctx: ToolContext) -> ToolOutput:
    """Execute the read tool.

    Args:
        params: Read parameters
        ctx: Tool execution context

    Returns:
        ToolOutput with file content
    """
    # Resolve file path
    file_path = Path(params.file_path)
    if not file_path.is_absolute():
        file_path = ctx.worktree / file_path

    # Check if file exists
    if not file_path.exists():
        return ToolOutput.error(
            f"File not found: {params.file_path}",
            title="Read Error"
        )

    if not file_path.is_file():
        return ToolOutput.error(
            f"Not a file: {params.file_path}",
            title="Read Error"
        )

    try:
        # Read file content
        content = file_path.read_text(encoding="utf-8")
        lines = content.splitlines(keepends=True)

        total_lines = len(lines)

        # Apply offset and limit
        start = 0
        if params.offset is not None:
            start = max(0, params.offset - 1)  # Convert to 0-indexed

        end = total_lines
        if params.limit is not None:
            end = min(total_lines, start + params.limit)

        # Extract lines
        selected_lines = lines[start:end]
        output_content = "".join(selected_lines)

        # Add line numbers
        numbered_lines = []
        for i, line in enumerate(selected_lines, start=start + 1):
            numbered_lines.append(f"{i:4d} | {line.rstrip()}")

        output_with_numbers = "\n".join(numbered_lines)

        # Build metadata
        metadata = {
            "file_path": str(file_path),
            "total_lines": total_lines,
            "start_line": start + 1,
            "end_line": end,
            "lines_read": len(selected_lines),
        }

        return ToolOutput(
            title=f"Read {params.file_path} ({len(selected_lines)} lines)",
            output=output_with_numbers,
            metadata=metadata,
        )

    except UnicodeDecodeError:
        return ToolOutput.error(
            f"Cannot read binary file: {params.file_path}",
            title="Read Error"
        )
    except PermissionError:
        return ToolOutput.error(
            f"Permission denied: {params.file_path}",
            title="Read Error"
        )
    except Exception as e:
        logger.error(f"Error reading file {params.file_path}: {e}")
        return ToolOutput.error(
            f"Error reading file: {e}",
            title="Read Error"
        )


# Define the read tool
ReadTool = Tool.define(
    id="read",
    description="""Read file content from the workspace.

Use this tool to read the contents of a file. You can optionally specify:
- offset: Start reading from a specific line (1-indexed)
- limit: Maximum number of lines to read

The output includes line numbers for reference.

Examples:
- Read entire file: {"file_path": "src/main.py"}
- Read lines 10-30: {"file_path": "src/main.py", "offset": 10, "limit": 20}
- Read first 50 lines: {"file_path": "src/main.py", "limit": 50}
""",
    parameters=ReadParams,
    execute=read_execute,
)
