"""Memory System for Talor.

This module provides memory management for the agent system:
- ShortTermMemory: Token-aware conversation context with auto-summarization
- MemoryContext: Legacy context wrapper

Memory is owned by Session instances. Access via session.memory property.

Features:
- Model-aware token limits (configure via memory.configure())
- 80% threshold auto-summarization with key node preservation
- Tool call tracking and milestone marking

Example:
    ```python
    from src.session import Session

    # Get session - memory is automatically created
    session = await Session.get("session_123")

    # Configure with model context length
    session.memory.configure(model_context_length=128000)

    # Add messages
    session.memory.add_user_message("Hello")
    session.memory.add_assistant_message("Hi there!")

    # Get context for LLM (auto-summarizes at 80% threshold)
    messages = await session.memory.get_messages_for_llm()
    ```
"""

from src.memory.short_term import (
    ShortTermMemory,
    MessageEntry,
    MessageImportance,
    ConversationSummary,
)
from src.memory.context import MemoryContext

__all__ = [
    "ShortTermMemory",
    "MessageEntry",
    "MessageImportance",
    "ConversationSummary",
    "MemoryContext",
]
