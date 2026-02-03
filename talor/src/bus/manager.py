"""Session Bus Manager for Talor.

This module provides functions for managing Session-specific Bus instances.
Each Session gets its own isolated Bus instance.

Example:
    ```python
    from src.bus.manager import get_bus, create_bus, remove_bus

    # Create bus when session is created
    bus = create_bus("session_123")

    # Get bus for publishing events
    bus = get_bus("session_123")
    await bus.publish(SomeEvent, data)

    # Remove bus when session is deleted
    await remove_bus("session_123")
    ```
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable, Awaitable

from src.bus.bus import Bus

logger = logging.getLogger(__name__)

# Module-level state
_buses: dict[str, Bus] = {}
_lock = asyncio.Lock()
_on_bus_destroyed: list[Callable[[str], Awaitable[None]]] = []


def create_bus(session_id: str) -> Bus:
    """Create a Bus for a session.

    Creates a new Bus instance for the session. If a Bus already
    exists, returns the existing one (idempotent).

    Args:
        session_id: The unique identifier of the session.

    Returns:
        The Bus instance for the session.
    """
    if session_id not in _buses:
        logger.info(f"Creating Bus for session: {session_id}")
        _buses[session_id] = Bus()
    return _buses[session_id]


def get_bus(session_id: str) -> Bus:
    """Get or create a Bus for a session.

    Args:
        session_id: The unique identifier of the session.

    Returns:
        The Bus instance for the session.
    """
    if session_id not in _buses:
        return create_bus(session_id)
    return _buses[session_id]


def has_bus(session_id: str) -> bool:
    """Check if a Bus exists for a session.

    Args:
        session_id: The unique identifier of the session.

    Returns:
        True if a Bus exists for the session, False otherwise.
    """
    return session_id in _buses


async def remove_bus(session_id: str) -> None:
    """Remove and cleanup the Bus for a session.

    Args:
        session_id: The unique identifier of the session.
    """
    async with _lock:
        if session_id not in _buses:
            return

        logger.info(f"Removing Bus for session: {session_id}")

        # Notify callbacks
        for callback in _on_bus_destroyed:
            try:
                await callback(session_id)
            except Exception as e:
                logger.error(f"Error in bus destroyed callback: {e}")

        # Clear bus subscriptions and remove
        bus = _buses.pop(session_id)
        bus.clear()


def on_bus_destroyed(callback: Callable[[str], Awaitable[None]]) -> Callable[[], None]:
    """Register a callback for bus destruction events.

    Args:
        callback: Async function called with session_id when bus is destroyed.

    Returns:
        Unregister function.
    """
    _on_bus_destroyed.append(callback)

    def unregister() -> None:
        try:
            _on_bus_destroyed.remove(callback)
        except ValueError:
            pass

    return unregister


def list_sessions() -> list[str]:
    """List all session IDs with active Buses."""
    return list(_buses.keys())


def bus_count() -> int:
    """Get the number of active Buses."""
    return len(_buses)


async def shutdown() -> None:
    """Shutdown all Buses."""
    logger.info(f"Shutting down {len(_buses)} session buses")
    session_ids = list(_buses.keys())
    for session_id in session_ids:
        await remove_bus(session_id)


def clear() -> None:
    """Clear all buses (for testing)."""
    for bus in _buses.values():
        bus.clear()
    _buses.clear()
    _on_bus_destroyed.clear()
