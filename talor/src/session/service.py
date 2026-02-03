"""Session Service for Talor.

This module provides the application service for Session operations.
The service orchestrates use cases, coordinates with repository, and publishes domain events.

Following DDD principles:
- Application Service orchestrates use cases
- Delegates business logic to Session entity
- Publishes domain events after successful operations
- Handles cross-cutting concerns (logging, transactions)

Example:
    ```python
    service = SessionService(repository=repo, bus=bus)

    session = await service.create_session(title="New Session")

    # Service delegates to entity's business methods
    await service.add_user_message(session.id, "Hello")
    ```
"""

from __future__ import annotations

import logging
from typing import Any, Callable, TYPE_CHECKING

from src.session.session import Session, SessionBusyError
from src.session.message import (
    MessagePart,
    MessageWithParts,
    UserMessage,
    AssistantMessage,
    SystemMessage,
)

# Union type for backward compatibility
Message = UserMessage | AssistantMessage | SystemMessage

if TYPE_CHECKING:
    from src.session.repository import SessionRepository
    from src.bus import Bus


logger = logging.getLogger(__name__)


class SessionService:
    """Application service for Session operations.

    Orchestrates use cases by:
    - Loading entities from repository
    - Delegating business logic to entities
    - Persisting changes via repository
    - Publishing domain events
    """

    def __init__(
        self,
        repository: "SessionRepository",
        bus: Any | None = None,
    ) -> None:
        """Initialize service.

        Args:
            repository: Session repository instance
            bus: Event bus for publishing domain events
        """
        self._repository = repository
        self._bus = bus

    # =========================================================================
    # Session Lifecycle
    # =========================================================================

    async def create_session(
        self,
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
        session = await self._repository.create(
            parent_id=parent_id,
            title=title,
            permission=permission,
        )

        await self._publish_session_created(session)
        logger.info(f"Created session: {session.id}")

        return session

    async def get_session(self, session_id: str) -> Session | None:
        """Get a session by ID.

        Args:
            session_id: Session identifier

        Returns:
            Session instance or None
        """
        return await self._repository.get(session_id)

    async def delete_session(self, session_id: str) -> None:
        """Delete a session.

        Args:
            session_id: Session identifier
        """
        session = await self._repository.delete(session_id)

        if session:
            await self._publish_session_deleted(session)
            logger.info(f"Deleted session: {session_id}")

    async def list_sessions(self) -> list[Session]:
        """List all sessions.

        Returns:
            List of sessions
        """
        return await self._repository.list()

    # =========================================================================
    # Session Updates
    # =========================================================================

    async def update_title(self, session_id: str, new_title: str) -> Session | None:
        """Update session title.

        Args:
            session_id: Session identifier
            new_title: New title

        Returns:
            Updated session or None
        """
        session = await self._repository.get(session_id)
        if not session:
            return None

        # Delegate to entity's business method
        session.update_title(new_title)

        await self._repository.save(session)
        await self._publish_session_updated(session)

        return session

    async def update_session(
        self,
        session_id: str,
        editor: Callable[[Session], None],
    ) -> Session | None:
        """Update a session with an editor function.

        Args:
            session_id: Session identifier
            editor: Function to modify the session

        Returns:
            Updated session or None
        """
        session = await self._repository.get(session_id)
        if not session:
            return None

        editor(session)
        await self._repository.save(session)
        await self._publish_session_updated(session)

        return session

    async def touch_session(self, session_id: str) -> None:
        """Update session timestamp.

        Args:
            session_id: Session identifier
        """
        session = await self._repository.get(session_id)
        if session:
            session._touch()
            await self._repository.save(session)
            await self._publish_session_updated(session)

    # =========================================================================
    # Message Operations (delegate to entity)
    # =========================================================================

    async def get_messages(self, session_id: str) -> list[MessageWithParts]:
        """Get all messages for a session.

        Args:
            session_id: Session identifier

        Returns:
            List of messages with parts
        """
        session = await self._repository.get(session_id)
        return session.messages if session else []

    async def add_user_message(
        self,
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
        session = await self._repository.get(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        # Delegate to entity
        msg = session.add_user_message(content)

        await self._publish_message_created(session_id, msg)

        return msg

    async def add_assistant_message(
        self,
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
        session = await self._repository.get(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        # Delegate to entity
        msg = session.add_assistant_message(content, tool_calls)

        await self._publish_message_created(session_id, msg)

        return msg

    async def add_tool_result(
        self,
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
        session = await self._repository.get(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        # Delegate to entity
        msg = session.add_tool_result(tool_call_id, content)

        await self._publish_message_created(session_id, msg)

        return msg

    async def add_message(
        self,
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
        session = await self._repository.get(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        msg_with_parts = session._add_message_instance(message, parts)

        await self._publish_message_created(session_id, msg_with_parts)

        return msg_with_parts

    async def update_message(
        self,
        session_id: str,
        message_id: str,
        editor: Callable[[MessageWithParts], None],
    ) -> MessageWithParts | None:
        """Update a message with an editor function.

        Args:
            session_id: Session identifier
            message_id: Message identifier
            editor: Function to modify the message

        Returns:
            Updated message or None
        """
        session = await self._repository.get(session_id)
        if not session:
            return None

        msg = session.get_message(message_id)
        if not msg:
            return None

        editor(msg)

        await self._publish_message_updated(
            session_id,
            message_id,
            msg.info.role,
            msg.get_text_content(),
        )

        return msg

    async def add_part(
        self,
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
        session = await self._repository.get(session_id)
        if not session:
            return None

        # Delegate to entity
        result = session.add_part_to_message(message_id, part)

        if result:
            await self._publish_part_created(session_id, message_id, part)

        return result

    # =========================================================================
    # Session State Management
    # =========================================================================

    async def mark_busy(self, session_id: str) -> None:
        """Mark session as busy.

        Args:
            session_id: Session identifier

        Raises:
            ValueError: If session not found
            SessionBusyError: If already busy
        """
        session = await self._repository.get(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        session.mark_busy()

    async def mark_idle(self, session_id: str) -> None:
        """Mark session as idle.

        Args:
            session_id: Session identifier
        """
        session = await self._repository.get(session_id)
        if session:
            session.mark_idle()

    async def clear_messages(self, session_id: str) -> None:
        """Clear all messages from a session.

        Args:
            session_id: Session identifier
        """
        session = await self._repository.get(session_id)
        if session:
            session.clear_messages()
            await self._repository.save(session)

    # =========================================================================
    # Memory Operations
    # =========================================================================

    def get_memory(self, session: Session) -> Any:
        """Get memory for a session.

        Args:
            session: Session instance

        Returns:
            ShortTermMemory instance
        """
        return session.memory

    async def get_conversation_for_llm(self, session_id: str) -> list[dict[str, Any]]:
        """Get conversation formatted for LLM.

        Args:
            session_id: Session identifier

        Returns:
            List of message dicts for LLM
        """
        session = await self._repository.get(session_id)
        if not session:
            return []

        return session.get_conversation_for_llm()

    # =========================================================================
    # Domain Event Publishing
    # =========================================================================

    async def _publish_session_created(self, session: Session) -> None:
        """Publish session created event."""
        if not self._bus:
            return

        from src.bus.events import SessionCreated, SessionCreatedData, SessionInfo as EventSessionInfo
        await self._bus.publish(
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

    async def _publish_session_updated(self, session: Session) -> None:
        """Publish session updated event."""
        if not self._bus:
            return

        from src.bus.events import SessionUpdated, SessionUpdatedData, SessionInfo as EventSessionInfo
        await self._bus.publish(
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

    async def _publish_session_deleted(self, session: Session) -> None:
        """Publish session deleted event."""
        if not self._bus:
            return

        from src.bus.events import SessionDeleted, SessionDeletedData, SessionInfo as EventSessionInfo
        await self._bus.publish(
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
        self,
        session_id: str,
        msg: MessageWithParts,
    ) -> None:
        """Publish message created event."""
        if not self._bus:
            return

        from src.bus.events import MessageCreated, MessageCreatedData
        await self._bus.publish(
            MessageCreated,
            MessageCreatedData(
                session_id=session_id,
                message_id=msg.info.id,
                role=msg.info.role,
                content=msg.get_text_content(),
            )
        )

    async def _publish_message_updated(
        self,
        session_id: str,
        message_id: str,
        role: str,
        content: str | None,
    ) -> None:
        """Publish message updated event."""
        if not self._bus:
            return

        from src.bus.events import MessageUpdated, MessageUpdatedData
        await self._bus.publish(
            MessageUpdated,
            MessageUpdatedData(
                session_id=session_id,
                message_id=message_id,
                role=role,
                content=content,
            )
        )

    async def _publish_part_created(
        self,
        session_id: str,
        message_id: str,
        part: MessagePart,
    ) -> None:
        """Publish message part created event."""
        if not self._bus:
            return

        from src.bus.events import MessagePartCreated, MessagePartCreatedData
        await self._bus.publish(
            MessagePartCreated,
            MessagePartCreatedData(
                session_id=session_id,
                message_id=message_id,
                part_id=part.id,
                part_type=part.type,
            )
        )
