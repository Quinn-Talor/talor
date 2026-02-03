"""Core infrastructure components for Talor."""

from src.core.config import (
    ConfigManager,
    Config,
    ProviderConfig,
    MCPServerConfig,
    PermissionConfig,
    PermissionRule,
    LoggingConfig,
    StorageConfig,
    UIConfig,
)
from src.core.storage import StorageSystem
from src.core.logging import Logger
from src.core.platform import (
    PlatformAdapter,
    Platform,
    PTYConfig,
    DirectoryPaths,
    get_platform_adapter,
)
from src.core.errors import (
    TalorError,
    ConfigError,
    StorageError,
)
from src.core.state import AppState, state

__all__ = [
    # Config
    "ConfigManager",
    "Config",
    "ProviderConfig",
    "MCPServerConfig",
    "PermissionConfig",
    "PermissionRule",
    "LoggingConfig",
    "StorageConfig",
    "UIConfig",
    # Storage
    "StorageSystem",
    # Logging
    "Logger",
    # Platform
    "PlatformAdapter",
    "Platform",
    "PTYConfig",
    "DirectoryPaths",
    "get_platform_adapter",
    # Errors
    "TalorError",
    "ConfigError",
    "StorageError",
    # State
    "AppState",
    "state",
]
