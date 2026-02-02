"""Global Event Bus for Cross-Instance Communication.

This module provides the GlobalBus for events that need to be shared
across multiple instances, following opencode's GlobalBus pattern.

Example:
    ```python
    from talor.bus.global_bus import GlobalBus
    
    # Listen for events from any instance
    def handler(data):
        print(f"Event from {data['directory']}: {data['payload']}")
    
    GlobalBus.on("event", handler)
    
    # Emit event (usually done by Bus.publish)
    GlobalBus.emit("event", {"directory": "/path", "payload": {...}})
    ```
"""

from __future__ import annotations

import logging
from typing import Any, Callable


logger = logging.getLogger(__name__)


class GlobalBus:
    """Global event emitter for cross-instance communication.
    
    Corresponds to opencode's GlobalBus (EventEmitter pattern).
    Used for events that need to be shared across multiple instances.
    
    This is a simple synchronous event emitter, unlike the async Bus.
    """
    
    _listeners: dict[str, list[Callable[[Any], None]]] = {}
    
    @classmethod
    def on(cls, event: str, callback: Callable[[Any], None]) -> Callable[[], None]:
        """Register an event listener.
        
        Args:
            event: Event name
            callback: Callback function
        
        Returns:
            Function to remove the listener
        """
        if event not in cls._listeners:
            cls._listeners[event] = []
        
        cls._listeners[event].append(callback)
        
        def remove() -> None:
            if event in cls._listeners:
                try:
                    cls._listeners[event].remove(callback)
                except ValueError:
                    pass
        
        return remove
    
    @classmethod
    def once(cls, event: str, callback: Callable[[Any], None]) -> Callable[[], None]:
        """Register a one-time event listener.
        
        Args:
            event: Event name
            callback: Callback function
        
        Returns:
            Function to remove the listener
        """
        remove: Callable[[], None] | None = None
        
        def wrapper(data: Any) -> None:
            nonlocal remove
            callback(data)
            if remove:
                remove()
        
        remove = cls.on(event, wrapper)
        return remove
    
    @classmethod
    def emit(cls, event: str, data: Any) -> None:
        """Emit an event to all listeners.
        
        Args:
            event: Event name
            data: Event data
        """
        listeners = cls._listeners.get(event, [])
        
        for listener in listeners[:]:  # Copy to allow modification during iteration
            try:
                listener(data)
            except Exception as e:
                logger.error(f"Error in GlobalBus listener for {event}: {e}", exc_info=True)
    
    @classmethod
    def remove_all_listeners(cls, event: str | None = None) -> None:
        """Remove all listeners for an event or all events.
        
        Args:
            event: Event name, or None to remove all
        """
        if event is None:
            cls._listeners.clear()
        elif event in cls._listeners:
            del cls._listeners[event]
    
    @classmethod
    def listener_count(cls, event: str) -> int:
        """Get the number of listeners for an event.
        
        Args:
            event: Event name
        
        Returns:
            Number of listeners
        """
        return len(cls._listeners.get(event, []))
