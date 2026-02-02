"""Configuration management system for Talor.

This module provides configuration loading, validation, and management using Pydantic.
It supports multiple configuration sources with priority ordering:
1. Project configuration (.talor/config.yaml in workspace)
2. User configuration (~/.config/talor/config.yaml)
3. Default configuration (built-in defaults)

Configuration files can be in JSON or YAML format.
"""

import json
import logging
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, ValidationError

from talor.core.errors import ConfigError


logger = logging.getLogger(__name__)


class ProviderConfig(BaseModel):
    """Configuration for an LLM provider.
    
    Attributes:
        api_key: API key for the provider
        base_url: Optional custom base URL for the provider API
        default_model: Optional default model to use for this provider
    """
    api_key: str
    base_url: str | None = None
    default_model: str | None = None


class MCPServerConfig(BaseModel):
    """Configuration for an MCP server.
    
    Attributes:
        command: Command to execute to start the MCP server
        args: Command-line arguments for the server
        env: Environment variables for the server process
        transport: Transport protocol (stdio or sse)
    """
    command: str
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    transport: Literal["stdio", "sse"] = "stdio"


class PermissionRule(BaseModel):
    """Permission rule for tool execution.
    
    Attributes:
        tool_pattern: Tool name pattern (supports wildcards like "file_*")
        action: Action to take (allow, deny, or ask user)
        scope: Scope of the permission (once, session, or always)
        conditions: Optional conditions for the rule
    """
    tool_pattern: str
    action: Literal["allow", "deny", "ask"]
    scope: Literal["once", "session", "always"]
    conditions: dict[str, Any] | None = None


class PermissionConfig(BaseModel):
    """Permission system configuration.
    
    Attributes:
        rules: List of permission rules
        dangerous_operations: List of operations that always require confirmation
    """
    rules: list[PermissionRule] = Field(default_factory=list)
    dangerous_operations: list[str] = Field(default_factory=lambda: [
        "delete_file",
        "write_file",
        "execute_command"
    ])


class LoggingConfig(BaseModel):
    """Logging system configuration.
    
    Attributes:
        level: Log level (DEBUG, INFO, WARNING, ERROR)
        file_rotation: Log file rotation interval
        max_file_size: Maximum log file size before rotation
    """
    level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    file_rotation: str = "1 day"
    max_file_size: str = "10 MB"


class StorageConfig(BaseModel):
    """Storage system configuration.
    
    Attributes:
        database_path: Path to SQLite database file (None for default location)
        backup_enabled: Whether to enable automatic backups
        backup_interval: Backup interval in hours
    """
    database_path: str | None = None
    backup_enabled: bool = True
    backup_interval: int = 24


class UIConfig(BaseModel):
    """UI configuration.
    
    Attributes:
        theme: UI theme (light or dark)
        font_size: Font size in pixels
        show_line_numbers: Whether to show line numbers in code views
    """
    theme: Literal["light", "dark"] = "dark"
    font_size: int = 14
    show_line_numbers: bool = True


class Config(BaseModel):
    """Main configuration model for Talor.
    
    This is the root configuration object that contains all subsystem configurations.
    
    Attributes:
        providers: LLM provider configurations
        mcp_servers: MCP server configurations
        permissions: Permission system configuration
        logging: Logging configuration
        storage: Storage configuration
        ui: UI configuration
    """
    providers: dict[str, ProviderConfig] = Field(default_factory=dict)
    mcp_servers: dict[str, MCPServerConfig] = Field(default_factory=dict)
    permissions: PermissionConfig = Field(default_factory=PermissionConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    storage: StorageConfig = Field(default_factory=StorageConfig)
    ui: UIConfig = Field(default_factory=UIConfig)


class ConfigManager:
    """Manages configuration loading, validation, and access.
    
    The ConfigManager handles loading configuration from multiple sources with
    priority ordering, validates configuration using Pydantic models, and provides
    access to configuration values.
    
    Configuration priority (highest to lowest):
    1. Project configuration (.talor/config.yaml in workspace)
    2. User configuration (~/.config/talor/config.yaml or %APPDATA%/talor/config.yaml)
    3. Default configuration (built-in defaults)
    
    Example:
        ```python
        manager = ConfigManager(workspace_path="/path/to/project")
        await manager.load()
        
        # Get configuration values
        api_key = manager.get("providers.openai.api_key")
        log_level = manager.get("logging.level", default="INFO")
        
        # Update configuration
        await manager.set("logging.level", "DEBUG")
        await manager.save()
        ```
    """
    
    def __init__(self, workspace_path: str | None = None) -> None:
        """Initialize the ConfigManager.
        
        Args:
            workspace_path: Optional path to the workspace/project directory.
                          If provided, project configuration will be loaded from
                          .talor/config.yaml in this directory.
        """
        self._workspace_path = Path(workspace_path) if workspace_path else None
        self._config: Config = Config()
        self._loaded = False
    
    async def load(self) -> Config:
        """Load configuration from all sources.
        
        Loads configuration in priority order:
        1. Default configuration (built-in)
        2. User configuration (if exists)
        3. Project configuration (if exists and workspace_path provided)
        
        Higher priority configurations override lower priority ones.
        
        Returns:
            The loaded and merged configuration
        
        Raises:
            ConfigError: If configuration loading or validation fails
        """
        # Start with default configuration
        config_data = self._get_default_config()
        
        # Load and merge user configuration
        user_config_path = self._get_user_config_path()
        if user_config_path.exists():
            try:
                user_data = self._load_config_file(user_config_path)
                config_data = self._merge_configs(config_data, user_data)
                logger.info(f"Loaded user configuration from {user_config_path}")
            except Exception as e:
                logger.warning(f"Failed to load user configuration: {e}")
        
        # Load and merge project configuration
        if self._workspace_path:
            project_config_path = self._get_project_config_path()
            if project_config_path.exists():
                try:
                    project_data = self._load_config_file(project_config_path)
                    config_data = self._merge_configs(config_data, project_data)
                    logger.info(f"Loaded project configuration from {project_config_path}")
                except Exception as e:
                    logger.warning(f"Failed to load project configuration: {e}")
        
        # Validate and create Config object
        try:
            self._config = Config(**config_data)
            self._loaded = True
            logger.info("Configuration loaded and validated successfully")
            return self._config
        except ValidationError as e:
            raise ConfigError(
                "Configuration validation failed",
                context={"errors": e.errors()}
            )
    
    async def reload(self) -> None:
        """Reload configuration from all sources.
        
        This is useful when configuration files have been modified and you want
        to pick up the changes without restarting the application.
        
        Raises:
            ConfigError: If configuration loading or validation fails
        """
        logger.info("Reloading configuration...")
        await self.load()
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value by key.
        
        Supports nested keys using dot notation (e.g., "logging.level").
        
        Args:
            key: Configuration key (supports dot notation for nested values)
            default: Default value to return if key is not found
        
        Returns:
            Configuration value or default if not found
        
        Example:
            ```python
            level = manager.get("logging.level")
            api_key = manager.get("providers.openai.api_key", default="")
            ```
        """
        if not self._loaded:
            logger.warning("Configuration not loaded, returning default value")
            return default
        
        # Navigate nested keys
        parts = key.split(".")
        value = self._config
        
        for part in parts:
            if isinstance(value, BaseModel):
                value = getattr(value, part, None)
            elif isinstance(value, dict):
                value = value.get(part)
            else:
                return default
            
            if value is None:
                return default
        
        return value
    
    async def set(self, key: str, value: Any) -> None:
        """Set a configuration value.
        
        Supports nested keys using dot notation. The configuration is updated
        in memory but not persisted to disk until save() is called.
        
        Args:
            key: Configuration key (supports dot notation for nested values)
            value: Value to set
        
        Raises:
            ConfigError: If the key is invalid or value validation fails
        
        Example:
            ```python
            await manager.set("logging.level", "DEBUG")
            await manager.set("providers.openai.api_key", "sk-...")
            ```
        """
        if not self._loaded:
            raise ConfigError("Configuration not loaded. Call load() first.")
        
        # Navigate to parent and set value
        parts = key.split(".")
        if len(parts) == 1:
            # Top-level key
            if not hasattr(self._config, key):
                raise ConfigError(f"Invalid configuration key: {key}")
            setattr(self._config, key, value)
        else:
            # Nested key
            parent = self._config
            for part in parts[:-1]:
                if isinstance(parent, BaseModel):
                    parent = getattr(parent, part, None)
                elif isinstance(parent, dict):
                    parent = parent.get(part)
                else:
                    raise ConfigError(f"Invalid configuration path: {key}")
                
                if parent is None:
                    raise ConfigError(f"Invalid configuration path: {key}")
            
            # Set the final value
            final_key = parts[-1]
            if isinstance(parent, BaseModel):
                if not hasattr(parent, final_key):
                    raise ConfigError(f"Invalid configuration key: {key}")
                setattr(parent, final_key, value)
            elif isinstance(parent, dict):
                parent[final_key] = value
            else:
                raise ConfigError(f"Cannot set value at: {key}")
        
        # Re-validate the entire configuration
        try:
            self._config = Config(**self._config.model_dump())
        except ValidationError as e:
            raise ConfigError(
                f"Configuration validation failed after setting {key}",
                context={"errors": e.errors()}
            )
    
    async def save(self, target: Literal["user", "project"] = "user") -> None:
        """Save the current configuration to disk.
        
        Args:
            target: Where to save the configuration ("user" or "project")
        
        Raises:
            ConfigError: If saving fails or target is invalid
        """
        if not self._loaded:
            raise ConfigError("Configuration not loaded. Call load() first.")
        
        if target == "user":
            config_path = self._get_user_config_path()
        elif target == "project":
            if not self._workspace_path:
                raise ConfigError("Cannot save project configuration: no workspace path set")
            config_path = self._get_project_config_path()
        else:
            raise ConfigError(f"Invalid save target: {target}")
        
        # Ensure directory exists
        config_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Convert config to dict and save as YAML
        config_data = self._config.model_dump(exclude_none=True)
        
        try:
            with open(config_path, "w") as f:
                yaml.dump(config_data, f, default_flow_style=False, sort_keys=False)
            logger.info(f"Configuration saved to {config_path}")
        except Exception as e:
            raise ConfigError(
                f"Failed to save configuration to {config_path}",
                context={"error": str(e)}
            )
    
    def _get_user_config_path(self) -> Path:
        """Get the path to the user configuration file.
        
        Returns platform-specific configuration directory using PlatformAdapter:
        - Linux: XDG_CONFIG_HOME or ~/.config/talor/config.yaml
        - macOS: ~/Library/Application Support/talor/config.yaml
        - Windows: %APPDATA%/talor/config.yaml
        """
        from talor.core.platform import get_platform_adapter
        
        adapter = get_platform_adapter()
        dirs = adapter.get_directories()
        return dirs.config / "config.yaml"
    
    def _get_project_config_path(self) -> Path:
        """Get the path to the project configuration file.
        
        Returns:
            Path to .talor/config.yaml in the workspace
        
        Raises:
            ConfigError: If workspace_path is not set
        """
        if not self._workspace_path:
            raise ConfigError("Workspace path not set")
        
        return self._workspace_path / ".talor" / "config.yaml"
    
    def _get_default_config(self) -> dict[str, Any]:
        """Get the default configuration.
        
        Returns:
            Dictionary with default configuration values
        """
        default_config = Config()
        return default_config.model_dump()
    
    def _load_config_file(self, path: Path) -> dict[str, Any]:
        """Load a configuration file (JSON or YAML).
        
        Args:
            path: Path to the configuration file
        
        Returns:
            Configuration data as a dictionary
        
        Raises:
            ConfigError: If file cannot be read or parsed
        """
        try:
            with open(path, "r") as f:
                content = f.read()
            
            # Try to determine format from extension
            if path.suffix.lower() == ".json":
                return json.loads(content)
            elif path.suffix.lower() in [".yaml", ".yml"]:
                return yaml.safe_load(content) or {}
            else:
                # Try YAML first, then JSON
                try:
                    return yaml.safe_load(content) or {}
                except yaml.YAMLError:
                    return json.loads(content)
        
        except json.JSONDecodeError as e:
            raise ConfigError(
                f"Failed to parse JSON configuration file: {path}",
                context={"error": str(e), "line": e.lineno, "column": e.colno}
            )
        except yaml.YAMLError as e:
            raise ConfigError(
                f"Failed to parse YAML configuration file: {path}",
                context={"error": str(e)}
            )
        except Exception as e:
            raise ConfigError(
                f"Failed to read configuration file: {path}",
                context={"error": str(e)}
            )
    
    def _merge_configs(self, base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
        """Merge two configuration dictionaries.
        
        The override dictionary takes precedence over the base dictionary.
        Nested dictionaries are merged recursively.
        
        Args:
            base: Base configuration dictionary
            override: Override configuration dictionary
        
        Returns:
            Merged configuration dictionary
        """
        result = base.copy()
        
        for key, value in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                # Recursively merge nested dictionaries
                result[key] = self._merge_configs(result[key], value)
            else:
                # Override value
                result[key] = value
        
        return result
