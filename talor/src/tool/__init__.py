"""Unified Tool System for Talor.

This module provides the tool system for agent actions:
- Tool.define() for tool definitions
- Tool.Context for execution context
- Tool.Output for standardized results
- ToolRegistry for tool management

Example:
    ```python
    from src.tool import Tool, ToolRegistry
    from pydantic import BaseModel

    class ReadParams(BaseModel):
        file_path: str
        offset: int = 0
        limit: int = 2000

    async def read_handler(params: ReadParams, ctx: Tool.Context) -> Tool.Output:
        content = await read_file(params.file_path)
        return Tool.Output(
            title=f"Read {params.file_path}",
            output=content,
            metadata={"lines": len(content.splitlines())}
        )

    ReadTool = Tool.define(
        "read",
        description="Read file content",
        parameters=ReadParams,
        execute=read_handler,
    )

    # Register with registry
    registry = ToolRegistry()
    await registry.register(ReadTool)
    ```
"""

from src.tool.tool import Tool
from src.tool.registry import ToolRegistry
from src.tool.context import ToolContext
from src.tool.output import ToolOutput

__all__ = ["Tool", "ToolRegistry", "ToolContext", "ToolOutput"]
