"""Session Management for Talor.

This module provides session management following opencode's pattern:
- Session.create() for creating sessions
- Session.update() for updating sessions
- Session.messages() for message streaming
- SessionPrompt.loop() for the main event loop

Example:
    ```python
    from talor.session import Session, SessionPrompt
    
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

from talor.session.session import Session
from talor.session.prompt import SessionPrompt, SSEEvent, PromptInput
from talor.session.message import Message, MessagePart

__all__ = ["Session", "SessionPrompt", "SSEEvent", "PromptInput", "Message", "MessagePart"]
