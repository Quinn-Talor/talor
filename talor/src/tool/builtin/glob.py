"""Glob Tool for Talor.

This module provides the glob tool for finding files by pattern,
following opencode's GlobTool pattern.
"""

from __future__ import annotations

import logging
from pathlib import Path

from pydantic import BaseModel, Field

from talor.tool import Tool, ToolContext, ToolOutput


logger = logging.getLogger(__name__)


class GlobParams(BaseModel):
    """Parameters for glob tool."""
    
    pattern: str = Field(
        description="Glob pattern to match files (e.g., '**/*.py', 'src/**/*.ts')"
    )
    path: str | None = Field(
        default=None,
        description="Base path to search from (relative to workspace, default: workspace root)"
    )


async def glob_execute(params: GlobParams, ctx: ToolContext) -> ToolOutput:
    """Execute the glob tool.
    
    Args:
        params: Glob parameters
        ctx: Tool execution context
    
    Returns:
        ToolOutput with matching files
    """
    # Determine base path
    if params.path:
        base_path = Path(params.path)
        if not base_path.is_absolute():
            base_path = ctx.worktree / base_path
    else:
        base_path = ctx.worktree
    
    # Validate base path
    if not base_path.exists():
        return ToolOutput.error(
            f"Path not found: {params.path or '.'}",
            title="Glob Error"
        )
    
    try:
        # Find matching files
        matches = list(base_path.glob(params.pattern))
        
        # Sort and format results
        matches.sort()
        
        # Limit results
        max_results = 1000
        truncated = len(matches) > max_results
        if truncated:
            matches = matches[:max_results]
        
        # Format output
        output_lines = []
        for match in matches:
            try:
                rel_path = match.relative_to(ctx.worktree)
            except ValueError:
                rel_path = match
            
            # Add file type indicator
            if match.is_dir():
                output_lines.append(f"{rel_path}/")
            else:
                output_lines.append(str(rel_path))
        
        output = "\n".join(output_lines) if output_lines else "(no matches)"
        
        # Build metadata
        metadata = {
            "pattern": params.pattern,
            "base_path": str(base_path),
            "matches_count": len(matches),
            "truncated": truncated,
        }
        
        if truncated:
            output += f"\n\n(truncated, showing first {max_results} of {len(matches)} matches)"
        
        return ToolOutput(
            title=f"Glob '{params.pattern}' ({len(matches)} matches)",
            output=output,
            metadata=metadata,
        )
        
    except Exception as e:
        logger.error(f"Error in glob: {e}")
        return ToolOutput.error(
            f"Error in glob: {e}",
            title="Glob Error"
        )


# Define the glob tool
GlobTool = Tool.define(
    id="glob",
    description="""Find files matching a glob pattern.

Use this tool to find files in the workspace using glob patterns.
Supports recursive patterns with '**'.

Common patterns:
- '*.py' - Python files in current directory
- '**/*.py' - All Python files recursively
- 'src/**/*.ts' - TypeScript files in src/
- '**/test_*.py' - All test files
- '**/*.{js,ts}' - JavaScript and TypeScript files

Examples:
- Find all Python files: {"pattern": "**/*.py"}
- Find tests: {"pattern": "**/test_*.py"}
- Find in specific dir: {"pattern": "*.md", "path": "docs"}
""",
    parameters=GlobParams,
    execute=glob_execute,
)
