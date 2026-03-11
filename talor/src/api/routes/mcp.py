"""MCP Routes."""

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from src.api.models import MCPServerResponse
from src.core.state import state


router = APIRouter()

_PRESETS_PATH = Path(__file__).parent.parent.parent / "mcp_client" / "presets.json"


@router.get("/servers", response_model=list[MCPServerResponse])
async def list_mcp_servers() -> list[MCPServerResponse]:
    """List MCP servers."""
    mcp_manager = state.mcp_manager
    if not mcp_manager:
        return []
    servers = await mcp_manager.list_servers()
    return [
        MCPServerResponse(
            name=s["name"],
            status=s["status"]["status"],
            tools_count=s["tools_count"],
        )
        for s in servers
    ]


@router.post("/servers/{server_name}/connect")
async def connect_mcp_server(server_name: str, config: dict[str, Any]) -> dict:
    """Connect to an MCP server."""
    mcp_manager = state.mcp_manager
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP manager not initialized")
    status = await mcp_manager.connect(server_name, config)
    return {"status": status.status, "error": status.error}


@router.post("/servers/{server_name}/disconnect")
async def disconnect_mcp_server(server_name: str) -> dict:
    """Disconnect from an MCP server."""
    mcp_manager = state.mcp_manager
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP manager not initialized")
    await mcp_manager.disconnect(server_name)
    return {"status": "disconnected"}


@router.get("/tools")
async def list_mcp_tools() -> list[dict]:
    """List tools from all MCP servers."""
    mcp_manager = state.mcp_manager
    if not mcp_manager:
        return []
    tools = await mcp_manager.tools()
    return [t.model_dump() for t in tools]


@router.get("/presets")
async def list_mcp_presets() -> list[dict]:
    """List built-in MCP server presets from presets.json.

    Returns preset templates that users can select in the management UI.
    Each preset provides sensible defaults (command/args/transport) so users
    don't have to look up configuration details manually.
    """
    if not _PRESETS_PATH.exists():
        return []
    try:
        return json.loads(_PRESETS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
