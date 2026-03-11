"""Tests for Subagent Tool."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.tool.builtin.subagent import (
    SubagentTool,
    SubagentParams,
    subagent_execute,
    MAX_SUBAGENT_DEPTH,
)
from src.tool.context import ToolContext
from src.tool.output import ToolOutput


def _make_ctx(**extra_overrides) -> ToolContext:
    """Create a ToolContext with mocked services."""
    return ToolContext(
        session_id="test-session",
        message_id="test-message",
        agent="build",
        extra=extra_overrides,
    )


class TestSubagentTool:
    """Test subagent tool definition."""

    def test_tool_id(self):
        assert SubagentTool.id == "subagent"

    def test_tool_description(self):
        assert "subagent" in SubagentTool.description.lower()

    def test_params_schema(self):
        schema = SubagentTool.get_parameters_schema()
        props = schema["properties"]
        assert "agent" in props
        assert "prompt" in props
        assert set(schema["required"]) == {"agent", "prompt"}


class TestSubagentExecution:
    """Test subagent execution logic."""

    @pytest.mark.asyncio
    async def test_missing_services_returns_error(self):
        ctx = _make_ctx()  # No executor/agent_service/session_service
        params = SubagentParams(agent="explore", prompt="test")

        result = await subagent_execute(params, ctx)

        assert result.metadata.get("error") is True
        assert "missing" in result.output.lower()

    @pytest.mark.asyncio
    async def test_nesting_depth_limit(self):
        ctx = _make_ctx(
            subagent_depth=MAX_SUBAGENT_DEPTH,
            executor=MagicMock(),
            agent_service=MagicMock(),
            session_service=MagicMock(),
        )
        params = SubagentParams(agent="explore", prompt="test")

        result = await subagent_execute(params, ctx)

        assert result.metadata.get("error") is True
        assert "nesting limit" in result.output.lower()

    @pytest.mark.asyncio
    async def test_agent_not_found(self):
        agent_service = MagicMock()
        agent_service.get_agent = AsyncMock(return_value=None)

        ctx = _make_ctx(
            executor=MagicMock(),
            agent_service=agent_service,
            session_service=MagicMock(),
        )
        params = SubagentParams(agent="nonexistent", prompt="test")

        result = await subagent_execute(params, ctx)

        assert result.metadata.get("error") is True
        assert "not found" in result.output.lower()

    @pytest.mark.asyncio
    async def test_agent_not_subagent_scope(self):
        agent = MagicMock()
        agent.is_subagent = False
        agent.scope = "primary"

        agent_service = MagicMock()
        agent_service.get_agent = AsyncMock(return_value=agent)

        ctx = _make_ctx(
            executor=MagicMock(),
            agent_service=agent_service,
            session_service=MagicMock(),
        )
        params = SubagentParams(agent="build", prompt="test")

        result = await subagent_execute(params, ctx)

        assert result.metadata.get("error") is True
        assert "cannot be used as subagent" in result.output.lower()

    @pytest.mark.asyncio
    async def test_successful_execution(self):
        # Mock agent
        agent = MagicMock()
        agent.is_subagent = True

        agent_service = MagicMock()
        agent_service.get_agent = AsyncMock(return_value=agent)

        # Mock session service
        mock_user_msg = MagicMock()
        mock_user_msg.info.role = "user"
        mock_user_msg.info.model = {"provider_id": "ollama", "model_id": "qwen3:4b"}

        session_service = MagicMock()
        session_service.get_messages = AsyncMock(return_value=[mock_user_msg])

        sub_session = MagicMock()
        sub_session.id = "sub-session-123"
        session_service.create_session = AsyncMock(return_value=sub_session)

        # Mock executor
        result_msg = MagicMock()
        result_msg.get_text_content.return_value = "Found 3 relevant files."

        executor = MagicMock()
        executor.execute = AsyncMock(return_value=result_msg)

        ctx = _make_ctx(
            executor=executor,
            agent_service=agent_service,
            session_service=session_service,
        )
        params = SubagentParams(agent="explore", prompt="Find test files")

        result = await subagent_execute(params, ctx)

        assert result.output == "Found 3 relevant files."
        assert result.title == "Subagent: explore"
        assert result.metadata["agent"] == "explore"
        assert result.metadata["sub_session_id"] == "sub-session-123"

        # Verify executor was called with correct params
        executor.execute.assert_called_once_with(
            session_id="sub-session-123",
            parts=[{"type": "text", "text": "Find test files"}],
            model={"provider_id": "ollama", "model_id": "qwen3:4b"},
            agent="explore",
        )

    @pytest.mark.asyncio
    async def test_execution_error_returns_error_output(self):
        agent = MagicMock()
        agent.is_subagent = True

        agent_service = MagicMock()
        agent_service.get_agent = AsyncMock(return_value=agent)

        mock_user_msg = MagicMock()
        mock_user_msg.info.role = "user"
        mock_user_msg.info.model = {"provider_id": "ollama", "model_id": "qwen3:4b"}

        session_service = MagicMock()
        session_service.get_messages = AsyncMock(return_value=[mock_user_msg])

        sub_session = MagicMock()
        sub_session.id = "sub-session-err"
        session_service.create_session = AsyncMock(return_value=sub_session)

        executor = MagicMock()
        executor.execute = AsyncMock(side_effect=RuntimeError("LLM timeout"))

        ctx = _make_ctx(
            executor=executor,
            agent_service=agent_service,
            session_service=session_service,
        )
        params = SubagentParams(agent="explore", prompt="test")

        result = await subagent_execute(params, ctx)

        assert result.metadata.get("error") is True
        assert "LLM timeout" in result.output
