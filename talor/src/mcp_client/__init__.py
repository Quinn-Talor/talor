"""MCP (Model Context Protocol) Integration for Talor.

This module provides MCP server management for tool extension:
- MCP client connections
- Tool conversion to standard format
- Status management
- Event publishing

Example:
    ```python
    from src.mcp_client import MCP

    # Connect to MCP server
    await MCP.connect("my-server", {
        "command": "uvx",
        "args": ["my-mcp-server"],
    })

    # Get tools from server
    tools = await MCP.tools("my-server")

    # Get status
    status = await MCP.status("my-server")
    ```
"""

# Lazy imports to avoid circular import with fastmcp
def __getattr__(name: str):
    if name in (
        "MCP",
        "MCPManager",
        "MCPClientWrapper",
        "MCPResource",
        "MCPServerConfig",
        "MCPStatus",
        "MCPStatusType",
        "MCPTool",
        "MCPTransport",
    ):
        from src.mcp_client.mcp import (
            MCP,
            MCPManager,
            MCPClientWrapper,
            MCPResource,
            MCPServerConfig,
            MCPStatus,
            MCPStatusType,
            MCPTool,
            MCPTransport,
        )
        return locals()[name]
    if name in ("MCPToolInfo", "register_mcp_tools"):
        from src.mcp_client.tools import MCPToolInfo, register_mcp_tools
        return locals()[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "MCP",
    "MCPManager",
    "MCPClientWrapper",
    "MCPResource",
    "MCPServerConfig",
    "MCPStatus",
    "MCPStatusType",
    "MCPTool",
    "MCPTransport",
    "MCPToolInfo",
    "register_mcp_tools",
]
