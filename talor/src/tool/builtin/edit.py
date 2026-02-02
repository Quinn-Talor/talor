"""Edit Tool for Talor.

This module provides the edit tool for editing files with string replacement,
following opencode's EditTool pattern.
"""

from __future__ import annotations

import logging
from pathlib import Path

from pydantic import BaseModel, Field

from talor.tool import Tool, ToolContext, ToolOutput


logger = logging.getLogger(__name__)


class EditParams(BaseModel):
    """Parameters for edit tool."""
    
    file_path: str = Field(
        description="Path to the file to edit (relative to workspace or absolute)"
    )
    old_string: str = Field(
        description="The exact string to find and replace (must match exactly)"
    )
    new_string: str = Field(
        description="The string to replace old_string with"
    )
    replace_all: bool = Field(
        default=False,
        description="If true, replace all occurrences; if false, replace only the first"
    )


async def edit_execute(params: EditParams, ctx: ToolContext) -> ToolOutput:
    """Execute the edit tool.
    
    Args:
        params: Edit parameters
        ctx: Tool execution context
    
    Returns:
        ToolOutput with result
    """
    # Resolve file path
    file_path = Path(params.file_path)
    if not file_path.is_absolute():
        file_path = ctx.worktree / file_path
    
    # Check if file exists
    if not file_path.exists():
        return ToolOutput.error(
            f"File not found: {params.file_path}",
            title="Edit Error"
        )
    
    if not file_path.is_file():
        return ToolOutput.error(
            f"Not a file: {params.file_path}",
            title="Edit Error"
        )
    
    try:
        # Read current content
        content = file_path.read_text(encoding="utf-8")
        
        # Check if old_string exists
        if params.old_string not in content:
            return ToolOutput.error(
                f"String not found in file: {repr(params.old_string[:100])}...",
                title="Edit Error",
                metadata={"reason": "string_not_found"}
            )
        
        # Count occurrences
        occurrences = content.count(params.old_string)
        
        # Perform replacement
        if params.replace_all:
            new_content = content.replace(params.old_string, params.new_string)
            replaced_count = occurrences
        else:
            new_content = content.replace(params.old_string, params.new_string, 1)
            replaced_count = 1
        
        # Write new content
        file_path.write_text(new_content, encoding="utf-8")
        
        # Calculate diff info
        old_lines = len(content.splitlines())
        new_lines = len(new_content.splitlines())
        
        # Build metadata
        metadata = {
            "file_path": str(file_path),
            "occurrences_found": occurrences,
            "occurrences_replaced": replaced_count,
            "old_lines": old_lines,
            "new_lines": new_lines,
            "lines_changed": new_lines - old_lines,
        }
        
        return ToolOutput(
            title=f"Edited {params.file_path} ({replaced_count} replacement{'s' if replaced_count > 1 else ''})",
            output=f"Successfully replaced {replaced_count} occurrence{'s' if replaced_count > 1 else ''} in {params.file_path}",
            metadata=metadata,
        )
        
    except UnicodeDecodeError:
        return ToolOutput.error(
            f"Cannot edit binary file: {params.file_path}",
            title="Edit Error"
        )
    except PermissionError:
        return ToolOutput.error(
            f"Permission denied: {params.file_path}",
            title="Edit Error"
        )
    except Exception as e:
        logger.error(f"Error editing file {params.file_path}: {e}")
        return ToolOutput.error(
            f"Error editing file: {e}",
            title="Edit Error"
        )


# Define the edit tool
EditTool = Tool.define(
    id="edit",
    description="""Edit a file by replacing a specific string.

Use this tool to make targeted changes to a file by finding and replacing
an exact string. The old_string must match exactly (including whitespace
and indentation).

IMPORTANT:
- old_string must be unique enough to identify the exact location
- Include surrounding context (2-3 lines) to ensure uniqueness
- For multiple changes, call this tool multiple times

Examples:
- Replace function: {"file_path": "src/main.py", "old_string": "def old_func():", "new_string": "def new_func():"}
- Fix typo: {"file_path": "README.md", "old_string": "teh", "new_string": "the", "replace_all": true}
""",
    parameters=EditParams,
    execute=edit_execute,
)
