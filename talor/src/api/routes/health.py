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
