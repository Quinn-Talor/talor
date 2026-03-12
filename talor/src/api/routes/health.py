"""Health Check Routes."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from src.api.models import HealthResponse


router = APIRouter()


@router.get("/", response_class=JSONResponse)
async def root() -> dict:
    """Root endpoint - API info."""
    return {
        "name": "Talor API",
        "version": "0.1.0",
        "status": "running",
        "architecture": "react-agent",
    }


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Health check."""
    return HealthResponse(status="ok", version="0.1.0")


@router.get("/mcp-status", response_class=JSONResponse)
async def mcp_status() -> dict:
    """Check MCP server status (debugging endpoint)."""
    from src.core.state import state

    if not state.mcp_manager:
        return {"error": "MCP Manager not initialized"}

    try:
        servers = await state.mcp_manager.list_servers()
        return {
            "mcp_manager_exists": True,
            "servers": servers,
            "tool_registry_count": state.tool_registry.tool_count if state.tool_registry else 0,
        }
    except Exception as e:
        return {"error": str(e), "exception_type": type(e).__name__}
