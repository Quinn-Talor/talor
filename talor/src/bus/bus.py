"""Event Bus for Talor.

This module provides the Bus class for event publishing and subscription
following DDD principles with proper instance-based state management.

Example:
    ```python
    from src.bus import Bus, BusEvent
    from pydantic import BaseModel

    class SessionData(BaseModel):
        session_id: str

    SessionCreated = BusEvent.define("session.created", SessionData)

    # Create bus instance
    bus = Bus(directory="/workspace")

    # Subscribe
    async def handler(event):
        print(f"Created: {event.properties.session_id}")

    unsub = bus.subscribe(SessionCreated, handler)

    # Publish
    await bus.publish(SessionCreated, SessionData(session_id="123"))

    # Unsubscribe
    unsub()
    ```
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Awaitable, TypeVar, Generic

from pydantic import BaseModel

from src.bus.bus_event import BusEvent, EventDefinition, EventPayload
from src.bus.global_bus import GlobalBus


logger = logging.getLogger(__name__)


# Type variable for event properties
P = TypeVar("P", bound=BaseModel)

# Callback type for event handlers
EventCallback = Callable[[EventPayload[P]], Awaitable[None] | None]


class Bus:
    """Event bus for component communication (DDD-compliant).

    A proper domain service with instance-based state management.
    Each Bus instance maintains its own subscriptions and directory context.

    Features:
    - Typed event definitions with Pydantic models
    - Async event delivery
    - Wildcard subscription ("*")
    - Instance-scoped state (no class variables)
    - GlobalBus integration for cross-instance events

    Example:
        ```python
        # Create bus instance (typically via DI container)
        bus = Bus(directory="/workspace")

        # Subscribe to events
        unsub = bus.subscribe(SessionCreated, my_handler)

        # Publish events
        await bus.publish(SessionCreated, SessionData(session_id="123"))
        ```
    """

    def __init__(self, directory: str | None = None) -> None:
        """Initialize the event bus.

        Args:
            directory: Instance working directory for GlobalBus routing
        """
        self._subscriptions: dict[str, list[EventCallback]] = {}
        self._lock = asyncio.Lock()
        self._directory = directory

    @property
    def directory(self) -> str | None:
        """Get the instance directory."""
        return self._directory

    def set_directory(self, directory: str) -> None:
        """Set the instance directory.

        Used for GlobalBus event routing.

        Args:
            directory: Instance working directory
        """
        self._directory = directory

    async def publish(
        self,
        definition: EventDefinition[P],
        properties: P,
    ) -> None:
        """Publish an event to all subscribers.

        Args:
            definition: Event definition from BusEvent.define()
            properties: Event properties instance

        Example:
            ```python
            await bus.publish(SessionCreated, SessionData(session_id="123"))
            ```
        """
        payload = EventPayload(type=definition.type, properties=properties)

        logger.debug(f"Publishing event: {definition.type}")

        # Collect handlers for this event type and wildcard
        handlers: list[EventCallback] = []

        async with self._lock:
            # Specific type handlers
            if definition.type in self._subscriptions:
                handlers.extend(self._subscriptions[definition.type])

            # Wildcard handlers
            if "*" in self._subscriptions:
                handlers.extend(self._subscriptions["*"])

        # Execute handlers concurrently
        if handlers:
            tasks = []
            for handler in handlers:
                task = asyncio.create_task(self._call_handler(handler, payload))
                tasks.append(task)

            await asyncio.gather(*tasks, return_exceptions=True)

        # Emit to GlobalBus for cross-instance communication
        if self._directory:
            GlobalBus.emit("event", {
                "directory": self._directory,
                "payload": payload.to_dict(),
            })

    def subscribe(
        self,
        definition: EventDefinition[P],
        callback: EventCallback[P],
    ) -> Callable[[], None]:
        """Subscribe to events of a specific type.

        Args:
            definition: Event definition to subscribe to
            callback: Async or sync function to call when event occurs

        Returns:
            Unsubscribe function

        Example:
            ```python
            async def handler(event):
                print(event.properties.session_id)

            unsub = bus.subscribe(SessionCreated, handler)
            # Later...
            unsub()
            ```
        """
        return self._raw_subscribe(definition.type, callback)

    def once(
        self,
        definition: EventDefinition[P],
        callback: Callable[[EventPayload[P]], str | None],
    ) -> Callable[[], None]:
        """Subscribe to an event once.

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

        unsub = self.subscribe(definition, wrapper)
        return unsub

    def subscribe_all(
        self,
        callback: EventCallback[Any],
    ) -> Callable[[], None]:
        """Subscribe to all events (wildcard).

        Args:
            callback: Function to call for any event

        Returns:
            Unsubscribe function
        """
        return self._raw_subscribe("*", callback)

    def _raw_subscribe(
        self,
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

        if event_type not in self._subscriptions:
            self._subscriptions[event_type] = []

        self._subscriptions[event_type].append(callback)

        def unsubscribe() -> None:
            logger.debug(f"Unsubscribing from: {event_type}")
            if event_type in self._subscriptions:
                try:
                    self._subscriptions[event_type].remove(callback)
                except ValueError:
                    pass  # Already removed

        return unsubscribe

    async def _call_handler(
        self,
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

    async def publish_raw(
        self,
        event_type: str,
        properties: dict[str, Any],
    ) -> None:
        """Publish a raw event without type definition.

        Useful for dynamic events or when event definition is not available.

        Args:
            event_type: Event type string
            properties: Event properties as dict
        """
        # Create a simple payload
        class DynamicProperties(BaseModel):
            model_config = {"extra": "allow"}

        # Try to find registered definition
        definition = BusEvent.get(event_type)

        if definition:
            # Use typed definition
            try:
                typed_props = definition.properties_class.model_validate(properties)
                await self.publish(definition, typed_props)
                return
            except Exception as e:
                logger.warning(f"Failed to validate properties for {event_type}: {e}")

        # Fallback to raw publishing
        payload = EventPayload(
            type=event_type,
            properties=DynamicProperties.model_validate(properties),
        )

        logger.debug(f"Publishing raw event: {event_type}")

        handlers: list[EventCallback] = []

        async with self._lock:
            if event_type in self._subscriptions:
                handlers.extend(self._subscriptions[event_type])
            if "*" in self._subscriptions:
                handlers.extend(self._subscriptions["*"])

        if handlers:
            tasks = [
                asyncio.create_task(self._call_handler(handler, payload))
                for handler in handlers
            ]
            await asyncio.gather(*tasks, return_exceptions=True)

        if self._directory:
            GlobalBus.emit("event", {
                "directory": self._directory,
                "payload": payload.to_dict(),
            })

    def clear(self) -> None:
        """Clear all subscriptions (for testing)."""
        self._subscriptions.clear()

    @property
    def subscription_count(self) -> int:
        """Get total number of subscriptions."""
        return sum(len(handlers) for handlers in self._subscriptions.values())


# =============================================================================
# Pre-defined Events
# =============================================================================

class InstanceDisposedData(BaseModel):
    """Data for instance disposed event."""
    directory: str


# Instance disposed event
InstanceDisposed = BusEvent.define("server.instance.disposed", InstanceDisposedData)
