"""Session Management for Talor.

This module provides session management for conversation tracking.

Simplified Architecture:
- Session: Rich domain entity with business logic
- Message types: UserMessage, AssistantMessage, SystemMessage, etc.
- Module-level functions: create_session, get_session, list_sessions, etc.
- Event publishing: Handled internally via SessionBusManager

Usage:
    ```python
    from src.session import session

    # Configure module (typically done at app startup)
    session.configure(workspace=Path("."), storage=storage)

    # Create and manage sessions
    sess = await session.create_session(title="New Session")
    await session.add_user_message(sess.id, "Hello")

    # Use entity methods directly
    sess.update_title("New Title")
    print(sess.message_count)
    ```

For backward compatibility, SessionService class is still available:
    ```python
    from src.session import SessionService

    service = SessionService()
    session = await service.create_session(title="New Session")
    ```

Note:
    Event bus is now managed by SessionBusManager internally.
    Each session gets its own isolated Bus instance.
"""

# Session entity and errors
from src.session.session import (
    Session,
    SessionBusyError,
    SessionService,
    # Module configuration
    configure,
    clear_cache,
    # Session operations
    create_session,
    get_session,
    list_sessions,
    delete_session,
    update_session,
    update_session_title,
    touch_session,
    # Message operations
    get_messages,
    add_user_message,
    add_assistant_message,
    add_tool_message,
    add_tool_result,
    add_message,
    update_message,
    add_part,
    # Session state operations
    mark_busy,
    mark_idle,
    clear_messages,
    # Memory operations
    get_memory,
    get_conversation_for_llm,
)

# Message types
from src.session.message import (
    # Part types
    MessagePart,
    TextPart,
    FilePart,
    ToolPart,
    AgentPart,
    ReasoningPart,
    # Message types
    Message,
    UserMessage,
    AssistantMessage,
    SystemMessage,
    # Message with parts
    MessageWithParts,
)

__all__ = [
    # Session entity and errors
    "Session",
    "SessionBusyError",
    # Backward compatibility
    "SessionService",
    # Module configuration
    "configure",
    "clear_cache",
    # Session operations
    "create_session",
    "get_session",
    "list_sessions",
    "delete_session",
    "update_session",
    "update_session_title",
    "touch_session",
    # Message operations
    "get_messages",
    "add_user_message",
    "add_assistant_message",
    "add_tool_message",
    "add_tool_result",
    "add_message",
    "update_message",
    "add_part",
    # Session state operations
    "mark_busy",
    "mark_idle",
    "clear_messages",
    # Memory operations
    "get_memory",
    "get_conversation_for_llm",
    # Part types
    "MessagePart",
    "TextPart",
    "FilePart",
    "ToolPart",
    "AgentPart",
    "ReasoningPart",
    # Message types
    "Message",
    "UserMessage",
    "AssistantMessage",
    "SystemMessage",
    # Message with parts
    "MessageWithParts",
]
