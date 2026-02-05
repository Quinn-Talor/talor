"""SSE Client Manager for Talor.

Simple module for tracking SSE client connections.
Desktop client uses a single global SSE connection.
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)

# Global client queues
_clients: list[asyncio.Queue] = []


def register_client(queue: asyncio.Queue) -> callable:
    """Register an SSE client queue.

    Args:
        queue: The asyncio.Queue for the client's events.

    Returns:
        A function to unregister the client.
    """
    _clients.append(queue)
    logger.debug(f"SSE client registered. Total: {len(_clients)}")

    def unregister() -> None:
        try:
            _clients.remove(queue)
            logger.debug(f"SSE client unregistered. Total: {len(_clients)}")
        except ValueError:
            pass

    return unregister


def get_clients() -> list[asyncio.Queue]:
    """Get all SSE client queues."""
    return _clients.copy()


def client_count() -> int:
    """Get the number of SSE clients."""
    return len(_clients)


def clear() -> None:
    """Clear all SSE clients (for testing)."""
    _clients.clear()
