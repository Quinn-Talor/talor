"""API Routes for Talor."""

from fastapi import APIRouter

from src.api.routes.health import router as health_router
from src.api.routes.sessions import router as sessions_router
from src.api.routes.prompt import router as prompt_router
from src.api.routes.tools import router as tools_router
from src.api.routes.agents import router as agents_router
from src.api.routes.providers import router as providers_router
from src.api.routes.mcp import router as mcp_router
from src.api.routes.config import router as config_router
from src.api.routes.events import router as events_router


def create_api_router() -> APIRouter:
    """Create the main API router with all sub-routers (under /api prefix)."""
    api_router = APIRouter()

    api_router.include_router(health_router, tags=["health"])
    api_router.include_router(sessions_router, prefix="/sessions", tags=["sessions"])
    api_router.include_router(prompt_router, prefix="/session", tags=["prompt"])
    api_router.include_router(tools_router, prefix="/tools", tags=["tools"])
    api_router.include_router(agents_router, prefix="/agents", tags=["agents"])
    api_router.include_router(providers_router, prefix="/providers", tags=["providers"])
    api_router.include_router(mcp_router, prefix="/mcp", tags=["mcp"])
    api_router.include_router(config_router, prefix="/config", tags=["config"])

    return api_router


def create_events_router() -> APIRouter:
    """Create the events router (at root level, no /api prefix)."""
    return events_router


__all__ = ["create_api_router", "create_events_router"]
