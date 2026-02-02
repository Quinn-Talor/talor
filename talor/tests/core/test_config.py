"""Unit tests for the configuration management system.

Tests cover:
- Configuration loading from multiple sources
- Configuration priority (project > user > default)
- Configuration validation and error reporting
- JSON and YAML format support
- Configuration merging
- Get/set operations
"""

import json
import pytest
from pathlib import Path

import yaml

from src.core.config import (
    ConfigManager,
    Config,
    ProviderConfig,
    MCPServerConfig,
    PermissionConfig,
    LoggingConfig,
)
from src.core.errors import ConfigError


@pytest.fixture
def temp_workspace(tmp_path):
    """Create a temporary workspace directory."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    return workspace


@pytest.fixture
def temp_user_config(tmp_path, monkeypatch):
    """Create a temporary user config directory and patch the config path."""
    user_config_dir = tmp_path / "user_config" / "talor"
    user_config_dir.mkdir(parents=True)

    # Patch the _get_user_config_path method
    original_method = ConfigManager._get_user_config_path

    def patched_method(self):
        return user_config_dir / "config.yaml"

    monkeypatch.setattr(ConfigManager, "_get_user_config_path", patched_method)

    return user_config_dir


@pytest.mark.asyncio
async def test_load_default_config(temp_user_config):
    """Test loading default configuration when no config files exist."""
    manager = ConfigManager()
    config = await manager.load()

    assert isinstance(config, Config)
    assert isinstance(config.logging, LoggingConfig)
    assert config.logging.level == "INFO"
    assert isinstance(config.permissions, PermissionConfig)
    assert len(config.providers) == 0


@pytest.mark.asyncio
async def test_load_user_config_yaml(temp_user_config):
    """Test loading user configuration from YAML file."""
    # Create user config file
    user_config_path = temp_user_config / "config.yaml"
    user_config_data = {
        "logging": {
            "level": "DEBUG"
        },
        "providers": {
            "openai": {
                "api_key": "sk-test-key",
                "default_model": "gpt-4"
            }
        }
    }

    with open(user_config_path, "w") as f:
        yaml.dump(user_config_data, f)

    manager = ConfigManager()
    config = await manager.load()

    assert config.logging.level == "DEBUG"
    assert "openai" in config.providers
    assert config.providers["openai"].api_key == "sk-test-key"
    assert config.providers["openai"].default_model == "gpt-4"


@pytest.mark.asyncio
async def test_load_user_config_json(temp_user_config):
    """Test loading user configuration from JSON file."""
    # Create user config file with .json extension
    user_config_path = temp_user_config / "config.json"
    user_config_data = {
        "logging": {
            "level": "WARNING"
        },
        "ui": {
            "theme": "light",
            "font_size": 16
        }
    }

    with open(user_config_path, "w") as f:
        json.dump(user_config_data, f)

    # Patch to return JSON path
    original_method = ConfigManager._get_user_config_path
    ConfigManager._get_user_config_path = lambda self: user_config_path

    manager = ConfigManager()
    config = await manager.load()

    assert config.logging.level == "WARNING"
    assert config.ui.theme == "light"
    assert config.ui.font_size == 16

    # Restore original method
    ConfigManager._get_user_config_path = original_method


@pytest.mark.asyncio
async def test_load_project_config(temp_workspace, temp_user_config):
    """Test loading project configuration."""
    # Create project config directory
    project_config_dir = temp_workspace / ".talor"
    project_config_dir.mkdir()
    project_config_path = project_config_dir / "config.yaml"

    project_config_data = {
        "logging": {
            "level": "ERROR"
        },
        "mcp_servers": {
            "test_server": {
                "command": "test-mcp",
                "args": ["--port", "8080"]
            }
        }
    }

    with open(project_config_path, "w") as f:
        yaml.dump(project_config_data, f)

    manager = ConfigManager(workspace_path=str(temp_workspace))
    config = await manager.load()

    assert config.logging.level == "ERROR"
    assert "test_server" in config.mcp_servers
    assert config.mcp_servers["test_server"].command == "test-mcp"
    assert config.mcp_servers["test_server"].args == ["--port", "8080"]


@pytest.mark.asyncio
async def test_config_priority(temp_workspace, temp_user_config):
    """Test that project config overrides user config, which overrides defaults."""
    # Create user config
    user_config_path = temp_user_config / "config.yaml"
    user_config_data = {
        "logging": {
            "level": "DEBUG",
            "file_rotation": "2 days"
        },
        "ui": {
            "theme": "light"
        }
    }

    with open(user_config_path, "w") as f:
        yaml.dump(user_config_data, f)

    # Create project config
    project_config_dir = temp_workspace / ".talor"
    project_config_dir.mkdir()
    project_config_path = project_config_dir / "config.yaml"

    project_config_data = {
        "logging": {
            "level": "ERROR"  # Override user config
        }
    }

    with open(project_config_path, "w") as f:
        yaml.dump(project_config_data, f)

    manager = ConfigManager(workspace_path=str(temp_workspace))
    config = await manager.load()

    # Project config should override user config for level
    assert config.logging.level == "ERROR"
    # User config should be used for file_rotation (not in project config)
    assert config.logging.file_rotation == "2 days"
    # User config should be used for theme
    assert config.ui.theme == "light"


@pytest.mark.asyncio
async def test_get_config_value():
    """Test getting configuration values with dot notation."""
    manager = ConfigManager()
    await manager.load()

    # Get top-level value
    logging_config = manager.get("logging")
    assert isinstance(logging_config, LoggingConfig)

    # Get nested value
    level = manager.get("logging.level")
    assert level == "INFO"

    # Get with default
    missing = manager.get("nonexistent.key", default="default_value")
    assert missing == "default_value"


@pytest.mark.asyncio
async def test_set_config_value():
    """Test setting configuration values."""
    manager = ConfigManager()
    await manager.load()

    # Set nested value
    await manager.set("logging.level", "DEBUG")
    assert manager.get("logging.level") == "DEBUG"

    # Set top-level dict value
    await manager.set("providers", {
        "anthropic": ProviderConfig(api_key="test-key").model_dump()
    })
    assert "anthropic" in manager.get("providers")


@pytest.mark.asyncio
async def test_set_invalid_key():
    """Test that setting an invalid key raises ConfigError."""
    manager = ConfigManager()
    await manager.load()

    with pytest.raises(ConfigError) as exc_info:
        await manager.set("invalid.nested.key", "value")

    assert "Invalid configuration" in str(exc_info.value)


@pytest.mark.asyncio
async def test_set_invalid_value():
    """Test that setting an invalid value raises ConfigError."""
    manager = ConfigManager()
    await manager.load()

    # Try to set invalid log level
    with pytest.raises(ConfigError) as exc_info:
        await manager.set("logging.level", "INVALID_LEVEL")

    assert "validation failed" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_save_user_config(temp_user_config):
    """Test saving configuration to user config file."""
    manager = ConfigManager()
    await manager.load()

    await manager.set("logging.level", "WARNING")
    await manager.save(target="user")

    # Verify file was created
    user_config_path = temp_user_config / "config.yaml"
    assert user_config_path.exists()

    # Verify content
    with open(user_config_path, "r") as f:
        saved_data = yaml.safe_load(f)

    assert saved_data["logging"]["level"] == "WARNING"


@pytest.mark.asyncio
async def test_save_project_config(temp_workspace, temp_user_config):
    """Test saving configuration to project config file."""
    manager = ConfigManager(workspace_path=str(temp_workspace))
    await manager.load()

    await manager.set("logging.level", "ERROR")
    await manager.save(target="project")

    # Verify file was created
    project_config_path = temp_workspace / ".talor" / "config.yaml"
    assert project_config_path.exists()

    # Verify content
    with open(project_config_path, "r") as f:
        saved_data = yaml.safe_load(f)

    assert saved_data["logging"]["level"] == "ERROR"


@pytest.mark.asyncio
async def test_save_without_workspace():
    """Test that saving project config without workspace raises error."""
    manager = ConfigManager()
    await manager.load()

    with pytest.raises(ConfigError) as exc_info:
        await manager.save(target="project")

    assert "no workspace path" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_reload_config(temp_user_config):
    """Test reloading configuration after file changes."""
    # Create initial config
    user_config_path = temp_user_config / "config.yaml"
    initial_data = {"logging": {"level": "INFO"}}

    with open(user_config_path, "w") as f:
        yaml.dump(initial_data, f)

    manager = ConfigManager()
    await manager.load()
    assert manager.get("logging.level") == "INFO"

    # Modify config file
    updated_data = {"logging": {"level": "DEBUG"}}
    with open(user_config_path, "w") as f:
        yaml.dump(updated_data, f)

    # Reload
    await manager.reload()
    assert manager.get("logging.level") == "DEBUG"


@pytest.mark.asyncio
async def test_invalid_yaml_config(temp_user_config):
    """Test that invalid YAML raises ConfigError."""
    user_config_path = temp_user_config / "config.yaml"

    # Write invalid YAML
    with open(user_config_path, "w") as f:
        f.write("invalid: yaml: content: [")

    manager = ConfigManager()

    # Should load with warning, using defaults
    config = await manager.load()
    assert config.logging.level == "INFO"  # Default value


@pytest.mark.asyncio
async def test_invalid_json_config(temp_user_config):
    """Test that invalid JSON raises ConfigError."""
    user_config_path = temp_user_config / "config.json"

    # Write invalid JSON
    with open(user_config_path, "w") as f:
        f.write('{"invalid": json}')

    # Patch to return JSON path
    original_method = ConfigManager._get_user_config_path
    ConfigManager._get_user_config_path = lambda self: user_config_path

    manager = ConfigManager()

    # Should load with warning, using defaults
    config = await manager.load()
    assert config.logging.level == "INFO"  # Default value

    # Restore
    ConfigManager._get_user_config_path = original_method


@pytest.mark.asyncio
async def test_validation_error_on_load(temp_user_config):
    """Test that validation errors are reported with details."""
    user_config_path = temp_user_config / "config.yaml"

    # Create config with invalid data
    invalid_data = {
        "logging": {
            "level": "INVALID_LEVEL"  # Not a valid log level
        }
    }

    with open(user_config_path, "w") as f:
        yaml.dump(invalid_data, f)

    manager = ConfigManager()

    with pytest.raises(ConfigError) as exc_info:
        await manager.load()

    assert "validation failed" in str(exc_info.value).lower()
    assert "errors" in exc_info.value.context


@pytest.mark.asyncio
async def test_merge_nested_configs():
    """Test that nested configurations are merged correctly."""
    manager = ConfigManager()

    base = {
        "logging": {
            "level": "INFO",
            "file_rotation": "1 day"
        },
        "ui": {
            "theme": "dark"
        }
    }

    override = {
        "logging": {
            "level": "DEBUG"  # Override this
            # file_rotation should remain from base
        },
        "storage": {
            "backup_enabled": False  # New key
        }
    }

    merged = manager._merge_configs(base, override)

    assert merged["logging"]["level"] == "DEBUG"
    assert merged["logging"]["file_rotation"] == "1 day"
    assert merged["ui"]["theme"] == "dark"
    assert merged["storage"]["backup_enabled"] is False


@pytest.mark.asyncio
async def test_provider_config_validation():
    """Test that provider configuration is validated correctly."""
    manager = ConfigManager()
    await manager.load()

    # Valid provider config
    await manager.set("providers", {
        "openai": {
            "api_key": "sk-test",
            "base_url": "https://api.openai.com",
            "default_model": "gpt-4"
        }
    })

    providers = manager.get("providers")
    assert "openai" in providers
    assert providers["openai"].api_key == "sk-test"


@pytest.mark.asyncio
async def test_mcp_server_config_validation():
    """Test that MCP server configuration is validated correctly."""
    manager = ConfigManager()
    await manager.load()

    # Valid MCP server config
    await manager.set("mcp_servers", {
        "test_server": {
            "command": "mcp-server",
            "args": ["--port", "8080"],
            "env": {"DEBUG": "true"},
            "transport": "stdio"
        }
    })

    servers = manager.get("mcp_servers")
    assert "test_server" in servers
    assert servers["test_server"].command == "mcp-server"
    assert servers["test_server"].transport == "stdio"


@pytest.mark.asyncio
async def test_permission_config_defaults(temp_user_config):
    """Test that permission configuration has correct defaults."""
    manager = ConfigManager()
    config = await manager.load()

    assert isinstance(config.permissions, PermissionConfig)
    assert len(config.permissions.rules) == 0
    assert "delete_file" in config.permissions.dangerous_operations
    assert "write_file" in config.permissions.dangerous_operations
    assert "execute_command" in config.permissions.dangerous_operations


@pytest.mark.asyncio
async def test_get_before_load():
    """Test that get returns default when config not loaded."""
    manager = ConfigManager()

    # Should return default without raising error
    value = manager.get("logging.level", default="DEFAULT")
    assert value == "DEFAULT"


@pytest.mark.asyncio
async def test_set_before_load():
    """Test that set raises error when config not loaded."""
    manager = ConfigManager()

    with pytest.raises(ConfigError) as exc_info:
        await manager.set("logging.level", "DEBUG")

    assert "not loaded" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_save_before_load():
    """Test that save raises error when config not loaded."""
    manager = ConfigManager()

    with pytest.raises(ConfigError) as exc_info:
        await manager.save()

    assert "not loaded" in str(exc_info.value).lower()
