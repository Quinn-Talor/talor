"""Session Repository for Talor.

This module provides the repository pattern implementation for Session persistence.
Repository only handles data persistence - no business events.

Following DDD principles:
- Repository is purely for data access (CRUD)
- Domain events are published by Application Service, not Repository
- Repository doesn't know about event bus

Example:
    ```python
    repository = SessionRepositoryImpl(storage=storage, directory="/workspace")

    session = await repository.create(title="New Session")
    session = await repository.get(session_id)
    await repository.save(session)
    ```
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, TYPE_CHECKING

from ulid import ULID

from src.session.session import Session

if TYPE_CHECKING:
    from src.core.storage import StorageSystem


logger = logging.getLogger(__name__)


# =============================================================================
# Repository Interface
# =============================================================================

class SessionRepository(ABC):
    """Abstract repository interface for Session persistence.

    Defines the contract for session data access operations.
    """

    @abstractmethod
    async def create(
        self,
        parent_id: str | None = None,
        title: str | None = None,
        permission: list[dict[str, Any]] | None = None,
    ) -> Session:
        """Create a new session."""
        ...

    @abstractmethod
    async def get(self, session_id: str) -> Session | None:
        """Get a session by ID."""
        ...

    @abstractmethod
    async def save(self, session: Session) -> None:
        """Save session changes."""
        ...

    @abstractmethod
    async def delete(self, session_id: str) -> Session | None:
        """Delete a session. Returns deleted session or None."""
        ...

    @abstractmethod
    async def list(self) -> list[Session]:
        """List all sessions."""
        ...


# =============================================================================
# Repository Implementation
# =============================================================================

class SessionRepositoryImpl(SessionRepository):
    """Concrete repository implementation for Session persistence.

    Handles only:
    - CRUD operations
    - In-memory caching
    - Storage persistence

    Does NOT handle:
    - Domain events (handled by SessionService)
    """

    def __init__(
        self,
        storage: Any | None = None,
        directory: str = ".",
    ) -> None:
        """Initialize repository.

        Args:
            storage: Storage system for persistence
            directory: Default directory for sessions
        """
        self._storage = storage
        self._directory = directory
        self._cache: dict[str, Session] = {}
        self._lock = asyncio.Lock()

    async def create(
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
        session_id = f"session_{ULID()}"
        now = int(time.time() * 1000)

        if not title:
            prefix = "Child session - " if parent_id else "New session - "
            title = prefix + datetime.now().isoformat()

        session = Session(
            id=session_id,
            title=title,
            directory=self._directory,
            parent_id=parent_id,
            time={"created": now, "updated": now},
            permission=permission or [],
        )

        async with self._lock:
            self._cache[session_id] = session

        if self._storage:
            await self._storage.execute(
                "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
                (session_id, now // 1000, now // 1000, json.dumps(session.to_dict())),
            )

        logger.info(f"Created session: {session_id}")
        return session

    async def get(self, session_id: str) -> Session | None:
        """Get a session by ID.

        Args:
            session_id: Session identifier

        Returns:
            Session instance or None
        """
        if session_id in self._cache:
            return self._cache[session_id]

        if self._storage:
            row = await self._storage.fetch_one(
                "SELECT * FROM sessions WHERE id = ?",
                (session_id,),
            )
            if row:
                metadata = json.loads(row["metadata"])
                session = Session.from_dict(metadata)
                self._cache[session_id] = session
                return session

        return None

    async def save(self, session: Session) -> None:
        """Save session changes.

        Args:
            session: Session to save
        """
        session.time["updated"] = int(time.time() * 1000)

        if self._storage:
            await self._storage.execute(
                "UPDATE sessions SET updated_at = ?, metadata = ? WHERE id = ?",
                (session.time["updated"] // 1000, json.dumps(session.to_dict()), session.id),
            )

    async def delete(self, session_id: str) -> Session | None:
        """Delete a session.

        Args:
            session_id: Session identifier

        Returns:
            Deleted session or None if not found
        """
        async with self._lock:
            session = self._cache.pop(session_id, None)

            if self._storage:
                await self._storage.execute(
                    "DELETE FROM sessions WHERE id = ?",
                    (session_id,),
                )

            return session

    async def list(self) -> list[Session]:
        """List all sessions.

        Returns:
            List of sessions sorted by update time
        """
        sessions = list(self._cache.values())

        if not sessions and self._storage:
            rows = await self._storage.fetch_all(
                "SELECT * FROM sessions ORDER BY updated_at DESC"
            )
            for row in rows:
                metadata = json.loads(row["metadata"])
                session = Session.from_dict(metadata)
                self._cache[session.id] = session
                sessions.append(session)

        return sorted(sessions, key=lambda s: s.time.get("updated", 0), reverse=True)

    async def touch(self, session_id: str) -> None:
        """Update session timestamp.

        Args:
            session_id: Session identifier
        """
        session = await self.get(session_id)
        if session:
            await self.save(session)

    def clear_cache(self) -> None:
        """Clear cache (for testing)."""
        self._cache.clear()
