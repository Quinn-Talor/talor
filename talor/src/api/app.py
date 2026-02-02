"""FastAPI Application for Talor Backend.

Provides REST API and WebSocket endpoints for the AI agent framework.
"""

from __future__ import annotations

import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.bus import Bus
from src.tool import ToolRegistry
from src.tool.builtin import get_all_builtin_tools
from src.session import Session, SessionPrompt
from src.agent import Agent
from src.config import Config
from src.provider import Provider
from src.mcp_client import MCP, register_mcp_tools
from src.core.state import state
from src.api.routes import create_api_router, create_events_router


logger = logging.getLogger(__name__)


# =============================================================================
# Event Broadcasting
# =============================================================================

async def _broadcast_event(event) -> None:
    """Broadcast event to SSE and WebSocket clients."""
    event_data = {
        "type": event.type,
        "properties": event.properties.model_dump() if hasattr(event.properties, "model_dump") else event.properties,
        "timestamp": int(time.time() * 1000),
    }

    session_id = event_data.get("properties", {}).get("session_id")

    for client in state.sse_clients:
        if client.should_receive(session_id):
            try:
                await client.queue.put(event_data)
            except Exception:
                pass

    message = json.dumps(event_data)
    disconnected = []
    for ws in state.websockets:
        try:
            await ws.send_text(message)
        except Exception:
            disconnected.append(ws)

    for ws in disconnected:
        if ws in state.websockets:
            state.websockets.remove(ws)


# =============================================================================
# Lifespan Management
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan manager."""
    logger.info("Starting Talor API server...")

    workspace = Path(os.environ.get("TALOR_WORKSPACE", os.getcwd()))
    state.workspace = workspace
    state.worktree = workspace

    # Configure systems
    Config.configure(bus=Bus, directory=workspace, worktree=workspace)
    Session.configure(storage=None, bus=Bus)
    Agent.configure(config=Config)
    Provider.configure(config=Config)
    MCP.configure(bus=Bus, config=Config)

    # Create tool registry
    state.tool_registry = ToolRegistry(bus=Bus)

    # Register built-in tools
    for tool in get_all_builtin_tools():
        await state.tool_registry.register(tool, source="builtin")

    # Configure session prompt
    SessionPrompt.configure(
        bus=Bus,
        tool_registry=state.tool_registry,
        provider=Provider,
        directory=workspace,
        worktree=workspace,
    )

    # Connect to MCP servers
    try:
        await MCP.connect_from_config()
        await register_mcp_tools(state.tool_registry)
    except Exception as e:
        logger.warning(f"Failed to connect MCP servers: {e}")

    # Subscribe to events for broadcasting
    Bus.subscribe_all(_broadcast_event)

    logger.info(f"Workspace: {workspace}")
    logger.info(f"Tools registered: {state.tool_registry.tool_count}")
    logger.info("Talor API server started")

    yield

    # Shutdown
    logger.info("Shutting down Talor API server...")

    await MCP.disconnect_all()

    if state.tool_registry:
        await state.tool_registry.clear()

    for ws in state.websockets:
        try:
            await ws.close()
        except Exception:
            pass

    logger.info("Talor API server stopped")


# =============================================================================
# FastAPI App
# =============================================================================

app = FastAPI(
    title="Talor API",
    description="Backend API for Talor AI Agent Framework",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(create_api_router(), prefix="/api")

# Include events routes at root level (no /api prefix)
# /event and /ws are accessed directly without /api prefix
app.include_router(create_events_router(), tags=["events"])

# Root endpoint (outside /api prefix)
@app.get("/")
async def root() -> dict:
    """Root endpoint - API info."""
    return {
        "name": "Talor API",
        "version": "0.1.0",
        "status": "running",
        "architecture": "react-agent",
    }


def create_app() -> FastAPI:
    """Create and return the FastAPI application."""
    return app
