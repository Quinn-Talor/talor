"""MCP Client Management for Talor.

This module provides MCP client management using fastmcp.Client.

Features:
- MCP server connections (stdio, SSE/HTTP)
- Tool conversion to standard format
- Status tracking
- Event publishing

Transport modes:
- stdio: Subprocess with stdin/stdout communication (default)
- sse: Server-Sent Events over HTTP (for remote MCP servers)
- http: Streamable HTTP (recommended for production)
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, TYPE_CHECKING

from fastmcp import Client
from fastmcp.client.transports import StdioTransport, SSETransport, StreamableHttpTransport
from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from src.bus import Bus
    from src.config import Config


logger = logging.getLogger(__name__)


# =============================================================================
# MCP Types
# =============================================================================

class MCPTransport(str, Enum):
    """MCP transport modes."""
    STDIO = "stdio"
    SSE = "sse"
    HTTP = "http"


class MCPStatusType(str, Enum):
    """MCP server status types."""
    CONNECTED = "connected"
    DISABLED = "disabled"
    FAILED = "failed"
    NEEDS_AUTH = "needs_auth"
    CONNECTING = "connecting"


class MCPStatus(BaseModel):
    """MCP server status."""
    status: MCPStatusType
    error: str | None = None


class MCPServerConfig(BaseModel):
    """MCP server configuration."""
    # Transport mode
    transport: MCPTransport = MCPTransport.STDIO
    
    # Stdio mode fields
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    cwd: str | None = None
    
    # SSE/HTTP mode fields
    url: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    
    # Common fields
    disabled: bool = False
    auto_approve: list[str] = Field(default_factory=list)
    timeout: float = 30.0  # seconds


class MCPTool(BaseModel):
    """MCP tool definition."""
    name: str
    description: str = ""
    input_schema: dict[str, Any] = Field(default_factory=dict)
    server: str


class MCPResource(BaseModel):
    """MCP resource definition."""
    name: str
    uri: str
    description: str | None = None
    mime_type: str | None = None
    server: str


# =============================================================================
# MCP Client Wrapper
# =============================================================================

@dataclass
class MCPClientWrapper:
    """Wrapper around fastmcp.Client with status tracking."""
    
    name: str
    config: MCPServerConfig
    client: Client | None = None
    status: MCPStatus = field(default_factory=lambda: MCPStatus(status=MCPStatusType.CONNECTING))
    tools: list[MCPTool] = field(default_factory=list)
    resources: list[MCPResource] = field(default_factory=list)
    _connected: bool = False
    
    def _create_transport(self) -> Any:
        """Create the appropriate transport based on config."""
        if self.config.transport == MCPTransport.STDIO:
            if not self.config.command:
                raise ValueError("command is required for stdio transport")
            return StdioTransport(
                command=self.config.command,
                args=self.config.args,
                env=self.config.env or None,
                cwd=self.config.cwd,
            )
        elif self.config.transport == MCPTransport.SSE:
            if not self.config.url:
                raise ValueError("url is required for SSE transport")
            return SSETransport(
                url=self.config.url,
                headers=self.config.headers or None,
            )
        elif self.config.transport == MCPTransport.HTTP:
            if not self.config.url:
                raise ValueError("url is required for HTTP transport")
            return StreamableHttpTransport(
                url=self.config.url,
                headers=self.config.headers or None,
            )
        else:
            raise ValueError(f"Unknown transport: {self.config.transport}")
    
    async def connect(self) -> None:
        """Connect to the MCP server."""
        if self.config.disabled:
            self.status = MCPStatus(status=MCPStatusType.DISABLED)
            return
        
        try:
            transport = self._create_transport()
            self.client = Client(transport)
            
            # Enter the client context
            await self.client.__aenter__()
            self._connected = True
            
            # List tools
            await self._list_tools()
            
            self.status = MCPStatus(status=MCPStatusType.CONNECTED)
            logger.info(
                f"MCP server '{self.name}' connected via {self.config.transport.value} "
                f"with {len(self.tools)} tools"
            )
            
        except Exception as e:
            logger.error(f"Failed to connect to MCP server '{self.name}': {e}")
            self.status = MCPStatus(status=MCPStatusType.FAILED, error=str(e))
            await self.disconnect()
    
    async def disconnect(self) -> None:
        """Disconnect from the MCP server."""
        if self.client and self._connected:
            try:
                await self.client.__aexit__(None, None, None)
            except Exception as e:
                logger.warning(f"Error disconnecting from MCP server '{self.name}': {e}")
            self._connected = False
        
        self.client = None
        self.tools = []
        self.status = MCPStatus(status=MCPStatusType.DISABLED)
    
    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Call a tool on the MCP server."""
        if not self.client or not self._connected:
            raise RuntimeError(f"MCP server '{self.name}' not connected")
        
        result = await self.client.call_tool(
            tool_name,
            arguments,
            timeout=self.config.timeout,
        )
        
        # Return structured data if available, otherwise content
        if result.data is not None:
            return result.data
        
        # Extract text from content blocks
        contents = []
        for content in result.content:
            if hasattr(content, 'text'):
                contents.append({"type": "text", "text": content.text})
            elif hasattr(content, 'data'):
                contents.append({"type": "image", "data": content.data})
        
        return contents
    
    async def _list_tools(self) -> None:
        """List available tools from the server."""
        if not self.client:
            return
        
        tools_result = await self.client.list_tools()
        
        self.tools = []
        for tool in tools_result:
            self.tools.append(MCPTool(
                name=tool.name,
                description=tool.description or "",
                input_schema=tool.inputSchema if hasattr(tool, 'inputSchema') else {},
                server=self.name,
            ))


# =============================================================================
# MCP Namespace
# =============================================================================

class MCP:
    """MCP management namespace."""
    
    # Class-level state
    _bus: Any | None = None
    _config: Any | None = None
    _clients: dict[str, MCPClientWrapper] = {}
    _lock = asyncio.Lock()
    
    @classmethod
    def configure(cls, bus: Any = None, config: Any = None) -> None:
        """Configure the MCP system."""
        cls._bus = bus
        cls._config = config
    
    @classmethod
    async def connect(cls, name: str, config: MCPServerConfig | dict[str, Any]) -> MCPStatus:
        """Connect to an MCP server."""
        async with cls._lock:
            # Convert dict to config
            if isinstance(config, dict):
                config = MCPServerConfig(**config)
            
            # Disconnect existing client
            if name in cls._clients:
                await cls._clients[name].disconnect()
            
            # Create and connect client
            client = MCPClientWrapper(name=name, config=config)
            await client.connect()
            
            cls._clients[name] = client
            
            # Publish event
            if cls._bus and client.status.status == MCPStatusType.CONNECTED:
                from src.bus.events import MCPConnected, MCPConnectedData
                await cls._bus.publish(
                    MCPConnected,
                    MCPConnectedData(server=name, tools_count=len(client.tools))
                )
            
            return client.status
    
    @classmethod
    async def disconnect(cls, name: str) -> None:
        """Disconnect from an MCP server."""
        async with cls._lock:
            client = cls._clients.pop(name, None)
            if client:
                await client.disconnect()
                
                if cls._bus:
                    from src.bus.events import MCPDisconnected, MCPDisconnectedData
                    await cls._bus.publish(
                        MCPDisconnected,
                        MCPDisconnectedData(server=name)
                    )
    
    @classmethod
    async def status(cls, name: str) -> MCPStatus | None:
        """Get server status."""
        client = cls._clients.get(name)
        return client.status if client else None
    
    @classmethod
    async def list_servers(cls) -> list[dict[str, Any]]:
        """List all MCP servers."""
        result = []
        for name, client in cls._clients.items():
            result.append({
                "name": name,
                "status": client.status.model_dump(),
                "tools_count": len(client.tools),
            })
        return result
    
    @classmethod
    async def tools(cls, name: str | None = None) -> list[MCPTool]:
        """Get tools from MCP servers."""
        tools = []
        
        for server_name, client in cls._clients.items():
            if name and server_name != name:
                continue
            if client.status.status == MCPStatusType.CONNECTED:
                tools.extend(client.tools)
        
        return tools
    
    @classmethod
    async def call_tool(cls, server: str, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Call a tool on an MCP server."""
        client = cls._clients.get(server)
        if not client:
            raise ValueError(f"MCP server not found: {server}")
        
        if client.status.status != MCPStatusType.CONNECTED:
            raise RuntimeError(f"MCP server not connected: {server}")
        
        return await client.call_tool(tool_name, arguments)
    
    @classmethod
    def get_tool_definitions(cls) -> list[dict[str, Any]]:
        """Get LLM-compatible tool definitions from all MCP servers."""
        definitions = []
        
        for client in cls._clients.values():
            if client.status.status != MCPStatusType.CONNECTED:
                continue
            
            for tool in client.tools:
                schema = tool.input_schema.copy()
                schema.setdefault("type", "object")
                schema.setdefault("properties", {})
                schema["additionalProperties"] = False
                
                definitions.append({
                    "type": "function",
                    "function": {
                        "name": f"mcp_{client.name}_{tool.name}",
                        "description": tool.description or f"MCP tool: {tool.name}",
                        "parameters": schema,
                    },
                })
        
        return definitions
    
    @classmethod
    async def connect_from_config(cls) -> None:
        """Connect to all MCP servers from configuration."""
        if not cls._config:
            return
        
        config = await cls._config.get()
        mcp_servers = config.get("mcp", {})
        
        for name, server_config in mcp_servers.items():
            try:
                await cls.connect(name, server_config)
            except Exception as e:
                logger.error(f"Failed to connect to MCP server '{name}': {e}")
    
    @classmethod
    async def disconnect_all(cls) -> None:
        """Disconnect from all MCP servers."""
        for name in list(cls._clients.keys()):
            await cls.disconnect(name)
    
    @classmethod
    def clear(cls) -> None:
        """Clear all state (for testing)."""
        cls._clients.clear()
