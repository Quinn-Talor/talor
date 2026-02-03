"""Tests for plugin configuration."""

import pytest
from pathlib import Path
import json

from src.config.config import Config
from src.plugin.manager import PluginManager
from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult


class MockPlugin(PromptPlugin):
    """Mock plugin for testing."""

    def __init__(self, name: str = "mock", priority: int = 500):
        super().__init__(name, priority, True, False)

    async def build(self, context: PluginContext) -> PluginResult:
        return PluginResult(content="mock", section="system")


class TestPluginConfig:
    """Tests for plugin configuration."""

    @pytest.fixture
    def config_dir(self, tmp_path):
        """Create a temporary config directory."""
        config_dir = tmp_path / ".talor"
        config_dir.mkdir()
        return config_dir

    @pytest.mark.asyncio
    async def test_get_plugin_config_empty(self, tmp_path, config_dir):
        """Test getting plugin config when empty."""
        Config.configure(directory=tmp_path, worktree=tmp_path)
        Config.clear_cache()

        config = await Config.get_plugin_config()

        assert config["builtin"] == {}
        assert config["custom"] == []
        assert config["options"] == {}

    @pytest.mark.asyncio
    async def test_get_plugin_config_with_builtin(self, tmp_path, config_dir):
        """Test getting plugin config with built-in overrides."""
        config_file = config_dir / "config.json"
        config_file.write_text(json.dumps({
            "plugins": {
                "builtin": {
                    "system": {"enabled": True},
                    "skill": {"enabled": False},
                }
            }
        }))

        Config.configure(directory=tmp_path, worktree=tmp_path)
        Config.clear_cache()

        config = await Config.get_plugin_config()

        assert "system" in config["builtin"]
        assert config["builtin"]["system"]["enabled"] is True
        assert config["builtin"]["skill"]["enabled"] is False

    @pytest.mark.asyncio
    async def test_get_builtin_plugin_config(self, tmp_path, config_dir):
        """Test getting specific plugin config."""
        config_file = config_dir / "config.json"
        config_file.write_text(json.dumps({
            "plugins": {
                "builtin": {
                    "system": {
                        "enabled": True,
                        "priority": 50,
                        "options": {"custom_prompt": "Hello"}
                    }
                }
            }
        }))

        Config.configure(directory=tmp_path, worktree=tmp_path)
        Config.clear_cache()

        config = await Config.get_builtin_plugin_config("system")

        assert config is not None
        assert config["enabled"] is True
        assert config["priority"] == 50

    @pytest.mark.asyncio
    async def test_is_plugin_enabled_default(self, tmp_path, config_dir):
        """Test plugin enabled check with default."""
        Config.configure(directory=tmp_path, worktree=tmp_path)
        Config.clear_cache()

        # Not configured = enabled by default
        enabled = await Config.is_plugin_enabled("system")
        assert enabled is True

    @pytest.mark.asyncio
    async def test_is_plugin_enabled_disabled(self, tmp_path, config_dir):
        """Test plugin enabled check when disabled."""
        config_file = config_dir / "config.json"
        config_file.write_text(json.dumps({
            "plugins": {
                "builtin": {
                    "skill": {"enabled": False}
                }
            }
        }))

        Config.configure(directory=tmp_path, worktree=tmp_path)
        Config.clear_cache()

        enabled = await Config.is_plugin_enabled("skill")
        assert enabled is False

    @pytest.mark.asyncio
    async def test_legacy_plugin_paths_merged(self, tmp_path, config_dir):
        """Test that legacy plugin paths are merged."""
        config_file = config_dir / "config.json"
        config_file.write_text(json.dumps({
            "plugin": ["/path/to/legacy/plugin"],
            "plugins": {
                "custom": ["/path/to/new/plugin"]
            }
        }))

        Config.configure(directory=tmp_path, worktree=tmp_path)
        Config.clear_cache()

        config = await Config.get_plugin_config()

        assert "/path/to/legacy/plugin" in config["custom"]
        assert "/path/to/new/plugin" in config["custom"]


class TestPluginManagerConfig:
    """Tests for PluginManager configuration."""

    @pytest.mark.asyncio
    async def test_apply_config(self):
        """Test applying configuration to plugins."""
        manager = PluginManager()
        await manager.register(MockPlugin("plugin1", 100))
        await manager.register(MockPlugin("plugin2", 200))

        config = {
            "builtin": {
                "plugin1": {"enabled": False},
                "plugin2": {"priority": 50},
            }
        }

        await manager.apply_config(config)

        plugin1 = await manager.get("plugin1")
        plugin2 = await manager.get("plugin2")

        assert plugin1.enabled is False
        assert plugin2.priority == 50

    @pytest.mark.asyncio
    async def test_reload_config(self, tmp_path):
        """Test reloading configuration."""
        config_dir = tmp_path / ".talor"
        config_dir.mkdir()
        config_file = config_dir / "config.json"
        config_file.write_text(json.dumps({
            "plugins": {
                "builtin": {
                    "mock": {"enabled": False}
                }
            }
        }))

        Config.configure(directory=tmp_path, worktree=tmp_path)
        Config.clear_cache()

        manager = PluginManager()
        await manager.register(MockPlugin("mock", 100))

        await manager.reload_config()

        plugin = await manager.get("mock")
        assert plugin.enabled is False
