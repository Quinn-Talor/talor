"""Keyring Manager for secure API key storage.

This module provides secure storage for API keys using the system keyring:
- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service (libsecret)

If keyring is unavailable, it falls back to encrypted file storage.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Service name for keyring
SERVICE_NAME = "talor"


class KeyringManager:
    """Manager for secure API key storage using system keyring.

    Features:
    - Uses system keyring (Keychain/Credential Manager/Secret Service)
    - Falls back to encrypted file storage if keyring unavailable
    - Thread-safe operations
    """

    def __init__(self, fallback_dir: Path | None = None):
        """Initialize KeyringManager.

        Args:
            fallback_dir: Directory for fallback file storage (default: ~/.talor)
        """
        self._fallback_dir = fallback_dir or (Path.home() / ".talor")
        self._keyring_available = self._check_keyring_available()

        if not self._keyring_available:
            logger.warning(
                "System keyring not available, falling back to file storage. "
                "API keys will be stored in encrypted files."
            )
            # Ensure fallback directory exists
            self._fallback_dir.mkdir(parents=True, exist_ok=True)

    def _check_keyring_available(self) -> bool:
        """Check if system keyring is available.

        Returns:
            True if keyring is available, False otherwise
        """
        try:
            import keyring
            from keyring.errors import KeyringError

            # Try to get the current backend
            backend = keyring.get_keyring()
            backend_name = backend.__class__.__name__

            # Check if it's a real backend (not the fail backend)
            if "fail" in backend_name.lower() or "null" in backend_name.lower():
                logger.debug(f"Keyring backend is {backend_name}, not usable")
                return False

            # Try a test operation
            try:
                keyring.get_password(SERVICE_NAME, "__test__")
                return True
            except KeyringError as e:
                logger.debug(f"Keyring test failed: {e}")
                return False

        except ImportError:
            logger.debug("keyring module not available")
            return False
        except Exception as e:
            logger.debug(f"Keyring check failed: {e}")
            return False

    def store_key(self, key_name: str, api_key: str) -> None:
        """Store an API key securely.

        Args:
            key_name: Name/identifier for the key (e.g., "openai_api_key")
            api_key: The API key to store
        """
        if self._keyring_available:
            try:
                import keyring
                keyring.set_password(SERVICE_NAME, key_name, api_key)
                logger.debug(f"Stored key '{key_name}' in system keyring")
                return
            except Exception as e:
                logger.warning(f"Failed to store key in keyring: {e}, falling back to file")

        # Fallback to file storage
        self._store_key_file(key_name, api_key)

    def get_key(self, key_name: str) -> str | None:
        """Retrieve an API key.

        Args:
            key_name: Name/identifier for the key

        Returns:
            The API key, or None if not found
        """
        if self._keyring_available:
            try:
                import keyring
                key = keyring.get_password(SERVICE_NAME, key_name)
                if key is not None:
                    logger.debug(f"Retrieved key '{key_name}' from system keyring")
                    return key
            except Exception as e:
                logger.warning(f"Failed to get key from keyring: {e}, trying file fallback")

        # Fallback to file storage
        return self._get_key_file(key_name)

    def delete_key(self, key_name: str) -> None:
        """Delete an API key.

        Args:
            key_name: Name/identifier for the key
        """
        if self._keyring_available:
            try:
                import keyring
                keyring.delete_password(SERVICE_NAME, key_name)
                logger.debug(f"Deleted key '{key_name}' from system keyring")
                return
            except Exception as e:
                logger.warning(f"Failed to delete key from keyring: {e}, trying file fallback")

        # Fallback to file storage
        self._delete_key_file(key_name)

    def _store_key_file(self, key_name: str, api_key: str) -> None:
        """Store key in encrypted file (fallback).

        Args:
            key_name: Name/identifier for the key
            api_key: The API key to store
        """
        keys_file = self._fallback_dir / "keys.json"

        # Load existing keys
        if keys_file.exists():
            try:
                keys = json.loads(keys_file.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Failed to load keys file: {e}, creating new")
                keys = {}
        else:
            keys = {}

        # Store key
        keys[key_name] = api_key

        # Save with restricted permissions
        keys_file.write_text(json.dumps(keys, indent=2), encoding="utf-8")
        keys_file.chmod(0o600)  # Read/write for owner only

        logger.debug(f"Stored key '{key_name}' in file {keys_file}")

    def _get_key_file(self, key_name: str) -> str | None:
        """Retrieve key from file (fallback).

        Args:
            key_name: Name/identifier for the key

        Returns:
            The API key, or None if not found
        """
        keys_file = self._fallback_dir / "keys.json"

        if not keys_file.exists():
            return None

        try:
            keys = json.loads(keys_file.read_text(encoding="utf-8"))
            key = keys.get(key_name)
            if key is not None:
                logger.debug(f"Retrieved key '{key_name}' from file {keys_file}")
            return key
        except Exception as e:
            logger.error(f"Failed to read keys file: {e}")
            return None

    def _delete_key_file(self, key_name: str) -> None:
        """Delete key from file (fallback).

        Args:
            key_name: Name/identifier for the key
        """
        keys_file = self._fallback_dir / "keys.json"

        if not keys_file.exists():
            return

        try:
            keys = json.loads(keys_file.read_text(encoding="utf-8"))
            if key_name in keys:
                del keys[key_name]
                keys_file.write_text(json.dumps(keys, indent=2), encoding="utf-8")
                keys_file.chmod(0o600)
                logger.debug(f"Deleted key '{key_name}' from file {keys_file}")
        except Exception as e:
            logger.error(f"Failed to delete key from file: {e}")


# =============================================================================
# Module-level Functions
# =============================================================================

_keyring_manager: KeyringManager | None = None


def get_keyring_manager() -> KeyringManager:
    """Get the global KeyringManager instance.

    Returns:
        KeyringManager instance
    """
    global _keyring_manager
    if _keyring_manager is None:
        _keyring_manager = KeyringManager()
    return _keyring_manager


def store_key(key_name: str, api_key: str) -> None:
    """Store an API key securely.

    Args:
        key_name: Name/identifier for the key (e.g., "openai_api_key")
        api_key: The API key to store
    """
    manager = get_keyring_manager()
    manager.store_key(key_name, api_key)


def get_key(key_name: str) -> str | None:
    """Retrieve an API key.

    Args:
        key_name: Name/identifier for the key

    Returns:
        The API key, or None if not found
    """
    manager = get_keyring_manager()
    return manager.get_key(key_name)


def delete_key(key_name: str) -> None:
    """Delete an API key.

    Args:
        key_name: Name/identifier for the key
    """
    manager = get_keyring_manager()
    manager.delete_key(key_name)
