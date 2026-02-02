"""Application State for Talor."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import WebSocket

if TYPE_CHECKING:
    from src.tool import ToolRegistry


class SSEClient:
    """SSE client with session subscriptions."""

    def __init__(self):
        self.queue: asyncio.Queue = asyncio.Queue()
        self.subscribed_sessions: set[str] = set()
        self.subscribe_all: bool = True

    def should_receive(self, session_id: str | None) -> bool:
        """Check if this client should receive events for a session."""
        if self.subscribe_all:
            return True
        if session_id is None:
            return True
        return session_id in self.subscribed_sessions

    def subscribe(self, session_id: str) -> None:
        """Subscribe to a specific session."""
        self.subscribe_all = False
        self.subscribed_sessions.add(session_id)

    def unsubscribe(self, session_id: str) -> None:
        """Unsubscribe from a specific session."""
        self.subscribed_sessions.discard(session_id)
        if not self.subscribed_sessions:
            self.subscribe_all = True


class AppState:
    """Application state container."""

    tool_registry: "ToolRegistry | None" = None
    workspace: Path = Path(".")
    worktree: Path = Path(".")
    sse_clients: list[SSEClient] = []
    websockets: list[WebSocket] = []


# Global state instance
state = AppState()
