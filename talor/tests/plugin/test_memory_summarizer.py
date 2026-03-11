"""Functional tests for MemoryPlugin LLM Summarizer injection.

Optimization 4: Verifies that MemoryPlugin correctly injects
SummarizerFactory.create_llm_summarizer() into ShortTermMemory
on first build() call when provider_service is available.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.plugin.builtin.memory import MemoryPlugin
from src.plugin.context import PluginContext


def _make_session_with_memory(summarizer=None):
    """Create a mock session with real-like memory mock."""
    memory = MagicMock()
    memory._summarizer = summarizer  # Start with no summarizer

    def configure_side_effect(**kwargs):
        if "summarizer" in kwargs:
            memory._summarizer = kwargs["summarizer"]

    memory.configure.side_effect = configure_side_effect
    memory.get_stats.return_value = {
        "message_count": 5,
        "total_messages": 5,
        "current_tokens": 1000,
        "model_context_length": 32000,
        "utilization": 0.03,
        "has_summary": False,
        "summary_covered_messages": 0,
        "key_nodes_count": 0,
        "pending_tool_calls": 0,
    }
    memory.get_messages_for_llm = AsyncMock(return_value=[
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there"},
    ])

    session = MagicMock()
    session.memory = memory
    return session


def _make_ctx(session_id="test-session", provider_id="ollama", model_id="qwen3:4b"):
    ctx = MagicMock(spec=PluginContext)
    ctx.session_id = session_id
    ctx.agent_name = "build"
    ctx.provider_id = provider_id
    ctx.model_id = model_id
    return ctx


class TestMemoryPluginSummarizerInjection:
    """Tests for LLM summarizer injection in MemoryPlugin."""

    @pytest.mark.asyncio
    async def test_no_provider_no_summarizer_injection(self):
        """Without provider_service, summarizer should remain None."""
        plugin = MemoryPlugin()  # No provider_service
        assert plugin._provider_service is None

        session = _make_session_with_memory()

        with patch("src.plugin.builtin.memory.get_session", return_value=session), \
             patch("src.memory.short_term.SummarizerFactory") as mock_factory:
            await plugin.build(_make_ctx())
            mock_factory.create_llm_summarizer.assert_not_called()
            assert session.memory._summarizer is None

    @pytest.mark.asyncio
    async def test_with_provider_injects_summarizer_on_first_build(self):
        """With provider_service, summarizer is injected on first build."""
        mock_provider = MagicMock()
        plugin = MemoryPlugin(provider_service=mock_provider)

        session = _make_session_with_memory()  # No summarizer initially

        with patch("src.plugin.builtin.memory.get_session", return_value=session), \
             patch("src.memory.short_term.SummarizerFactory") as mock_factory:
            mock_summarizer = AsyncMock()
            mock_factory.create_llm_summarizer.return_value = mock_summarizer

            await plugin.build(_make_ctx())

            # Verify summarizer was created with the provider
            mock_factory.create_llm_summarizer.assert_called_once_with(
                provider=mock_provider
            )
            # Verify it was injected into session memory
            assert session.memory._summarizer is mock_summarizer

    @pytest.mark.asyncio
    async def test_summarizer_injected_only_once(self):
        """Summarizer should not be re-injected if already set."""
        mock_provider = MagicMock()
        plugin = MemoryPlugin(provider_service=mock_provider)

        existing_summarizer = AsyncMock()
        session = _make_session_with_memory(summarizer=existing_summarizer)

        with patch("src.plugin.builtin.memory.get_session", return_value=session), \
             patch("src.memory.short_term.SummarizerFactory") as mock_factory:
            await plugin.build(_make_ctx())
            # Should NOT be called again since summarizer already exists
            mock_factory.create_llm_summarizer.assert_not_called()
            # Existing summarizer should be unchanged
            assert session.memory._summarizer is existing_summarizer

    @pytest.mark.asyncio
    async def test_auto_summarize_called_on_get_messages(self):
        """get_messages_for_llm should be called with auto_summarize=True."""
        mock_provider = MagicMock()
        plugin = MemoryPlugin(provider_service=mock_provider)
        session = _make_session_with_memory()

        with patch("src.plugin.builtin.memory.get_session", return_value=session), \
             patch("src.memory.short_term.SummarizerFactory"):
            await plugin.build(_make_ctx())
            session.memory.get_messages_for_llm.assert_called_once_with(
                include_system=False,
                auto_summarize=True,
            )

    @pytest.mark.asyncio
    async def test_plugin_result_contains_memory_stats(self):
        """PluginResult metadata should include memory stats."""
        mock_provider = MagicMock()
        plugin = MemoryPlugin(provider_service=mock_provider)
        session = _make_session_with_memory()

        with patch("src.plugin.builtin.memory.get_session", return_value=session), \
             patch("src.memory.short_term.SummarizerFactory"):
            result = await plugin.build(_make_ctx())

        assert result is not None
        assert "messages" in result.metadata
        assert "token_utilization" in result.metadata
        assert "has_summary" in result.metadata
        assert result.metadata["message_count"] == 5

    @pytest.mark.asyncio
    async def test_session_not_found_returns_error_result(self):
        """If session is not found, return graceful error."""
        plugin = MemoryPlugin()
        with patch("src.plugin.builtin.memory.get_session", return_value=None):
            result = await plugin.build(_make_ctx())

        assert result is not None
        assert result.metadata.get("error") == "Session not found"
        assert result.metadata["messages"] == []
