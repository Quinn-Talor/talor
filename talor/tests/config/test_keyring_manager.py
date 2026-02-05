"""Tests for KeyringManager."""

import json
import tempfile
from pathlib import Path

import pytest

from src.config.keyring_manager import KeyringManager


class TestKeyringManager:
    """Test KeyringManager functionality."""

    def test_store_and_get_key(self):
        """Test storing and retrieving keys (uses system keyring if available)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = KeyringManager(fallback_dir=Path(tmpdir))

            # Store a key
            manager.store_key("test_key", "test_value_123")

            # Retrieve the key
            value = manager.get_key("test_key")
            assert value == "test_value_123"

            # Clean up
            manager.delete_key("test_key")

    def test_get_nonexistent_key(self):
        """Test retrieving a key that doesn't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = KeyringManager(fallback_dir=Path(tmpdir))

            value = manager.get_key("nonexistent_key")
            assert value is None

    def test_delete_key(self):
        """Test deleting a key."""
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = KeyringManager(fallback_dir=Path(tmpdir))

            # Store a key
            manager.store_key("test_key", "test_value")
            assert manager.get_key("test_key") == "test_value"

            # Delete the key
            manager.delete_key("test_key")
            assert manager.get_key("test_key") is None

    def test_multiple_keys(self):
        """Test storing multiple keys."""
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = KeyringManager(fallback_dir=Path(tmpdir))

            # Store multiple keys
            manager.store_key("key1", "value1")
            manager.store_key("key2", "value2")
            manager.store_key("key3", "value3")

            # Retrieve all keys
            assert manager.get_key("key1") == "value1"
            assert manager.get_key("key2") == "value2"
            assert manager.get_key("key3") == "value3"

    def test_update_existing_key(self):
        """Test updating an existing key."""
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = KeyringManager(fallback_dir=Path(tmpdir))

            # Store initial value
            manager.store_key("test_key", "initial_value")
            assert manager.get_key("test_key") == "initial_value"

            # Update value
            manager.store_key("test_key", "updated_value")
            assert manager.get_key("test_key") == "updated_value"

    def test_module_level_functions(self):
        """Test module-level convenience functions."""
        from src.config.keyring_manager import store_key, get_key, delete_key

        # Note: These use the global manager, so we can't control the directory
        # Just test that they don't crash
        store_key("test_module_key", "test_value")
        value = get_key("test_module_key")
        assert value == "test_value"

        delete_key("test_module_key")
        value = get_key("test_module_key")
        assert value is None
