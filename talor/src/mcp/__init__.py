"""MCP (Model Context Protocol) Integration for Talor.

This module provides MCP server management following opencode's pattern:
- MCP client connections
- Tool conversion to standard format
- Status management
- Event publishing

Example:
    ```python
    from talor.mcp import MCP
    
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

from talor.mcp.mcp import (
    MCP,
    MCPClientWrapper,
    MCPResource,
    MCPServerConfig,
    MCPStatus,
    MCPStatusType,
    MCPTool,
    MCPTransport,
)

__all__ = [
    "MCP",
    "MCPClientWrapper",
    "MCPResource",
    "MCPServerConfig",
    "MCPStatus",
    "MCPStatusType",
    "MCPTool",
    "MCPTransport",
]
