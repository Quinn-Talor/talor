"""Tests for ShortTermMemory.

Tests the short-term memory implementation.
"""

import pytest
from src.memory.short_term import ShortTermMemory, MessageEntry


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


class TestShortTermMemory:
    """Test ShortTermMemory class."""

    def test_init(self):
        """Test initialization."""
        memory = ShortTermMemory(session_id="test_session")

        assert memory.session_id == "test_session"
        assert memory.max_messages == 50
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
            max_tokens=100,
            token_counter=lambda x: len(x),
        )

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
        """Test summarization threshold."""
        memory = ShortTermMemory(session_id="test")

        # Below threshold
        for i in range(20):
            memory.add_user_message(f"Message {i}")

        assert memory.needs_summarization(threshold=30) is False

        # Above threshold
        for i in range(15):
            memory.add_user_message(f"More {i}")

        assert memory.needs_summarization(threshold=30) is True

    def test_clear(self):
        """Test clearing memory."""
        memory = ShortTermMemory(session_id="test")

        memory.set_system_message("System prompt")
        memory.add_user_message("Hello")
        memory.set_summary("Summary")

        memory.clear()

        assert memory.message_count == 0
        # System message should be preserved
        messages = memory.get_messages(include_system=True)
        assert len(messages) == 1
        assert messages[0]["role"] == "system"

    def test_token_count(self):
        """Test token counting."""
        memory = ShortTermMemory(
            session_id="test",
            token_counter=lambda x: len(x),
        )

        memory.set_system_message("System")  # 6 tokens
        memory.add_user_message("Hello")     # 5 tokens

        assert memory.get_token_count() == 11
