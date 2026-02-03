"""Configuration System for Talor.

This module provides configuration management.

New code should use module-level functions:
    ```python
    from src.config import config

    config.configure(workspace=Path("/workspace"))
    cfg = await config.get()
    await config.set_value("default_model", "openai/gpt-4")
    ```

Or import functions directly:
    ```python
    from src.config.config import configure, get, set_value, clear_cache

    configure(workspace=Path("/workspace"))
    cfg = await get()
    ```

Legacy code can still use (deprecated):
    ```python
    from src.config import Config, ConfigService

    # Static facade
    config = await Config.get()

    # Service instance
    service = ConfigService(directory=Path("/workspace"))
    config = await service.get()
    ```
"""

from src.config.config import (
    # Module-level functions (new API)
    configure,
    clear_cache,
    get,
    reload,
    set_value,
    directories,
    get_plugin_config,
    get_builtin_plugin_config,
    is_plugin_enabled,
    # Internal functions (for testing)
    _merge_config,
    _load_env,
    _load_file,
    # JSONC parser
    parse_jsonc,
    # Configuration schema classes
    MCPServerConfig,
    ProviderConfig,
    PluginConfig,
    PluginsConfig,
    ConfigInfo,
    # Default configuration
    DEFAULT_CONFIG,
    # Legacy classes (backward compatibility)
    Config,
    ConfigService,
)

__all__ = [
    # Module-level functions (new API)
    "configure",
    "clear_cache",
    "get",
    "reload",
    "set_value",
    "directories",
    "get_plugin_config",
    "get_builtin_plugin_config",
    "is_plugin_enabled",
    # JSONC parser
    "parse_jsonc",
    # Internal functions (for testing)
    "_merge_config",
    "_load_env",
    "_load_file",
    # Configuration schema classes
    "MCPServerConfig",
    "ProviderConfig",
    "PluginConfig",
    "PluginsConfig",
    "ConfigInfo",
    # Default configuration
    "DEFAULT_CONFIG",
    # Legacy classes (backward compatibility)
    "Config",
    "ConfigService",
]
