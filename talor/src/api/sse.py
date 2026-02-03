"""SSE Client Manager for Talor.

This module manages Server-Sent Events (SSE) client connections.
Each session can have multiple SSE clients subscribed to its events.

Example:
    ```python
    from src.api.sse import register_client, unregister_client

    # Register a client
    queue = asyncio.Queue()
    unregister = register_client("session_123", queue)

    # When client disconnects
    unregister()
    ```
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable

logger = logging.getLogger(__name__)

# Module-level state: session_id -> list of client queues
_clients: dict[str, list[asyncio.Queue]] = {}


def register_client(session_id: str, queue: asyncio.Queue) -> Callable[[], None]:
    """Register an SSE client queue for a session.

    Args:
        session_id: The session to subscribe to.
        queue: The asyncio.Queue for the client's events.

    Returns:
        A function to unregister the client.
    """
    if session_id not in _clients:
        _clients[session_id] = []

    _clients[session_id].append(queue)
    logger.debug(f"SSE client registered for session: {session_id}")

    def unregister() -> None:
        if session_id in _clients:
            try:
                _clients[session_id].remove(queue)
                logger.debug(f"SSE client unregistered for session: {session_id}")
            except ValueError:
                pass  # Already removed

    return unregister


def get_clients(session_id: str) -> list[asyncio.Queue]:
    """Get all SSE client queues for a session.

    Args:
        session_id: The session identifier.

    Returns:
        List of client queues. Empty list if no clients.
    """
    return _clients.get(session_id, [])


def client_count(session_id: str) -> int:
    """Get the number of SSE clients for a session.

    Args:
        session_id: The session identifier.

    Returns:
        Number of connected clients.
    """
    return len(_clients.get(session_id, []))


def clear_session(session_id: str) -> None:
    """Clear all SSE clients for a session.

    Called when a session is deleted.

    Args:
        session_id: The session identifier.
    """
    if session_id in _clients:
        del _clients[session_id]
        logger.debug(f"Cleared SSE clients for session: {session_id}")


def clear() -> None:
    """Clear all SSE clients (for testing)."""
    _clients.clear()
