"""Event Bus System for Talor.

This module provides the event-driven architecture:
- BusEvent.define() for typed event definitions
- Bus.publish() for event publishing
- Bus.subscribe() for event subscription
- manager module for session-specific bus management

Example:
    ```python
    from src.bus import Bus, BusEvent
    from src.bus import manager as bus_manager
    from pydantic import BaseModel

    # Define typed event
    class SessionCreatedData(BaseModel):
        session_id: str
        title: str

    SessionCreated = BusEvent.define("session.created", SessionCreatedData)

    # Get session bus
    bus = bus_manager.get_bus("session_123")

    # Subscribe to event
    async def handler(event):
        print(f"Session created: {event.properties.session_id}")

    bus.subscribe(SessionCreated, handler)

    # Publish event
    await bus.publish(SessionCreated, SessionCreatedData(session_id="123", title="Test"))
    ```
"""

from src.bus.bus_event import BusEvent
from src.bus.bus import Bus
from src.bus.global_bus import GlobalBus
from src.bus import manager

__all__ = ["BusEvent", "Bus", "GlobalBus", "manager"]
