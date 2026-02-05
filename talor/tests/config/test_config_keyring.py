"""Tests for config integration with keyring."""

import json
import tempfile
from pathlib import Path

import pytest

from src.config import config
from src.config.keyring_manager import store_key, get_key


class TestConfigKeyringIntegration:
    """Test configuration loading with keyring API key references."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self):
        """Setup and teardown for each test."""
        # Clear cache before each test
        config.clear_cache()
        yield
        # Clear cache after each test
        config.clear_cache()

    async def test_load_api_key_from_keyring_ref(self):
        """Test loading API key from keyring reference."""
        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = Path(tmpdir)

            # Store API key in keyring
            store_key("openai_test_key", "sk-test-123456")

            # Create config file with api_key_ref
            config_file = workspace / "talor.json"
            config_data = {
                "provider": {
                    "openai": {
                        "api_key_ref": "keyring:openai_test_key"
                    }
                }
            }
            config_file.write_text(json.dumps(config_data))

            # Configure and load
            config.configure(workspace=workspace, worktree=workspace)
            cfg = await config.get()

            # Verify API key was loaded from keyring
            assert "provider" in cfg
            assert "openai" in cfg["provider"]
            assert cfg["provider"]["openai"]["api_key"] == "sk-test-123456"
            assert cfg["provider"]["openai"]["api_key_ref"] == "keyring:openai_test_key"

    async def test_api_key_ref_not_found(self):
        """Test handling when keyring key is not found."""
        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = Path(tmpdir)

            # Create config file with api_key_ref to non-existent key
            config_file = workspace / "talor.json"
            config_data = {
                "provider": {
                    "openai": {
                        "api_key_ref": "keyring:nonexistent_key"
                    }
                }
            }
            config_file.write_text(json.dumps(config_data))

            # Configure and load
            config.configure(workspace=workspace, worktree=workspace)
            cfg = await config.get()

            # Verify config loaded but API key is not set
            assert "provider" in cfg
            assert "openai" in cfg["provider"]
            assert "api_key" not in cfg["provider"]["openai"] or cfg["provider"]["openai"]["api_key"] is None

    async def test_invalid_api_key_ref_format(self):
        """Test handling invalid api_key_ref format."""
        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = Path(tmpdir)

            # Create config file with invalid api_key_ref format
            config_file = workspace / "talor.json"
            config_data = {
                "provider": {
                    "openai": {
                        "api_key_ref": "invalid_format"
                    }
                }
            }
            config_file.write_text(json.dumps(config_data))

            # Configure and load (should not crash)
            config.configure(workspace=workspace, worktree=workspace)
            cfg = await config.get()

            # Verify config loaded
            assert "provider" in cfg
            assert "openai" in cfg["provider"]

    async def test_multiple_providers_with_keyring(self):
        """Test multiple providers with keyring references."""
        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = Path(tmpdir)

            # Store multiple API keys
            store_key("openai_key", "sk-openai-123")
            store_key("anthropic_key", "sk-ant-456")

            # Create config file
            config_file = workspace / "talor.json"
            config_data = {
                "provider": {
                    "openai": {
                        "api_key_ref": "keyring:openai_key"
                    },
                    "anthropic": {
                        "api_key_ref": "keyring:anthropic_key"
                    }
                }
            }
            config_file.write_text(json.dumps(config_data))

            # Configure and load
            config.configure(workspace=workspace, worktree=workspace)
            cfg = await config.get()

            # Verify both API keys were loaded
            assert cfg["provider"]["openai"]["api_key"] == "sk-openai-123"
            assert cfg["provider"]["anthropic"]["api_key"] == "sk-ant-456"

    async def test_plaintext_api_key_still_works(self):
        """Test that plaintext API keys still work (backward compatibility)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = Path(tmpdir)

            # Create config file with plaintext API key
            config_file = workspace / "talor.json"
            config_data = {
                "provider": {
                    "openai": {
                        "api_key": "sk-plaintext-123"
                    }
                }
            }
            config_file.write_text(json.dumps(config_data))

            # Configure and load
            config.configure(workspace=workspace, worktree=workspace)
            cfg = await config.get()

            # Verify plaintext API key is preserved
            assert cfg["provider"]["openai"]["api_key"] == "sk-plaintext-123"

    async def test_api_key_ref_overrides_plaintext(self):
        """Test that api_key_ref takes precedence over plaintext api_key."""
        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = Path(tmpdir)

            # Store API key in keyring
            store_key("override_key", "sk-from-keyring")

            # Create config file with both api_key and api_key_ref
            config_file = workspace / "talor.json"
            config_data = {
                "provider": {
                    "openai": {
                        "api_key": "sk-plaintext",
                        "api_key_ref": "keyring:override_key"
                    }
                }
            }
            config_file.write_text(json.dumps(config_data))

            # Configure and load
            config.configure(workspace=workspace, worktree=workspace)
            cfg = await config.get()

            # Verify keyring value overrides plaintext
            assert cfg["provider"]["openai"]["api_key"] == "sk-from-keyring"
