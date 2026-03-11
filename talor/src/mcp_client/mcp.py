"""MCP Client Management for Talor.

This module provides MCP client management using fastmcp.Client.

Features:
- MCP server connections (stdio, SSE/HTTP)
- Tool conversion to standard format
- Status tracking
- Event publishing
- Authentication support (bearer token, API key, keyring)

Transport modes:
- stdio: Subprocess with stdin/stdout communication (default)
- sse: Server-Sent Events over HTTP (for remote MCP servers)
- http: Streamable HTTP (recommended for production)

Design:
- MCPManager is an instance-based class (no singleton/class-level state)
- Multiple independent managers can coexist without interference
- Each manager owns its own _clients dict and asyncio.Lock
- MCP is kept as a backward-compatible alias for MCPManager
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


class MCPAuthType(str, Enum):
    """MCP authentication types."""
    NONE = "none"
    BEARER = "bearer"    # Authorization: Bearer <token>
    API_KEY = "api_key"  # Custom header with API key


class MCPAuthConfig(BaseModel):
    """MCP server authentication configuration."""
    type: MCPAuthType = MCPAuthType.NONE
    # Token reference in keyring: "keyring:key_name"
    token_ref: str | None = None
    # Plain-text token (dev/testing only, never persisted to disk)
    token: str | None = None
    # Header name for API_KEY mode
    header_name: str = "Authorization"
    # For stdio mode: inject resolved token as this environment variable
    env_var: str | None = None


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

    # Authentication
    auth: MCPAuthConfig = Field(default_factory=MCPAuthConfig)


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

    def _resolve_auth_token(self) -> str | None:
        """Resolve authentication token from config."""
        auth = self.config.auth
        if auth.type == MCPAuthType.NONE:
            return None

        # Plain-text token (dev/testing only)
        if auth.token:
            return auth.token

        # Keyring reference: "keyring:key_name"
        if auth.token_ref and auth.token_ref.startswith("keyring:"):
            key_name = auth.token_ref[8:]
            try:
                from src.config.keyring_manager import get_key
                resolved = get_key(key_name)
                if resolved:
                    return resolved
                logger.warning(
                    f"MCP server '{self.name}': keyring key '{key_name}' not found"
                )
            except Exception as e:
                logger.error(
                    f"MCP server '{self.name}': failed to resolve keyring key '{key_name}': {e}"
                )
        return None

    def _build_auth_headers(self) -> dict[str, str]:
        """Build authentication headers for SSE/HTTP transport."""
        auth = self.config.auth
        if auth.type == MCPAuthType.NONE:
            return {}

        token = self._resolve_auth_token()
        if not token:
            return {}

        if auth.type == MCPAuthType.BEARER:
            return {"Authorization": f"Bearer {token}"}
        elif auth.type == MCPAuthType.API_KEY:
            return {auth.header_name: token}

        return {}

    def _build_auth_env(self) -> dict[str, str]:
        """Build environment variables for stdio transport auth."""
        auth = self.config.auth
        if auth.type == MCPAuthType.NONE or not auth.env_var:
            return {}

        token = self._resolve_auth_token()
        if not token:
            return {}

        return {auth.env_var: token}

    def _create_transport(self) -> Any:
        """Create the appropriate transport based on config."""
        if self.config.transport == MCPTransport.STDIO:
            if not self.config.command:
                raise ValueError("command is required for stdio transport")
            merged_env = {**self.config.env, **self._build_auth_env()}
            return StdioTransport(
                command=self.config.command,
                args=self.config.args,
                env=merged_env or None,
                cwd=self.config.cwd,
            )
        elif self.config.transport == MCPTransport.SSE:
            if not self.config.url:
                raise ValueError("url is required for SSE transport")
            merged_headers = {**self.config.headers, **self._build_auth_headers()}
            return SSETransport(
                url=self.config.url,
                headers=merged_headers or None,
            )
        elif self.config.transport == MCPTransport.HTTP:
            if not self.config.url:
                raise ValueError("url is required for HTTP transport")
            merged_headers = {**self.config.headers, **self._build_auth_headers()}
            return StreamableHttpTransport(
                url=self.config.url,
                headers=merged_headers or None,
            )
        else:
            raise ValueError(f"Unknown transport: {self.config.transport}")

    async def connect(self) -> None:
        """Connect to the MCP server."""
        if self.config.disabled:
            self.status = MCPStatus(status=MCPStatusType.DISABLED)
            return

        # Check if auth is required but unresolvable (only for header-based auth)
        if (self.config.auth.type != MCPAuthType.NONE
                and not self.config.auth.env_var
                and self._resolve_auth_token() is None):
            self.status = MCPStatus(
                status=MCPStatusType.NEEDS_AUTH,
                error=(
                    f"Authentication required but token not found "
                    f"(token_ref={self.config.auth.token_ref!r})"
                )
            )
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
# Preset helpers
# =============================================================================

def _load_presets() -> dict[str, dict[str, Any]]:
    """Load built-in MCP presets from presets.json.

    Returns a dict keyed by preset 'id' for O(1) lookup.
    Returns {} on any error (missing file, parse error, etc.).
    """
    import json as _json
    from pathlib import Path as _Path

    presets_path = _Path(__file__).parent / "presets.json"
    if not presets_path.exists():
        return {}
    try:
        presets_list: list[dict[str, Any]] = _json.loads(
            presets_path.read_text(encoding="utf-8")
        )
        return {p["id"]: p for p in presets_list if "id" in p}
    except Exception as exc:
        logger.warning(f"Failed to load MCP presets: {exc}")
        return {}


def _merge_with_preset(
    name: str,
    user_config: dict[str, Any],
    presets: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Merge a user config entry with a preset if needed.

    When the user config lacks both 'command' and 'url', we look up the
    server name in the preset registry and use the preset values as defaults.
    User-provided values always win (merge with user on top).
    """
    if user_config.get("command") or user_config.get("url"):
        # User already specified transport details — no preset merging needed
        return user_config

    preset = presets.get(name)
    if not preset:
        return user_config

    # Preset fields that serve as defaults (user config overrides these)
    preset_defaults: dict[str, Any] = {}
    for key in ("transport", "command", "args", "url", "auth"):
        if key in preset:
            preset_defaults[key] = preset[key]

    # Merge: preset defaults first, then user config on top
    merged = {**preset_defaults, **user_config}
    logger.debug(f"MCP server '{name}' config merged from preset '{name}'")
    return merged


# =============================================================================
# MCPManager (instance-based, no class-level state)
# =============================================================================

class MCPManager:
    """MCP management instance.

    Manages MCP server connections, tool discovery, and invocation.

    This is an instance-based class (no singleton/class-level state):
    - Each instance has its own _clients dict and asyncio.Lock
    - Multiple managers can coexist without state interference
    - Safe for testing, per-session scoping, or parallel usage

    Example:
        manager = MCPManager(bus=bus, config=Config)
        await manager.connect_from_config()
        tools = await manager.tools()
        result = await manager.call_tool("playwright", "navigate", {"url": "..."})
        await manager.disconnect_all()
    """

    def __init__(self, bus: Any = None, config: Any = None) -> None:
        self._bus = bus
        self._config = config
        self._clients: dict[str, MCPClientWrapper] = {}
        self._lock = asyncio.Lock()

    def configure(self, bus: Any = None, config: Any = None) -> None:
        """Update bus and config references after construction."""
        if bus is not None:
            self._bus = bus
        if config is not None:
            self._config = config

    async def connect(self, name: str, config: MCPServerConfig | dict[str, Any]) -> MCPStatus:
        """Connect to an MCP server."""
        async with self._lock:
            if isinstance(config, dict):
                config = MCPServerConfig(**config)

            if name in self._clients:
                await self._clients[name].disconnect()

            client = MCPClientWrapper(name=name, config=config)
            await client.connect()

            self._clients[name] = client

            if self._bus and client.status.status == MCPStatusType.CONNECTED:
                from src.bus.events import MCPConnected, MCPConnectedData
                await self._bus.publish(
                    MCPConnected,
                    MCPConnectedData(server=name, tools_count=len(client.tools))
                )

            return client.status

    async def disconnect(self, name: str) -> None:
        """Disconnect from an MCP server."""
        async with self._lock:
            client = self._clients.pop(name, None)
            if client:
                await client.disconnect()

                if self._bus:
                    from src.bus.events import MCPDisconnected, MCPDisconnectedData
                    await self._bus.publish(
                        MCPDisconnected,
                        MCPDisconnectedData(server=name)
                    )

    async def status(self, name: str) -> MCPStatus | None:
        """Get server status."""
        client = self._clients.get(name)
        return client.status if client else None

    async def list_servers(self) -> list[dict[str, Any]]:
        """List all MCP servers."""
        result = []
        for name, client in self._clients.items():
            result.append({
                "name": name,
                "status": client.status.model_dump(),
                "tools_count": len(client.tools),
            })
        return result

    async def tools(self, name: str | None = None) -> list[MCPTool]:
        """Get tools from MCP servers."""
        tools: list[MCPTool] = []

        for server_name, client in self._clients.items():
            if name and server_name != name:
                continue
            if client.status.status == MCPStatusType.CONNECTED:
                tools.extend(client.tools)

        return tools

    async def call_tool(self, server: str, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Call a tool on an MCP server."""
        client = self._clients.get(server)
        if not client:
            raise ValueError(f"MCP server not found: {server}")

        if client.status.status != MCPStatusType.CONNECTED:
            raise RuntimeError(f"MCP server not connected: {server}")

        return await client.call_tool(tool_name, arguments)

    def get_tool_definitions(self) -> list[dict[str, Any]]:
        """Get LLM-compatible tool definitions from all connected MCP servers."""
        definitions = []

        for client in self._clients.values():
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

    async def connect_from_config(self) -> None:
        """Connect to all MCP servers from configuration.

        If a server config entry omits 'command' (and 'url'), the server name
        is looked up in the built-in presets.json to auto-fill the transport
        defaults.  User-provided fields always take precedence over preset
        defaults (merge semantics).
        """
        if not self._config:
            return

        config = await self._config.get()
        mcp_servers = config.get("mcp", {})

        presets = _load_presets()

        for name, server_config in mcp_servers.items():
            try:
                if isinstance(server_config, dict):
                    merged = _merge_with_preset(name, server_config, presets)
                else:
                    merged = server_config
                await self.connect(name, merged)
            except Exception as e:
                logger.error(f"Failed to connect to MCP server '{name}': {e}")

    async def disconnect_all(self) -> None:
        """Disconnect from all MCP servers."""
        for name in list(self._clients.keys()):
            await self.disconnect(name)

    def clear(self) -> None:
        """Clear all state. For testing only."""
        self._clients.clear()


# Backward-compatible alias — new code should use MCPManager directly
MCP = MCPManager
