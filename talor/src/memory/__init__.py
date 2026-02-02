"""Memory System for Talor.

This module provides memory management for the agent system:
- Short-term memory: Current session context
- Long-term memory: Cross-session knowledge (optional)
- Memory retrieval: Context-aware memory access

Example:
    ```python
    from src.memory import Memory, ShortTermMemory

    # Create short-term memory for session
    memory = ShortTermMemory(session_id="session_123", max_messages=20)

    # Add messages
    memory.add_message({"role": "user", "content": "Hello"})

    # Get context for LLM
    context = memory.get_context(max_tokens=4000)
    ```
"""

from src.memory.short_term import ShortTermMemory
from src.memory.context import MemoryContext

__all__ = ["ShortTermMemory", "MemoryContext"]
