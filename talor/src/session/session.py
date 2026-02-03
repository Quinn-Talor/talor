"""Session Entity for Talor.

This module provides the Session entity - a rich domain object
with both state and behavior (business logic).

Following DDD principles:
- Session is a rich entity with encapsulated business logic
- Entity methods operate on its own state
- Persistence is handled by module-level functions
- Event publishing is handled by module-level functions via SessionBusManager

Example:
    ```python
    # Configure module
    from src.session import session
    session.configure(workspace=Path("."), storage=storage)

    # Create session via module function
    session_obj = await session.create_session(title="New Session")

    # Use entity methods (business logic)
    message = session_obj.add_message(role="user", content="Hello")
    session_obj.update_title("New Title")

    # Access state
    print(session_obj.message_count)
    print(session_obj.is_active)
    ```
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ulid import ULID

from src.session.message import (
    AssistantMessage,
    Message,
    MessagePart,
    MessageWithParts,
    SystemMessage,
    TextPart,
    UserMessage,
)

if TYPE_CHECKING:
    from src.memory.short_term import ShortTermMemory


logger = logging.getLogger(__name__)


# =============================================================================
# Module-level State (replaces Repository)
# =============================================================================

_workspace: Path = Path(".")
_storage: Any = None
_cache: dict[str, Session] = {}
_lock = asyncio.Lock()


def configure(
    workspace: Path | None = None,
    storage: Any = None,
) -> None:
    """Configure module-level state.

    Args:
        workspace: Default workspace directory for sessions
        storage: Storage system for persistence

    Note:
        Event bus is now managed by SessionBusManager, not passed here.
    """
    global _workspace, _storage
    if workspace is not None:
        _workspace = workspace
    if storage is not None:
        _storage = storage


def clear_cache() -> None:
    """Clear the session cache (for testing)."""
    _cache.clear()


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
    def memory(self) -> ShortTermMemory:
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
                return bool(rule.get("allowed", True))

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
    def from_dict(cls, data: dict[str, Any]) -> Session:
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


# =============================================================================
# Module-level Async Functions (replaces SessionRepositoryImpl)
# =============================================================================

async def _save_session(session: Session) -> None:
    """Save session changes to storage.

    Args:
        session: Session to save
    """
    session.time["updated"] = int(time.time() * 1000)

    if _storage:
        await _storage.execute(
            "UPDATE sessions SET updated_at = ?, metadata = ? WHERE id = ?",
            (session.time["updated"] // 1000, json.dumps(session.to_dict()), session.id),
        )


async def _load_session(session_id: str) -> Session | None:
    """Load a session from storage.

    Args:
        session_id: Session identifier

    Returns:
        Session instance or None if not found
    """
    # Check cache first
    if session_id in _cache:
        return _cache[session_id]

    # Load from storage
    if _storage:
        row = await _storage.fetch_one(
            "SELECT * FROM sessions WHERE id = ?",
            (session_id,),
        )
        if row:
            metadata = json.loads(row["metadata"])
            session = Session.from_dict(metadata)
            _cache[session_id] = session
            return session

    return None


async def _delete_session_from_storage(session_id: str) -> Session | None:
    """Delete a session from storage.

    Args:
        session_id: Session identifier

    Returns:
        Deleted session or None if not found
    """
    async with _lock:
        session = _cache.pop(session_id, None)

        if _storage:
            await _storage.execute(
                "DELETE FROM sessions WHERE id = ?",
                (session_id,),
            )

        return session


async def _list_sessions_from_storage() -> list[Session]:
    """List all sessions from storage.

    Returns:
        List of sessions sorted by update time (newest first)
    """
    sessions = list(_cache.values())

    if not sessions and _storage:
        rows = await _storage.fetch_all(
            "SELECT * FROM sessions ORDER BY updated_at DESC"
        )
        for row in rows:
            metadata = json.loads(row["metadata"])
            session = Session.from_dict(metadata)
            _cache[session.id] = session
            sessions.append(session)

    return sorted(sessions, key=lambda s: s.time.get("updated", 0), reverse=True)


async def _create_session_in_storage(
    parent_id: str | None = None,
    title: str | None = None,
    permission: list[dict[str, Any]] | None = None,
) -> Session:
    """Create a new session and persist to storage.

    Args:
        parent_id: Optional parent session ID
        title: Session title
        permission: Permission rules

    Returns:
        Created Session instance
    """
    from datetime import datetime

    session_id = f"session_{ULID()}"
    now = int(time.time() * 1000)

    if not title:
        prefix = "Child session - " if parent_id else "New session - "
        title = prefix + datetime.now().isoformat()

    session = Session(
        id=session_id,
        title=title,
        directory=str(_workspace),
        parent_id=parent_id,
        time={"created": now, "updated": now},
        permission=permission or [],
    )

    async with _lock:
        _cache[session_id] = session

    if _storage:
        await _storage.execute(
            "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
            (session_id, now // 1000, now // 1000, json.dumps(session.to_dict())),
        )

    logger.info(f"Created session: {session_id}")
    return session


async def _touch_session(session_id: str) -> None:
    """Update session timestamp.

    Args:
        session_id: Session identifier
    """
    session = await _load_session(session_id)
    if session:
        await _save_session(session)


# =============================================================================
# Event Publishing Functions (from service.py)
# =============================================================================

async def _publish_session_created(session: Session) -> None:
    """Publish session created event to session's bus."""
    from src.bus import manager as bus_manager
    from src.bus.events import SessionCreated, SessionCreatedData, SessionInfo as EventSessionInfo

    bus = bus_manager.get_bus(session.id)

    await bus.publish(
        SessionCreated,
        SessionCreatedData(
            info=EventSessionInfo(
                id=session.id,
                title=session.title,
                directory=session.directory,
                parent_id=session.parent_id,
                time=session.time,
            )
        )
    )


async def _publish_session_updated(session: Session) -> None:
    """Publish session updated event to session's bus."""
    from src.bus import manager as bus_manager
    from src.bus.events import SessionUpdated, SessionUpdatedData, SessionInfo as EventSessionInfo

    bus = bus_manager.get_bus(session.id)

    await bus.publish(
        SessionUpdated,
        SessionUpdatedData(
            info=EventSessionInfo(
                id=session.id,
                title=session.title,
                directory=session.directory,
                parent_id=session.parent_id,
                time=session.time,
            )
        )
    )


async def _publish_session_deleted(session: Session) -> None:
    """Publish session deleted event to session's bus."""
    from src.bus import manager as bus_manager
    from src.bus.events import SessionDeleted, SessionDeletedData, SessionInfo as EventSessionInfo

    bus = bus_manager.get_bus(session.id)

    await bus.publish(
        SessionDeleted,
        SessionDeletedData(
            info=EventSessionInfo(
                id=session.id,
                title=session.title,
                directory=session.directory,
                parent_id=session.parent_id,
                time=session.time,
            )
        )
    )


async def _publish_message_created(
    session_id: str,
    msg: MessageWithParts,
) -> None:
    """Publish message created event to session's bus."""
    from src.bus import manager as bus_manager
    from src.bus.events import MessageCreated, MessageCreatedData

    bus = bus_manager.get_bus(session_id)

    await bus.publish(
        MessageCreated,
        MessageCreatedData(
            session_id=session_id,
            message_id=msg.info.id,
            role=msg.info.role,
            content=msg.get_text_content(),
        )
    )


async def _publish_message_updated(
    session_id: str,
    message_id: str,
    role: str,
    content: str | None,
) -> None:
    """Publish message updated event to session's bus."""
    from src.bus import manager as bus_manager
    from src.bus.events import MessageUpdated, MessageUpdatedData

    bus = bus_manager.get_bus(session_id)

    await bus.publish(
        MessageUpdated,
        MessageUpdatedData(
            session_id=session_id,
            message_id=message_id,
            role=role,
            content=content,
        )
    )


async def _publish_part_created(
    session_id: str,
    message_id: str,
    part: MessagePart,
) -> None:
    """Publish message part created event to session's bus."""
    from src.bus import manager as bus_manager
    from src.bus.events import MessagePartCreated, MessagePartCreatedData

    bus = bus_manager.get_bus(session_id)

    await bus.publish(
        MessagePartCreated,
        MessagePartCreatedData(
            session_id=session_id,
            message_id=message_id,
            part_id=part.id,
            part_type=part.type,
        )
    )


# =============================================================================
# Module-level Service Functions (replaces SessionService)
# =============================================================================

async def create_session(
    parent_id: str | None = None,
    title: str | None = None,
    permission: list[dict[str, Any]] | None = None,
) -> Session:
    """Create a new session.

    Args:
        parent_id: Optional parent session ID
        title: Session title
        permission: Permission rules

    Returns:
        Created Session instance
    """
    session = await _create_session_in_storage(
        parent_id=parent_id,
        title=title,
        permission=permission,
    )

    # Explicitly create Bus for this session
    from src.bus import manager as bus_manager
    bus_manager.create_bus(session.id)

    await _publish_session_created(session)
    logger.info(f"Created session: {session.id}")

    return session


async def get_session(session_id: str) -> Session | None:
    """Get a session by ID.

    Args:
        session_id: Session identifier

    Returns:
        Session instance or None
    """
    return await _load_session(session_id)


async def delete_session(session_id: str) -> None:
    """Delete a session and its associated Bus.

    Args:
        session_id: Session identifier
    """
    from src.bus.manager import SessionBusManager

    session = await _delete_session_from_storage(session_id)

    if session:
        # Publish deletion event before removing bus
        await _publish_session_deleted(session)

        # Remove the session's bus and clear SSE clients
        from src.bus import manager as bus_manager
        from src.api.sse import clear_session as clear_sse_clients
        await bus_manager.remove_bus(session_id)
        clear_sse_clients(session_id)

        logger.info(f"Deleted session and bus: {session_id}")


async def list_sessions() -> list[Session]:
    """List all sessions.

    Returns:
        List of sessions
    """
    return await _list_sessions_from_storage()


async def update_session_title(session_id: str, new_title: str) -> Session | None:
    """Update session title.

    Args:
        session_id: Session identifier
        new_title: New title

    Returns:
        Updated session or None
    """
    session = await _load_session(session_id)
    if not session:
        return None

    # Delegate to entity's business method
    session.update_title(new_title)

    await _save_session(session)
    await _publish_session_updated(session)

    return session


async def update_session(
    session_id: str,
    editor: Any,  # Callable[[Session], None]
) -> Session | None:
    """Update a session with an editor function.

    Args:
        session_id: Session identifier
        editor: Function to modify the session

    Returns:
        Updated session or None
    """
    session = await _load_session(session_id)
    if not session:
        return None

    editor(session)
    await _save_session(session)
    await _publish_session_updated(session)

    return session


async def touch_session(session_id: str) -> None:
    """Update session timestamp.

    Args:
        session_id: Session identifier
    """
    session = await _load_session(session_id)
    if session:
        session._touch()
        await _save_session(session)
        await _publish_session_updated(session)


async def get_messages(session_id: str) -> list[MessageWithParts]:
    """Get all messages for a session.

    Args:
        session_id: Session identifier

    Returns:
        List of messages with parts
    """
    session = await _load_session(session_id)
    return session.messages if session else []


async def add_user_message(
    session_id: str,
    content: str,
) -> MessageWithParts:
    """Add a user message to a session.

    Args:
        session_id: Session identifier
        content: Message content

    Returns:
        Created MessageWithParts

    Raises:
        ValueError: If session not found
    """
    session = await _load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    # Delegate to entity
    msg = session.add_user_message(content)

    await _publish_message_created(session_id, msg)

    return msg


async def add_assistant_message(
    session_id: str,
    content: str | None = None,
    tool_calls: list[dict[str, Any]] | None = None,
) -> MessageWithParts:
    """Add an assistant message to a session.

    Args:
        session_id: Session identifier
        content: Message content
        tool_calls: Optional tool calls

    Returns:
        Created MessageWithParts

    Raises:
        ValueError: If session not found
    """
    session = await _load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    # Delegate to entity
    msg = session.add_assistant_message(content, tool_calls)

    await _publish_message_created(session_id, msg)

    return msg


async def add_tool_message(
    session_id: str,
    tool_call_id: str,
    content: str,
) -> MessageWithParts:
    """Add a tool result message.

    Args:
        session_id: Session identifier
        tool_call_id: Tool call ID
        content: Result content

    Returns:
        Created MessageWithParts

    Raises:
        ValueError: If session not found
    """
    session = await _load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    # Delegate to entity
    msg = session.add_tool_result(tool_call_id, content)

    await _publish_message_created(session_id, msg)

    return msg


# Alias for backward compatibility
add_tool_result = add_tool_message


async def add_message(
    session_id: str,
    message: Message,
    parts: list[MessagePart] | None = None,
) -> MessageWithParts:
    """Add a pre-constructed message (backward compatibility).

    Prefer using add_user_message, add_assistant_message, etc.

    Args:
        session_id: Session identifier
        message: Message to add
        parts: Optional message parts

    Returns:
        Created MessageWithParts

    Raises:
        ValueError: If session not found
    """
    session = await _load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    msg_with_parts = session._add_message_instance(message, parts)

    await _publish_message_created(session_id, msg_with_parts)

    return msg_with_parts


async def update_message(
    session_id: str,
    message_id: str,
    editor: Any,  # Callable[[MessageWithParts], None]
) -> MessageWithParts | None:
    """Update a message with an editor function.

    Args:
        session_id: Session identifier
        message_id: Message identifier
        editor: Function to modify the message

    Returns:
        Updated message or None
    """
    session = await _load_session(session_id)
    if not session:
        return None

    msg = session.get_message(message_id)
    if not msg:
        return None

    editor(msg)

    await _publish_message_updated(
        session_id,
        message_id,
        msg.info.role,
        msg.get_text_content(),
    )

    return msg


async def add_part(
    session_id: str,
    message_id: str,
    part: MessagePart,
) -> MessagePart | None:
    """Add a part to a message.

    Args:
        session_id: Session identifier
        message_id: Message identifier
        part: Part to add

    Returns:
        Added part or None
    """
    session = await _load_session(session_id)
    if not session:
        return None

    # Delegate to entity
    result = session.add_part_to_message(message_id, part)

    if result:
        await _publish_part_created(session_id, message_id, part)

    return result


async def mark_busy(session_id: str) -> None:
    """Mark session as busy.

    Args:
        session_id: Session identifier

    Raises:
        ValueError: If session not found
        SessionBusyError: If already busy
    """
    session = await _load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    session.mark_busy()


async def mark_idle(session_id: str) -> None:
    """Mark session as idle.

    Args:
        session_id: Session identifier
    """
    session = await _load_session(session_id)
    if session:
        session.mark_idle()


async def clear_messages(session_id: str) -> None:
    """Clear all messages from a session.

    Args:
        session_id: Session identifier
    """
    session = await _load_session(session_id)
    if session:
        session.clear_messages()
        await _save_session(session)


def get_memory(session: Session) -> Any:
    """Get memory for a session.

    Args:
        session: Session instance

    Returns:
        ShortTermMemory instance
    """
    return session.memory


async def get_conversation_for_llm(session_id: str) -> list[dict[str, Any]]:
    """Get conversation formatted for LLM.

    Args:
        session_id: Session identifier

    Returns:
        List of message dicts for LLM
    """
    session = await _load_session(session_id)
    if not session:
        return []

    return session.get_conversation_for_llm()


# =============================================================================
# Backward-Compatible SessionService Class
# =============================================================================

class SessionService:
    """Application service for Session operations (backward compatibility).

    This class wraps module-level functions for backward compatibility.
    New code should use module-level functions directly.

    Example:
        # Old way (still works)
        service = SessionService(repository=repo)
        session = await service.create_session(title="New Session")

        # New way (preferred)
        from src.session import session
        session.configure(workspace=Path("."), storage=storage)
        session_obj = await session.create_session(title="New Session")

    Note:
        Event bus is now managed by SessionBusManager, not passed here.
    """

    def __init__(
        self,
        repository: Any = None,
        bus: Any = None,  # Kept for backward compatibility, but ignored
    ) -> None:
        """Initialize service.

        Args:
            repository: Session repository instance (ignored, for compatibility)
            bus: Event bus (ignored, now managed by SessionBusManager)
        """
        # bus parameter is kept for backward compatibility but ignored
        # Event publishing now uses SessionBusManager internally
        pass

    async def create_session(
        self,
        parent_id: str | None = None,
        title: str | None = None,
        permission: list[dict[str, Any]] | None = None,
    ) -> Session:
        """Create a new session."""
        return await create_session(parent_id=parent_id, title=title, permission=permission)

    async def get_session(self, session_id: str) -> Session | None:
        """Get a session by ID."""
        return await get_session(session_id)

    async def delete_session(self, session_id: str) -> None:
        """Delete a session."""
        return await delete_session(session_id)

    async def list_sessions(self) -> list[Session]:
        """List all sessions."""
        return await list_sessions()

    async def update_title(self, session_id: str, new_title: str) -> Session | None:
        """Update session title."""
        return await update_session_title(session_id, new_title)

    async def update_session(
        self,
        session_id: str,
        editor: Any,
    ) -> Session | None:
        """Update a session with an editor function."""
        return await update_session(session_id, editor)

    async def touch_session(self, session_id: str) -> None:
        """Update session timestamp."""
        return await touch_session(session_id)

    async def get_messages(self, session_id: str) -> list[MessageWithParts]:
        """Get all messages for a session."""
        return await get_messages(session_id)

    async def add_user_message(
        self,
        session_id: str,
        content: str,
    ) -> MessageWithParts:
        """Add a user message to a session."""
        return await add_user_message(session_id, content)

    async def add_assistant_message(
        self,
        session_id: str,
        content: str | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
    ) -> MessageWithParts:
        """Add an assistant message to a session."""
        return await add_assistant_message(session_id, content, tool_calls)

    async def add_tool_result(
        self,
        session_id: str,
        tool_call_id: str,
        content: str,
    ) -> MessageWithParts:
        """Add a tool result message."""
        return await add_tool_message(session_id, tool_call_id, content)

    async def add_message(
        self,
        session_id: str,
        message: Message,
        parts: list[MessagePart] | None = None,
    ) -> MessageWithParts:
        """Add a pre-constructed message."""
        return await add_message(session_id, message, parts)

    async def update_message(
        self,
        session_id: str,
        message_id: str,
        editor: Any,
    ) -> MessageWithParts | None:
        """Update a message with an editor function."""
        return await update_message(session_id, message_id, editor)

    async def add_part(
        self,
        session_id: str,
        message_id: str,
        part: MessagePart,
    ) -> MessagePart | None:
        """Add a part to a message."""
        return await add_part(session_id, message_id, part)

    async def mark_busy(self, session_id: str) -> None:
        """Mark session as busy."""
        return await mark_busy(session_id)

    async def mark_idle(self, session_id: str) -> None:
        """Mark session as idle."""
        return await mark_idle(session_id)

    async def clear_messages(self, session_id: str) -> None:
        """Clear all messages from a session."""
        return await clear_messages(session_id)

    def get_memory(self, session: Session) -> Any:
        """Get memory for a session."""
        return get_memory(session)

    async def get_conversation_for_llm(self, session_id: str) -> list[dict[str, Any]]:
        """Get conversation formatted for LLM."""
        return await get_conversation_for_llm(session_id)
