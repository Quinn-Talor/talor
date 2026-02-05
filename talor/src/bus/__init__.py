"""Event Bus System for Talor.

This module provides the event-driven architecture:
- BusEvent.define() for typed event definitions
- Bus.publish() for event publishing
- Bus.subscribe() for event subscription
- GlobalBus for application-wide event communication

Example:
    ```python
    from src.bus import Bus, BusEvent, GlobalBus
    from pydantic import BaseModel

    # Define typed event
    class SessionCreatedData(BaseModel):
        session_id: str
        title: str

    SessionCreated = BusEvent.define("session.created", SessionCreatedData)

    # Get global bus
    from src import get_global_bus
    bus = get_global_bus()

    # Subscribe to event (with optional session_id filter)
    async def handler(event):
        print(f"Session created: {event.properties.session_id}")

    bus.subscribe(SessionCreated, handler, session_id="session_123")

    # Publish event
    await bus.publish(SessionCreated, SessionCreatedData(session_id="123", title="Test"))
    ```
"""

from src.bus.bus_event import BusEvent
from src.bus.bus import Bus
from src.bus.global_bus import GlobalBus

__all__ = ["BusEvent", "Bus", "GlobalBus"]
