"""Grep Tool for Talor.

This module provides the grep tool for searching file content.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from pydantic import BaseModel, Field

from src.tool import Tool, ToolContext, ToolOutput


logger = logging.getLogger(__name__)


class GrepParams(BaseModel):
    """Parameters for grep tool."""

    pattern: str = Field(
        description="Regex pattern to search for"
    )
    path: str | None = Field(
        default=None,
        description="Path to search in (file or directory, default: workspace root)"
    )
    include: str | None = Field(
        default=None,
        description="Glob pattern for files to include (e.g., '*.py')"
    )
    case_sensitive: bool = Field(
        default=False,
        description="Whether the search is case-sensitive"
    )


async def grep_execute(params: GrepParams, ctx: ToolContext) -> ToolOutput:
    """Execute the grep tool.

    Args:
        params: Grep parameters
        ctx: Tool execution context

    Returns:
        ToolOutput with search results
    """
    # Determine search path
    if params.path:
        search_path = Path(params.path)
        if not search_path.is_absolute():
            search_path = ctx.worktree / search_path
    else:
        search_path = ctx.worktree

    # Validate path
    if not search_path.exists():
        return ToolOutput.error(
            f"Path not found: {params.path or '.'}",
            title="Grep Error"
        )

    try:
        # Compile regex
        flags = 0 if params.case_sensitive else re.IGNORECASE
        try:
            regex = re.compile(params.pattern, flags)
        except re.error as e:
            return ToolOutput.error(
                f"Invalid regex pattern: {e}",
                title="Grep Error"
            )

        # Collect files to search
        files_to_search = []

        if search_path.is_file():
            files_to_search.append(search_path)
        else:
            # Get files matching include pattern
            if params.include:
                files_to_search = list(search_path.rglob(params.include))
            else:
                # Default: search common text files
                for ext in ["*.py", "*.js", "*.ts", "*.jsx", "*.tsx", "*.md", "*.txt", "*.json", "*.yaml", "*.yml", "*.toml", "*.html", "*.css", "*.sh", "*.bash"]:
                    files_to_search.extend(search_path.rglob(ext))

        # Search files
        results = []
        max_results = 100
        max_context_lines = 2

        for file_path in files_to_search:
            if len(results) >= max_results:
                break

            if not file_path.is_file():
                continue

            try:
                content = file_path.read_text(encoding="utf-8")
                lines = content.splitlines()

                for i, line in enumerate(lines):
                    if len(results) >= max_results:
                        break

                    if regex.search(line):
                        # Get context lines
                        start = max(0, i - max_context_lines)
                        end = min(len(lines), i + max_context_lines + 1)

                        context = []
                        for j in range(start, end):
                            prefix = ">" if j == i else " "
                            context.append(f"{j + 1:4d}{prefix}| {lines[j]}")

                        try:
                            rel_path = file_path.relative_to(ctx.worktree)
                        except ValueError:
                            rel_path = file_path

                        results.append({
                            "file": str(rel_path),
                            "line": i + 1,
                            "context": "\n".join(context),
                        })

            except (UnicodeDecodeError, PermissionError):
                continue

        # Format output
        if not results:
            return ToolOutput(
                title=f"Grep '{params.pattern}' (no matches)",
                output="No matches found",
                metadata={"pattern": params.pattern, "matches_count": 0},
            )

        output_parts = []
        for result in results:
            output_parts.append(f"--- {result['file']}:{result['line']} ---")
            output_parts.append(result["context"])
            output_parts.append("")

        output = "\n".join(output_parts)

        truncated = len(results) >= max_results
        if truncated:
            output += f"\n(truncated, showing first {max_results} matches)"

        # Build metadata
        metadata = {
            "pattern": params.pattern,
            "matches_count": len(results),
            "files_searched": len(files_to_search),
            "truncated": truncated,
        }

        return ToolOutput(
            title=f"Grep '{params.pattern}' ({len(results)} matches)",
            output=output,
            metadata=metadata,
        )

    except Exception as e:
        logger.error(f"Error in grep: {e}")
        return ToolOutput.error(
            f"Error in grep: {e}",
            title="Grep Error"
        )


# Define the grep tool
GrepTool = Tool.define(
    id="grep",
    description="""Search for a pattern in files.

Use this tool to search file content using regex patterns.
Results include context lines around each match.

IMPORTANT:
- Use regex syntax for patterns
- Escape special characters: . * + ? ^ $ [ ] { } | \\
- Default is case-insensitive

Examples:
- Find function: {"pattern": "def my_function"}
- Find imports: {"pattern": "^import", "include": "*.py"}
- Find TODO: {"pattern": "TODO|FIXME", "path": "src"}
- Case-sensitive: {"pattern": "MyClass", "case_sensitive": true}
""",
    parameters=GrepParams,
    execute=grep_execute,
)
