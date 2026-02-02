"""Config Routes."""

from typing import Any

from fastapi import APIRouter

from src.api.models import ConfigResponse
from src.config import Config


router = APIRouter()


@router.get("", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    """Get current configuration."""
    config = await Config.get()
    return ConfigResponse(
        default_agent=config.get("default_agent"),
        default_model=config.get("default_model"),
        providers=config.get("provider", {}),
        mcp=config.get("mcp", {}),
    )


@router.put("/{key}")
async def set_config(key: str, value: Any, scope: str = "project") -> dict:
    """Set a configuration value."""
    await Config.set(key, value, scope=scope)
    return {"status": "updated"}
