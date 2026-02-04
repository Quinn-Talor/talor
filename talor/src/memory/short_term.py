"""Short-Term Memory for Talor.

This module provides short-term memory management for agent sessions.
Short-term memory maintains the current conversation context with:
- Message history with sliding window
- Token-aware truncation based on model context length
- Automatic summarization at 80% threshold
- Key node preservation (tool calls, important decisions)
- Tool call/result tracking

Following DDD principles:
- ShortTermMemory is a domain entity owned by Session
- No class-level state or singletons
- Instance-based configuration
- Summarizer injected via constructor or configure()

Example:
    ```python
    # Create memory instance (typically owned by Session)
    memory = ShortTermMemory(session_id="session_123")

    # Configure with model context length and summarizer
    memory.configure(
        model_context_length=128000,
        summarizer=my_summarizer_func,
    )

    memory.add_user_message("Hello")
    memory.add_assistant_message("Hi there!")

    # Get messages for LLM context (auto-summarizes if needed)
    messages = await memory.get_messages_for_llm()
    ```
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Awaitable
from collections import deque

logger = logging.getLogger(__name__)


# =============================================================================
# Constants
# =============================================================================

DEFAULT_MAX_MESSAGES = 100
DEFAULT_CONTEXT_LENGTH = 32000
SUMMARIZATION_THRESHOLD = 0.8  # 80% of context triggers summarization
SUMMARY_RESERVE_RATIO = 0.3   # Reserve 30% of context for new content after summary
MIN_MESSAGES_FOR_SUMMARY = 10  # Minimum messages before considering summary


# =============================================================================
# Message Entry
# =============================================================================

class MessageImportance(Enum):
    """Message importance level for key node preservation."""
    NORMAL = 0
    TOOL_CALL = 1      # Tool invocation
    TOOL_RESULT = 2    # Tool execution result
    DECISION = 3       # Important decision point
    ERROR = 4          # Error that needs context
    MILESTONE = 5      # Task milestone/completion


@dataclass
class MessageEntry:
    """A message entry in memory with metadata."""
    role: str
    content: str | None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None
    name: str | None = None
    timestamp: float = field(default_factory=time.time)
    token_count: int = 0
    importance: MessageImportance = MessageImportance.NORMAL
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to message dict format for LLM."""
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

    @property
    def is_key_node(self) -> bool:
        """Check if this is a key node that should be preserved."""
        return self.importance.value >= MessageImportance.TOOL_CALL.value


@dataclass
class ConversationSummary:
    """Summary of conversation history."""
    content: str
    covered_message_count: int
    covered_token_count: int
    key_points: list[str] = field(default_factory=list)
    timestamp: float = field(default_factory=time.time)
    token_count: int = 0


# =============================================================================
# Summarizer Factory
# =============================================================================

class SummarizerFactory:
    """Factory for creating summarizer functions.

    Provides a way to create summarizers without coupling to specific providers.
    """

    # Cache for loaded prompt template
    _cached_prompt_template: str | None = None

    @staticmethod
    def _load_summarize_prompt() -> str:
        """Load summarize prompt from file.

        Returns:
            Prompt template with {{conversation}} placeholder
        """
        if SummarizerFactory._cached_prompt_template:
            return SummarizerFactory._cached_prompt_template

        try:
            # Get the project root (talor/)
            # This file is at: talor/src/memory/short_term.py
            # We need to go up 2 levels to reach talor/
            current_file = Path(__file__)
            project_root = current_file.parent.parent.parent
            prompt_file = project_root / "prompts" / "memory" / "summarize.md"

            if prompt_file.exists():
                content = prompt_file.read_text(encoding="utf-8")
                # Strip markdown header if present
                if content.startswith("# "):
                    lines = content.split("\n", 1)
                    content = lines[1].strip() if len(lines) > 1 else content
                SummarizerFactory._cached_prompt_template = content
                logger.info(f"Loaded summarize prompt from {prompt_file}")
                return content
            else:
                logger.warning(f"Summarize prompt file not found: {prompt_file}, using fallback")
                return SummarizerFactory._get_fallback_prompt()

        except Exception as e:
            logger.error(f"Failed to load summarize prompt from file: {e}, using fallback")
            return SummarizerFactory._get_fallback_prompt()

    @staticmethod
    def _get_fallback_prompt() -> str:
        """Get fallback summarize prompt.

        Returns:
            Fallback prompt template
        """
        return """Summarize the following conversation concisely.

## Focus Areas

1. **Main topics discussed** - What were the primary subjects of conversation?
2. **Key decisions made** - What important choices or conclusions were reached?
3. **Important tool calls and their results** - Which tools were used and what did they accomplish?
4. **Any errors or issues encountered** - Were there any problems or failures?
5. **Current state/progress** - Where are we now in the task?

## Guidelines

- Keep the summary under 500 words
- Be concise but preserve critical information
- Maintain chronological order when relevant
- Highlight any unresolved issues or next steps

## Conversation

{{conversation}}

## Summary"""

    @staticmethod
    def create_llm_summarizer(
        provider: Any,
        model: str | None = None,
    ) -> Callable[[list[dict]], Awaitable[str]]:
        """Create an LLM-based summarizer function.

        Args:
            provider: Provider service for LLM calls
            model: Model to use for summarization

        Returns:
            Async function that summarizes messages
        """
        async def summarize(messages: list[dict[str, Any]]) -> str:
            # Format messages for summary
            lines = []
            for msg in messages:
                role = msg.get("role", "unknown")
                content = msg.get("content", "")

                if role == "user":
                    lines.append(f"User: {content}")
                elif role == "assistant":
                    if content:
                        lines.append(f"Assistant: {content}")
                    tool_calls = msg.get("tool_calls", [])
                    for tc in tool_calls:
                        func = tc.get("function", {})
                        lines.append(f"  [Tool Call: {func.get('name', 'unknown')}]")
                elif role == "tool":
                    name = msg.get("name", "tool")
                    result = content[:200] + "..." if len(content) > 200 else content
                    lines.append(f"  [Tool Result ({name}): {result}]")

            conversation_text = "\n".join(lines)

            # Load prompt template and replace placeholder
            prompt_template = SummarizerFactory._load_summarize_prompt()
            summary_prompt = prompt_template.replace("{{conversation}}", conversation_text)

            use_model = model or "ollama/deepseek-v3.1:671b-cloud"

            response = await provider.complete(
                model=use_model,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that creates concise conversation summaries."},
                    {"role": "user", "content": summary_prompt},
                ],
                stream=False,
            )

            return response.get("content", "")

        return summarize


# =============================================================================
# Short-Term Memory (DDD Entity)
# =============================================================================

class ShortTermMemory:
    """Short-term memory entity for a single session.

    A domain entity that manages conversation context for a session.
    Memory is owned by Session instance and accessed via session.memory property.

    Following DDD principles:
    - No class-level state (all state is instance-based)
    - No singleton pattern (instances created by owning Session)
    - Dependencies injected via constructor or configure()

    Features:
    - Token-aware context management based on model limits
    - Automatic summarization at 80% threshold
    - Key node preservation (tool calls, decisions, errors)
    - Pending tool call tracking
    """

    def __init__(
        self,
        session_id: str,
        max_messages: int = DEFAULT_MAX_MESSAGES,
        token_counter: Callable[[str], int] | None = None,
        summarizer: Callable[[list[dict]], Awaitable[str]] | None = None,
    ) -> None:
        """Initialize short-term memory.

        Args:
            session_id: Session identifier
            max_messages: Maximum messages to retain in memory
            token_counter: Optional function to count tokens
            summarizer: Optional async function to generate summaries
        """
        self.session_id = session_id
        self.max_messages = max_messages
        self._token_counter = token_counter or self._default_token_count
        self._summarizer = summarizer

        # Model context configuration
        self._model_context_length = DEFAULT_CONTEXT_LENGTH
        self._summarization_threshold = SUMMARIZATION_THRESHOLD

        # Message storage
        self._messages: deque[MessageEntry] = deque(maxlen=max_messages)
        self._system_message: MessageEntry | None = None

        # Summarization
        self._summary: ConversationSummary | None = None

        # Tracking
        self._total_messages_added = 0
        self._pending_tool_calls: dict[str, dict[str, Any]] = {}
        self._key_nodes: list[MessageEntry] = []  # Preserved key nodes

        # State
        self._initialized = False
        self._lock = asyncio.Lock()

    # =========================================================================
    # Configuration
    # =========================================================================

    def configure(
        self,
        model_context_length: int | None = None,
        summarization_threshold: float | None = None,
        summarizer: Callable[[list[dict]], Awaitable[str]] | None = None,
    ) -> None:
        """Configure memory with model-specific settings.

        Args:
            model_context_length: Model's maximum context length in tokens
            summarization_threshold: Threshold (0-1) to trigger summarization
            summarizer: Async function to generate summaries
        """
        if model_context_length is not None:
            self._model_context_length = model_context_length
            logger.debug(f"Set model context length to {model_context_length}")

        if summarization_threshold is not None:
            self._summarization_threshold = summarization_threshold

        if summarizer is not None:
            self._summarizer = summarizer

    @property
    def context_budget(self) -> int:
        """Get available token budget for context."""
        return self._model_context_length

    @property
    def summarization_trigger(self) -> int:
        """Get token count that triggers summarization."""
        return int(self._model_context_length * self._summarization_threshold)

    # =========================================================================
    # Token Counting
    # =========================================================================

    @staticmethod
    def _default_token_count(text: str) -> int:
        """Simple token estimation (4 chars per token).

        This is a rough estimate. For production, use tiktoken or similar.
        """
        if not text:
            return 0
        return len(text) // 4

    def _count_message_tokens(self, entry: MessageEntry) -> int:
        """Count tokens for a message entry."""
        total = 0

        if entry.content:
            total += self._token_counter(entry.content)

        if entry.tool_calls:
            # Estimate tokens for tool calls
            import json
            total += self._token_counter(json.dumps(entry.tool_calls))

        # Add overhead for message structure
        total += 4  # role, separators, etc.

        return total

    # =========================================================================
    # Message Management
    # =========================================================================

    def set_system_message(self, content: str) -> None:
        """Set the system message.

        Args:
            content: System message content
        """
        token_count = self._token_counter(content)
        self._system_message = MessageEntry(
            role="system",
            content=content,
            token_count=token_count,
            importance=MessageImportance.MILESTONE,
        )
        logger.debug(f"Set system message ({token_count} tokens)")

    def add_message(self, message: dict[str, Any]) -> MessageEntry:
        """Add a message to memory.

        Args:
            message: Message dict with role, content, etc.

        Returns:
            Created MessageEntry
        """
        # Determine importance
        importance = MessageImportance.NORMAL
        if message.get("tool_calls"):
            importance = MessageImportance.TOOL_CALL
        elif message.get("tool_call_id"):
            importance = MessageImportance.TOOL_RESULT
        elif message.get("role") == "assistant" and "error" in str(message.get("content", "")).lower():
            importance = MessageImportance.ERROR

        # Create entry
        content = message.get("content") or ""
        entry = MessageEntry(
            role=message.get("role", "user"),
            content=message.get("content"),
            tool_calls=message.get("tool_calls"),
            tool_call_id=message.get("tool_call_id"),
            name=message.get("name"),
            timestamp=time.time(),
            importance=importance,
            metadata=message.get("metadata", {}),
        )
        entry.token_count = self._count_message_tokens(entry)

        # Track tool calls
        if entry.tool_calls:
            for tc in entry.tool_calls:
                call_id = tc.get("id")
                if call_id:
                    self._pending_tool_calls[call_id] = tc

        # Mark tool call as resolved
        if entry.tool_call_id:
            self._pending_tool_calls.pop(entry.tool_call_id, None)

        # Preserve key nodes
        if entry.is_key_node:
            self._key_nodes.append(entry)
            # Limit key nodes to prevent unbounded growth
            if len(self._key_nodes) > 50:
                self._key_nodes = self._key_nodes[-30:]

        self._messages.append(entry)
        self._total_messages_added += 1

        return entry

    def add_user_message(self, content: str) -> MessageEntry:
        """Add a user message.

        Args:
            content: Message content

        Returns:
            Created MessageEntry
        """
        return self.add_message({"role": "user", "content": content})

    def add_assistant_message(
        self,
        content: str | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
    ) -> MessageEntry:
        """Add an assistant message.

        Args:
            content: Message content
            tool_calls: Optional tool calls

        Returns:
            Created MessageEntry
        """
        return self.add_message({
            "role": "assistant",
            "content": content,
            "tool_calls": tool_calls,
        })

    def add_tool_result(
        self,
        tool_call_id: str,
        content: str,
        name: str | None = None,
    ) -> MessageEntry:
        """Add a tool result message.

        Args:
            tool_call_id: ID of the tool call
            content: Tool result content
            name: Optional tool name

        Returns:
            Created MessageEntry
        """
        return self.add_message({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": content,
            "name": name,
        })

    def mark_milestone(self, description: str) -> None:
        """Mark a milestone in the conversation.

        Args:
            description: Milestone description
        """
        if self._messages:
            last = self._messages[-1]
            last.importance = MessageImportance.MILESTONE
            last.metadata["milestone"] = description
            if last not in self._key_nodes:
                self._key_nodes.append(last)

    # =========================================================================
    # Context Retrieval
    # =========================================================================

    def get_current_token_count(self) -> int:
        """Get total token count of current messages."""
        total = 0

        if self._system_message:
            total += self._system_message.token_count

        if self._summary:
            total += self._summary.token_count

        for entry in self._messages:
            total += entry.token_count

        return total

    def needs_summarization(self) -> bool:
        """Check if summarization is needed based on 80% threshold."""
        if len(self._messages) < MIN_MESSAGES_FOR_SUMMARY:
            return False

        current_tokens = self.get_current_token_count()
        threshold = self.summarization_trigger

        return current_tokens >= threshold

    async def get_messages_for_llm(
        self,
        include_system: bool = True,
        max_tokens: int | None = None,
        auto_summarize: bool = True,
    ) -> list[dict[str, Any]]:
        """Get messages for LLM context with automatic summarization.

        This is the main method for retrieving conversation context.
        Automatically triggers summarization at 80% threshold.

        Args:
            include_system: Include system message
            max_tokens: Optional token limit (defaults to model context)
            auto_summarize: Whether to auto-summarize when threshold reached

        Returns:
            List of message dicts for LLM
        """
        async with self._lock:
            # Check if summarization needed
            if auto_summarize and self.needs_summarization():
                await self._perform_summarization()

            return self._build_context(include_system, max_tokens)

    def get_messages_sync(
        self,
        include_system: bool = True,
        max_tokens: int | None = None,
    ) -> list[dict[str, Any]]:
        """Get messages synchronously (no auto-summarization).

        Args:
            include_system: Include system message
            max_tokens: Optional token limit

        Returns:
            List of message dicts for LLM
        """
        return self._build_context(include_system, max_tokens)

    # Alias for backward compatibility
    def get_messages(
        self,
        include_system: bool = True,
        max_tokens: int | None = None,
    ) -> list[dict[str, Any]]:
        """Get messages (sync, backward compatible).

        Alias for get_messages_sync().

        Args:
            include_system: Include system message
            max_tokens: Optional token limit

        Returns:
            List of message dicts for LLM
        """
        return self.get_messages_sync(include_system, max_tokens)

    def _build_context(
        self,
        include_system: bool,
        max_tokens: int | None,
    ) -> list[dict[str, Any]]:
        """Build context messages within token budget.

        Args:
            include_system: Include system message
            max_tokens: Token limit

        Returns:
            List of message dicts
        """
        messages = []
        token_budget = max_tokens or self._model_context_length
        current_tokens = 0

        # 1. Add system message first (always included if present)
        if include_system and self._system_message:
            messages.append(self._system_message.to_dict())
            current_tokens += self._system_message.token_count

        # 2. Add summary if available
        if self._summary:
            summary_msg = {
                "role": "system",
                "content": f"[Conversation Summary]\n{self._summary.content}",
            }
            messages.append(summary_msg)
            current_tokens += self._summary.token_count

        # 3. Collect messages from newest to oldest
        selected: list[MessageEntry] = []
        for entry in reversed(self._messages):
            entry_tokens = entry.token_count

            # Always include key nodes if possible
            if entry.is_key_node:
                if current_tokens + entry_tokens <= token_budget:
                    selected.append(entry)
                    current_tokens += entry_tokens
                continue

            # Include normal messages within budget
            if current_tokens + entry_tokens > token_budget:
                break

            selected.append(entry)
            current_tokens += entry_tokens

        # 4. Reverse to get chronological order
        selected.reverse()

        # 5. Convert to dicts
        for entry in selected:
            messages.append(entry.to_dict())

        logger.debug(
            f"Built context: {len(messages)} messages, {current_tokens}/{token_budget} tokens"
        )

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

    def get_key_nodes(self) -> list[dict[str, Any]]:
        """Get all preserved key nodes.

        Returns:
            List of key node message dicts
        """
        return [entry.to_dict() for entry in self._key_nodes]

    # =========================================================================
    # Summarization
    # =========================================================================

    async def _perform_summarization(self) -> None:
        """Perform conversation summarization.

        Summarizes older messages while preserving key nodes.
        """
        if not self._summarizer:
            logger.warning("No summarizer configured, using simple summary")
            self._generate_simple_summary()
            return

        try:
            # Get messages to summarize (older half)
            messages_list = list(self._messages)
            split_point = len(messages_list) // 2

            # Keep key nodes from the portion being summarized
            to_summarize = messages_list[:split_point]
            to_keep = messages_list[split_point:]

            if len(to_summarize) < MIN_MESSAGES_FOR_SUMMARY:
                return

            # Extract key points from key nodes
            key_points = []
            for entry in to_summarize:
                if entry.is_key_node:
                    if entry.tool_calls:
                        for tc in entry.tool_calls:
                            func = tc.get("function", {})
                            key_points.append(f"Called tool: {func.get('name', 'unknown')}")
                    elif entry.content:
                        key_points.append(entry.content[:100])

            # Generate summary
            messages_to_summarize = [e.to_dict() for e in to_summarize]
            summary_content = await self._summarizer(messages_to_summarize)

            # Calculate tokens
            summarized_tokens = sum(e.token_count for e in to_summarize)
            summary_token_count = self._token_counter(summary_content)

            # Create summary object
            self._summary = ConversationSummary(
                content=summary_content,
                covered_message_count=len(to_summarize),
                covered_token_count=summarized_tokens,
                key_points=key_points[:10],  # Limit key points
                token_count=summary_token_count,
            )

            # Clear summarized messages, keep recent ones
            self._messages.clear()
            for entry in to_keep:
                self._messages.append(entry)

            logger.info(
                f"Summarized {len(to_summarize)} messages "
                f"({summarized_tokens} -> {summary_token_count} tokens)"
            )

        except Exception as e:
            logger.error(f"Summarization failed: {e}", exc_info=True)
            self._generate_simple_summary()

    def _generate_simple_summary(self) -> None:
        """Generate a simple summary without LLM.

        Fallback when no summarizer is configured.
        """
        messages_list = list(self._messages)
        if len(messages_list) < MIN_MESSAGES_FOR_SUMMARY:
            return

        split_point = len(messages_list) // 2
        to_summarize = messages_list[:split_point]
        to_keep = messages_list[split_point:]

        # Count message types
        user_count = sum(1 for m in to_summarize if m.role == "user")
        assistant_count = sum(1 for m in to_summarize if m.role == "assistant")
        tool_count = sum(1 for m in to_summarize if m.role == "tool")

        # Extract key points
        key_points = []
        for entry in to_summarize:
            if entry.is_key_node and entry.content:
                key_points.append(entry.content[:50])

        # Build summary
        summary_parts = [
            f"Previous conversation: {len(to_summarize)} messages",
            f"({user_count} user, {assistant_count} assistant, {tool_count} tool calls)",
        ]

        if key_points:
            summary_parts.append("Key actions: " + "; ".join(key_points[:5]))

        summary_content = "\n".join(summary_parts)
        summarized_tokens = sum(e.token_count for e in to_summarize)

        self._summary = ConversationSummary(
            content=summary_content,
            covered_message_count=len(to_summarize),
            covered_token_count=summarized_tokens,
            key_points=key_points[:5],
            token_count=self._token_counter(summary_content),
        )

        # Clear summarized messages
        self._messages.clear()
        for entry in to_keep:
            self._messages.append(entry)

        logger.info(f"Generated simple summary for {len(to_summarize)} messages")

    def set_summary(self, summary: str) -> None:
        """Set conversation summary manually.

        Args:
            summary: Summary text
        """
        self._summary = ConversationSummary(
            content=summary,
            covered_message_count=self._total_messages_added,
            covered_token_count=self.get_current_token_count(),
            token_count=self._token_counter(summary),
        )

    # =========================================================================
    # State Management
    # =========================================================================

    def clear(self) -> None:
        """Clear all messages (except system)."""
        self._messages.clear()
        self._pending_tool_calls.clear()
        self._key_nodes.clear()
        self._summary = None
        self._total_messages_added = 0

    def load_from_session(self, messages: list[dict[str, Any]]) -> None:
        """Load messages from session storage.

        Used to initialize memory from persisted session data.

        Args:
            messages: List of message dicts from session
        """
        self.clear()
        for msg in messages:
            self.add_message(msg)
        self._initialized = True
        logger.debug(f"Loaded {len(messages)} messages from session")

    @property
    def message_count(self) -> int:
        """Get current message count."""
        return len(self._messages)

    @property
    def total_messages(self) -> int:
        """Get total messages added (including summarized)."""
        return self._total_messages_added

    @property
    def has_pending_tool_calls(self) -> bool:
        """Check if there are unresolved tool calls."""
        return len(self._pending_tool_calls) > 0

    @property
    def has_summary(self) -> bool:
        """Check if a summary exists."""
        return self._summary is not None

    @property
    def summary(self) -> ConversationSummary | None:
        """Get current summary."""
        return self._summary

    def get_stats(self) -> dict[str, Any]:
        """Get memory statistics.

        Returns:
            Dict with memory stats
        """
        return {
            "session_id": self.session_id,
            "message_count": self.message_count,
            "total_messages": self._total_messages_added,
            "current_tokens": self.get_current_token_count(),
            "model_context_length": self._model_context_length,
            "utilization": self.get_current_token_count() / self._model_context_length,
            "has_summary": self.has_summary,
            "summary_covered_messages": self._summary.covered_message_count if self._summary else 0,
            "key_nodes_count": len(self._key_nodes),
            "pending_tool_calls": len(self._pending_tool_calls),
        }
