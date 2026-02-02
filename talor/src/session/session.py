"""Session Management for Talor.

This module provides session management with event publishing
and immutable updates.

Features:
- Session creation with ULID identifiers
- Session update with editor functions
- Message streaming
- Event publishing for session lifecycle
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, AsyncIterator, TYPE_CHECKING

from pydantic import BaseModel, Field
from ulid import ULID

from src.session.message import (
    Message,
    MessagePart,
    MessageWithParts,
    UserMessage,
    AssistantMessage,
    TextPart,
    ToolPart,
)

if TYPE_CHECKING:
    from src.bus import Bus
    from src.core.storage import StorageSystem


logger = logging.getLogger(__name__)


# =============================================================================
# Session Info
# =============================================================================

class SessionInfo(BaseModel):
    """Session information.

    Contains metadata about a conversation session.
    """

    id: str
    slug: str = ""
    project_id: str = ""
    directory: str
    parent_id: str | None = None
    title: str
    version: str = "1.0.0"
    time: dict[str, int] = Field(default_factory=dict)
    permission: list[dict[str, Any]] = Field(default_factory=list)
    summary: dict[str, Any] | None = None
    share: dict[str, str] | None = None
    revert: dict[str, Any] | None = None


# =============================================================================
# Session Namespace
# =============================================================================

class Session:
    """Session management namespace.

    Provides methods for creating, updating, and querying sessions.
    """

    # Class-level state
    _storage: Any | None = None
    _bus: Any | None = None
    _directory: str = "."
    _sessions_cache: dict[str, SessionInfo] = {}
    _messages_cache: dict[str, list[MessageWithParts]] = {}
    _lock = asyncio.Lock()

    @classmethod
    def configure(
        cls,
        storage: Any,
        bus: Any | None = None,
        directory: str = ".",
    ) -> None:
        """Configure the session system.

        Args:
            storage: StorageSystem instance
            bus: Optional Bus instance for events
            directory: Working directory
        """
        cls._storage = storage
        cls._bus = bus
        cls._directory = directory

    @classmethod
    async def create(
        cls,
        parent_id: str | None = None,
        title: str | None = None,
        permission: list[dict[str, Any]] | None = None,
    ) -> SessionInfo:
        """Create a new session.

        Args:
            parent_id: Optional parent session ID
            title: Optional session title
            permission: Optional permission rules

        Returns:
            Created SessionInfo
        """
        session_id = f"session_{ULID()}"
        now = int(time.time() * 1000)

        # Generate default title
        if not title:
            prefix = "Child session - " if parent_id else "New session - "
            title = prefix + datetime.now().isoformat()

        session = SessionInfo(
            id=session_id,
            slug=str(ULID()).lower()[:8],
            project_id="default",
            directory=cls._directory,
            parent_id=parent_id,
            title=title,
            time={"created": now, "updated": now},
            permission=permission or [],
        )

        # Store session
        async with cls._lock:
            cls._sessions_cache[session_id] = session
            cls._messages_cache[session_id] = []

        # Persist to storage
        if cls._storage:
            await cls._storage.execute(
                "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
                (session_id, now // 1000, now // 1000, json.dumps(session.model_dump())),
            )

        # Publish event
        if cls._bus:
            from src.bus.events import SessionCreated, SessionCreatedData, SessionInfo as EventSessionInfo
            await cls._bus.publish(
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

        logger.info(f"Created session: {session_id}")
        return session

    @classmethod
    async def get(cls, session_id: str) -> SessionInfo | None:
        """Get a session by ID.

        Args:
            session_id: Session ID

        Returns:
            SessionInfo or None
        """
        # Check cache
        if session_id in cls._sessions_cache:
            return cls._sessions_cache[session_id]

        # Load from storage
        if cls._storage:
            row = await cls._storage.fetch_one(
                "SELECT * FROM sessions WHERE id = ?",
                (session_id,),
            )
            if row:
                metadata = json.loads(row["metadata"])
                session = SessionInfo(**metadata)
                cls._sessions_cache[session_id] = session
                return session

        return None

    @classmethod
    async def update(
        cls,
        session_id: str,
        editor: Callable[[SessionInfo], None],
    ) -> SessionInfo | None:
        """Update a session using an editor function.

        Args:
            session_id: Session ID
            editor: Function that modifies the session

        Returns:
            Updated SessionInfo or None
        """
        async with cls._lock:
            session = await cls.get(session_id)
            if not session:
                return None

            # Apply editor
            editor(session)

            # Update timestamp
            session.time["updated"] = int(time.time() * 1000)

            # Update cache
            cls._sessions_cache[session_id] = session

            # Persist
            if cls._storage:
                await cls._storage.execute(
                    "UPDATE sessions SET updated_at = ?, metadata = ? WHERE id = ?",
                    (session.time["updated"] // 1000, json.dumps(session.model_dump()), session_id),
                )

            # Publish event
            if cls._bus:
                from src.bus.events import SessionUpdated, SessionUpdatedData, SessionInfo as EventSessionInfo
                await cls._bus.publish(
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

            return session

    @classmethod
    async def touch(cls, session_id: str) -> None:
        """Update session's updated timestamp.

        Args:
            session_id: Session ID
        """
        await cls.update(session_id, lambda s: None)

    @classmethod
    async def delete(cls, session_id: str) -> None:
        """Delete a session.

        Args:
            session_id: Session ID
        """
        async with cls._lock:
            session = cls._sessions_cache.pop(session_id, None)
            cls._messages_cache.pop(session_id, None)

            if cls._storage:
                await cls._storage.execute(
                    "DELETE FROM sessions WHERE id = ?",
                    (session_id,),
                )

            if session and cls._bus:
                from src.bus.events import SessionDeleted, SessionDeletedData, SessionInfo as EventSessionInfo
                await cls._bus.publish(
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

    @classmethod
    async def list(cls) -> list[SessionInfo]:
        """List all sessions.

        Returns:
            List of SessionInfo
        """
        sessions = list(cls._sessions_cache.values())

        # Load from storage if empty
        if not sessions and cls._storage:
            rows = await cls._storage.fetch_all(
                "SELECT * FROM sessions ORDER BY updated_at DESC"
            )
            for row in rows:
                metadata = json.loads(row["metadata"])
                session = SessionInfo(**metadata)
                cls._sessions_cache[session.id] = session
                sessions.append(session)

        return sorted(sessions, key=lambda s: s.time.get("updated", 0), reverse=True)

    @classmethod
    async def messages(cls, session_id: str) -> list[MessageWithParts]:
        """Get messages for a session.

        Args:
            session_id: Session ID

        Returns:
            List of MessageWithParts
        """
        if session_id in cls._messages_cache:
            return cls._messages_cache[session_id]
        return []

    @classmethod
    async def add_message(
        cls,
        session_id: str,
        message: Message,
        parts: list[MessagePart] | None = None,
    ) -> MessageWithParts:
        """Add a message to a session.

        Args:
            session_id: Session ID
            message: Message to add
            parts: Optional message parts

        Returns:
            MessageWithParts
        """
        msg_with_parts = MessageWithParts(info=message, parts=parts or [])

        async with cls._lock:
            if session_id not in cls._messages_cache:
                cls._messages_cache[session_id] = []
            cls._messages_cache[session_id].append(msg_with_parts)

        # Publish event
        if cls._bus:
            from src.bus.events import MessageCreated, MessageCreatedData
            await cls._bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id=session_id,
                    message_id=message.id,
                    role=message.role,
                    content=msg_with_parts.get_text_content() if parts else None,
                )
            )

        return msg_with_parts

    @classmethod
    async def update_message(
        cls,
        session_id: str,
        message_id: str,
        editor: Callable[[MessageWithParts], None],
    ) -> MessageWithParts | None:
        """Update a message.

        Args:
            session_id: Session ID
            message_id: Message ID
            editor: Function that modifies the message

        Returns:
            Updated MessageWithParts or None
        """
        async with cls._lock:
            messages = cls._messages_cache.get(session_id, [])
            for msg in messages:
                if msg.info.id == message_id:
                    editor(msg)

                    # Publish event
                    if cls._bus:
                        from src.bus.events import MessageUpdated, MessageUpdatedData
                        await cls._bus.publish(
                            MessageUpdated,
                            MessageUpdatedData(
                                session_id=session_id,
                                message_id=message_id,
                                role=msg.info.role,
                                content=msg.get_text_content(),
                            )
                        )

                    return msg

        return None

    @classmethod
    async def add_part(
        cls,
        session_id: str,
        message_id: str,
        part: MessagePart,
    ) -> MessagePart | None:
        """Add a part to a message.

        Args:
            session_id: Session ID
            message_id: Message ID
            part: Part to add

        Returns:
            Added part or None
        """
        async with cls._lock:
            messages = cls._messages_cache.get(session_id, [])
            for msg in messages:
                if msg.info.id == message_id:
                    part.session_id = session_id
                    part.message_id = message_id
                    msg.parts.append(part)

                    # Publish event
                    if cls._bus:
                        from src.bus.events import MessagePartCreated, MessagePartCreatedData
                        await cls._bus.publish(
                            MessagePartCreated,
                            MessagePartCreatedData(
                                session_id=session_id,
                                message_id=message_id,
                                part_id=part.id,
                                part_type=part.type,
                            )
                        )

                    return part

        return None

    @classmethod
    def clear_cache(cls) -> None:
        """Clear all caches (for testing)."""
        cls._sessions_cache.clear()
        cls._messages_cache.clear()


# =============================================================================
# Errors
# =============================================================================

class SessionBusyError(Exception):
    """Session is busy processing."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        super().__init__(f"Session {session_id} is busy")
