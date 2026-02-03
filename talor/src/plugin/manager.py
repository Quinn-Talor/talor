"""Plugin Manager for Talor.

This module provides the PluginManager class that handles plugin
registration, execution, and result aggregation.

Features:
- Plugin registration and unregistration
- Priority-based execution order
- Async plugin execution
- Result aggregation
- Error handling with isolation
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, TYPE_CHECKING

from src.plugin.base import PromptPlugin
from src.plugin.context import PluginContext

if TYPE_CHECKING:
    from src.bus import Bus

logger = logging.getLogger(__name__)


class PluginManager:
    """Plugin manager for prompt building.

    Manages plugin registration, execution, and result aggregation.

    Features:
    - Plugin registration with unique names
    - Priority-based execution order
    - Async plugin execution
    - Error handling with isolation for non-required plugins
    """

    def __init__(self, bus: Any | None = None) -> None:
        """Initialize the plugin manager.

        Args:
            bus: Optional Bus instance for event publishing
        """
        self._bus = bus
        self._plugins: dict[str, PromptPlugin] = {}
        self._lock = asyncio.Lock()
        self._initialized = False

    async def initialize(self) -> None:
        """Initialize and load all required plugins."""
        if self._initialized:
            return

        # Import and register built-in plugins
        from src.plugin.builtin import (
            SystemPromptPlugin,
            AgentPromptPlugin,
            EnvironmentPlugin,
            MemoryPlugin,
            SkillPlugin,
            LLMPlugin,
            ToolPlugin,
        )

        await self.register(SystemPromptPlugin())
        await self.register(AgentPromptPlugin())
        await self.register(EnvironmentPlugin())
        await self.register(MemoryPlugin())
        await self.register(SkillPlugin())
        await self.register(LLMPlugin())
        await self.register(ToolPlugin())

        self._initialized = True
        logger.info("Plugin manager initialized with built-in plugins")

    async def register(self, plugin: PromptPlugin) -> None:
        """Register a plugin.

        Args:
            plugin: Plugin to register

        Raises:
            ValueError: If plugin name already exists
        """
        async with self._lock:
            if plugin.name in self._plugins:
                raise ValueError(f"Plugin '{plugin.name}' already registered")

            self._plugins[plugin.name] = plugin
            logger.debug(f"Registered plugin: {plugin.name} (priority={plugin.priority})")

            # Publish event
            if self._bus:
                from src.bus.events import PluginRegistered, PluginRegisteredData
                await self._bus.publish(
                    PluginRegistered,
                    PluginRegisteredData(
                        plugin_name=plugin.name,
                        priority=plugin.priority,
                        required=plugin.required,
                    )
                )

    async def unregister(self, name: str) -> None:
        """Unregister a plugin.

        Args:
            name: Plugin name to unregister

        Raises:
            ValueError: If trying to unregister a required plugin
        """
        async with self._lock:
            plugin = self._plugins.get(name)
            if not plugin:
                return

            if plugin.required:
                raise ValueError(f"Cannot unregister required plugin: {name}")

            del self._plugins[name]
            logger.debug(f"Unregistered plugin: {name}")

    async def get(self, name: str) -> PromptPlugin | None:
        """Get a plugin by name.

        Args:
            name: Plugin name

        Returns:
            Plugin or None if not found
        """
        return self._plugins.get(name)

    async def list_plugins(self) -> list[dict[str, Any]]:
        """List all registered plugins.

        Returns:
            List of plugin metadata
        """
        return [
            {
                "name": p.name,
                "priority": p.priority,
                "enabled": p.enabled,
                "required": p.required,
            }
            for p in sorted(self._plugins.values(), key=lambda p: p.priority)
        ]

    async def build_prompt(self, context: PluginContext) -> dict[str, Any]:
        """Build complete LLM messages list from all plugins.

        Executes plugins in priority order and builds a complete messages list
        ready for LLM API calls.

        Args:
            context: Plugin execution context

        Returns:
            Dictionary with:
            - messages: list[dict] - Complete LLM messages, ready for API call
            - tools: list[dict] - Tool definitions list
            - tool_restrictions: list[str] | None - Tool restrictions from Skills
            - metadata: dict - Plugin metadata
        """
        system_parts: list[str] = []
        conversation_messages: list[dict[str, Any]] = []
        tools: list[dict[str, Any]] = []
        tool_restrictions: set[str] | None = None
        all_metadata: dict[str, Any] = {}

        # Sort plugins by priority
        sorted_plugins = sorted(
            self._plugins.values(),
            key=lambda p: p.priority
        )

        for plugin in sorted_plugins:
            # Skip disabled plugins
            if not plugin.enabled:
                logger.debug(f"Skipping disabled plugin: {plugin.name}")
                continue

            try:
                result = await plugin.build(context)
                if result:
                    # Handle different section types
                    if result.section == "memory":
                        # Memory plugin returns conversation messages list
                        if result.metadata and "messages" in result.metadata:
                            conversation_messages = result.metadata["messages"]
                    elif result.section == "tool":
                        # Tool plugin returns tool definitions
                        if result.metadata and "tools" in result.metadata:
                            tools = result.metadata["tools"]
                        # Tool plugin may also contribute to system prompt
                        if result.content:
                            system_parts.append(result.content)
                    else:
                        # Other plugins contribute to system prompt content
                        if result.content:
                            system_parts.append(result.content)

                    # Collect tool restrictions (intersection)
                    if result.tool_restrictions:
                        if tool_restrictions is None:
                            tool_restrictions = set(result.tool_restrictions)
                        else:
                            tool_restrictions &= set(result.tool_restrictions)

                    # Merge metadata
                    if result.metadata:
                        all_metadata.update(result.metadata)

                    logger.debug(f"Plugin {plugin.name} produced result")

            except Exception as e:
                logger.error(f"Plugin {plugin.name} failed: {e}", exc_info=True)

                # Re-raise for required plugins
                if plugin.required:
                    raise

        # Build final messages list
        messages: list[dict[str, Any]] = []

        # 1. Add system message (merged from all system content)
        if system_parts:
            messages.append({
                "role": "system",
                "content": "\n\n".join(system_parts),
            })

        # 2. Add conversation history (user/assistant/tool messages)
        messages.extend(conversation_messages)

        return {
            "messages": messages,
            "tools": tools,
            "tool_restrictions": list(tool_restrictions) if tool_restrictions else None,
            "metadata": all_metadata,
        }

    def enable_plugin(self, name: str) -> bool:
        """Enable a plugin.

        Args:
            name: Plugin name

        Returns:
            True if plugin was enabled, False if not found
        """
        plugin = self._plugins.get(name)
        if plugin:
            plugin.enabled = True
            return True
        return False

    def disable_plugin(self, name: str) -> bool:
        """Disable a plugin.

        Args:
            name: Plugin name

        Returns:
            True if plugin was disabled, False if not found
        """
        plugin = self._plugins.get(name)
        if plugin:
            plugin.enabled = False
            return True
        return False

    @property
    def plugin_count(self) -> int:
        """Get the number of registered plugins."""
        return len(self._plugins)

    @property
    def initialized(self) -> bool:
        """Check if the manager is initialized."""
        return self._initialized

    async def reload_config(self) -> None:
        """Reload plugin configuration from config file.

        Updates plugin enabled/disabled state based on configuration.
        """
        from src.config.config import Config

        plugin_config = await Config.get_plugin_config()
        builtin_config = plugin_config.get("builtin", {})

        async with self._lock:
            for plugin_name, plugin in self._plugins.items():
                config = builtin_config.get(plugin_name, {})

                # Update enabled state
                enabled = config.get("enabled", True)
                plugin.enabled = enabled

                # Update priority if specified
                priority = config.get("priority")
                if priority is not None:
                    plugin.priority = priority

                logger.debug(
                    f"Plugin {plugin_name}: enabled={enabled}, priority={plugin.priority}"
                )

        logger.info("Plugin configuration reloaded")

    async def apply_config(self, config: dict[str, Any]) -> None:
        """Apply plugin configuration.

        Args:
            config: Plugin configuration dictionary with:
                - builtin: dict of built-in plugin configs
                - custom: list of custom plugin paths
                - options: global plugin options
        """
        builtin_config = config.get("builtin", {})

        async with self._lock:
            for plugin_name, plugin in self._plugins.items():
                plugin_cfg = builtin_config.get(plugin_name, {})

                # Update enabled state
                plugin.enabled = plugin_cfg.get("enabled", True)

                # Update priority if specified
                priority = plugin_cfg.get("priority")
                if priority is not None:
                    plugin.priority = priority

        logger.info("Plugin configuration applied")
