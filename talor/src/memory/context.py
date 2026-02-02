"""Memory Context for Talor.

This module provides the MemoryContext class that integrates
short-term and long-term memory for agent execution.

Example:
    ```python
    ctx = MemoryContext(session_id="session_123")

    # Build context for LLM
    messages = ctx.build_context(
        user_prompt="Help me with this code",
        max_tokens=8000,
    )
    ```
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, TYPE_CHECKING

from src.memory.short_term import ShortTermMemory

if TYPE_CHECKING:
    pass


logger = logging.getLogger(__name__)


@dataclass
class ContextConfig:
    """Configuration for memory context."""
    max_short_term_messages: int = 50
    max_context_tokens: int = 32000
    enable_long_term: bool = False
    summarization_threshold: int = 30


class MemoryContext:
    """Unified memory context for agent execution.

    Combines short-term and long-term memory to build
    optimal context for LLM calls.
    """

    def __init__(
        self,
        session_id: str,
        config: ContextConfig | None = None,
    ) -> None:
        """Initialize memory context.

        Args:
            session_id: Session identifier
            config: Context configuration
        """
        self.session_id = session_id
        self.config = config or ContextConfig()

        # Initialize short-term memory
        self.short_term = ShortTermMemory(
            session_id=session_id,
            max_messages=self.config.max_short_term_messages,
            max_tokens=self.config.max_context_tokens,
        )

        # Long-term memory placeholder
        self._long_term_enabled = self.config.enable_long_term

    def set_system_prompt(self, prompt: str) -> None:
        """Set the system prompt.

        Args:
            prompt: System prompt content
        """
        self.short_term.set_system_message(prompt)

    def add_user_message(self, content: str) -> None:
        """Add a user message.

        Args:
            content: Message content
        """
        self.short_term.add_user_message(content)

    def add_assistant_message(
        self,
        content: str | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
    ) -> None:
        """Add an assistant message.

        Args:
            content: Message content
            tool_calls: Optional tool calls
        """
        self.short_term.add_assistant_message(content, tool_calls)

    def add_tool_result(
        self,
        tool_call_id: str,
        content: str,
        name: str | None = None,
    ) -> None:
        """Add a tool result.

        Args:
            tool_call_id: Tool call ID
            content: Result content
            name: Tool name
        """
        self.short_term.add_tool_result(tool_call_id, content, name)

    def build_context(
        self,
        user_prompt: str | None = None,
        max_tokens: int | None = None,
        include_long_term: bool = True,
    ) -> list[dict[str, Any]]:
        """Build context for LLM call.

        Args:
            user_prompt: Optional new user prompt to add
            max_tokens: Token limit for context
            include_long_term: Include long-term memory

        Returns:
            List of messages for LLM
        """
        # Add user prompt if provided
        if user_prompt:
            self.add_user_message(user_prompt)

        # Get short-term messages
        messages = self.short_term.get_messages(
            include_system=True,
            max_tokens=max_tokens or self.config.max_context_tokens,
        )

        # TODO: Add long-term memory retrieval
        # if include_long_term and self._long_term_enabled:
        #     relevant = self._retrieve_long_term(user_prompt)
        #     messages = self._inject_long_term(messages, relevant)

        return messages

    def get_recent_context(self, message_count: int = 5) -> list[dict[str, Any]]:
        """Get recent conversation context.

        Args:
            message_count: Number of recent messages

        Returns:
            Recent messages
        """
        return self.short_term.get_recent_messages(message_count)

    async def summarize_if_needed(
        self,
        summarizer: Any = None,
    ) -> str | None:
        """Summarize conversation if needed.

        Args:
            summarizer: Optional summarization function

        Returns:
            Summary if generated, None otherwise
        """
        if not self.short_term.needs_summarization(
            self.config.summarization_threshold
        ):
            return None

        # Get messages to summarize
        messages = self.short_term.get_messages(include_system=False)

        if summarizer:
            summary = await summarizer(messages)
            self.short_term.set_summary(summary)
            return summary

        # Simple fallback summary
        summary = self._generate_simple_summary(messages)
        self.short_term.set_summary(summary)
        return summary

    def _generate_simple_summary(
        self,
        messages: list[dict[str, Any]],
    ) -> str:
        """Generate a simple summary of messages.

        Args:
            messages: Messages to summarize

        Returns:
            Simple summary text
        """
        user_messages = [m for m in messages if m.get("role") == "user"]
        tool_calls = sum(
            1 for m in messages
            if m.get("role") == "assistant" and m.get("tool_calls")
        )

        topics = []
        for msg in user_messages[-3:]:
            content = msg.get("content", "")
            if content:
                # Extract first sentence or first 100 chars
                first_sentence = content.split(".")[0][:100]
                topics.append(first_sentence)

        summary = f"Conversation with {len(messages)} messages, {tool_calls} tool calls."
        if topics:
            summary += f" Recent topics: {'; '.join(topics)}"

        return summary

    def clear(self) -> None:
        """Clear all memory."""
        self.short_term.clear()

    @property
    def token_count(self) -> int:
        """Get current token count."""
        return self.short_term.get_token_count()

    @property
    def message_count(self) -> int:
        """Get current message count."""
        return self.short_term.message_count
