"""Unit tests for the StorageSystem class.

Tests cover:
- Database initialization
- CRUD operations
- Error handling and retry logic
- Schema migrations
- Connection management
"""

import asyncio
import time
from pathlib import Path

import pytest

from src.core.storage import StorageSystem
from src.core.errors import StorageError


class TestStorageSystemInitialization:
    """Tests for StorageSystem initialization."""
    
    async def test_init_creates_in_memory_database(self):
        """Test that init creates an in-memory database successfully."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        # Verify connection is established
        assert storage._initialized
        assert storage._connection is not None
        
        await storage.close()
    
    async def test_init_creates_file_database(self, tmp_path):
        """Test that init creates a file-based database."""
        db_path = tmp_path / "test.db"
        storage = StorageSystem(str(db_path))
        await storage.init()
        
        # Verify database file was created
        assert db_path.exists()
        assert storage._initialized
        
        await storage.close()
    
    async def test_init_creates_directory_if_needed(self, tmp_path):
        """Test that init creates parent directories if they don't exist."""
        db_path = tmp_path / "subdir" / "nested" / "test.db"
        storage = StorageSystem(str(db_path))
        await storage.init()
        
        # Verify directory structure was created
        assert db_path.parent.exists()
        assert db_path.exists()
        
        await storage.close()
    
    async def test_init_creates_schema(self):
        """Test that init creates all required tables."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        # Verify tables exist by querying sqlite_master
        tables = await storage.fetch_all(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        table_names = [t["name"] for t in tables]
        
        assert "schema_version" in table_names
        assert "sessions" in table_names
        assert "messages" in table_names
        assert "permissions" in table_names
        
        await storage.close()
    
    async def test_init_sets_schema_version(self):
        """Test that init sets the schema version."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        version = await storage._get_schema_version()
        assert version == 1
        
        await storage.close()
    
    async def test_init_idempotent(self):
        """Test that calling init multiple times is safe."""
        storage = StorageSystem(":memory:")
        await storage.init()
        await storage.init()  # Should not raise
        
        assert storage._initialized
        
        await storage.close()
    
    async def test_init_enables_foreign_keys(self):
        """Test that foreign key constraints are enabled."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        # Check foreign_keys pragma
        result = await storage.fetch_one("PRAGMA foreign_keys")
        assert result["foreign_keys"] == 1
        
        await storage.close()


class TestStorageSystemCRUD:
    """Tests for CRUD operations."""
    
    async def test_execute_insert(self):
        """Test executing an INSERT query."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        await storage.execute(
            "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
            ("test_session", 1234567890, 1234567890, "{}")
        )
        
        # Verify insertion
        session = await storage.fetch_one(
            "SELECT * FROM sessions WHERE id = ?",
            ("test_session",)
        )
        assert session is not None
        assert session["id"] == "test_session"
        
        await storage.close()
    
    async def test_execute_update(self):
        """Test executing an UPDATE query."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        # Insert initial data
        await storage.execute(
            "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
            ("test_session", 1234567890, 1234567890, "{}")
        )
        
        # Update
        await storage.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?",
            (9999999999, "test_session")
        )
        
        # Verify update
        session = await storage.fetch_one(
            "SELECT * FROM sessions WHERE id = ?",
            ("test_session",)
        )
        assert session["updated_at"] == 9999999999
        
        await storage.close()
    
    async def test_execute_delete(self):
        """Test executing a DELETE query."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        # Insert data
        await storage.execute(
            "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
            ("test_session", 1234567890, 1234567890, "{}")
        )
        
        # Delete
        await storage.execute(
            "DELETE FROM sessions WHERE id = ?",
            ("test_session",)
        )
        
        # Verify deletion
        session = await storage.fetch_one(
            "SELECT * FROM sessions WHERE id = ?",
            ("test_session",)
        )
        assert session is None
        
        await storage.close()
    
    async def test_fetch_one_returns_dict(self):
        """Test that fetch_one returns a dictionary."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        await storage.execute(
            "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
            ("test_session", 1234567890, 1234567890, '{"key": "value"}')
        )
        
        session = await storage.fetch_one(
            "SELECT * FROM sessions WHERE id = ?",
            ("test_session",)
        )
        
        assert isinstance(session, dict)
        assert session["id"] == "test_session"
        assert session["created_at"] == 1234567890
        assert session["metadata"] == '{"key": "value"}'
        
        await storage.close()
    
    async def test_fetch_one_returns_none_when_not_found(self):
        """Test that fetch_one returns None when no row is found."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        session = await storage.fetch_one(
            "SELECT * FROM sessions WHERE id = ?",
            ("nonexistent",)
        )
        
        assert session is None
        
        await storage.close()
    
    async def test_fetch_all_returns_list(self):
        """Test that fetch_all returns a list of dictionaries."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        # Insert multiple sessions
        for i in range(3):
            await storage.execute(
                "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
                (f"session_{i}", 1234567890 + i, 1234567890 + i, "{}")
            )
        
        sessions = await storage.fetch_all("SELECT * FROM sessions ORDER BY id")
        
        assert isinstance(sessions, list)
        assert len(sessions) == 3
        assert all(isinstance(s, dict) for s in sessions)
        assert sessions[0]["id"] == "session_0"
        assert sessions[1]["id"] == "session_1"
        assert sessions[2]["id"] == "session_2"
        
        await storage.close()
    
    async def test_fetch_all_returns_empty_list_when_no_rows(self):
        """Test that fetch_all returns an empty list when no rows match."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        sessions = await storage.fetch_all("SELECT * FROM sessions")
        
        assert isinstance(sessions, list)
        assert len(sessions) == 0
        
        await storage.close()


class TestStorageSystemForeignKeys:
    """Tests for foreign key constraints."""
    
    async def test_foreign_key_cascade_delete(self):
        """Test that deleting a session cascades to messages and permissions."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        # Insert session
        await storage.execute(
            "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
            ("test_session", 1234567890, 1234567890, "{}")
        )
        
        # Insert messages
        await storage.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            ("msg_1", "test_session", "user", "Hello", 1234567890)
        )
        await storage.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            ("msg_2", "test_session", "assistant", "Hi", 1234567891)
        )
        
        # Insert permission
        await storage.execute(
            "INSERT INTO permissions (id, session_id, tool_name, action, granted, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            ("perm_1", "test_session", "read_file", "allow", 1, 1234567890)
        )
        
        # Delete session
        await storage.execute("DELETE FROM sessions WHERE id = ?", ("test_session",))
        
        # Verify messages were deleted
        messages = await storage.fetch_all(
            "SELECT * FROM messages WHERE session_id = ?",
            ("test_session",)
        )
        assert len(messages) == 0
        
        # Verify permissions were deleted
        permissions = await storage.fetch_all(
            "SELECT * FROM permissions WHERE session_id = ?",
            ("test_session",)
        )
        assert len(permissions) == 0
        
        await storage.close()


class TestStorageSystemErrorHandling:
    """Tests for error handling."""
    
    async def test_execute_raises_error_when_not_initialized(self):
        """Test that execute raises error when storage is not initialized."""
        storage = StorageSystem(":memory:")
        
        with pytest.raises(StorageError) as exc_info:
            await storage.execute("SELECT 1")
        
        assert "not initialized" in str(exc_info.value).lower()
    
    async def test_fetch_one_raises_error_when_not_initialized(self):
        """Test that fetch_one raises error when storage is not initialized."""
        storage = StorageSystem(":memory:")
        
        with pytest.raises(StorageError) as exc_info:
            await storage.fetch_one("SELECT 1")
        
        assert "not initialized" in str(exc_info.value).lower()
    
    async def test_fetch_all_raises_error_when_not_initialized(self):
        """Test that fetch_all raises error when storage is not initialized."""
        storage = StorageSystem(":memory:")
        
        with pytest.raises(StorageError) as exc_info:
            await storage.fetch_all("SELECT 1")
        
        assert "not initialized" in str(exc_info.value).lower()
    
    async def test_execute_raises_error_on_invalid_sql(self):
        """Test that execute raises error on invalid SQL."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        with pytest.raises(StorageError):
            await storage.execute("INVALID SQL QUERY")
        
        await storage.close()
    
    async def test_fetch_one_raises_error_on_invalid_sql(self):
        """Test that fetch_one raises error on invalid SQL."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        with pytest.raises(StorageError):
            await storage.fetch_one("INVALID SQL QUERY")
        
        await storage.close()


class TestStorageSystemRetryLogic:
    """Tests for retry logic on database locks."""
    
    async def test_execute_retries_on_database_lock(self):
        """Test that execute retries when database is locked."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        # Insert initial data
        await storage.execute(
            "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
            ("test_session", 1234567890, 1234567890, "{}")
        )
        
        # Simulate concurrent access by holding a lock
        async def hold_lock():
            # Start a transaction and hold it
            await storage._connection.execute("BEGIN EXCLUSIVE")
            await asyncio.sleep(0.3)
            await storage._connection.rollback()
        
        async def update_with_retry():
            # This should retry and eventually succeed
            await storage.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                (9999999999, "test_session")
            )
        
        # Run both concurrently
        lock_task = asyncio.create_task(hold_lock())
        await asyncio.sleep(0.1)  # Let lock be acquired first
        
        # This should succeed after retries
        await update_with_retry()
        await lock_task
        
        # Verify update succeeded
        session = await storage.fetch_one(
            "SELECT * FROM sessions WHERE id = ?",
            ("test_session",)
        )
        assert session["updated_at"] == 9999999999
        
        await storage.close()


class TestStorageSystemConnectionManagement:
    """Tests for connection management."""
    
    async def test_close_commits_pending_transactions(self):
        """Test that close commits pending transactions."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        await storage.execute(
            "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
            ("test_session", 1234567890, 1234567890, "{}")
        )
        
        await storage.close()
        
        # Verify storage is no longer initialized
        assert not storage._initialized
        assert storage._connection is None
    
    async def test_close_idempotent(self):
        """Test that calling close multiple times is safe."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        await storage.close()
        await storage.close()  # Should not raise
        
        assert not storage._initialized
    
    async def test_close_without_init(self):
        """Test that close without init is safe."""
        storage = StorageSystem(":memory:")
        await storage.close()  # Should not raise
        
        assert not storage._initialized


class TestStorageSystemIndexes:
    """Tests for database indexes."""
    
    async def test_indexes_created(self):
        """Test that indexes are created on foreign key columns."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        # Query for indexes
        indexes = await storage.fetch_all(
            "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name"
        )
        index_names = [idx["name"] for idx in indexes]
        
        assert "idx_messages_session_id" in index_names
        assert "idx_permissions_session_id" in index_names
        
        await storage.close()


class TestStorageSystemDefaultPath:
    """Tests for default database path."""
    
    async def test_default_path_uses_platform_specific_location(self):
        """Test that default path is platform-specific."""
        storage = StorageSystem()
        
        # Should not raise and should have a valid path
        assert storage._database_path is not None
        assert len(storage._database_path) > 0
        
        # Path should contain 'talor'
        assert "talor" in storage._database_path.lower()


class TestStorageSystemConcurrency:
    """Tests for concurrent access."""
    
    async def test_concurrent_inserts(self):
        """Test that concurrent inserts work correctly."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        async def insert_session(session_id: str):
            await storage.execute(
                "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
                (session_id, int(time.time()), int(time.time()), "{}")
            )
        
        # Insert 10 sessions concurrently
        tasks = [insert_session(f"session_{i}") for i in range(10)]
        await asyncio.gather(*tasks)
        
        # Verify all sessions were inserted
        sessions = await storage.fetch_all("SELECT * FROM sessions")
        assert len(sessions) == 10
        
        await storage.close()
    
    async def test_concurrent_reads(self):
        """Test that concurrent reads work correctly."""
        storage = StorageSystem(":memory:")
        await storage.init()
        
        # Insert test data
        await storage.execute(
            "INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)",
            ("test_session", 1234567890, 1234567890, "{}")
        )
        
        async def read_session():
            return await storage.fetch_one(
                "SELECT * FROM sessions WHERE id = ?",
                ("test_session",)
            )
        
        # Read 10 times concurrently
        tasks = [read_session() for _ in range(10)]
        results = await asyncio.gather(*tasks)
        
        # Verify all reads succeeded
        assert len(results) == 10
        assert all(r is not None for r in results)
        assert all(r["id"] == "test_session" for r in results)
        
        await storage.close()
