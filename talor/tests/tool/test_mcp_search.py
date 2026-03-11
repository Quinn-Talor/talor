"""Tests for MCP Search Tool."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.tool.builtin.mcp_search import (
    MCPSearchTool,
    MCPSearchParams,
    mcp_search_execute,
)
from src.tool.context import ToolContext


def _make_ctx(**extra_overrides) -> ToolContext:
    """Create a ToolContext with mocked services."""
    return ToolContext(
        session_id="test-session",
        message_id="test-message",
        agent="build",
        extra=extra_overrides,
    )


# Sample MCP tools for testing
SAMPLE_MCP_TOOLS = [
    {"name": "mcp_browser_click", "description": "Click an element on a web page"},
    {"name": "mcp_browser_screenshot", "description": "Take a screenshot of the browser"},
    {"name": "mcp_browser_navigate", "description": "Navigate to a URL in the browser"},
    {"name": "mcp_fs_read", "description": "Read a file from the filesystem"},
    {"name": "mcp_fs_write", "description": "Write content to a file on the filesystem"},
    {"name": "mcp_db_query", "description": "Execute a SQL query against a database"},
]


class TestMCPSearchToolDefinition:
    """Test MCP search tool definition."""

    def test_tool_id(self):
        assert MCPSearchTool.id == "mcp_search"

    def test_tool_description(self):
        assert "mcp" in MCPSearchTool.description.lower()
        assert "search" in MCPSearchTool.description.lower()

    def test_params_schema(self):
        schema = MCPSearchTool.get_parameters_schema()
        props = schema["properties"]
        assert "query" in props
        assert "query" in schema["required"]


class TestMCPSearchExecution:
    """Test MCP search execution logic."""

    @pytest.mark.asyncio
    async def test_missing_registry_returns_error(self):
        ctx = _make_ctx()  # No tool_registry
        params = MCPSearchParams(query="browser")

        result = await mcp_search_execute(params, ctx)

        assert result.metadata.get("error") is True
        assert "registry" in result.output.lower()

    @pytest.mark.asyncio
    async def test_no_mcp_tools_available(self):
        registry = MagicMock()
        registry.list = AsyncMock(return_value=[])

        ctx = _make_ctx(tool_registry=registry)
        params = MCPSearchParams(query="browser")

        result = await mcp_search_execute(params, ctx)

        assert "no mcp tools" in result.output.lower()

    @pytest.mark.asyncio
    async def test_keyword_matching(self):
        registry = MagicMock()
        registry.list = AsyncMock(return_value=SAMPLE_MCP_TOOLS)

        ctx = _make_ctx(tool_registry=registry)
        params = MCPSearchParams(query="browser")

        result = await mcp_search_execute(params, ctx)

        assert "mcp_browser_click" in result.output
        assert "mcp_browser_screenshot" in result.output
        assert "mcp_browser_navigate" in result.output
        # Non-browser tools should NOT appear
        assert "mcp_fs_read" not in result.output
        assert "mcp_db_query" not in result.output

    @pytest.mark.asyncio
    async def test_multi_word_query_scoring(self):
        registry = MagicMock()
        registry.list = AsyncMock(return_value=SAMPLE_MCP_TOOLS)

        ctx = _make_ctx(tool_registry=registry)
        params = MCPSearchParams(query="file filesystem")

        result = await mcp_search_execute(params, ctx)

        # filesystem tools should match
        assert "mcp_fs_read" in result.output
        assert "mcp_fs_write" in result.output

    @pytest.mark.asyncio
    async def test_no_matches_shows_fallback(self):
        registry = MagicMock()
        registry.list = AsyncMock(return_value=SAMPLE_MCP_TOOLS)

        ctx = _make_ctx(tool_registry=registry)
        params = MCPSearchParams(query="completely_unrelated_xyzzy")

        result = await mcp_search_execute(params, ctx)

        # Should show fallback tools (all tools up to cap)
        assert "no exact matches" in result.output.lower()
        assert result.metadata["match_count"] > 0

    @pytest.mark.asyncio
    async def test_case_insensitive_matching(self):
        registry = MagicMock()
        registry.list = AsyncMock(return_value=SAMPLE_MCP_TOOLS)

        ctx = _make_ctx(tool_registry=registry)
        params = MCPSearchParams(query="DATABASE")

        result = await mcp_search_execute(params, ctx)

        assert "mcp_db_query" in result.output

    @pytest.mark.asyncio
    async def test_result_metadata(self):
        registry = MagicMock()
        registry.list = AsyncMock(return_value=SAMPLE_MCP_TOOLS)

        ctx = _make_ctx(tool_registry=registry)
        params = MCPSearchParams(query="browser")

        result = await mcp_search_execute(params, ctx)

        assert result.metadata["query"] == "browser"
        assert result.metadata["match_count"] == 3

    @pytest.mark.asyncio
    async def test_long_description_truncated(self):
        long_tools = [
            {"name": "mcp_long_tool", "description": "A" * 200},
        ]
        registry = MagicMock()
        registry.list = AsyncMock(return_value=long_tools)

        ctx = _make_ctx(tool_registry=registry)
        params = MCPSearchParams(query="long")

        result = await mcp_search_execute(params, ctx)

        # Description should be truncated with ...
        assert "..." in result.output
