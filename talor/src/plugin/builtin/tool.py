"""Tool Plugin for Talor.

This plugin manages tool definitions and injects them into the prompt.

Features:
- Tool definition retrieval from registry
- Permission-based filtering
- Tool description formatting
- Usage guidelines injection
- MCP tool on-demand discovery (when many MCP tools are configured)
"""

from __future__ import annotations

import logging
from typing import Any

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult


logger = logging.getLogger(__name__)

# When MCP tool count exceeds this threshold, switch to on-demand discovery mode
# (only mcp_search is injected; MCP tools are excluded from LLM definitions)
MCP_INLINE_THRESHOLD = 10


class ToolPlugin(PromptPlugin):
    """Tool Plugin - Tool definitions and usage guidelines.

    Responsibilities:
    - Retrieve tool definitions from ToolRegistry
    - Filter tools based on agent permissions
    - Format tool definitions for LLM
    - Inject tool usage guidelines
    - On-demand MCP tool discovery when many servers are configured
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

        When many MCP tools are registered (> MCP_INLINE_THRESHOLD), excludes
        individual MCP tool definitions from the LLM context and relies on
        the mcp_search tool for on-demand discovery. This saves significant
        context tokens (~85% for MCP tool schemas).

        Skill-based filtering is enforced at execution time in the executor.

        Args:
            context: Plugin execution context

        Returns:
            PluginResult with:
            - content: Tool descriptions for system prompt
            - metadata["tools"]: Tool definitions list for LLM API
            - metadata["tool_count"]: Number of tools
        """
        if not self._registry:
            return None

        all_tools = await self._registry.get_llm_definitions(agent=context.agent_name)

        if not all_tools:
            return PluginResult(
                content="",
                section="tool",
                metadata={"tools": [], "tool_count": 0},
            )

        # Separate MCP tools from non-MCP tools.
        # mcp_search is a builtin tool (not an actual MCP tool) and must always be kept.
        _BUILTIN_MCP_PREFIX_TOOLS = {"mcp_search"}
        mcp_tools = [
            t for t in all_tools
            if t.get("function", {}).get("name", "").startswith("mcp_")
            and t.get("function", {}).get("name", "") not in _BUILTIN_MCP_PREFIX_TOOLS
        ]
        non_mcp_tools = [
            t for t in all_tools
            if not t.get("function", {}).get("name", "").startswith("mcp_")
            or t.get("function", {}).get("name", "") in _BUILTIN_MCP_PREFIX_TOOLS
        ]

        # Decide whether to use on-demand discovery mode
        if len(mcp_tools) > MCP_INLINE_THRESHOLD:
            # On-demand mode: exclude individual MCP tools, keep mcp_search
            tools = non_mcp_tools
            mcp_summary = self._build_mcp_summary(mcp_tools)
            logger.info(
                f"MCP on-demand discovery mode: {len(mcp_tools)} MCP tools excluded, "
                f"use mcp_search to discover"
            )
        else:
            # Inline mode: include all tools (MCP tool count is manageable)
            tools = all_tools
            mcp_summary = ""

        tool_descriptions = []
        for tool in tools:
            func = tool.get("function", {})
            name = func.get("name", "")
            description = func.get("description", "")
            tool_descriptions.append(f"- {name}: {description}")

        content = f"""<available_tools>
{chr(10).join(tool_descriptions)}
</available_tools>"""

        if mcp_summary:
            content += f"\n\n{mcp_summary}"

        return PluginResult(
            content=content,
            section="tool",
            metadata={"tools": tools, "tool_count": len(tools), "mcp_discovery_mode": len(mcp_tools) > MCP_INLINE_THRESHOLD},
        )

    @staticmethod
    def _build_mcp_summary(mcp_tools: list[dict[str, Any]]) -> str:
        """Build a concise summary of MCP servers for system prompt.

        Args:
            mcp_tools: List of MCP tool definitions

        Returns:
            Summary string for system prompt
        """
        # Group by server (extract server name from mcp_{server}_{tool} naming)
        servers: dict[str, list[str]] = {}
        for tool in mcp_tools:
            name = tool.get("function", {}).get("name", "")
            # Parse mcp_{server}_{tool} format
            parts = name.split("_", 2)
            if len(parts) >= 3:
                server = parts[1]
                tool_name = parts[2]
            else:
                server = "unknown"
                tool_name = name
            servers.setdefault(server, []).append(tool_name)

        lines = [
            "<mcp_servers>",
            f"You have {len(mcp_tools)} MCP tools available from {len(servers)} server(s).",
            "Use the mcp_search tool to discover specific tools by capability.",
            "",
        ]
        for server, tool_names in servers.items():
            lines.append(f"- {server}: {len(tool_names)} tools ({', '.join(tool_names[:5])}{'...' if len(tool_names) > 5 else ''})")
        lines.append("</mcp_servers>")

        return "\n".join(lines)
