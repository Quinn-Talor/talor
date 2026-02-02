"""Event Bus System for Talor.

This module provides the event-driven architecture following opencode's pattern:
- BusEvent.define() for typed event definitions
- Bus.publish() for event publishing
- Bus.subscribe() for event subscription
- GlobalBus for cross-instance events

Example:
    ```python
    from talor.bus import Bus, BusEvent
    from pydantic import BaseModel
    
    # Define typed event
    class SessionCreatedData(BaseModel):
        session_id: str
        title: str
    
    SessionCreated = BusEvent.define("session.created", SessionCreatedData)
    
    # Subscribe to event
    async def handler(event):
        print(f"Session created: {event.properties.session_id}")
    
    Bus.subscribe(SessionCreated, handler)
    
    # Publish event
    await Bus.publish(SessionCreated, SessionCreatedData(session_id="123", title="Test"))
    ```
"""

from talor.bus.bus_event import BusEvent
from talor.bus.bus import Bus
from talor.bus.global_bus import GlobalBus

__all__ = ["BusEvent", "Bus", "GlobalBus"]
