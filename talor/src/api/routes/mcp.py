"""MCP Routes."""

from typing import Any

from fastapi import APIRouter

from src.api.models import MCPServerResponse
from src.mcp_client import MCP


router = APIRouter()


@router.get("/servers", response_model=list[MCPServerResponse])
async def list_mcp_servers() -> list[MCPServerResponse]:
    """List MCP servers."""
    servers = await MCP.list_servers()
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
    status = await MCP.connect(server_name, config)
    return {"status": status.status, "error": status.error}


@router.post("/servers/{server_name}/disconnect")
async def disconnect_mcp_server(server_name: str) -> dict:
    """Disconnect from an MCP server."""
    await MCP.disconnect(server_name)
    return {"status": "disconnected"}


@router.get("/tools")
async def list_mcp_tools() -> list[dict]:
    """List tools from all MCP servers."""
    tools = await MCP.tools()
    return [t.model_dump() for t in tools]
