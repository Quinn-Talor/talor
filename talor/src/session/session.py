"""Session Entity for Talor.

This module provides the Session entity - a rich domain object
with both state and behavior (business logic).

Following DDD principles:
- Session is a rich entity with encapsulated business logic
- Entity methods operate on its own state
- No persistence concerns (handled by Repository)
- No event publishing (handled by Application Service)

Example:
    ```python
    # Create via service
    session = await session_service.create_session(title="New Session")

    # Use entity methods (business logic)
    message = session.add_message(role="user", content="Hello")
    session.update_title("New Title")

    # Access state
    print(session.message_count)
    print(session.is_active)
    ```
"""

from __future__ import annotations

import logging
import time
from typing import Any, TYPE_CHECKING

from ulid import ULID

from src.session.message import (
    MessagePart,
    MessageWithParts,
    TextPart,
    UserMessage,
    AssistantMessage,
    SystemMessage,
)

if TYPE_CHECKING:
    from src.memory.short_term import ShortTermMemory


logger = logging.getLogger(__name__)


class Session:
    """Session entity - represents a conversation with rich behavior.

    A Session is the aggregate root for conversation management.
    It encapsulates:
    - Session metadata (id, title, directory, etc.)
    - Message collection with business rules
    - Memory integration
    - State transitions and validations

    Use SessionService for persistence and event publishing.
    """

    def __init__(
        self,
        id: str,
        title: str,
        directory: str,
        slug: str = "",
        project_id: str = "",
        parent_id: str | None = None,
        version: str = "1.0.0",
        time: dict[str, int] | None = None,
        permission: list[dict[str, Any]] | None = None,
        summary: dict[str, Any] | None = None,
        share: dict[str, str] | None = None,
        revert: dict[str, Any] | None = None,
    ) -> None:
        """Initialize a session."""
        self.id = id
        self.title = title
        self.directory = directory
        self.slug = slug or str(ULID()).lower()[:8]
        self.project_id = project_id or "default"
        self.parent_id = parent_id
        self.version = version
        self.time = time or {}
        self.permission = permission or []
        self.summary = summary
        self.share = share
        self.revert = revert

        # Internal state
        self._messages: list[MessageWithParts] = []
        self._memory: ShortTermMemory | None = None
        self._is_busy: bool = False

    # =========================================================================
    # Properties (State Access)
    # =========================================================================

    @property
    def messages(self) -> list[MessageWithParts]:
        """Get messages list (read-only view)."""
        return list(self._messages)

    @property
    def message_count(self) -> int:
        """Get number of messages."""
        return len(self._messages)

    @property
    def is_empty(self) -> bool:
        """Check if session has no messages."""
        return len(self._messages) == 0

    @property
    def is_busy(self) -> bool:
        """Check if session is currently processing."""
        return self._is_busy

    @property
    def is_child(self) -> bool:
        """Check if this is a child session."""
        return self.parent_id is not None

    @property
    def created_at(self) -> int:
        """Get creation timestamp."""
        return self.time.get("created", 0)

    @property
    def updated_at(self) -> int:
        """Get last update timestamp."""
        return self.time.get("updated", 0)

    @property
    def last_message(self) -> MessageWithParts | None:
        """Get the last message."""
        return self._messages[-1] if self._messages else None

    @property
    def memory(self) -> "ShortTermMemory":
        """Get short-term memory (lazy initialization).

        Memory is owned by the session instance.
        Creates a new ShortTermMemory instance if not already created.
        """
        if self._memory is None:
            from src.memory.short_term import ShortTermMemory
            self._memory = ShortTermMemory(self.id)
        return self._memory

    def configure_memory(
        self,
        summarizer: Any | None = None,
        model_context_length: int | None = None,
    ) -> None:
        """Configure the session's memory.

        Args:
            summarizer: Async function to generate summaries
            model_context_length: Model's maximum context length
        """
        self.memory.configure(
            summarizer=summarizer,
            model_context_length=model_context_length,
        )

    # =========================================================================
    # Business Logic - Title Management
    # =========================================================================

    def update_title(self, new_title: str) -> None:
        """Update session title.

        Args:
            new_title: New title for the session

        Raises:
            ValueError: If title is empty
        """
        if not new_title or not new_title.strip():
            raise ValueError("Title cannot be empty")
        self.title = new_title.strip()
        self._touch()

    def generate_title_from_content(self) -> str:
        """Generate a title from the first user message.

        Returns:
            Generated title or default
        """
        for msg in self._messages:
            if msg.info.role == "user":
                content = msg.get_text_content()
                if content:
                    # Take first 50 chars
                    title = content[:50]
                    if len(content) > 50:
                        title += "..."
                    return title
        return f"Session {self.slug}"

    # =========================================================================
    # Business Logic - Message Management
    # =========================================================================

    def add_message(
        self,
        role: str,
        content: str | None = None,
        parts: list[MessagePart] | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
        tool_call_id: str | None = None,
    ) -> MessageWithParts:
        """Add a message to the session.

        This is the primary method for adding messages with business validation.

        Args:
            role: Message role (user, assistant, tool, system)
            content: Text content
            parts: Optional message parts
            tool_calls: Optional tool calls (for assistant)
            tool_call_id: Optional tool call ID (for tool responses)

        Returns:
            Created MessageWithParts

        Raises:
            ValueError: If role is invalid
            SessionBusyError: If session is busy
        """
        # Validate role
        valid_roles = {"user", "assistant", "tool", "system"}
        if role not in valid_roles:
            raise ValueError(f"Invalid role: {role}. Must be one of {valid_roles}")

        # Create message based on role
        message_id = f"msg_{ULID()}"
        message = self._create_message_by_role(
            message_id=message_id,
            role=role,
            tool_calls=tool_calls,
            tool_call_id=tool_call_id,
        )

        # Create parts if content provided
        if parts is None and content is not None:
            parts = [TextPart(
                id=f"part_{ULID()}",
                session_id=self.id,
                message_id=message_id,
                text=content,
            )]

        msg_with_parts = MessageWithParts(info=message, parts=parts or [])
        self._messages.append(msg_with_parts)
        self._touch()

        # Sync to memory
        self._sync_message_to_memory(msg_with_parts)

        return msg_with_parts

    def _create_message_by_role(
        self,
        message_id: str,
        role: str,
        tool_calls: list[dict[str, Any]] | None = None,
        tool_call_id: str | None = None,
    ) -> UserMessage | AssistantMessage | SystemMessage:
        """Create the appropriate message type based on role.

        Args:
            message_id: Message identifier
            role: Message role
            tool_calls: Optional tool calls (for assistant)
            tool_call_id: Optional tool call ID (for tool responses)

        Returns:
            Appropriate message type instance
        """
        import time as time_module

        current_time = int(time_module.time() * 1000)
        time_dict = {"created": current_time, "updated": current_time}

        if role == "user":
            return UserMessage(
                id=message_id,
                session_id=self.id,
                model={"provider_id": "", "model_id": ""},
                time=time_dict,
            )
        elif role == "assistant" or role == "tool":
            # Tool responses are also assistant messages with tool_call_id
            return AssistantMessage(
                id=message_id,
                session_id=self.id,
                model_id="",
                provider_id="",
                agent="",
                time=time_dict,
            )
        elif role == "system":
            return SystemMessage(
                id=message_id,
                session_id=self.id,
                content="",
                time=time_dict,
            )
        else:
            # Fallback to assistant message
            return AssistantMessage(
                id=message_id,
                session_id=self.id,
                model_id="",
                provider_id="",
                agent="",
                time=time_dict,
            )

    def add_user_message(self, content: str) -> MessageWithParts:
        """Add a user message (convenience method).

        Args:
            content: Message content

        Returns:
            Created MessageWithParts
        """
        return self.add_message(role="user", content=content)

    def add_assistant_message(
        self,
        content: str | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
    ) -> MessageWithParts:
        """Add an assistant message (convenience method).

        Args:
            content: Message content
            tool_calls: Optional tool calls

        Returns:
            Created MessageWithParts
        """
        return self.add_message(role="assistant", content=content, tool_calls=tool_calls)

    def add_tool_result(
        self,
        tool_call_id: str,
        content: str,
    ) -> MessageWithParts:
        """Add a tool result message (convenience method).

        Args:
            tool_call_id: ID of the tool call being responded to
            content: Tool result content

        Returns:
            Created MessageWithParts
        """
        return self.add_message(role="tool", content=content, tool_call_id=tool_call_id)

    def get_message(self, message_id: str) -> MessageWithParts | None:
        """Get a message by ID.

        Args:
            message_id: Message identifier

        Returns:
            MessageWithParts or None
        """
        for msg in self._messages:
            if msg.info.id == message_id:
                return msg
        return None

    def add_part_to_message(
        self,
        message_id: str,
        part: MessagePart,
    ) -> MessagePart | None:
        """Add a part to an existing message.

        Args:
            message_id: Message identifier
            part: Part to add

        Returns:
            Added part or None if message not found
        """
        msg = self.get_message(message_id)
        if not msg:
            return None

        part.session_id = self.id
        part.message_id = message_id
        msg.parts.append(part)
        self._touch()

        return part

    def get_messages_by_role(self, role: str) -> list[MessageWithParts]:
        """Get all messages with a specific role.

        Args:
            role: Message role to filter by

        Returns:
            List of matching messages
        """
        return [msg for msg in self._messages if msg.info.role == role]

    def get_conversation_for_llm(self) -> list[dict[str, Any]]:
        """Get messages formatted for LLM context.

        Returns:
            List of message dicts suitable for LLM API
        """
        return self.memory.get_messages()

    # =========================================================================
    # Business Logic - State Management
    # =========================================================================

    def mark_busy(self) -> None:
        """Mark session as busy (processing).

        Raises:
            SessionBusyError: If already busy
        """
        if self._is_busy:
            raise SessionBusyError(self.id)
        self._is_busy = True

    def mark_idle(self) -> None:
        """Mark session as idle (not processing)."""
        self._is_busy = False

    def clear_messages(self) -> None:
        """Clear all messages from the session."""
        self._messages.clear()
        self.memory.clear()
        self._touch()

    # =========================================================================
    # Business Logic - Permission
    # =========================================================================

    def has_permission(self, action: str) -> bool:
        """Check if an action is permitted.

        Args:
            action: Action to check

        Returns:
            True if permitted
        """
        # Default allow if no rules
        if not self.permission:
            return True

        for rule in self.permission:
            if rule.get("action") == action:
                return rule.get("allowed", True)

        return True

    def add_permission_rule(self, action: str, allowed: bool) -> None:
        """Add a permission rule.

        Args:
            action: Action name
            allowed: Whether action is allowed
        """
        # Remove existing rule for this action
        self.permission = [r for r in self.permission if r.get("action") != action]
        self.permission.append({"action": action, "allowed": allowed})

    # =========================================================================
    # Internal Methods
    # =========================================================================

    def _touch(self) -> None:
        """Update the updated timestamp."""
        self.time["updated"] = int(time.time() * 1000)

    def _sync_message_to_memory(self, msg: MessageWithParts) -> None:
        """Sync a message to short-term memory."""
        content = msg.get_text_content()

        # Build message dict with common fields
        message_dict: dict[str, Any] = {
            "role": msg.info.role,
            "content": content,
        }

        # Add tool_calls if present (only on AssistantMessage)
        if hasattr(msg.info, "tool_calls"):
            message_dict["tool_calls"] = getattr(msg.info, "tool_calls", None)

        # Add tool_call_id if present (only on AssistantMessage for tool responses)
        if hasattr(msg.info, "tool_call_id"):
            message_dict["tool_call_id"] = getattr(msg.info, "tool_call_id", None)

        self.memory.add_message(message_dict)

    # =========================================================================
    # Legacy Internal Methods (for Service compatibility)
    # =========================================================================

    def _add_message_instance(
        self,
        message: Message,
        parts: list[MessagePart] | None = None,
    ) -> MessageWithParts:
        """Add a pre-constructed message (for backward compatibility).

        Prefer using add_message() for new code.
        """
        msg_with_parts = MessageWithParts(info=message, parts=parts or [])
        self._messages.append(msg_with_parts)
        self._touch()
        return msg_with_parts

    def _add_part_instance(
        self,
        message_id: str,
        part: MessagePart,
    ) -> MessagePart | None:
        """Add a part to a message (for backward compatibility).

        Prefer using add_part_to_message() for new code.
        """
        return self.add_part_to_message(message_id, part)

    # =========================================================================
    # Serialization
    # =========================================================================

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict (for storage).

        Returns:
            Dict representation of session metadata
        """
        return {
            "id": self.id,
            "title": self.title,
            "directory": self.directory,
            "slug": self.slug,
            "project_id": self.project_id,
            "parent_id": self.parent_id,
            "version": self.version,
            "time": self.time,
            "permission": self.permission,
            "summary": self.summary,
            "share": self.share,
            "revert": self.revert,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Session":
        """Create from dict.

        Args:
            data: Dict with session data

        Returns:
            Session instance
        """
        return cls(
            id=data["id"],
            title=data.get("title", ""),
            directory=data.get("directory", "."),
            slug=data.get("slug", ""),
            project_id=data.get("project_id", ""),
            parent_id=data.get("parent_id"),
            version=data.get("version", "1.0.0"),
            time=data.get("time", {}),
            permission=data.get("permission", []),
            summary=data.get("summary"),
            share=data.get("share"),
            revert=data.get("revert"),
        )

    def __repr__(self) -> str:
        """String representation."""
        return f"Session(id={self.id!r}, title={self.title!r}, messages={self.message_count})"


# =============================================================================
# Errors
# =============================================================================

class SessionBusyError(Exception):
    """Session is busy processing."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        super().__init__(f"Session {session_id} is busy")
