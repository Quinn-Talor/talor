"""Config Service for Talor.

This module provides the application service for configuration management.
The service is an object instance, not a class with static methods.

Example:
    ```python
    service = ConfigService(directory=Path("/workspace"))

    config = await service.get()
    await service.set("default_model", "openai/gpt-4")
    await service.reload()
    ```
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from src.bus import Bus


logger = logging.getLogger(__name__)


# Default configuration
DEFAULT_CONFIG = {
    "default_model": "ollama/deepseek-v3.1:671b-cloud",
    "default_agent": "build",
    "provider": {},
    "agent": {},
    "mcp": {},
}


class ConfigService:
    """Application service for configuration management.

    Manages:
    - Loading configuration from files
    - Merging multiple config sources
    - Configuration updates and persistence
    """

    def __init__(
        self,
        directory: Path | None = None,
        worktree: Path | None = None,
        bus: Any | None = None,
    ) -> None:
        """Initialize service.

        Args:
            directory: Workspace directory
            worktree: Working tree directory
            bus: Event bus for publishing config changes
        """
        self._directory = directory or Path(".")
        self._worktree = worktree or directory or Path(".")
        self._bus = bus
        self._config: dict[str, Any] | None = None
        self._lock = asyncio.Lock()

    def clear_cache(self) -> None:
        """Clear config cache."""
        self._config = None

    async def get(self) -> dict[str, Any]:
        """Get merged configuration.

        Returns:
            Merged configuration dict
        """
        if self._config is not None:
            return self._config

        async with self._lock:
            if self._config is not None:
                return self._config

            self._config = await self._load_config()
            return self._config

    async def reload(self) -> dict[str, Any]:
        """Reload configuration from files.

        Returns:
            Reloaded configuration dict
        """
        async with self._lock:
            self._config = await self._load_config()

            if self._bus:
                from src.bus.events import ConfigReloaded, ConfigReloadedData
                await self._bus.publish(
                    ConfigReloaded,
                    ConfigReloadedData(config=self._config)
                )

            return self._config

    async def set(self, key: str, value: Any) -> None:
        """Set a configuration value.

        Args:
            key: Configuration key (dot-separated for nested)
            value: Value to set
        """
        config = await self.get()

        # Handle nested keys
        keys = key.split(".")
        target = config
        for k in keys[:-1]:
            if k not in target:
                target[k] = {}
            target = target[k]
        target[keys[-1]] = value

        # Save to file
        await self._save_config(config)

    async def _load_config(self) -> dict[str, Any]:
        """Load configuration from all sources."""
        config = dict(DEFAULT_CONFIG)

        # Load from workspace config files
        config_paths = [
            self._directory / "talor-config.json",
            self._directory / ".talor" / "config.json",
        ]

        for path in config_paths:
            if path.exists():
                try:
                    file_config = await self._load_file(path)
                    config = self._merge_config(config, file_config)
                    logger.debug(f"Loaded config from {path}")
                except Exception as e:
                    logger.warning(f"Failed to load config from {path}: {e}")

        # Load from environment
        env_config = self._load_from_env()
        config = self._merge_config(config, env_config)

        return config

    async def _load_file(self, path: Path) -> dict[str, Any]:
        """Load configuration from a file."""
        content = path.read_text()
        return json.loads(content)

    async def _save_config(self, config: dict[str, Any]) -> None:
        """Save configuration to file."""
        config_path = self._directory / "talor-config.json"

        # Remove default values before saving
        save_config = {}
        for key, value in config.items():
            if key in DEFAULT_CONFIG and value == DEFAULT_CONFIG[key]:
                continue
            save_config[key] = value

        if save_config:
            config_path.write_text(json.dumps(save_config, indent=2))
            logger.debug(f"Saved config to {config_path}")

    def _load_from_env(self) -> dict[str, Any]:
        """Load configuration from environment variables."""
        config: dict[str, Any] = {}

        # TALOR_DEFAULT_MODEL
        if model := os.environ.get("TALOR_DEFAULT_MODEL"):
            config["default_model"] = model

        # TALOR_DEFAULT_AGENT
        if agent := os.environ.get("TALOR_DEFAULT_AGENT"):
            config["default_agent"] = agent

        return config

    def _merge_config(
        self,
        base: dict[str, Any],
        override: dict[str, Any],
    ) -> dict[str, Any]:
        """Deep merge two configuration dicts."""
        result = dict(base)

        for key, value in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._merge_config(result[key], value)
            else:
                result[key] = value

        return result
