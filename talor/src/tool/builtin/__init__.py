"""Built-in Tools for Talor.

This module provides the built-in tools for agent actions:
- read: Read file content
- write: Write file content
- edit: Edit file with string replacement
- bash: Execute shell commands
- glob: Find files by pattern
- grep: Search file content
- ls: List directory contents
- subagent: Delegate subtasks to specialized subagents
- mcp_search: On-demand discovery of MCP tools (saves context tokens)

Each tool is defined using Tool.define() with Pydantic parameters.
"""

from src.tool.builtin.read import ReadTool
from src.tool.builtin.write import WriteTool
from src.tool.builtin.edit import EditTool
from src.tool.builtin.bash import BashTool
from src.tool.builtin.glob import GlobTool
from src.tool.builtin.grep import GrepTool
from src.tool.builtin.ls import ListTool
from src.tool.builtin.subagent import SubagentTool
from src.tool.builtin.mcp_search import MCPSearchTool

__all__ = [
    "ReadTool",
    "WriteTool",
    "EditTool",
    "BashTool",
    "GlobTool",
    "GrepTool",
    "ListTool",
    "SubagentTool",
    "MCPSearchTool",
]


def get_all_builtin_tools():
    """Get all built-in tools.

    Returns:
        List of ToolInfo instances
    """
    return [
        ReadTool,
        WriteTool,
        EditTool,
        BashTool,
        GlobTool,
        GrepTool,
        ListTool,
        SubagentTool,
        MCPSearchTool,
    ]
