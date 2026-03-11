"""MCP Search Tool for Talor.

Provides on-demand discovery of MCP tools to save context tokens.
Instead of injecting all MCP tool definitions into the LLM context,
only this search tool is exposed. The LLM calls it to find relevant
MCP tools by keyword, then uses the discovered tools directly.

Inspired by Claude Code's Tool Search Tool pattern (~85% token savings).
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field

from src.tool import Tool, ToolContext, ToolOutput


logger = logging.getLogger(__name__)


class MCPSearchParams(BaseModel):
    """Parameters for MCP search tool."""

    query: str = Field(
        description=(
            "Search query describing what capability you need. "
            "Examples: 'browser automation', 'PDF parsing', 'file system', 'database'"
        )
    )


async def mcp_search_execute(params: MCPSearchParams, ctx: ToolContext) -> ToolOutput:
    """Search available MCP tools by keyword.

    Args:
        params: Search parameters
        ctx: Tool execution context

    Returns:
        ToolOutput listing matched MCP tools with names and descriptions
    """
    registry = ctx.extra.get("tool_registry")
    if not registry:
        return ToolOutput.error("Tool registry not available")

    # Get all MCP tools from registry
    mcp_tools = await registry.list(source="mcp")

    if not mcp_tools:
        return ToolOutput(
            title="MCP Search",
            output="No MCP tools available. No MCP servers are configured.",
        )

    # Keyword matching (case-insensitive, match against name and description)
    query_lower = params.query.lower()
    query_words = query_lower.split()

    scored: list[tuple[int, dict[str, Any]]] = []
    for tool in mcp_tools:
        name = tool.get("name", "").lower()
        desc = tool.get("description", "").lower()
        searchable = f"{name} {desc}"

        # Score by number of matching words
        score = sum(1 for word in query_words if word in searchable)
        if score > 0:
            scored.append((score, tool))

    # Sort by score descending
    scored.sort(key=lambda x: x[0], reverse=True)
    matches = [tool for _, tool in scored]

    # If no matches, show all tools as fallback (capped)
    if not matches:
        matches = mcp_tools[:15]
        header = f"No exact matches for '{params.query}'. Showing all {len(matches)} MCP tools:"
    else:
        matches = matches[:15]
        header = f"Found {len(matches)} MCP tools matching '{params.query}':"

    # Format output
    lines = [header]
    for t in matches:
        name = t.get("name", "unknown")
        desc = t.get("description", "")
        # Truncate long descriptions
        if len(desc) > 120:
            desc = desc[:117] + "..."
        lines.append(f"- **{name}**: {desc}")

    lines.append("")
    lines.append("Use the tool name directly to call it (e.g., call the tool by its name above).")

    return ToolOutput(
        title=f"MCP Search: {params.query}",
        output="\n".join(lines),
        metadata={"query": params.query, "match_count": len(matches)},
    )


MCPSearchTool = Tool.define(
    id="mcp_search",
    description=(
        "Search for available MCP (Model Context Protocol) tools by keyword. "
        "Use this when you need capabilities from external MCP servers "
        "(browser automation, file operations, database access, etc.). "
        "Returns matching tool names and descriptions that you can then call directly."
    ),
    parameters=MCPSearchParams,
    execute=mcp_search_execute,
)
