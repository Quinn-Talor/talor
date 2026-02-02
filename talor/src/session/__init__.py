"""Session Management for Talor.

This module provides session management for conversation tracking:
- Session.create() for creating sessions
- Session.update() for updating sessions
- Session.messages() for message streaming
- SessionPrompt.loop() for the main event loop

Example:
    ```python
    from src.session import Session, SessionPrompt

    # Create a session
    session = await Session.create()

    # Process a prompt
    message = await SessionPrompt.prompt(
        session_id=session.id,
        parts=[{"type": "text", "text": "Hello!"}],
        model={"provider_id": "openai", "model_id": "gpt-4"},
    )
    ```
"""

from src.session.session import Session
from src.session.prompt import SessionPrompt, SSEEvent, PromptInput
from src.session.message import Message, MessagePart

__all__ = ["Session", "SessionPrompt", "SSEEvent", "PromptInput", "Message", "MessagePart"]
