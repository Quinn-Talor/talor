"""Application State for Talor."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import WebSocket

if TYPE_CHECKING:
    from src.tool import ToolRegistry
    from src.agent.executor import AgentExecutor
    from src.mcp_client.mcp import MCPManager


class AppState:
    """Application state container.

    Note: Global bus has been removed. Use SessionBusManager
    to get session-specific buses.
    """

    tool_registry: "ToolRegistry | None" = None
    agent_executor: "AgentExecutor | None" = None
    mcp_manager: "MCPManager | None" = None
    workspace: Path = Path(".")
    worktree: Path = Path(".")
    websockets: list[WebSocket] = []
    # Removed: bus, sse_clients


# Global state instance
state = AppState()
