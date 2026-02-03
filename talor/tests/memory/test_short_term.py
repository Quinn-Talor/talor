"""Tests for ShortTermMemory.

Tests the short-term memory implementation with:
- Singleton pattern
- Token-aware context management
- Auto-summarization at 80% threshold
- Key node preservation
"""

import pytest
from src.memory.short_term import (
    ShortTermMemory,
    MessageEntry,
    MessageImportance,
    ConversationSummary,
    DEFAULT_MAX_MESSAGES,
    DEFAULT_CONTEXT_LENGTH,
    SUMMARIZATION_THRESHOLD,
)


class TestMessageEntry:
    """Test MessageEntry dataclass."""

    def test_to_dict_basic(self):
        """Test basic message conversion."""
        entry = MessageEntry(role="user", content="Hello")
        result = entry.to_dict()

        assert result == {"role": "user", "content": "Hello"}

    def test_to_dict_with_tool_calls(self):
        """Test message with tool calls."""
        entry = MessageEntry(
            role="assistant",
            content="Let me check",
            tool_calls=[{"id": "1", "function": {"name": "read"}}],
        )
        result = entry.to_dict()

        assert result["role"] == "assistant"
        assert result["content"] == "Let me check"
        assert len(result["tool_calls"]) == 1

    def test_to_dict_tool_result(self):
        """Test tool result message."""
        entry = MessageEntry(
            role="tool",
            content="File content",
            tool_call_id="call_1",
            name="read_file",
        )
        result = entry.to_dict()

        assert result["role"] == "tool"
        assert result["tool_call_id"] == "call_1"
        assert result["name"] == "read_file"

    def test_is_key_node(self):
        """Test key node detection."""
        normal = MessageEntry(role="user", content="Hello")
        assert normal.is_key_node is False

        tool_call = MessageEntry(
            role="assistant",
            content="",
            importance=MessageImportance.TOOL_CALL,
        )
        assert tool_call.is_key_node is True

        error = MessageEntry(
            role="assistant",
            content="Error occurred",
            importance=MessageImportance.ERROR,
        )
        assert error.is_key_node is True


class TestShortTermMemory:
    """Test ShortTermMemory class."""

    def setup_method(self):
        """Create a fresh memory instance for each test."""
        # No longer using singleton pattern - just create fresh instances
        pass

    def test_init(self):
        """Test initialization."""
        memory = ShortTermMemory(session_id="test_session")

        assert memory.session_id == "test_session"
        assert memory.max_messages == DEFAULT_MAX_MESSAGES
        assert memory.message_count == 0

    def test_add_message(self):
        """Test adding messages."""
        memory = ShortTermMemory(session_id="test")

        memory.add_message({"role": "user", "content": "Hello"})
        memory.add_message({"role": "assistant", "content": "Hi!"})

        assert memory.message_count == 2
        assert memory.total_messages == 2

    def test_add_user_message(self):
        """Test add_user_message helper."""
        memory = ShortTermMemory(session_id="test")

        memory.add_user_message("Hello world")

        messages = memory.get_messages(include_system=False)
        assert len(messages) == 1
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == "Hello world"

    def test_add_assistant_message(self):
        """Test add_assistant_message helper."""
        memory = ShortTermMemory(session_id="test")

        memory.add_assistant_message(
            content="I'll help",
            tool_calls=[{"id": "1", "function": {"name": "read"}}],
        )

        messages = memory.get_messages(include_system=False)
        assert len(messages) == 1
        assert messages[0]["role"] == "assistant"
        assert messages[0]["tool_calls"] is not None

    def test_add_tool_result(self):
        """Test add_tool_result helper."""
        memory = ShortTermMemory(session_id="test")

        memory.add_tool_result(
            tool_call_id="call_1",
            content="File content here",
            name="read_file",
        )

        messages = memory.get_messages(include_system=False)
        assert len(messages) == 1
        assert messages[0]["role"] == "tool"
        assert messages[0]["tool_call_id"] == "call_1"

    def test_system_message(self):
        """Test system message handling."""
        memory = ShortTermMemory(session_id="test")

        memory.set_system_message("You are a helpful assistant.")
        memory.add_user_message("Hello")

        messages = memory.get_messages(include_system=True)

        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == "You are a helpful assistant."

    def test_max_messages_limit(self):
        """Test message limit enforcement."""
        memory = ShortTermMemory(session_id="test", max_messages=5)

        for i in range(10):
            memory.add_user_message(f"Message {i}")

        assert memory.message_count == 5
        assert memory.total_messages == 10

        # Should have most recent messages
        messages = memory.get_messages(include_system=False)
        assert "Message 9" in messages[-1]["content"]

    def test_get_recent_messages(self):
        """Test getting recent messages."""
        memory = ShortTermMemory(session_id="test")

        for i in range(10):
            memory.add_user_message(f"Message {i}")

        recent = memory.get_recent_messages(count=3)

        assert len(recent) == 3
        assert "Message 7" in recent[0]["content"]
        assert "Message 9" in recent[2]["content"]

    def test_token_limit(self):
        """Test token-based context limiting."""
        # Custom token counter: 1 token per character
        memory = ShortTermMemory(
            session_id="test",
            token_counter=lambda x: len(x),
        )
        # Configure with small context length
        memory.configure(model_context_length=100)

        # Add messages that exceed token limit
        memory.add_user_message("A" * 50)  # 50 tokens
        memory.add_user_message("B" * 50)  # 50 tokens
        memory.add_user_message("C" * 50)  # 50 tokens

        messages = memory.get_messages(include_system=False, max_tokens=100)

        # Should only include messages that fit
        total_content = sum(len(m.get("content", "")) for m in messages)
        assert total_content <= 100

    def test_tool_call_tracking(self):
        """Test pending tool call tracking."""
        memory = ShortTermMemory(session_id="test")

        # Add assistant message with tool call
        memory.add_assistant_message(
            content="Checking...",
            tool_calls=[{"id": "call_1", "function": {"name": "read"}}],
        )

        assert memory.has_pending_tool_calls is True

        # Add tool result
        memory.add_tool_result("call_1", "Result")

        assert memory.has_pending_tool_calls is False

    def test_summary(self):
        """Test conversation summary."""
        memory = ShortTermMemory(session_id="test")

        for i in range(10):
            memory.add_user_message(f"Message {i}")

        # Set summary
        memory.set_summary("User asked 10 questions about various topics.")

        messages = memory.get_messages(include_system=True)

        # Summary should be included
        summary_msg = next(
            (m for m in messages if "summary" in m.get("content", "").lower()),
            None
        )
        assert summary_msg is not None

    def test_needs_summarization(self):
        """Test summarization threshold (80% of context)."""
        memory = ShortTermMemory(
            session_id="test",
            token_counter=lambda x: len(x),
        )
        # Set small context for testing
        memory.configure(model_context_length=1000)

        # Add messages below threshold (< 800 tokens = 80%)
        for i in range(10):
            memory.add_user_message(f"Msg{i}")  # ~5 tokens each = 50 total

        assert memory.needs_summarization() is False

        # Add more messages to exceed threshold
        for i in range(100):
            memory.add_user_message("X" * 10)  # 10 tokens each = 1000 total

        assert memory.needs_summarization() is True

    def test_clear(self):
        """Test clearing memory."""
        memory = ShortTermMemory(session_id="test")

        memory.set_system_message("System prompt")
        memory.add_user_message("Hello")
        memory.set_summary("Summary")

        memory.clear()

        assert memory.message_count == 0
        assert memory.has_summary is False
        # System message is NOT cleared by clear()
        messages = memory.get_messages(include_system=True)
        assert len(messages) == 1
        assert messages[0]["role"] == "system"

    def test_token_count(self):
        """Test token counting."""
        memory = ShortTermMemory(
            session_id="test",
            token_counter=lambda x: len(x),
        )

        memory.set_system_message("System")  # 6 tokens + overhead
        memory.add_user_message("Hello")     # 5 tokens + overhead

        # Token count includes overhead for message structure
        assert memory.get_current_token_count() > 11

    def test_configure(self):
        """Test configuration."""
        memory = ShortTermMemory(session_id="test")

        memory.configure(
            model_context_length=64000,
            summarization_threshold=0.7,
        )

        assert memory._model_context_length == 64000
        assert memory._summarization_threshold == 0.7
        assert memory.summarization_trigger == int(64000 * 0.7)

    def test_key_node_preservation(self):
        """Test that key nodes are preserved."""
        memory = ShortTermMemory(session_id="test")

        # Add tool call (key node)
        memory.add_assistant_message(
            content="Calling tool",
            tool_calls=[{"id": "1", "function": {"name": "read"}}],
        )

        # Add tool result (key node)
        memory.add_tool_result("1", "Result content")

        key_nodes = memory.get_key_nodes()
        assert len(key_nodes) == 2

    def test_mark_milestone(self):
        """Test milestone marking."""
        memory = ShortTermMemory(session_id="test")

        memory.add_user_message("Important decision")
        memory.mark_milestone("User made key decision")

        key_nodes = memory.get_key_nodes()
        assert len(key_nodes) == 1

    def test_get_stats(self):
        """Test statistics retrieval."""
        memory = ShortTermMemory(session_id="test")
        memory.configure(model_context_length=32000)

        memory.add_user_message("Hello")
        memory.add_assistant_message("Hi there!")

        stats = memory.get_stats()

        assert stats["session_id"] == "test"
        assert stats["message_count"] == 2
        assert stats["model_context_length"] == 32000
        assert "utilization" in stats
        assert "has_summary" in stats


class TestShortTermMemoryInstantiation:
    """Test instance creation (DDD-compliant - no singleton)."""

    def test_create_multiple_instances(self):
        """Test that multiple instances can be created independently."""
        memory1 = ShortTermMemory(session_id="session_1")
        memory2 = ShortTermMemory(session_id="session_1")
        memory3 = ShortTermMemory(session_id="session_2")

        # Each call creates a new instance (no singleton)
        assert memory1 is not memory2
        assert memory1 is not memory3

        # But they have the same session_id
        assert memory1.session_id == memory2.session_id
        assert memory1.session_id != memory3.session_id

    def test_instance_isolation(self):
        """Test that instances are isolated from each other."""
        memory1 = ShortTermMemory(session_id="session_1")
        memory2 = ShortTermMemory(session_id="session_1")

        memory1.add_user_message("Hello from memory1")

        # memory2 should not have the message
        assert memory1.message_count == 1
        assert memory2.message_count == 0

    def test_instance_with_custom_config(self):
        """Test creating instance with custom configuration."""
        def custom_counter(text: str) -> int:
            return len(text)

        memory = ShortTermMemory(
            session_id="test",
            max_messages=50,
            token_counter=custom_counter,
        )

        assert memory.max_messages == 50
        # Token counter should use custom function
        memory.add_user_message("Hello")
        # Custom counter counts chars, not tokens


class TestShortTermMemoryAsync:
    """Test async methods."""

    def setup_method(self):
        """Create fresh memory instance for each test."""
        pass

    @pytest.mark.asyncio
    async def test_get_messages_for_llm(self):
        """Test async message retrieval."""
        memory = ShortTermMemory(session_id="test")

        memory.add_user_message("Hello")
        memory.add_assistant_message("Hi!")

        messages = await memory.get_messages_for_llm(include_system=False)

        assert len(messages) == 2
        assert messages[0]["role"] == "user"
        assert messages[1]["role"] == "assistant"

    @pytest.mark.asyncio
    async def test_load_from_session(self):
        """Test loading messages from session."""
        memory = ShortTermMemory(session_id="test")

        session_messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi!"},
            {"role": "user", "content": "How are you?"},
        ]

        memory.load_from_session(session_messages)

        assert memory.message_count == 3
        messages = memory.get_messages(include_system=False)
        assert messages[0]["content"] == "Hello"
