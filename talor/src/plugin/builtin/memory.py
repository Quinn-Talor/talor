"""Memory Plugin for Talor.

This plugin manages conversation history and context.

Features:
- Conversation history retrieval
- Token-aware truncation
- Tool call history tracking
- Summary inclusion
"""

from __future__ import annotations

from typing import Any

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult


class MemoryPlugin(PromptPlugin):
    """Memory Plugin - Conversation history and context.

    Responsibilities:
    - Retrieve conversation history from session
    - Respect token limits when building context
    - Include tool call history and results
    - Include conversation summary if available
    """

    def __init__(self, max_tokens: int = 32000) -> None:
        """Initialize the memory plugin.

        Args:
            max_tokens: Maximum tokens for context
        """
        super().__init__(
            name="memory",
            priority=PluginPriority.MEMORY,
            enabled=True,
            required=True,
        )
        self._max_tokens = max_tokens

    async def build(self, context: PluginContext) -> PluginResult | None:
        """Build conversation history.

        Args:
            context: Plugin execution context

        Returns:
            PluginResult with conversation history, or None if no messages
        """
        if not context.messages:
            return None

        # Use ShortTermMemory for token-aware truncation
        from src.memory.short_term import ShortTermMemory

        memory = ShortTermMemory(
            session_id=context.session_id,
            max_tokens=self._max_tokens,
        )

        # Add messages to memory
        for msg in context.messages:
            memory.add_message(msg)

        # Get messages within token limit
        messages = memory.get_messages(include_system=False)

        # Format messages for output
        formatted = self._format_messages(messages)

        return PluginResult(
            content=formatted,
            section="memory",
            metadata={
                "message_count": len(messages),
                "total_messages": memory.total_messages,
                "has_pending_tool_calls": memory.has_pending_tool_calls,
            },
        )

    def _format_messages(self, messages: list[dict[str, Any]]) -> str:
        """Format messages for prompt inclusion.

        Args:
            messages: List of message dictionaries

        Returns:
            Formatted message string
        """
        # Return JSON representation for now
        # In actual implementation, this would be handled by the LLM provider
        import json
        return json.dumps(messages, ensure_ascii=False, indent=2)

    def set_max_tokens(self, max_tokens: int) -> None:
        """Set the maximum tokens for context.

        Args:
            max_tokens: Maximum tokens
        """
        self._max_tokens = max_tokens
