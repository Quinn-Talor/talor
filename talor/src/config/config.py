"""Configuration Management for Talor.

This module provides configuration management with layered loading.

Features:
- Layered configuration loading
- JSONC format support
- Configuration merging
- Directory discovery
- Module-level async functions (replacing ConfigService)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, TYPE_CHECKING

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from src.bus import Bus


logger = logging.getLogger(__name__)


# =============================================================================
# Configuration Schema
# =============================================================================

class MCPServerConfig(BaseModel):
    """MCP server configuration."""
    command: str
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    disabled: bool = False
    auto_approve: list[str] = Field(default_factory=list)


class ProviderConfig(BaseModel):
    """Provider configuration.

    Matches the structure expected by provider.py for full provider loading.
    """
    name: str | None = None
    api_key_env: str | None = None
    base_url: str | None = None
    auto_discover: bool = False
    models: list[dict[str, Any]] = Field(default_factory=list)


class PluginItemConfig(BaseModel):
    """Single plugin configuration.

    Used for both built-in and custom plugins in k-v structure.
    """
    # Whether the plugin is enabled (default True for builtin)
    enabled: bool = True

    # Priority override (optional)
    priority: int | None = None

    # Path to custom plugin file (only for custom plugins)
    path: str | None = None


class ConfigInfo(BaseModel):
    """Full configuration schema.

    Defines all configuration options for Talor.
    """

    # Schema version
    schema_version: str = Field(default="1.0.0", alias="$schema")

    # Default settings
    default_agent: str | None = None
    default_model: str | None = None

    # Agent configurations
    agent: dict[str, dict[str, Any]] = Field(default_factory=dict)

    # Provider configurations (new key)
    providers: dict[str, ProviderConfig] = Field(default_factory=dict)

    # MCP server configurations
    mcp: dict[str, MCPServerConfig] = Field(default_factory=dict)

    # Permission overrides
    permission: dict[str, Any] = Field(default_factory=dict)

    # Plugin paths (legacy, use plugins instead)
    plugin: list[str] = Field(default_factory=list)

    # Plugins configuration (k-v structure)
    # Format: {"plugin_name": {"enabled": bool, "priority": int, "path": str}}
    plugins: dict[str, PluginItemConfig] = Field(default_factory=dict)

    # Workspace directories (security feature)
    workspace: list[str] = Field(default_factory=list)

    # Instruction files
    instructions: list[str] = Field(default_factory=list)

    # Keybinds
    keybinds: dict[str, str] = Field(default_factory=dict)

    # Experimental features
    experimental: dict[str, Any] = Field(default_factory=dict)

    # Username for telemetry
    username: str | None = None

    class Config:
        populate_by_name = True


# =============================================================================
# JSONC Parser
# =============================================================================

def parse_jsonc(content: str) -> dict[str, Any]:
    """Parse JSONC (JSON with comments) content.

    Args:
        content: JSONC string

    Returns:
        Parsed dictionary
    """
    # Remove single-line comments
    content = re.sub(r'(?<!:)//.*$', '', content, flags=re.MULTILINE)
    # Remove multi-line comments
    content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
    # Remove trailing commas
    content = re.sub(r',(\s*[}\]])', r'\1', content)

    return json.loads(content)


# =============================================================================
# Default Configuration
# =============================================================================

DEFAULT_CONFIG: dict[str, Any] = {
    "default_model": "ollama/deepseek-v3.1:671b-cloud",
    "default_agent": "build",
    "providers": {},
    "agent": {},
    "mcp": {},
    "workspace": [],
}


# =============================================================================
# Module-level State
# =============================================================================

_workspace: Path = Path(".")
_worktree: Path = Path(".")
_bus: Any = None
_cache: dict[str, Any] | None = None
_global_path: Path | None = None
_lock = asyncio.Lock()


def configure(
    workspace: Path | str | None = None,
    worktree: Path | str | None = None,
    bus: Any = None,
    global_path: Path | str | None = None,
) -> None:
    """Configure the config module.

    Args:
        workspace: Working directory
        worktree: Project worktree root
        bus: Bus instance for events
        global_path: Global config directory
    """
    global _workspace, _worktree, _bus, _cache, _global_path

    if workspace is not None:
        _workspace = Path(workspace)
    if worktree is not None:
        _worktree = Path(worktree)
    else:
        _worktree = _workspace
    if bus is not None:
        _bus = bus
    if global_path is not None:
        _global_path = Path(global_path)
    # Clear cache when configuration changes
    _cache = None


def clear_cache() -> None:
    """Clear configuration cache (for testing)."""
    global _cache
    _cache = None


# =============================================================================
# Module-level Functions (replacing ConfigService)
# =============================================================================

async def get() -> dict[str, Any]:
    """Get merged configuration.

    Returns:
        Merged configuration dictionary
    """
    global _cache

    if _cache is not None:
        return _cache

    async with _lock:
        # Double-check after acquiring lock
        if _cache is not None:
            return _cache

        result: dict[str, Any] = dict(DEFAULT_CONFIG)

        # 1. Load global config (lowest precedence)
        global_config = await _load_global()
        result = _merge_config(result, global_config)

        # 2. Load project config (higher precedence)
        project_config = await _load_project()
        result = _merge_config(result, project_config)

        # 3. Load from environment variable (highest precedence)
        env_config = _load_env()
        result = _merge_config(result, env_config)

        # Set defaults
        result.setdefault("agent", {})
        result.setdefault("providers", {})
        result.setdefault("mcp", {})
        result.setdefault("permission", {})
        result.setdefault("plugin", [])
        result.setdefault("plugins", {})
        result.setdefault("instructions", [])
        result.setdefault("keybinds", {})
        result.setdefault("experimental", {})
        result.setdefault("workspace", [])

        # Resolve API key references from keyring
        _resolve_api_keys(result)

        # Initialize workspace module with configured directories
        workspace_dirs = result.get("workspace", [])
        if workspace_dirs:
            from src.core import workspace
            workspace.configure(workspace_dirs)
            logger.info(f"Initialized workspace with {len(workspace_dirs)} directories")
        else:
            # No workspace configured - backward compatibility mode
            logger.debug("No workspace directories configured, workspace restrictions disabled")

        _cache = result
        return result


async def reload() -> dict[str, Any]:
    """Reload configuration from files.

    Returns:
        Reloaded configuration dict
    """
    global _cache

    async with _lock:
        _cache = None

    config = await get()

    if _bus:
        from src.bus.events import ConfigChanged, ConfigChangedData
        await _bus.publish(ConfigChanged, ConfigChangedData(path="*", source="reload"))

    logger.info("Configuration reloaded")
    return config


async def set_value(key: str, value: Any, scope: str = "project") -> None:
    """Set a configuration value.

    Args:
        key: Configuration key (dot-separated for nested)
        value: Value to set
        scope: "global" or "project"
    """
    global _cache

    # Determine config file path
    if scope == "global":
        config_dir = _global_path or Path.home() / ".talor"
        config_path = config_dir / "talor.json"
    else:
        config_dir = _worktree / ".talor"
        config_path = config_dir / "config.json"

    # Ensure directory exists
    config_dir.mkdir(parents=True, exist_ok=True)

    # Load existing config
    if config_path.exists():
        config = _load_file(config_path)
    else:
        config = {}

    # Set value (support dot notation)
    keys = key.split(".")
    current = config
    for k in keys[:-1]:
        if k not in current:
            current[k] = {}
        current = current[k]
    current[keys[-1]] = value

    # Save config
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

    # Clear cache
    _cache = None

    # Publish event
    if _bus:
        from src.bus.events import ConfigChanged, ConfigChangedData
        await _bus.publish(
            ConfigChanged,
            ConfigChangedData(path=str(config_path), source=scope)
        )


async def directories() -> list[Path]:
    """Get configuration directories.

    Returns directories that may contain config files, plugins, etc.

    Returns:
        List of directory paths
    """
    dirs = []

    # Global config directory
    global_dir = _global_path or Path.home() / ".talor"
    if global_dir.exists():
        dirs.append(global_dir)

    # Project .talor directory
    project_dir = _worktree / ".talor"
    if project_dir.exists():
        dirs.append(project_dir)

    # Current directory .talor
    if _workspace != _worktree:
        current_dir = _workspace / ".talor"
        if current_dir.exists():
            dirs.append(current_dir)

    return dirs


async def get_plugin_config() -> dict[str, Any]:
    """Get plugin configuration.

    Returns:
        Plugin configuration dictionary in k-v format:
        {"plugin_name": {"enabled": bool, "priority": int, "path": str}}
    """
    config = await get()

    # Get plugins section (k-v structure)
    plugins = config.get("plugins", {})

    # Merge legacy plugin paths as custom plugins
    legacy_plugins = config.get("plugin", [])
    for path in legacy_plugins:
        # Extract plugin name from path
        from pathlib import Path
        name = Path(path).stem
        if name not in plugins:
            plugins[name] = {"enabled": True, "path": path}

    return plugins


async def get_builtin_plugin_config(plugin_name: str) -> dict[str, Any] | None:
    """Get configuration for a specific plugin.

    Args:
        plugin_name: Plugin name (e.g., "system", "agent", "skill")

    Returns:
        Plugin configuration or None if not configured
    """
    plugin_config = await get_plugin_config()
    return plugin_config.get(plugin_name)


async def is_plugin_enabled(plugin_name: str) -> bool:
    """Check if a plugin is enabled.

    Args:
        plugin_name: Plugin name

    Returns:
        True if enabled (default), False if explicitly disabled
    """
    config = await get_builtin_plugin_config(plugin_name)
    if config is None:
        return True  # Enabled by default
    return config.get("enabled", True)


# =============================================================================
# Internal Functions
# =============================================================================

async def _load_global() -> dict[str, Any]:
    """Load global configuration."""
    global_dir = _global_path or Path.home() / ".talor"

    for filename in ["talor.jsonc", "talor.json"]:
        config_path = global_dir / filename
        if config_path.exists():
            try:
                return _load_file(config_path)
            except Exception as e:
                logger.warning(f"Failed to load global config {config_path}: {e}")

    return {}


async def _load_project() -> dict[str, Any]:
    """Load project configuration."""
    result: dict[str, Any] = {}

    # Search for config files
    search_dirs = [_workspace]
    if _worktree != _workspace:
        search_dirs.append(_worktree)

    # Config file patterns to search
    config_patterns = [
        "config.json",
        "config.jsonc",
        "talor.jsonc",
        "talor.json",
        "talor-config.jsonc",
        "talor-config.json",
        ".talor/config.jsonc",
        ".talor/config.json",
    ]

    for search_dir in search_dirs:
        for filename in config_patterns:
            config_path = search_dir / filename
            if config_path.exists():
                try:
                    file_config = _load_file(config_path)
                    result = _merge_config(result, file_config)
                    logger.info(f"Loaded config from {config_path}")
                except Exception as e:
                    logger.warning(f"Failed to load project config {config_path}: {e}")

    return result


def _load_env() -> dict[str, Any]:
    """Load configuration from environment variables."""
    result: dict[str, Any] = {}

    # TALOR_CONFIG_CONTENT - inline JSON config
    config_content = os.environ.get("TALOR_CONFIG_CONTENT")
    if config_content:
        try:
            result = json.loads(config_content)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse TALOR_CONFIG_CONTENT: {e}")

    # Individual environment variables
    if os.environ.get("TALOR_DEFAULT_AGENT"):
        result["default_agent"] = os.environ["TALOR_DEFAULT_AGENT"]

    if os.environ.get("TALOR_DEFAULT_MODEL"):
        result["default_model"] = os.environ["TALOR_DEFAULT_MODEL"]

    return result


def _load_file(path: Path) -> dict[str, Any]:
    """Load configuration from a file.

    Args:
        path: Path to config file

    Returns:
        Configuration dictionary
    """
    content = path.read_text(encoding="utf-8")

    if path.suffix in [".jsonc", ".json"]:
        return parse_jsonc(content)
    else:
        return {}


def _merge_config(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Merge two configuration dictionaries.

    Args:
        base: Base configuration
        override: Override configuration

    Returns:
        Merged configuration
    """
    result = base.copy()

    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _merge_config(result[key], value)
        elif key in result and isinstance(result[key], list) and isinstance(value, list):
            # Concatenate lists and deduplicate
            result[key] = list(dict.fromkeys(result[key] + value))
        else:
            result[key] = value

    return result


def _resolve_api_keys(config: dict[str, Any]) -> None:
    """Resolve API key references from keyring.

    Looks for api_key_ref fields in provider configs and loads the actual
    API keys from the system keyring.

    Args:
        config: Configuration dictionary (modified in place)
    """
    providers = config.get("providers", {})
    if not providers:
        return

    from src.config.keyring_manager import get_key

    for provider_name, provider_config in providers.items():
        if not isinstance(provider_config, dict):
            continue

        # Check for api_key_ref
        api_key_ref = provider_config.get("api_key_ref")
        if not api_key_ref:
            continue

        # Parse reference format: "keyring:key_name"
        if not api_key_ref.startswith("keyring:"):
            logger.warning(
                f"Invalid api_key_ref format for provider '{provider_name}': {api_key_ref}. "
                "Expected format: 'keyring:key_name'"
            )
            continue

        key_name = api_key_ref[8:]  # Remove "keyring:" prefix

        # Load from keyring
        try:
            api_key = get_key(key_name)
            if api_key:
                provider_config["api_key"] = api_key
                logger.debug(f"Loaded API key for provider '{provider_name}' from keyring")
            else:
                logger.warning(
                    f"API key '{key_name}' not found in keyring for provider '{provider_name}'"
                )
        except Exception as e:
            logger.error(
                f"Failed to load API key for provider '{provider_name}' from keyring: {e}"
            )


# =============================================================================
# Legacy Config Class (for backward compatibility)
# =============================================================================

class Config:
    """Configuration management namespace.

    DEPRECATED: Use module-level functions instead.
    This class is kept for backward compatibility during migration.
    """

    @classmethod
    def configure(
        cls,
        bus: Any | None = None,
        directory: Path | str = ".",
        worktree: Path | str | None = None,
        global_path: Path | str | None = None,
    ) -> None:
        """Configure the config system.

        DEPRECATED: Use module-level configure() instead.
        """
        configure(
            workspace=directory,
            worktree=worktree,
            bus=bus,
            global_path=global_path,
        )

    @classmethod
    async def get(cls) -> dict[str, Any]:
        """Get merged configuration.

        DEPRECATED: Use module-level get() instead.
        """
        return await get()

    @classmethod
    async def directories(cls) -> list[Path]:
        """Get configuration directories.

        DEPRECATED: Use module-level directories() instead.
        """
        return await directories()

    @classmethod
    async def set(cls, key: str, value: Any, scope: str = "project") -> None:
        """Set a configuration value.

        DEPRECATED: Use module-level set_value() instead.
        """
        await set_value(key, value, scope)

    @classmethod
    def clear_cache(cls) -> None:
        """Clear configuration cache.

        DEPRECATED: Use module-level clear_cache() instead.
        """
        clear_cache()

    @classmethod
    async def get_plugin_config(cls) -> dict[str, Any]:
        """Get plugin configuration.

        DEPRECATED: Use module-level get_plugin_config() instead.
        """
        return await get_plugin_config()

    @classmethod
    async def get_builtin_plugin_config(cls, plugin_name: str) -> dict[str, Any] | None:
        """Get configuration for a specific built-in plugin.

        DEPRECATED: Use module-level get_builtin_plugin_config() instead.
        """
        return await get_builtin_plugin_config(plugin_name)

    @classmethod
    async def is_plugin_enabled(cls, plugin_name: str) -> bool:
        """Check if a plugin is enabled.

        DEPRECATED: Use module-level is_plugin_enabled() instead.
        """
        return await is_plugin_enabled(plugin_name)


# =============================================================================
# Legacy ConfigService Class (for backward compatibility)
# =============================================================================

class ConfigService:
    """Application service for configuration management.

    DEPRECATED: Use module-level functions instead.
    This class is kept for backward compatibility during migration.

    Example (deprecated):
        ```python
        service = ConfigService(directory=Path("/workspace"))
        config = await service.get()
        await service.set("default_model", "openai/gpt-4")
        ```

    New code should use:
        ```python
        from src.config import config
        config.configure(workspace=Path("/workspace"))
        cfg = await config.get()
        await config.set_value("default_model", "openai/gpt-4")
        ```
    """

    def __init__(
        self,
        directory: Path | None = None,
        worktree: Path | None = None,
        bus: Any = None,
    ) -> None:
        """Initialize service.

        Args:
            directory: Workspace directory
            worktree: Working tree directory
            bus: Event bus for publishing config changes
        """
        # Configure the module-level state
        configure(
            workspace=directory,
            worktree=worktree,
            bus=bus,
        )

    def clear_cache(self) -> None:
        """Clear config cache."""
        clear_cache()

    async def get(self) -> dict[str, Any]:
        """Get merged configuration.

        Returns:
            Merged configuration dict
        """
        return await get()

    async def reload(self) -> dict[str, Any]:
        """Reload configuration from files.

        Returns:
            Reloaded configuration dict
        """
        return await reload()

    async def set(self, key: str, value: Any) -> None:
        """Set a configuration value.

        Args:
            key: Configuration key (dot-separated for nested)
            value: Value to set
        """
        await set_value(key, value, scope="project")
