"""Short-Term Memory for Talor.

This module provides short-term memory management for agent sessions.
Short-term memory maintains the current conversation context with:
- Message history with sliding window
- Token-aware truncation
- Tool call/result tracking
- Summary generation for long conversations

Example:
    ```python
    memory = ShortTermMemory(session_id="session_123", max_messages=20)

    memory.add_message({"role": "user", "content": "Hello"})
    memory.add_message({"role": "assistant", "content": "Hi there!"})

    # Get messages for LLM context
    messages = memory.get_messages()
    ```
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable
from collections import deque

logger = logging.getLogger(__name__)


@dataclass
class MessageEntry:
    """A message entry in memory."""
    role: str
    content: str | None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None
    name: str | None = None
    timestamp: float = 0
    token_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Convert to message dict format."""
        msg: dict[str, Any] = {"role": self.role}

        if self.content is not None:
            msg["content"] = self.content

        if self.tool_calls:
            msg["tool_calls"] = self.tool_calls

        if self.tool_call_id:
            msg["tool_call_id"] = self.tool_call_id

        if self.name:
            msg["name"] = self.name

        return msg


class ShortTermMemory:
    """Short-term memory for a single session.

    Manages conversation history with:
    - Configurable message limit
    - Token-aware context management
    - Automatic summarization for long conversations
    - Tool call tracking
    """

    def __init__(
        self,
        session_id: str,
        max_messages: int = 50,
        max_tokens: int = 32000,
        token_counter: Callable[[str], int] | None = None,
    ) -> None:
        """Initialize short-term memory.

        Args:
            session_id: Session identifier
            max_messages: Maximum messages to retain
            max_tokens: Maximum tokens for context
            token_counter: Optional function to count tokens
        """
        self.session_id = session_id
        self.max_messages = max_messages
        self.max_tokens = max_tokens
        self._token_counter = token_counter or self._default_token_count

        # Message storage
        self._messages: deque[MessageEntry] = deque(maxlen=max_messages)
        self._system_message: MessageEntry | None = None

        # Tracking
        self._total_messages = 0
        self._summarized_count = 0
        self._summary: str | None = None

        # Tool call tracking
        self._pending_tool_calls: dict[str, dict[str, Any]] = {}

    @staticmethod
    def _default_token_count(text: str) -> int:
        """Simple token estimation (4 chars per token)."""
        return len(text) // 4

    def set_system_message(self, content: str) -> None:
        """Set the system message.

        Args:
            content: System message content
        """
        self._system_message = MessageEntry(
            role="system",
            content=content,
            token_count=self._token_counter(content),
        )

    def add_message(self, message: dict[str, Any]) -> None:
        """Add a message to memory.

        Args:
            message: Message dict with role, content, etc.
        """
        import time

        entry = MessageEntry(
            role=message.get("role", "user"),
            content=message.get("content"),
            tool_calls=message.get("tool_calls"),
            tool_call_id=message.get("tool_call_id"),
            name=message.get("name"),
            timestamp=time.time(),
            token_count=self._token_counter(message.get("content", "") or ""),
        )

        # Track tool calls
        if entry.tool_calls:
            for tc in entry.tool_calls:
                call_id = tc.get("id")
                if call_id:
                    self._pending_tool_calls[call_id] = tc

        # Mark tool call as resolved
        if entry.tool_call_id:
            self._pending_tool_calls.pop(entry.tool_call_id, None)

        self._messages.append(entry)
        self._total_messages += 1

    def add_user_message(self, content: str) -> None:
        """Add a user message.

        Args:
            content: Message content
        """
        self.add_message({"role": "user", "content": content})

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
        self.add_message({
            "role": "assistant",
            "content": content,
            "tool_calls": tool_calls,
        })

    def add_tool_result(
        self,
        tool_call_id: str,
        content: str,
        name: str | None = None,
    ) -> None:
        """Add a tool result message.

        Args:
            tool_call_id: ID of the tool call
            content: Tool result content
            name: Optional tool name
        """
        self.add_message({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": content,
            "name": name,
        })

    def get_messages(
        self,
        include_system: bool = True,
        max_tokens: int | None = None,
    ) -> list[dict[str, Any]]:
        """Get messages for LLM context.

        Args:
            include_system: Include system message
            max_tokens: Optional token limit

        Returns:
            List of message dicts
        """
        messages = []
        token_budget = max_tokens or self.max_tokens
        current_tokens = 0

        # Add system message first
        if include_system and self._system_message:
            messages.append(self._system_message.to_dict())
            current_tokens += self._system_message.token_count

        # Add summary if available
        if self._summary:
            summary_tokens = self._token_counter(self._summary)
            if current_tokens + summary_tokens < token_budget:
                messages.append({
                    "role": "system",
                    "content": f"[Previous conversation summary]\n{self._summary}",
                })
                current_tokens += summary_tokens

        # Add messages from newest to oldest, then reverse
        selected = []
        for entry in reversed(self._messages):
            entry_tokens = entry.token_count
            if current_tokens + entry_tokens > token_budget:
                break
            selected.append(entry)
            current_tokens += entry_tokens

        # Reverse to get chronological order
        selected.reverse()

        # Convert to dicts
        for entry in selected:
            messages.append(entry.to_dict())

        return messages

    def get_recent_messages(self, count: int = 10) -> list[dict[str, Any]]:
        """Get most recent messages.

        Args:
            count: Number of messages to return

        Returns:
            List of recent message dicts
        """
        recent = list(self._messages)[-count:]
        return [entry.to_dict() for entry in recent]

    def set_summary(self, summary: str) -> None:
        """Set conversation summary.

        Args:
            summary: Summary text
        """
        self._summary = summary
        self._summarized_count = self._total_messages

    def needs_summarization(self, threshold: int = 30) -> bool:
        """Check if conversation needs summarization.

        Args:
            threshold: Message count threshold

        Returns:
            True if summarization recommended
        """
        unsummarized = self._total_messages - self._summarized_count
        return unsummarized >= threshold

    def get_token_count(self) -> int:
        """Get total token count of current messages."""
        total = 0
        if self._system_message:
            total += self._system_message.token_count
        for entry in self._messages:
            total += entry.token_count
        return total

    def clear(self) -> None:
        """Clear all messages (except system)."""
        self._messages.clear()
        self._pending_tool_calls.clear()
        self._summary = None
        self._summarized_count = 0

    @property
    def message_count(self) -> int:
        """Get current message count."""
        return len(self._messages)

    @property
    def total_messages(self) -> int:
        """Get total messages added (including truncated)."""
        return self._total_messages

    @property
    def has_pending_tool_calls(self) -> bool:
        """Check if there are unresolved tool calls."""
        return len(self._pending_tool_calls) > 0
