"""Event Bus for Talor.

This module provides the Bus namespace for event publishing and subscription,
following opencode's Bus pattern with instance-scoped state.

Example:
    ```python
    from talor.bus import Bus, BusEvent
    from pydantic import BaseModel
    
    class SessionData(BaseModel):
        session_id: str
    
    SessionCreated = BusEvent.define("session.created", SessionData)
    
    # Subscribe
    async def handler(event):
        print(f"Created: {event.properties.session_id}")
    
    unsub = Bus.subscribe(SessionCreated, handler)
    
    # Publish
    await Bus.publish(SessionCreated, SessionData(session_id="123"))
    
    # Unsubscribe
    unsub()
    ```
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Awaitable, TypeVar, Generic

from pydantic import BaseModel

from talor.bus.bus_event import BusEvent, EventDefinition, EventPayload
from talor.bus.global_bus import GlobalBus


logger = logging.getLogger(__name__)


# Type variable for event properties
P = TypeVar("P", bound=BaseModel)

# Callback type for event handlers
EventCallback = Callable[[EventPayload[P]], Awaitable[None] | None]


class Bus:
    """Event bus for component communication.
    
    Corresponds to opencode's Bus namespace.
    Provides publish/subscribe functionality with typed events.
    
    Features:
    - Typed event definitions with Pydantic models
    - Async event delivery
    - Wildcard subscription ("*")
    - Instance-scoped state
    - GlobalBus integration for cross-instance events
    """
    
    # Instance-scoped subscriptions
    _subscriptions: dict[str, list[EventCallback]] = {}
    _lock = asyncio.Lock()
    _instance_directory: str | None = None
    
    @classmethod
    def set_instance(cls, directory: str) -> None:
        """Set the current instance directory.
        
        Used for GlobalBus event routing.
        
        Args:
            directory: Instance working directory
        """
        cls._instance_directory = directory
    
    @classmethod
    async def publish(
        cls,
        definition: EventDefinition[P],
        properties: P,
    ) -> None:
        """Publish an event to all subscribers.
        
        Corresponds to opencode's Bus.publish().
        
        Args:
            definition: Event definition from BusEvent.define()
            properties: Event properties instance
        
        Example:
            ```python
            await Bus.publish(SessionCreated, SessionData(session_id="123"))
            ```
        """
        payload = EventPayload(type=definition.type, properties=properties)
        
        logger.debug(f"Publishing event: {definition.type}")
        
        # Collect handlers for this event type and wildcard
        handlers: list[EventCallback] = []
        
        async with cls._lock:
            # Specific type handlers
            if definition.type in cls._subscriptions:
                handlers.extend(cls._subscriptions[definition.type])
            
            # Wildcard handlers
            if "*" in cls._subscriptions:
                handlers.extend(cls._subscriptions["*"])
        
        # Execute handlers concurrently
        if handlers:
            tasks = []
            for handler in handlers:
                task = asyncio.create_task(cls._call_handler(handler, payload))
                tasks.append(task)
            
            await asyncio.gather(*tasks, return_exceptions=True)
        
        # Emit to GlobalBus for cross-instance communication
        if cls._instance_directory:
            GlobalBus.emit("event", {
                "directory": cls._instance_directory,
                "payload": payload.to_dict(),
            })
    
    @classmethod
    def subscribe(
        cls,
        definition: EventDefinition[P],
        callback: EventCallback[P],
    ) -> Callable[[], None]:
        """Subscribe to events of a specific type.
        
        Corresponds to opencode's Bus.subscribe().
        
        Args:
            definition: Event definition to subscribe to
            callback: Async or sync function to call when event occurs
        
        Returns:
            Unsubscribe function
        
        Example:
            ```python
            async def handler(event):
                print(event.properties.session_id)
            
            unsub = Bus.subscribe(SessionCreated, handler)
            # Later...
            unsub()
            ```
        """
        return cls._raw_subscribe(definition.type, callback)
    
    @classmethod
    def once(
        cls,
        definition: EventDefinition[P],
        callback: Callable[[EventPayload[P]], str | None],
    ) -> Callable[[], None]:
        """Subscribe to an event once.
        
        Corresponds to opencode's Bus.once().
        Callback should return "done" to unsubscribe, or None to continue.
        
        Args:
            definition: Event definition to subscribe to
            callback: Function that returns "done" when finished
        
        Returns:
            Unsubscribe function
        """
        unsub: Callable[[], None] | None = None
        
        async def wrapper(event: EventPayload[P]) -> None:
            nonlocal unsub
            result = callback(event)
            if result == "done" and unsub:
                unsub()
        
        unsub = cls.subscribe(definition, wrapper)
        return unsub
    
    @classmethod
    def subscribe_all(
        cls,
        callback: EventCallback[Any],
    ) -> Callable[[], None]:
        """Subscribe to all events (wildcard).
        
        Corresponds to opencode's Bus.subscribeAll().
        
        Args:
            callback: Function to call for any event
        
        Returns:
            Unsubscribe function
        """
        return cls._raw_subscribe("*", callback)
    
    @classmethod
    def _raw_subscribe(
        cls,
        event_type: str,
        callback: EventCallback,
    ) -> Callable[[], None]:
        """Internal subscription method.
        
        Args:
            event_type: Event type string or "*" for wildcard
            callback: Handler function
        
        Returns:
            Unsubscribe function
        """
        logger.debug(f"Subscribing to: {event_type}")
        
        if event_type not in cls._subscriptions:
            cls._subscriptions[event_type] = []
        
        cls._subscriptions[event_type].append(callback)
        
        def unsubscribe() -> None:
            logger.debug(f"Unsubscribing from: {event_type}")
            if event_type in cls._subscriptions:
                try:
                    cls._subscriptions[event_type].remove(callback)
                except ValueError:
                    pass  # Already removed
        
        return unsubscribe
    
    @classmethod
    async def _call_handler(
        cls,
        handler: EventCallback,
        payload: EventPayload,
    ) -> None:
        """Call a handler with exception isolation.
        
        Args:
            handler: Handler function
            payload: Event payload
        """
        try:
            result = handler(payload)
            if asyncio.iscoroutine(result):
                await result
        except Exception as e:
            logger.error(f"Error in event handler for {payload.type}: {e}", exc_info=True)
    
    @classmethod
    def clear(cls) -> None:
        """Clear all subscriptions (for testing)."""
        cls._subscriptions.clear()
        cls._instance_directory = None


# =============================================================================
# Pre-defined Events (corresponds to opencode's built-in events)
# =============================================================================

class InstanceDisposedData(BaseModel):
    """Data for instance disposed event."""
    directory: str


# Instance disposed event
InstanceDisposed = BusEvent.define("server.instance.disposed", InstanceDisposedData)
