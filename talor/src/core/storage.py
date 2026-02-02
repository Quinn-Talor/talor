"""Storage system for persistent data management.

This module provides the StorageSystem class for managing SQLite database operations
asynchronously using aiosqlite. It handles:
- Database initialization and schema creation
- Database migrations
- CRUD operations with error handling and retry logic
- Graceful shutdown and connection management

The storage system uses SQLite for structured data (sessions, messages, permissions)
and provides a simple interface for database operations.
"""

import asyncio
import logging
from pathlib import Path
from typing import Any

import aiosqlite

from talor.core.errors import StorageError


logger = logging.getLogger(__name__)


# Database schema version
SCHEMA_VERSION = 1

# Database schema SQL
SCHEMA_SQL = """
-- Schema version table
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    metadata TEXT NOT NULL
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Create index on session_id for faster message queries
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

-- Permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    action TEXT NOT NULL,
    granted BOOLEAN NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Create index on session_id for faster permission queries
CREATE INDEX IF NOT EXISTS idx_permissions_session_id ON permissions(session_id);
"""


class StorageSystem:
    """Asynchronous SQLite storage system.

    The StorageSystem manages database connections and provides methods for
    executing queries with proper error handling and retry logic. It ensures:
    - Automatic schema initialization and migrations
    - Connection pooling and management
    - Error handling with retries for transient failures
    - Graceful shutdown with connection cleanup

    Example:
        ```python
        storage = StorageSystem("/path/to/database.db")
        await storage.init()

        # Execute a query
        await storage.execute(
            "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
            ("session_id", 1234567890, 1234567890, "{}")
        )

        # Fetch data
        session = await storage.fetch_one(
            "SELECT * FROM sessions WHERE id = ?",
            ("session_id",)
        )

        # Cleanup
        await storage.close()
        ```
    """

    def __init__(self, database_path: str | None = None) -> None:
        """Initialize the StorageSystem.

        Args:
            database_path: Path to the SQLite database file.
                          If None, uses default location based on platform.
                          Use ":memory:" for in-memory database (testing).
        """
        if database_path is None:
            database_path = self._get_default_database_path()

        self._database_path = database_path
        self._connection: aiosqlite.Connection | None = None
        self._initialized = False
        self._lock = asyncio.Lock()

    async def init(self) -> None:
        """Initialize the storage system.

        This method:
        1. Creates the database file if it doesn't exist
        2. Opens a connection to the database
        3. Enables foreign key constraints
        4. Creates the schema if needed
        5. Applies any pending migrations

        Raises:
            StorageError: If initialization fails
        """
        if self._initialized:
            logger.warning("StorageSystem already initialized")
            return

        try:
            # Create database directory if needed
            if self._database_path != ":memory:":
                db_path = Path(self._database_path)
                db_path.parent.mkdir(parents=True, exist_ok=True)
                logger.info(f"Database path: {db_path}")

            # Open connection
            self._connection = await aiosqlite.connect(self._database_path)

            # Enable foreign key constraints
            await self._connection.execute("PRAGMA foreign_keys = ON")

            # Enable WAL mode for better concurrency
            await self._connection.execute("PRAGMA journal_mode = WAL")

            # Set row factory to return dict-like rows
            self._connection.row_factory = aiosqlite.Row

            logger.info("Database connection established")

            # Initialize schema
            await self._init_schema()

            # Mark as initialized before applying migrations
            # (migrations may use execute() which requires initialization)
            self._initialized = True

            # Apply migrations
            await self._apply_migrations()

            logger.info("StorageSystem initialized successfully")

        except Exception as e:
            raise StorageError(
                "Failed to initialize storage system",
                context={"error": str(e), "database_path": self._database_path},
            )

    async def execute(
        self, query: str, params: tuple[Any, ...] | None = None, max_retries: int = 3
    ) -> None:
        """Execute a SQL query (INSERT, UPDATE, DELETE).

        This method executes a query that doesn't return results. It includes
        retry logic for transient failures like database locks.

        Args:
            query: SQL query to execute
            params: Query parameters as a tuple
            max_retries: Maximum number of retry attempts for transient failures

        Raises:
            StorageError: If execution fails after all retries
        """
        if not self._initialized or not self._connection:
            raise StorageError("StorageSystem not initialized. Call init() first.")

        params = params or ()

        for attempt in range(max_retries):
            try:
                async with self._lock:
                    await self._connection.execute(query, params)
                    await self._connection.commit()
                return

            except aiosqlite.OperationalError as e:
                # Database is locked - retry with exponential backoff
                if "locked" in str(e).lower() and attempt < max_retries - 1:
                    delay = 0.1 * (2**attempt)
                    logger.warning(
                        f"Database locked, retrying in {delay}s (attempt {attempt + 1}/{max_retries})"
                    )
                    await asyncio.sleep(delay)
                    continue

                raise StorageError(
                    "Database operation failed",
                    context={"error": str(e), "query": query, "attempt": attempt + 1},
                )

            except Exception as e:
                raise StorageError(
                    "Failed to execute query", context={"error": str(e), "query": query}
                )

    async def fetch_one(
        self, query: str, params: tuple[Any, ...] | None = None
    ) -> dict[str, Any] | None:
        """Fetch a single row from the database.

        Args:
            query: SQL SELECT query
            params: Query parameters as a tuple

        Returns:
            Dictionary with column names as keys, or None if no row found

        Raises:
            StorageError: If query execution fails
        """
        if not self._initialized or not self._connection:
            raise StorageError("StorageSystem not initialized. Call init() first.")

        params = params or ()

        try:
            async with self._lock:
                cursor = await self._connection.execute(query, params)
                row = await cursor.fetchone()
                await cursor.close()

            if row is None:
                return None

            # Convert Row to dict
            return dict(row)

        except Exception as e:
            raise StorageError("Failed to fetch row", context={"error": str(e), "query": query})

    async def fetch_all(
        self, query: str, params: tuple[Any, ...] | None = None
    ) -> list[dict[str, Any]]:
        """Fetch all rows from the database.

        Args:
            query: SQL SELECT query
            params: Query parameters as a tuple

        Returns:
            List of dictionaries with column names as keys

        Raises:
            StorageError: If query execution fails
        """
        if not self._initialized or not self._connection:
            raise StorageError("StorageSystem not initialized. Call init() first.")

        params = params or ()

        try:
            async with self._lock:
                cursor = await self._connection.execute(query, params)
                rows = await cursor.fetchall()
                await cursor.close()

            # Convert Rows to dicts
            return [dict(row) for row in rows]

        except Exception as e:
            raise StorageError("Failed to fetch rows", context={"error": str(e), "query": query})

    async def close(self) -> None:
        """Close the database connection.

        This method ensures all pending writes are flushed to disk before
        closing the connection.
        """
        if not self._initialized:
            return

        if self._connection:
            try:
                # Commit any pending transactions
                await self._connection.commit()

                # Close connection
                await self._connection.close()
                logger.info("Database connection closed")

            except Exception as e:
                logger.error(f"Error closing database connection: {e}")

            finally:
                self._connection = None
                self._initialized = False

    async def _init_schema(self) -> None:
        """Initialize the database schema.

        Creates all tables and indexes if they don't exist.

        Raises:
            StorageError: If schema creation fails
        """
        try:
            async with self._lock:
                await self._connection.executescript(SCHEMA_SQL)
                await self._connection.commit()

            logger.info("Database schema initialized")

        except Exception as e:
            raise StorageError("Failed to initialize database schema", context={"error": str(e)})

    async def _apply_migrations(self) -> None:
        """Apply database migrations.

        Checks the current schema version and applies any pending migrations
        to bring the database up to date.

        Raises:
            StorageError: If migration fails
        """
        try:
            # Get current schema version
            current_version = await self._get_schema_version()

            if current_version == SCHEMA_VERSION:
                logger.info(f"Database schema is up to date (version {SCHEMA_VERSION})")
                return

            if current_version > SCHEMA_VERSION:
                raise StorageError(
                    "Database schema version is newer than supported version",
                    context={
                        "current_version": current_version,
                        "supported_version": SCHEMA_VERSION,
                    },
                )

            # Apply migrations
            logger.info(f"Applying migrations from version {current_version} to {SCHEMA_VERSION}")

            for version in range(current_version + 1, SCHEMA_VERSION + 1):
                await self._apply_migration(version)

            logger.info("Database migrations applied successfully")

        except StorageError:
            raise
        except Exception as e:
            raise StorageError("Failed to apply database migrations", context={"error": str(e)})

    async def _get_schema_version(self) -> int:
        """Get the current schema version.

        Returns:
            Current schema version, or 0 if no version is set
        """
        try:
            row = await self.fetch_one("SELECT MAX(version) as version FROM schema_version")

            if row and row["version"] is not None:
                return row["version"]

            return 0

        except Exception:
            # Table doesn't exist yet
            return 0

    async def _apply_migration(self, version: int) -> None:
        """Apply a specific migration.

        Args:
            version: Migration version to apply

        Raises:
            StorageError: If migration fails
        """
        # For now, we only have version 1 (initial schema)
        # Future migrations would be added here

        if version == 1:
            # Initial schema is already created in _init_schema
            # Just record the version
            import time

            await self.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
                (version, int(time.time())),
            )
            logger.info(f"Applied migration version {version}")
        else:
            raise StorageError(
                f"Unknown migration version: {version}", context={"version": version}
            )

    def _get_default_database_path(self) -> str:
        """Get the default database path based on platform.

        Returns:
            Path to the default database file
        """
        import platform

        system = platform.system()
        if system == "Windows":
            data_dir = Path.home() / "AppData" / "Local" / "talor"
        else:
            # Linux/macOS - use XDG_DATA_HOME or default to ~/.local/share
            import os

            xdg_data = os.environ.get("XDG_DATA_HOME")
            if xdg_data:
                data_dir = Path(xdg_data) / "talor"
            else:
                data_dir = Path.home() / ".local" / "share" / "talor"

        return str(data_dir / "talor.db")
