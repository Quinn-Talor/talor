"""FastAPI Application for Talor Backend.

Provides REST API and WebSocket endpoints for the AI agent framework.

Architecture:
    Uses module-level initialization for simplified dependency management.

    ```python
    from src import initialize, shutdown
    from src.bus import Bus

    # Initialize all modules
    bus = Bus(directory=str(workspace))
    await initialize(workspace=workspace, storage=None, bus=bus)

    # Use module-level functions directly
    from src.session import create_session
    session = await create_session(title="New Session")

    # Cleanup on shutdown
    shutdown()
    ```
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src import initialize, shutdown
from src.bus import Bus
from src.tool import ToolRegistry
from src.tool.builtin import get_all_builtin_tools
from src.config import Config
from src.mcp_client import MCPManager, register_mcp_tools
from src.core.state import state
from src.api.routes import create_api_router, create_events_router


logger = logging.getLogger(__name__)


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

    # Create a temporary bus for module initialization (config events only)
    bus = Bus()

    # Initialize all modules using simplified architecture
    await initialize(
        workspace=workspace,
        worktree=workspace,
        storage=None,
        bus=bus,
    )

    # Configure other systems (still using static API for now)
    Config.configure(bus=bus, directory=workspace, worktree=workspace)
    mcp_manager = MCPManager(bus=bus, config=Config)
    state.mcp_manager = mcp_manager

    # Create tool registry directly
    tool_registry = ToolRegistry(bus=bus)
    state.tool_registry = tool_registry

    # Register built-in tools
    for tool in get_all_builtin_tools():
        await state.tool_registry.register(tool, source="builtin")

    # Connect to MCP servers
    try:
        print("[DEBUG] Starting MCP connection...", flush=True)
        logger.info("Connecting to MCP servers from config...")

        await mcp_manager.connect_from_config()
        print("[DEBUG] MCP servers connected", flush=True)
        logger.info("MCP servers connected successfully")

        print("[DEBUG] Registering MCP tools...", flush=True)
        await register_mcp_tools(state.tool_registry, mcp_manager)
        print(f"[DEBUG] MCP tools registered. Total: {state.tool_registry.tool_count}", flush=True)
        logger.info(
            f"MCP tools registered successfully. Total tools: {state.tool_registry.tool_count}"
        )
    except Exception as e:
        print(f"[ERROR] MCP connection failed: {e}", flush=True)
        logger.warning(f"Failed to connect MCP servers: {e}")
        import traceback

        error_trace = traceback.format_exc()
        print(f"[ERROR] Traceback:\n{error_trace}", flush=True)
        logger.warning(f"Traceback: {error_trace}")

    # Create AgentExecutor with module-level services
    from src.session import SessionService
    from src.provider import ProviderService
    from src.agent import AgentService, AgentExecutor

    session_service = SessionService(bus=bus)
    provider_service = ProviderService()
    agent_service = AgentService()

    state.agent_executor = AgentExecutor(
        session_service=session_service,
        provider_service=provider_service,
        tool_registry=tool_registry,
        agent_service=agent_service,
        workspace=workspace,
        worktree=workspace,
    )

    # Initialize task service with storage (shared with session module so FK works)
    from src.core.storage import StorageSystem
    import src.task.service as task_svc
    import src.session.session as session_module

    task_storage = StorageSystem()
    await task_storage.init()
    session_module.configure(workspace=workspace, storage=task_storage)
    task_svc.configure(workspace=workspace, storage=task_storage)

    # Recover any tasks that were running before shutdown
    await task_svc.recover_interrupted_tasks()

    state.task_storage = task_storage

    logger.info(f"Workspace: {workspace}")
    logger.info(f"Tools registered: {state.tool_registry.tool_count}")
    logger.info("Talor API server started")

    yield

    # Shutdown
    logger.info("Shutting down Talor API server...")

    # Note: Global bus doesn't need explicit shutdown as it's managed by the application lifecycle

    await mcp_manager.disconnect_all()

    if state.tool_registry:
        await state.tool_registry.clear()

    if hasattr(state, "task_storage") and state.task_storage:
        await state.task_storage.close()

    # Clear module caches
    shutdown()

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
    title="Talor — AI Agent 平台",
    description="AI Agent 平台，支持构建、定义和运行结构化 Agent。",
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
        "name": "Talor AI Agent 平台",
        "version": "0.1.0",
        "status": "running",
        "architecture": "agent-platform",
        "capabilities": ["agents", "react-agent", "mcp", "multi-provider"],
    }


def create_app() -> FastAPI:
    """Create and return the FastAPI application."""
    return app
