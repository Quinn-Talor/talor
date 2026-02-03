"""Session Management for Talor.

This module provides session management for conversation tracking.

DDD Architecture:
- Session: Pure domain entity with business logic
- SessionRepository: Data persistence
- SessionService: Application service (orchestrates use cases, publishes events)

Usage:
    ```python
    from src.core.container import get_container

    container = get_container()
    session = await container.session_service.create_session(title="New Session")

    # Use entity methods
    session.add_user_message("Hello")
    session.update_title("New Title")

    # Execute prompts using AgentExecutor
    async for event in container.agent_executor.execute_stream(...):
        ...
    ```
"""

from src.session.session import Session, SessionBusyError
from src.session.message import MessagePart, MessageWithParts
from src.session.repository import SessionRepository, SessionRepositoryImpl
from src.session.service import SessionService

__all__ = [
    # Domain
    "Session",
    "SessionBusyError",
    # Repository
    "SessionRepository",
    "SessionRepositoryImpl",
    # Service
    "SessionService",
    # Message
    "MessagePart",
    "MessageWithParts",
]
