"""Typed Event Definitions for Talor.

This module provides the BusEvent namespace for defining typed events,
following opencode's BusEvent.define() pattern.

Events are defined with:
- A unique type string (e.g., "session.created")
- A Pydantic model for the event properties

Example:
    ```python
    from pydantic import BaseModel
    from talor.bus.bus_event import BusEvent
    
    class SessionData(BaseModel):
        session_id: str
        title: str
    
    SessionCreated = BusEvent.define("session.created", SessionData)
    ```
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Generic, TypeVar, get_type_hints

from pydantic import BaseModel


# Type variable for event properties
P = TypeVar("P", bound=BaseModel)


@dataclass(frozen=True)
class EventDefinition(Generic[P]):
    """Event definition with type and properties schema.
    
    Corresponds to opencode's BusEvent.Definition.
    
    Attributes:
        type: Unique event type string (e.g., "session.created")
        properties_class: Pydantic model class for event properties
    """
    
    type: str
    properties_class: type[P]
    
    def create_payload(self, properties: P) -> EventPayload[P]:
        """Create an event payload with this definition.
        
        Args:
            properties: Event properties instance
        
        Returns:
            EventPayload with type and properties
        """
        return EventPayload(type=self.type, properties=properties)


@dataclass
class EventPayload(Generic[P]):
    """Event payload containing type and properties.
    
    Corresponds to opencode's event payload structure.
    
    Attributes:
        type: Event type string
        properties: Event properties instance
    """
    
    type: str
    properties: P
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "type": self.type,
            "properties": self.properties.model_dump() if hasattr(self.properties, "model_dump") else self.properties,
        }


class BusEvent:
    """Namespace for event definition utilities.
    
    Corresponds to opencode's BusEvent namespace.
    
    Usage:
        ```python
        # Define an event
        SessionCreated = BusEvent.define("session.created", SessionData)
        
        # Get all registered event types
        types = BusEvent.all_types()
        ```
    """
    
    # Registry of all defined events
    _registry: dict[str, EventDefinition] = {}
    
    @classmethod
    def define(cls, event_type: str, properties_class: type[P]) -> EventDefinition[P]:
        """Define a new typed event.
        
        Corresponds to opencode's BusEvent.define().
        
        Args:
            event_type: Unique event type string (e.g., "session.created")
            properties_class: Pydantic model class for event properties
        
        Returns:
            EventDefinition instance
        
        Example:
            ```python
            class SessionData(BaseModel):
                session_id: str
            
            SessionCreated = BusEvent.define("session.created", SessionData)
            ```
        """
        definition = EventDefinition(type=event_type, properties_class=properties_class)
        cls._registry[event_type] = definition
        return definition
    
    @classmethod
    def get(cls, event_type: str) -> EventDefinition | None:
        """Get an event definition by type.
        
        Args:
            event_type: Event type string
        
        Returns:
            EventDefinition or None if not found
        """
        return cls._registry.get(event_type)
    
    @classmethod
    def all_types(cls) -> list[str]:
        """Get all registered event types.
        
        Returns:
            List of event type strings
        """
        return list(cls._registry.keys())
    
    @classmethod
    def clear(cls) -> None:
        """Clear all registered events (for testing)."""
        cls._registry.clear()
