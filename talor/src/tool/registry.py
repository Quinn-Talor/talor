"""Tool Registry for Talor.

This module provides the ToolRegistry class for managing tools
available to agents during the ReAct cycle.

Features:
- Tool registration and unregistration
- Source-based indexing (mcp, filesystem, skill, custom)
- Tool filtering by agent/model
- LLM-compatible tool definitions
- Event publishing for tool lifecycle
- Lazy loading support
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, Callable, Awaitable, TYPE_CHECKING

from src.tool.tool import ToolInfo
from src.tool.context import ToolContext
from src.tool.output import ToolOutput

if TYPE_CHECKING:
    from src.bus import Bus


logger = logging.getLogger(__name__)


class ToolRegistry:
    """Central tool registry.

    Manages all available tools with support for filtering and lazy loading.

    Features:
    - Unified interface for all tool types
    - Source-based indexing (mcp, filesystem, skill, custom)
    - LLM-compatible tool definitions
    - Event publishing for tool lifecycle
    - Lazy loading for on-demand tool initialization
    """

    def __init__(self, bus: Any | None = None) -> None:
        """Initialize the registry.

        Args:
            bus: Optional Bus instance for event publishing
        """
        self._bus = bus
        self._tools: dict[str, ToolInfo] = {}
        self._source_index: dict[str, list[str]] = {}
        self._lazy_loaders: dict[str, Callable[[], Awaitable[ToolInfo]]] = {}
        self._lock = asyncio.Lock()

    async def register(
        self,
        tool: ToolInfo,
        source: str = "custom",
    ) -> None:
        """Register a tool.

        Args:
            tool: ToolInfo to register
            source: Tool source (mcp, filesystem, skill, custom)

        Raises:
            ValueError: If tool name already exists
        """
        async with self._lock:
            tool_name = tool.id

            # Check for name conflict
            if tool_name in self._tools:
                raise ValueError(f"Tool '{tool_name}' already registered")

            # Register tool
            self._tools[tool_name] = tool

            # Update source index
            if source not in self._source_index:
                self._source_index[source] = []
            self._source_index[source].append(tool_name)

            logger.debug(f"Registered tool '{tool_name}' from source '{source}'")

            # Publish event
            if self._bus:
                from src.bus.events import ToolRegistered, ToolRegisteredData
                await self._bus.publish(
                    ToolRegistered,
                    ToolRegisteredData(
                        tool_name=tool_name,
                        source=source,
                        description=tool.description,
                    )
                )

    async def unregister(self, tool_name: str) -> None:
        """Unregister a tool.

        Args:
            tool_name: Name of tool to unregister
        """
        async with self._lock:
            if tool_name not in self._tools:
                return

            # Remove from registry
            del self._tools[tool_name]

            # Remove from source index
            for source, names in self._source_index.items():
                if tool_name in names:
                    names.remove(tool_name)
                    break

            logger.debug(f"Unregistered tool '{tool_name}'")

            # Publish event
            if self._bus:
                from src.bus.events import ToolUnregistered, ToolUnregisteredData
                await self._bus.publish(
                    ToolUnregistered,
                    ToolUnregisteredData(tool_name=tool_name)
                )

    async def get(self, tool_name: str) -> ToolInfo | None:
        """Get a tool by name.

        Supports lazy loading for tools registered with register_lazy.

        Args:
            tool_name: Tool name

        Returns:
            ToolInfo or None if not found
        """
        # Check if already loaded
        if tool_name in self._tools:
            return self._tools[tool_name]

        # Check lazy loaders
        if tool_name in self._lazy_loaders:
            async with self._lock:
                if tool_name in self._lazy_loaders:
                    loader = self._lazy_loaders[tool_name]
                    tool = await loader()
                    self._tools[tool_name] = tool
                    del self._lazy_loaders[tool_name]
                    return tool

        return None

    def register_lazy(
        self,
        tool_name: str,
        loader: Callable[[], Awaitable[ToolInfo]],
        source: str = "custom",
    ) -> None:
        """Register a lazy loader for a tool.

        Tool will be loaded on first access.

        Args:
            tool_name: Tool name
            loader: Async function that returns the ToolInfo
            source: Tool source
        """
        self._lazy_loaders[tool_name] = loader

        # Add to source index
        if source not in self._source_index:
            self._source_index[source] = []
        if tool_name not in self._source_index[source]:
            self._source_index[source].append(tool_name)

    async def list(
        self,
        source: str | None = None,
        agent: str | None = None,
    ) -> list[dict[str, Any]]:
        """List all tools metadata.

        Args:
            source: Filter by source (optional)
            agent: Filter by agent permissions (optional)

        Returns:
            List of tool metadata dictionaries
        """
        tools = []

        # Get all tool names (including lazy)
        all_names = set(self._tools.keys()) | set(self._lazy_loaders.keys())

        for tool_name in all_names:
            # Filter by source
            if source:
                tool_source = self._find_source(tool_name)
                if tool_source != source:
                    continue

            # Get tool (may trigger lazy load)
            tool = await self.get(tool_name)
            if not tool:
                continue

            # TODO: Filter by agent permissions

            tools.append({
                "name": tool.id,
                "description": tool.description,
                "parameters": tool.get_parameters_schema(),
                "source": self._find_source(tool_name),
            })

        return tools

    def _find_source(self, tool_name: str) -> str:
        """Find the source of a tool.

        Args:
            tool_name: Tool name

        Returns:
            Source name or "custom"
        """
        for source, names in self._source_index.items():
            if tool_name in names:
                return source
        return "custom"

    async def get_llm_definitions(
        self,
        agent: str | None = None,
    ) -> list[dict[str, Any]]:
        """Get LLM-compatible tool definitions.

        Used for passing to LLM's tools parameter.

        Args:
            agent: Optional agent for permission filtering

        Returns:
            List of tool definitions in OpenAI format
        """
        tools_metadata = await self.list(agent=agent)

        definitions = []
        for tool in tools_metadata:
            definitions.append({
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool["description"],
                    "parameters": tool["parameters"],
                }
            })

        return definitions

    async def execute(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        context: ToolContext,
    ) -> ToolOutput:
        """Execute a tool.

        Args:
            tool_name: Tool name
            arguments: Tool arguments
            context: Execution context

        Returns:
            ToolOutput with result

        Raises:
            ValueError: If tool not found
        """
        tool = await self.get(tool_name)
        if not tool:
            raise ValueError(f"Tool not found: {tool_name}")

        # Publish executing event
        if self._bus:
            from src.bus.events import ToolExecuting, ToolExecutingData
            await self._bus.publish(
                ToolExecuting,
                ToolExecutingData(
                    session_id=context.session_id,
                    message_id=context.message_id,
                    tool_name=tool_name,
                    call_id=context.call_id or "",
                    arguments=arguments,
                )
            )

        import time
        start_time = time.time()

        try:
            # Execute tool
            result = await tool(arguments, context)

            duration_ms = (time.time() - start_time) * 1000

            # Publish executed event
            if self._bus:
                from src.bus.events import ToolExecuted, ToolExecutedData
                await self._bus.publish(
                    ToolExecuted,
                    ToolExecutedData(
                        session_id=context.session_id,
                        message_id=context.message_id,
                        tool_name=tool_name,
                        call_id=context.call_id or "",
                        success=True,
                        output=result.output[:500] if result.output else None,
                        duration_ms=duration_ms,
                    )
                )

            return result

        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000

            # Publish executed event with error
            if self._bus:
                from src.bus.events import ToolExecuted, ToolExecutedData
                await self._bus.publish(
                    ToolExecuted,
                    ToolExecutedData(
                        session_id=context.session_id,
                        message_id=context.message_id,
                        tool_name=tool_name,
                        call_id=context.call_id or "",
                        success=False,
                        error=str(e),
                        duration_ms=duration_ms,
                    )
                )

            raise

    async def clear(self) -> None:
        """Clear all tools (for testing)."""
        async with self._lock:
            self._tools.clear()
            self._source_index.clear()
            self._lazy_loaders.clear()

    @property
    def tool_count(self) -> int:
        """Get total number of registered tools."""
        return len(self._tools) + len(self._lazy_loaders)
