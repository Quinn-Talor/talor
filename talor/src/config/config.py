"""Configuration Management for Talor.

This module provides configuration management with layered loading.

Features:
- Layered configuration loading
- JSONC format support
- Configuration merging
- Directory discovery
"""

from __future__ import annotations

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
    """Provider configuration."""
    api_key: str | None = None
    base_url: str | None = None
    options: dict[str, Any] = Field(default_factory=dict)


class PluginConfig(BaseModel):
    """Plugin configuration.

    Supports both built-in and custom plugins.
    """
    # Plugin name (for built-in) or path (for custom)
    name: str

    # Whether the plugin is enabled
    enabled: bool = True

    # Plugin-specific options
    options: dict[str, Any] = Field(default_factory=dict)

    # Priority override (optional)
    priority: int | None = None


class PluginsConfig(BaseModel):
    """Plugins section configuration."""
    # Built-in plugin overrides
    builtin: dict[str, PluginConfig] = Field(default_factory=dict)

    # Custom plugin paths
    custom: list[str] = Field(default_factory=list)

    # Global plugin options
    options: dict[str, Any] = Field(default_factory=dict)


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

    # Provider configurations
    provider: dict[str, ProviderConfig] = Field(default_factory=dict)

    # MCP server configurations
    mcp: dict[str, MCPServerConfig] = Field(default_factory=dict)

    # Permission overrides
    permission: dict[str, Any] = Field(default_factory=dict)

    # Plugin paths (legacy, use plugins.custom instead)
    plugin: list[str] = Field(default_factory=list)

    # Plugins configuration (new)
    plugins: PluginsConfig = Field(default_factory=PluginsConfig)

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
# Config Namespace
# =============================================================================

class Config:
    """Configuration management namespace.

    Provides methods for loading and managing configuration.
    """

    # Class-level state
    _bus: Any | None = None
    _directory: Path = Path(".")
    _worktree: Path = Path(".")
    _cache: dict[str, Any] | None = None
    _global_path: Path | None = None

    @classmethod
    def configure(
        cls,
        bus: Any | None = None,
        directory: Path | str = ".",
        worktree: Path | str | None = None,
        global_path: Path | str | None = None,
    ) -> None:
        """Configure the config system.

        Args:
            bus: Bus instance for events
            directory: Working directory
            worktree: Project worktree root
            global_path: Global config directory
        """
        cls._bus = bus
        cls._directory = Path(directory)
        cls._worktree = Path(worktree) if worktree else cls._directory
        cls._global_path = Path(global_path) if global_path else None
        cls._cache = None

    @classmethod
    async def get(cls) -> dict[str, Any]:
        """Get merged configuration.

        Returns:
            Merged configuration dictionary
        """
        if cls._cache is not None:
            return cls._cache

        result: dict[str, Any] = {}

        # 1. Load global config (lowest precedence)
        global_config = await cls._load_global()
        result = cls._merge_config(result, global_config)

        # 2. Load project config (higher precedence)
        project_config = await cls._load_project()
        result = cls._merge_config(result, project_config)

        # 3. Load from environment variable (highest precedence)
        env_config = cls._load_env()
        result = cls._merge_config(result, env_config)

        # Set defaults
        result.setdefault("agent", {})
        result.setdefault("provider", {})
        result.setdefault("mcp", {})
        result.setdefault("permission", {})
        result.setdefault("plugin", [])
        result.setdefault("plugins", {"builtin": {}, "custom": [], "options": {}})
        result.setdefault("instructions", [])
        result.setdefault("keybinds", {})
        result.setdefault("experimental", {})

        cls._cache = result
        return result

    @classmethod
    async def _load_global(cls) -> dict[str, Any]:
        """Load global configuration."""
        global_dir = cls._global_path or Path.home() / ".talor"

        for filename in ["talor.jsonc", "talor.json", "config.yaml", "config.yml"]:
            config_path = global_dir / filename
            if config_path.exists():
                try:
                    return cls._load_file(config_path)
                except Exception as e:
                    logger.warning(f"Failed to load global config {config_path}: {e}")

        return {}

    @classmethod
    async def _load_project(cls) -> dict[str, Any]:
        """Load project configuration."""
        result: dict[str, Any] = {}

        # Search for config files
        search_dirs = [cls._directory]
        if cls._worktree != cls._directory:
            search_dirs.append(cls._worktree)

        # Config file patterns to search
        config_patterns = [
            "talor.jsonc",
            "talor.json",
            "talor-config.jsonc",
            "talor-config.json",
            "talor-config.yaml",
            "talor-config.yml",
            ".talor/config.jsonc",
            ".talor/config.json",
            ".talor/config.yaml",
            ".talor/config.yml",
        ]

        for search_dir in search_dirs:
            for filename in config_patterns:
                config_path = search_dir / filename
                if config_path.exists():
                    try:
                        file_config = cls._load_file(config_path)
                        result = cls._merge_config(result, file_config)
                        logger.info(f"Loaded config from {config_path}")
                    except Exception as e:
                        logger.warning(f"Failed to load project config {config_path}: {e}")

        return result

    @classmethod
    def _load_env(cls) -> dict[str, Any]:
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

    @classmethod
    def _load_file(cls, path: Path) -> dict[str, Any]:
        """Load configuration from a file.

        Args:
            path: Path to config file

        Returns:
            Configuration dictionary
        """
        content = path.read_text(encoding="utf-8")

        if path.suffix in [".jsonc", ".json"]:
            return parse_jsonc(content)
        elif path.suffix in [".yaml", ".yml"]:
            try:
                import yaml
                return yaml.safe_load(content) or {}
            except ImportError:
                logger.warning("PyYAML not installed, skipping YAML config")
                return {}
        else:
            return {}

    @classmethod
    def _merge_config(cls, base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
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
                result[key] = cls._merge_config(result[key], value)
            elif key in result and isinstance(result[key], list) and isinstance(value, list):
                # Concatenate lists and deduplicate
                result[key] = list(dict.fromkeys(result[key] + value))
            else:
                result[key] = value

        return result

    @classmethod
    async def directories(cls) -> list[Path]:
        """Get configuration directories.

        Returns directories that may contain config files, plugins, etc.

        Returns:
            List of directory paths
        """
        dirs = []

        # Global config directory
        global_dir = cls._global_path or Path.home() / ".talor"
        if global_dir.exists():
            dirs.append(global_dir)

        # Project .talor directory
        project_dir = cls._worktree / ".talor"
        if project_dir.exists():
            dirs.append(project_dir)

        # Current directory .talor
        if cls._directory != cls._worktree:
            current_dir = cls._directory / ".talor"
            if current_dir.exists():
                dirs.append(current_dir)

        return dirs

    @classmethod
    async def set(cls, key: str, value: Any, scope: str = "project") -> None:
        """Set a configuration value.

        Args:
            key: Configuration key (dot-separated for nested)
            value: Value to set
            scope: "global" or "project"
        """
        # Determine config file path
        if scope == "global":
            config_dir = cls._global_path or Path.home() / ".talor"
            config_path = config_dir / "talor.json"
        else:
            config_dir = cls._worktree / ".talor"
            config_path = config_dir / "config.json"

        # Ensure directory exists
        config_dir.mkdir(parents=True, exist_ok=True)

        # Load existing config
        if config_path.exists():
            config = cls._load_file(config_path)
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
        cls._cache = None

        # Publish event
        if cls._bus:
            from src.bus.events import ConfigChanged, ConfigChangedData
            await cls._bus.publish(
                ConfigChanged,
                ConfigChangedData(path=str(config_path), source=scope)
            )

    @classmethod
    def clear_cache(cls) -> None:
        """Clear configuration cache (for testing)."""
        cls._cache = None

    @classmethod
    async def get_plugin_config(cls) -> dict[str, Any]:
        """Get plugin configuration.

        Returns:
            Plugin configuration dictionary with:
            - builtin: dict of built-in plugin configs
            - custom: list of custom plugin paths
            - options: global plugin options
        """
        config = await cls.get()

        # Get plugins section
        plugins = config.get("plugins", {})

        # Merge legacy plugin paths
        legacy_plugins = config.get("plugin", [])
        custom_plugins = plugins.get("custom", [])

        return {
            "builtin": plugins.get("builtin", {}),
            "custom": list(dict.fromkeys(legacy_plugins + custom_plugins)),
            "options": plugins.get("options", {}),
        }

    @classmethod
    async def get_builtin_plugin_config(cls, plugin_name: str) -> dict[str, Any] | None:
        """Get configuration for a specific built-in plugin.

        Args:
            plugin_name: Plugin name (e.g., "system", "agent", "skill")

        Returns:
            Plugin configuration or None if not configured
        """
        plugin_config = await cls.get_plugin_config()
        builtin = plugin_config.get("builtin", {})
        return builtin.get(plugin_name)

    @classmethod
    async def is_plugin_enabled(cls, plugin_name: str) -> bool:
        """Check if a plugin is enabled.

        Args:
            plugin_name: Plugin name

        Returns:
            True if enabled (default), False if explicitly disabled
        """
        config = await cls.get_builtin_plugin_config(plugin_name)
        if config is None:
            return True  # Enabled by default
        return config.get("enabled", True)
