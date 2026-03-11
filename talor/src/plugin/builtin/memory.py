"""Memory Plugin for Talor.

This plugin retrieves conversation history from short-term memory
and provides it to the prompt building pipeline.

Responsibilities:
- Get messages from ShortTermMemory (singleton per session)
- Provide token-aware, summarized context
- Pass messages to prompt builder via metadata

Note: This plugin does NOT build LLM messages directly.
The prompt building pipeline handles message formatting.
"""

from __future__ import annotations

import logging
from typing import Any

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult
from src.session import get_session
from src.provider import get_model

logger = logging.getLogger(__name__)


class MemoryPlugin(PromptPlugin):
    """Memory Plugin - Retrieves conversation history from short-term memory.

    This plugin:
    1. Gets the singleton ShortTermMemory for the session
    2. Configures it with model-specific token limits
    3. Injects LLM summarizer for high-quality auto-summarization
    4. Retrieves messages (with auto-summarization at 80% threshold)
    5. Passes messages to the prompt builder via metadata

    The actual LLM message formatting is done by the prompt builder,
    not by this plugin.
    """

    def __init__(self, provider_service: Any = None) -> None:
        """Initialize the memory plugin.

        Args:
            provider_service: Optional ProviderService for LLM-based summarization
        """
        super().__init__(
            name="memory",
            priority=PluginPriority.MEMORY,
            enabled=True,
            required=True,
        )
        self._provider_service = provider_service

    async def build(self, context: PluginContext) -> PluginResult | None:
        """Retrieve conversation history from short-term memory.

        Args:
            context: Plugin execution context

        Returns:
            PluginResult with messages in metadata
        """
        try:
            # Get session via module-level function
            session = await get_session(context.session_id)
            if not session:
                return PluginResult(
                    content="",
                    section="memory",
                    metadata={"messages": [], "error": "Session not found"},
                )

            # Get model context length and configure memory
            model_context_length = await self._get_model_context_length(
                context.provider_id,
                context.model_id,
            )
            session.memory.configure(model_context_length=model_context_length)

            # Inject LLM summarizer on first access (enables high-quality auto-summarization)
            if not session.memory._summarizer and self._provider_service:
                from src.memory.short_term import SummarizerFactory
                session.memory.configure(
                    summarizer=SummarizerFactory.create_llm_summarizer(
                        provider=self._provider_service,
                    ),
                )

            # Get messages with auto-summarization at 80% threshold
            messages = await session.memory.get_messages_for_llm(
                include_system=False,  # System prompt handled by SystemPlugin
                auto_summarize=True,
            )

            # Get memory stats
            stats = session.memory.get_stats()

            # Log memory status
            if stats["has_summary"]:
                logger.info(
                    f"Memory for session {context.session_id}: "
                    f"{stats['message_count']} messages, "
                    f"{stats['utilization']:.1%} utilization, "
                    f"summarized {stats['summary_covered_messages']} messages"
                )

            return PluginResult(
                content="",  # No content - messages passed via metadata
                section="memory",
                metadata={
                    "messages": messages,
                    "message_count": stats["message_count"],
                    "total_messages": stats["total_messages"],
                    "current_tokens": stats["current_tokens"],
                    "model_context_length": stats["model_context_length"],
                    "token_utilization": stats["utilization"],
                    "has_summary": stats["has_summary"],
                    "summary_covered_messages": stats.get("summary_covered_messages", 0),
                    "key_nodes_count": stats["key_nodes_count"],
                    "pending_tool_calls": stats["pending_tool_calls"],
                },
            )

        except Exception as e:
            logger.error(f"Memory plugin error: {e}", exc_info=True)
            return PluginResult(
                content="",
                section="memory",
                metadata={
                    "messages": [],
                    "error": str(e),
                    "fallback": True,
                },
            )

    async def _get_model_context_length(
        self,
        provider_id: str,
        model_id: str,
    ) -> int:
        """Get model's context length from provider.

        Args:
            provider_id: Provider ID
            model_id: Model ID

        Returns:
            Context length in tokens
        """
        try:
            model = await get_model(provider_id, model_id)
            if model:
                return model.context_length
        except Exception as e:
            logger.warning(f"Failed to get model context length: {e}")

        # Default fallbacks by provider
        defaults = {
            "openai": 128000,
            "anthropic": 200000,
            "google": 1000000,
            "ollama": 32000,
        }
        return defaults.get(provider_id, 32000)
