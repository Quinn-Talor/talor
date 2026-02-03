"""Tool Plugin for Talor.

This plugin manages tool definitions and injects them into the prompt.

Features:
- Tool definition retrieval from registry
- Permission-based filtering
- Tool description formatting
- Usage guidelines injection
"""

from __future__ import annotations

from typing import Any

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult


class ToolPlugin(PromptPlugin):
    """Tool Plugin - Tool definitions and usage guidelines.

    Responsibilities:
    - Retrieve tool definitions from ToolRegistry
    - Filter tools based on agent permissions
    - Format tool definitions for LLM
    - Inject tool usage guidelines
    """

    def __init__(self, tool_registry: Any = None) -> None:
        """Initialize the tool plugin.

        Args:
            tool_registry: Optional ToolRegistry instance
        """
        super().__init__(
            name="tool",
            priority=PluginPriority.TOOL,
            enabled=True,
            required=True,
        )
        self._registry = tool_registry

    def set_registry(self, registry: Any) -> None:
        """Set the tool registry.

        Args:
            registry: ToolRegistry instance
        """
        self._registry = registry

    async def build(self, context: PluginContext) -> PluginResult | None:
        """Build tool definitions.

        Args:
            context: Plugin execution context

        Returns:
            PluginResult with tool definitions, or None if no registry
        """
        if not self._registry:
            return None

        # Get tool definitions
        tools = await self._registry.get_llm_definitions(
            agent=context.agent_name
        )

        if not tools:
            return None

        # Format tool descriptions
        tool_descriptions = []
        for tool in tools:
            func = tool.get("function", {})
            name = func.get("name", "")
            description = func.get("description", "")
            tool_descriptions.append(f"- {name}: {description}")

        content = f"""<available_tools>
{chr(10).join(tool_descriptions)}
</available_tools>"""

        return PluginResult(
            content=content,
            section="tool",
            metadata={"tool_count": len(tools)},
        )
