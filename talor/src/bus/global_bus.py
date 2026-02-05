"""Global Event Bus for Talor.

This module provides the GlobalBus class that extends the base Bus with
session_id filtering capabilities for cross-session event communication.

The GlobalBus is designed to replace session-level Bus instances with a
single global event bus that supports efficient session-based filtering.

Example:
    ```python
    from src.bus import GlobalBus, BusEvent
    from pydantic import BaseModel

    class MessageData(BaseModel):
        session_id: str
        content: str

    MessageCreated = BusEvent.define("message.created", MessageData)

    # Create global bus instance
    global_bus = GlobalBus()

    # Subscribe with session_id filter
    async def handler(event):
        print(f"Message: {event.properties.content}")

    unsub = global_bus.subscribe(
        MessageCreated,
        handler,
        session_id="session-123"
    )

    # Publish event
    await global_bus.publish(
        MessageCreated,
        MessageData(session_id="session-123", content="Hello")
    )
    ```
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, TypeVar

from pydantic import BaseModel

from src.bus.bus import Bus, EventCallback, EventPayload
from src.bus.bus_event import EventDefinition


logger = logging.getLogger(__name__)


# Type variable for event properties
P = TypeVar("P", bound=BaseModel)


class GlobalBus(Bus):
    """Global event bus with session_id filtering support.

    Extends the base Bus class to support cross-session event communication
    with efficient session-based filtering. All events published through
    GlobalBus should include a session_id field in their properties.

    Features:
    - Session-based event filtering
    - Efficient subscriber lookup by session_id
    - Backward compatible with base Bus API
    - Wildcard subscription support

    Example:
        ```python
        # Create global bus
        bus = GlobalBus()

        # Subscribe to events for a specific session
        unsub = bus.subscribe(
            MessageCreated,
            my_handler,
            session_id="session-123"
        )

        # Subscribe to all sessions (no filter)
        unsub_all = bus.subscribe(MessageCreated, global_handler)

        # Publish event (must include session_id in properties)
        await bus.publish(
            MessageCreated,
            MessageData(session_id="session-123", content="Hello")
        )
        ```
    """

    def __init__(self) -> None:
        """Initialize the global event bus."""
        super().__init__()
        # Index of subscriptions by session_id for efficient filtering
        # Format: {session_id: {event_type: [callbacks]}}
        self._session_subscriptions: dict[str, dict[str, list[EventCallback]]] = {}
        self._session_lock = asyncio.Lock()

    async def publish(
        self,
        definition: EventDefinition[P],
        properties: P,
    ) -> None:
        """Publish an event to all subscribers.

        Events are delivered to:
        1. Subscribers with matching session_id filter
        2. Subscribers without session_id filter (global subscribers)
        3. Wildcard subscribers

        Args:
            definition: Event definition from BusEvent.define()
            properties: Event properties instance (should include session_id)

        Example:
            ```python
            await bus.publish(
                MessageCreated,
                MessageData(session_id="session-123", content="Hello")
            )
            ```
        """
        payload = EventPayload(type=definition.type, properties=properties)

        # Extract session_id from properties if available
        session_id = getattr(properties, "session_id", None)
        if session_id is None:
            # Check if session_id is in nested info object (for SessionCreated events)
            info = getattr(properties, "info", None)
            if info:
                session_id = getattr(info, "id", None)

        if session_id is None:
            logger.warning(
                f"Event {definition.type} published without session_id field. "
                "Session-filtered subscribers will not receive this event."
            )

        logger.debug(f"Publishing event: {definition.type} (session_id={session_id})")

        # Collect handlers
        handlers: list[EventCallback] = []

        async with self._lock:
            # 1. Global subscribers (no session filter) for this event type
            if definition.type in self._subscriptions:
                handlers.extend(self._subscriptions[definition.type])

            # 2. Global wildcard subscribers
            if "*" in self._subscriptions:
                handlers.extend(self._subscriptions["*"])

        # 3. Session-specific subscribers
        if session_id:
            async with self._session_lock:
                if session_id in self._session_subscriptions:
                    session_subs = self._session_subscriptions[session_id]
                    # Specific type handlers for this session
                    if definition.type in session_subs:
                        handlers.extend(session_subs[definition.type])
                    # Wildcard handlers for this session
                    if "*" in session_subs:
                        handlers.extend(session_subs["*"])

        # Execute handlers concurrently
        if handlers:
            tasks = []
            for handler in handlers:
                task = asyncio.create_task(self._call_handler(handler, payload))
                tasks.append(task)

            await asyncio.gather(*tasks, return_exceptions=True)

    def subscribe(
        self,
        definition: EventDefinition[P],
        callback: EventCallback[P],
        session_id: str | None = None,
    ) -> Callable[[], None]:
        """Subscribe to events of a specific type.

        Args:
            definition: Event definition to subscribe to
            callback: Async or sync function to call when event occurs
            session_id: Optional session_id filter. If provided, only events
                       with matching session_id will be delivered.

        Returns:
            Unsubscribe function

        Example:
            ```python
            # Subscribe to all sessions
            unsub1 = bus.subscribe(MessageCreated, handler)

            # Subscribe to specific session only
            unsub2 = bus.subscribe(
                MessageCreated,
                handler,
                session_id="session-123"
            )
            ```
        """
        if session_id is None:
            # No filter - use base Bus subscription
            return super().subscribe(definition, callback)
        else:
            # Session-filtered subscription
            return self._subscribe_with_session(definition.type, callback, session_id)

    def subscribe_all(
        self,
        callback: EventCallback[Any],
        session_id: str | None = None,
    ) -> Callable[[], None]:
        """Subscribe to all events (wildcard).

        Args:
            callback: Function to call for any event
            session_id: Optional session_id filter

        Returns:
            Unsubscribe function

        Example:
            ```python
            # Subscribe to all events for all sessions
            unsub1 = bus.subscribe_all(handler)

            # Subscribe to all events for specific session
            unsub2 = bus.subscribe_all(handler, session_id="session-123")
            ```
        """
        if session_id is None:
            # No filter - use base Bus subscription
            return super().subscribe_all(callback)
        else:
            # Session-filtered wildcard subscription
            return self._subscribe_with_session("*", callback, session_id)

    def _subscribe_with_session(
        self,
        event_type: str,
        callback: EventCallback,
        session_id: str,
    ) -> Callable[[], None]:
        """Internal subscription method with session_id filter.

        Args:
            event_type: Event type string or "*" for wildcard
            callback: Handler function
            session_id: Session ID to filter events

        Returns:
            Unsubscribe function
        """
        logger.debug(f"Subscribing to: {event_type} (session_id={session_id})")

        # Initialize session subscriptions if needed
        if session_id not in self._session_subscriptions:
            self._session_subscriptions[session_id] = {}

        if event_type not in self._session_subscriptions[session_id]:
            self._session_subscriptions[session_id][event_type] = []

        self._session_subscriptions[session_id][event_type].append(callback)

        def unsubscribe() -> None:
            logger.debug(f"Unsubscribing from: {event_type} (session_id={session_id})")
            if session_id in self._session_subscriptions:
                if event_type in self._session_subscriptions[session_id]:
                    try:
                        self._session_subscriptions[session_id][event_type].remove(callback)
                        # Clean up empty structures
                        if not self._session_subscriptions[session_id][event_type]:
                            del self._session_subscriptions[session_id][event_type]
                        if not self._session_subscriptions[session_id]:
                            del self._session_subscriptions[session_id]
                    except ValueError:
                        pass  # Already removed

        return unsubscribe

    def clear(self) -> None:
        """Clear all subscriptions (for testing)."""
        super().clear()
        self._session_subscriptions.clear()

    @property
    def session_subscription_count(self) -> int:
        """Get total number of session-filtered subscriptions."""
        count = 0
        for session_subs in self._session_subscriptions.values():
            for handlers in session_subs.values():
                count += len(handlers)
        return count

    @property
    def total_subscription_count(self) -> int:
        """Get total number of all subscriptions (global + session-filtered)."""
        return self.subscription_count + self.session_subscription_count

    def get_session_ids(self) -> list[str]:
        """Get list of session IDs that have active subscriptions.

        Returns:
            List of session IDs with active subscriptions

        Example:
            ```python
            session_ids = bus.get_session_ids()
            print(f"Active sessions: {session_ids}")
            ```
        """
        return list(self._session_subscriptions.keys())
