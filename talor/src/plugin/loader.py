"""Custom Plugin Loader for Talor.

This module provides loading of custom plugins from Python files.

Features:
- Load plugins from Python files
- Plugin validation
- Hot-reloading support
"""

from __future__ import annotations

import importlib.util
import logging
import sys
from pathlib import Path
from typing import Any

from src.plugin.base import PromptPlugin

logger = logging.getLogger(__name__)


class PluginValidationError(Exception):
    """Plugin validation error."""
    pass


class PluginLoader:
    """Custom plugin loader.

    Loads plugins from Python files following the plugin interface.
    """

    # Required attributes for a valid plugin class
    REQUIRED_METHODS = ["build"]

    def __init__(self) -> None:
        """Initialize the plugin loader."""
        self._loaded_modules: dict[str, Any] = {}

    def load_from_file(self, path: Path) -> PromptPlugin | None:
        """Load a plugin from a Python file.

        The file must contain a class that inherits from PromptPlugin.

        Args:
            path: Path to Python file

        Returns:
            Plugin instance or None if loading fails

        Raises:
            PluginValidationError: If plugin validation fails
        """
        if not path.exists():
            logger.warning(f"Plugin file not found: {path}")
            return None

        if not path.suffix == ".py":
            logger.warning(f"Invalid plugin file extension: {path}")
            return None

        try:
            # Load module
            module = self._load_module(path)
            if not module:
                return None

            # Find plugin class
            plugin_class = self._find_plugin_class(module)
            if not plugin_class:
                logger.warning(f"No plugin class found in: {path}")
                return None

            # Validate plugin
            self._validate_plugin_class(plugin_class)

            # Instantiate plugin
            plugin = plugin_class()
            logger.info(f"Loaded custom plugin: {plugin.name} from {path}")

            return plugin

        except PluginValidationError as e:
            logger.error(f"Plugin validation failed for {path}: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to load plugin from {path}: {e}")
            return None

    def load_from_directory(self, directory: Path) -> list[PromptPlugin]:
        """Load all plugins from a directory.

        Args:
            directory: Directory containing plugin files

        Returns:
            List of loaded plugins
        """
        plugins = []

        if not directory.is_dir():
            return plugins

        for path in directory.glob("*.py"):
            if path.name.startswith("_"):
                continue

            try:
                plugin = self.load_from_file(path)
                if plugin:
                    plugins.append(plugin)
            except PluginValidationError:
                continue

        return plugins

    def _load_module(self, path: Path) -> Any | None:
        """Load a Python module from file.

        Args:
            path: Path to Python file

        Returns:
            Loaded module or None
        """
        module_name = f"talor_plugin_{path.stem}"

        # Check if already loaded
        if module_name in self._loaded_modules:
            return self._loaded_modules[module_name]

        try:
            spec = importlib.util.spec_from_file_location(module_name, path)
            if not spec or not spec.loader:
                return None

            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)

            self._loaded_modules[module_name] = module
            return module

        except Exception as e:
            logger.error(f"Failed to load module {path}: {e}")
            return None

    def _find_plugin_class(self, module: Any) -> type | None:
        """Find a plugin class in a module.

        Args:
            module: Python module

        Returns:
            Plugin class or None
        """
        for name in dir(module):
            if name.startswith("_"):
                continue

            obj = getattr(module, name)

            # Check if it's a class that inherits from PromptPlugin
            if (
                isinstance(obj, type)
                and issubclass(obj, PromptPlugin)
                and obj is not PromptPlugin
            ):
                return obj

        return None

    def _validate_plugin_class(self, plugin_class: type) -> None:
        """Validate a plugin class.

        Args:
            plugin_class: Plugin class to validate

        Raises:
            PluginValidationError: If validation fails
        """
        # Check required methods
        for method in self.REQUIRED_METHODS:
            if not hasattr(plugin_class, method):
                raise PluginValidationError(
                    f"Plugin class missing required method: {method}"
                )

            if not callable(getattr(plugin_class, method)):
                raise PluginValidationError(
                    f"Plugin attribute '{method}' is not callable"
                )

        # Try to instantiate
        try:
            instance = plugin_class()
        except Exception as e:
            raise PluginValidationError(
                f"Failed to instantiate plugin: {e}"
            )

        # Validate instance attributes
        if not hasattr(instance, "name") or not instance.name:
            raise PluginValidationError("Plugin must have a 'name' attribute")

        if not hasattr(instance, "priority"):
            raise PluginValidationError("Plugin must have a 'priority' attribute")

    def reload_module(self, path: Path) -> PromptPlugin | None:
        """Reload a plugin module.

        Args:
            path: Path to Python file

        Returns:
            Reloaded plugin instance or None
        """
        module_name = f"talor_plugin_{path.stem}"

        # Remove from cache
        if module_name in self._loaded_modules:
            del self._loaded_modules[module_name]

        if module_name in sys.modules:
            del sys.modules[module_name]

        return self.load_from_file(path)

    def clear_cache(self) -> None:
        """Clear loaded module cache."""
        for module_name in list(self._loaded_modules.keys()):
            if module_name in sys.modules:
                del sys.modules[module_name]

        self._loaded_modules.clear()
