"""Session Prompt Processing for Talor.

This module provides the main event loop for processing prompts,
following opencode's SessionPrompt pattern.

Features:
- Prompt processing with tool execution
- Main event loop with step tracking
- Cancellation support
- Event publishing for status updates
- SSE streaming support for real-time inference
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, TYPE_CHECKING
from uuid import uuid4

from pydantic import BaseModel, Field
from ulid import ULID

from talor.session.session import Session, SessionInfo, SessionBusyError
from talor.session.message import (
    Message,
    MessagePart,
    MessageWithParts,
    UserMessage,
    AssistantMessage,
    TextPart,
    ToolPart,
)

if TYPE_CHECKING:
    from talor.bus import Bus
    from talor.tool import ToolRegistry, ToolContext


logger = logging.getLogger(__name__)


# =============================================================================
# SSE Event Types
# =============================================================================

@dataclass
class SSEEvent:
    """SSE event for streaming."""
    event: str  # "text", "tool_call", "tool_result", "error", "done"
    data: dict[str, Any]


# =============================================================================
# Prompt Input
# =============================================================================

class PromptInput(BaseModel):
    """Input for prompt processing."""
    
    session_id: str
    parts: list[dict[str, Any]]
    model: dict[str, str]  # {"provider_id": "...", "model_id": "..."}
    agent: str | None = None
    message_id: str | None = None
    no_reply: bool = False
    system: str | None = None


# =============================================================================
# Session Status
# =============================================================================

@dataclass
class SessionStatus:
    """Session processing status."""
    
    type: str  # "idle", "busy", "error"
    step: int = 0
    message: str | None = None


# =============================================================================
# Session Prompt Namespace
# =============================================================================

class SessionPrompt:
    """Session prompt processing namespace.
    
    Corresponds to opencode's SessionPrompt namespace.
    Provides the main event loop for processing prompts.
    """
    
    # Class-level state
    _bus: Any | None = None
    _tool_registry: Any | None = None
    _provider: Any | None = None
    _directory: Path = Path(".")
    _worktree: Path = Path(".")
    
    # Active sessions
    _active: dict[str, dict] = {}  # session_id -> {abort, callbacks}
    _status: dict[str, SessionStatus] = {}
    _lock = asyncio.Lock()
    
    @classmethod
    def configure(
        cls,
        bus: Any | None = None,
        tool_registry: Any | None = None,
        provider: Any | None = None,
        directory: Path | str = ".",
        worktree: Path | str | None = None,
    ) -> None:
        """Configure the prompt system.
        
        Args:
            bus: Bus instance for events
            tool_registry: ToolRegistry instance
            provider: Provider instance for LLM calls
            directory: Working directory
            worktree: Project worktree root
        """
        cls._bus = bus
        cls._tool_registry = tool_registry
        cls._provider = provider
        cls._directory = Path(directory)
        cls._worktree = Path(worktree) if worktree else cls._directory
    
    @classmethod
    def assert_not_busy(cls, session_id: str) -> None:
        """Assert that a session is not busy.
        
        Args:
            session_id: Session ID
        
        Raises:
            SessionBusyError: If session is busy
        """
        if session_id in cls._active:
            raise SessionBusyError(session_id)
    
    @classmethod
    async def prompt(cls, input: PromptInput) -> MessageWithParts:
        """Process a prompt.
        
        Corresponds to opencode's SessionPrompt.prompt().
        
        Args:
            input: PromptInput with session and prompt data
        
        Returns:
            Final assistant message
        """
        session = await Session.get(input.session_id)
        if not session:
            raise ValueError(f"Session not found: {input.session_id}")
        
        # Create user message
        message = await cls._create_user_message(input)
        await Session.touch(input.session_id)
        
        if input.no_reply:
            return message
        
        # Start the main loop
        return await cls.loop(input.session_id)
    
    @classmethod
    async def prompt_stream(cls, input: PromptInput) -> AsyncIterator[SSEEvent]:
        """Process a prompt with streaming response.
        
        Yields SSE events during inference for real-time updates.
        
        Args:
            input: PromptInput with session and prompt data
        
        Yields:
            SSEEvent objects for streaming
        """
        session = await Session.get(input.session_id)
        if not session:
            yield SSEEvent(event="error", data={"message": f"Session not found: {input.session_id}"})
            return
        
        # Create user message
        message = await cls._create_user_message(input)
        await Session.touch(input.session_id)
        
        if input.no_reply:
            yield SSEEvent(event="done", data={"message_id": message.info.id})
            return
        
        # Start the streaming loop
        async for event in cls.loop_stream(input.session_id):
            yield event
    
    @classmethod
    async def loop(cls, session_id: str) -> MessageWithParts:
        """Main event loop for processing.
        
        Corresponds to opencode's SessionPrompt.loop().
        
        Args:
            session_id: Session ID
        
        Returns:
            Final assistant message
        """
        # Start processing
        abort = cls._start(session_id)
        if not abort:
            # Already processing, wait for result
            return await cls._wait_for_result(session_id)
        
        try:
            step = 0
            max_steps = 50
            
            while step < max_steps:
                cls._set_status(session_id, SessionStatus(type="busy", step=step))
                logger.info(f"Loop step {step} for session {session_id}")
                
                if abort.is_set():
                    break
                
                # Get messages
                messages = await Session.messages(session_id)
                
                # Find last user and assistant messages
                last_user: MessageWithParts | None = None
                last_assistant: MessageWithParts | None = None
                
                for msg in reversed(messages):
                    if not last_user and msg.info.role == "user":
                        last_user = msg
                    if not last_assistant and msg.info.role == "assistant":
                        last_assistant = msg
                    if last_user and last_assistant:
                        break
                
                if not last_user:
                    raise ValueError("No user message found")
                
                # Check if we're done
                if last_assistant and isinstance(last_assistant.info, AssistantMessage):
                    if last_assistant.info.finish and last_assistant.info.finish not in ["tool-calls", "unknown"]:
                        if last_user.info.id < last_assistant.info.id:
                            logger.info(f"Loop complete for session {session_id}")
                            return last_assistant
                
                step += 1
                
                # Process step
                result = await cls._process_step(
                    session_id=session_id,
                    messages=messages,
                    last_user=last_user,
                    abort=abort,
                )
                
                if result:
                    # Check if done
                    if isinstance(result.info, AssistantMessage):
                        if result.info.finish and result.info.finish not in ["tool-calls"]:
                            return result
            
            # Max steps reached
            logger.warning(f"Max steps reached for session {session_id}")
            return await cls._create_max_steps_message(session_id)
            
        finally:
            cls.cancel(session_id)
    
    @classmethod
    async def loop_stream(cls, session_id: str) -> AsyncIterator[SSEEvent]:
        """Main event loop with streaming response.
        
        Yields SSE events during processing for real-time updates.
        
        Args:
            session_id: Session ID
        
        Yields:
            SSEEvent objects
        """
        # Start processing
        abort = cls._start(session_id)
        if not abort:
            yield SSEEvent(event="error", data={"message": "Session is busy"})
            return
        
        try:
            step = 0
            max_steps = 50
            
            while step < max_steps:
                cls._set_status(session_id, SessionStatus(type="busy", step=step))
                logger.info(f"Loop stream step {step} for session {session_id}")
                
                if abort.is_set():
                    yield SSEEvent(event="done", data={"reason": "cancelled"})
                    break
                
                # Get messages
                messages = await Session.messages(session_id)
                
                # Find last user and assistant messages
                last_user: MessageWithParts | None = None
                last_assistant: MessageWithParts | None = None
                
                for msg in reversed(messages):
                    if not last_user and msg.info.role == "user":
                        last_user = msg
                    if not last_assistant and msg.info.role == "assistant":
                        last_assistant = msg
                    if last_user and last_assistant:
                        break
                
                if not last_user:
                    yield SSEEvent(event="error", data={"message": "No user message found"})
                    return
                
                # Check if we're done
                if last_assistant and isinstance(last_assistant.info, AssistantMessage):
                    if last_assistant.info.finish and last_assistant.info.finish not in ["tool-calls", "unknown"]:
                        if last_user.info.id < last_assistant.info.id:
                            logger.info(f"Loop stream complete for session {session_id}")
                            yield SSEEvent(event="done", data={
                                "message_id": last_assistant.info.id,
                                "reason": last_assistant.info.finish,
                            })
                            return
                
                step += 1
                
                # Process step with streaming
                async for event in cls._process_step_stream(
                    session_id=session_id,
                    messages=messages,
                    last_user=last_user,
                    abort=abort,
                ):
                    yield event
                    
                    # Check if done
                    if event.event == "done":
                        return
                    if event.event == "error":
                        return
            
            # Max steps reached
            logger.warning(f"Max steps reached for session {session_id}")
            yield SSEEvent(event="error", data={"message": "Maximum steps reached"})
            
        finally:
            cls.cancel(session_id)
    
    @classmethod
    def cancel(cls, session_id: str) -> None:
        """Cancel processing for a session.
        
        Args:
            session_id: Session ID
        """
        logger.info(f"Cancelling session {session_id}")
        
        active = cls._active.pop(session_id, None)
        if active:
            active["abort"].set()
            for callback in active["callbacks"]:
                callback["reject"]()
        
        cls._set_status(session_id, SessionStatus(type="idle"))
    
    @classmethod
    def _start(cls, session_id: str) -> asyncio.Event | None:
        """Start processing for a session.
        
        Args:
            session_id: Session ID
        
        Returns:
            Abort event or None if already processing
        """
        if session_id in cls._active:
            return None
        
        abort = asyncio.Event()
        cls._active[session_id] = {
            "abort": abort,
            "callbacks": [],
        }
        
        return abort
    
    @classmethod
    async def _wait_for_result(cls, session_id: str) -> MessageWithParts:
        """Wait for processing result.
        
        Args:
            session_id: Session ID
        
        Returns:
            Result message
        """
        loop = asyncio.get_event_loop()
        future: asyncio.Future[MessageWithParts] = loop.create_future()
        
        def resolve(msg: MessageWithParts) -> None:
            if not future.done():
                future.set_result(msg)
        
        def reject() -> None:
            if not future.done():
                future.set_exception(asyncio.CancelledError())
        
        active = cls._active.get(session_id)
        if active:
            active["callbacks"].append({"resolve": resolve, "reject": reject})
        
        return await future
    
    @classmethod
    def _set_status(cls, session_id: str, status: SessionStatus) -> None:
        """Set session status.
        
        Args:
            session_id: Session ID
            status: New status
        """
        cls._status[session_id] = status
    
    @classmethod
    async def _create_user_message(cls, input: PromptInput) -> MessageWithParts:
        """Create a user message from input.
        
        Args:
            input: PromptInput
        
        Returns:
            Created message
        """
        now = int(time.time() * 1000)
        
        message = UserMessage(
            id=input.message_id or f"message_{ULID()}",
            session_id=input.session_id,
            model=input.model,
            agent=input.agent,
            time={"created": now},
        )
        
        # Convert parts
        parts: list[MessagePart] = []
        for part_data in input.parts:
            part_type = part_data.get("type")
            if part_type == "text":
                parts.append(TextPart(
                    text=part_data.get("text", ""),
                    session_id=input.session_id,
                    message_id=message.id,
                ))
        
        return await Session.add_message(input.session_id, message, parts)
    
    @classmethod
    async def _process_step(
        cls,
        session_id: str,
        messages: list[MessageWithParts],
        last_user: MessageWithParts,
        abort: asyncio.Event,
    ) -> MessageWithParts | None:
        """Process a single step in the loop.
        
        Args:
            session_id: Session ID
            messages: All messages
            last_user: Last user message
            abort: Abort event
        
        Returns:
            New assistant message or None
        """
        if not cls._provider:
            raise ValueError("Provider not configured")
        
        # Get model info from last user message
        if not isinstance(last_user.info, UserMessage):
            raise ValueError("Invalid user message")
        
        model_info = last_user.info.model
        agent = last_user.info.agent or "build"
        
        # Create assistant message
        now = int(time.time() * 1000)
        assistant_msg = AssistantMessage(
            id=f"message_{ULID()}",
            session_id=session_id,
            parent_id=last_user.info.id,
            model_id=model_info.get("model_id", ""),
            provider_id=model_info.get("provider_id", ""),
            agent=agent,
            path={"cwd": str(cls._directory), "root": str(cls._worktree)},
            time={"created": now},
        )
        
        msg_with_parts = await Session.add_message(session_id, assistant_msg, [])
        
        # Publish agent started event
        if cls._bus:
            from talor.bus.events import AgentStarted, AgentStartedData
            await cls._bus.publish(
                AgentStarted,
                AgentStartedData(
                    session_id=session_id,
                    agent=agent,
                    model_id=model_info.get("model_id", ""),
                    provider_id=model_info.get("provider_id", ""),
                )
            )
        
        try:
            # Build LLM messages
            llm_messages = cls._build_llm_messages(messages)
            
            # Get tool definitions
            tool_defs = []
            if cls._tool_registry:
                tool_defs = await cls._tool_registry.get_llm_definitions(agent=agent)
            
            # Call LLM
            response = await cls._provider.complete(
                model=model_info.get("model_id", ""),
                messages=llm_messages,
                tools=tool_defs,
                stream=False,
            )
            
            # Process response
            finish_reason = response.get("finish_reason", "stop")
            content = response.get("content", "")
            tool_calls = response.get("tool_calls", [])
            
            # Add text content
            if content:
                text_part = TextPart(
                    text=content,
                    session_id=session_id,
                    message_id=assistant_msg.id,
                )
                await Session.add_part(session_id, assistant_msg.id, text_part)
            
            # Handle tool calls
            if tool_calls:
                for tc in tool_calls:
                    await cls._handle_tool_call(
                        session_id=session_id,
                        message_id=assistant_msg.id,
                        tool_call=tc,
                        abort=abort,
                    )
                finish_reason = "tool-calls"
            
            # Update message with finish reason
            await Session.update_message(
                session_id,
                assistant_msg.id,
                lambda m: setattr(m.info, "finish", finish_reason) if isinstance(m.info, AssistantMessage) else None,
            )
            
            # Publish agent completed event
            if cls._bus:
                from talor.bus.events import AgentCompleted, AgentCompletedData
                await cls._bus.publish(
                    AgentCompleted,
                    AgentCompletedData(
                        session_id=session_id,
                        agent=agent,
                        iterations=1,
                        reason=finish_reason,
                    )
                )
            
            # Get updated message
            messages = await Session.messages(session_id)
            for msg in reversed(messages):
                if msg.info.id == assistant_msg.id:
                    return msg
            
            return msg_with_parts
            
        except Exception as e:
            logger.error(f"Error in process step: {e}", exc_info=True)
            
            # Update message with error
            await Session.update_message(
                session_id,
                assistant_msg.id,
                lambda m: setattr(m.info, "error", {"message": str(e)}) if isinstance(m.info, AssistantMessage) else None,
            )
            
            # Publish error event
            if cls._bus:
                from talor.bus.events import AgentError, AgentErrorData
                await cls._bus.publish(
                    AgentError,
                    AgentErrorData(
                        session_id=session_id,
                        agent=agent,
                        error=str(e),
                    )
                )
            
            raise
    
    @classmethod
    async def _process_step_stream(
        cls,
        session_id: str,
        messages: list[MessageWithParts],
        last_user: MessageWithParts,
        abort: asyncio.Event,
    ) -> AsyncIterator[SSEEvent]:
        """Process a single step with streaming response.
        
        Publishes events to Bus for 方案 B (分离式架构).
        
        Args:
            session_id: Session ID
            messages: All messages
            last_user: Last user message
            abort: Abort event
        
        Yields:
            SSEEvent objects
        """
        if not cls._provider:
            yield SSEEvent(event="error", data={"message": "Provider not configured"})
            return
        
        # Get model info from last user message
        if not isinstance(last_user.info, UserMessage):
            yield SSEEvent(event="error", data={"message": "Invalid user message"})
            return
        
        model_info = last_user.info.model
        agent = last_user.info.agent or "build"
        
        # Create assistant message
        now = int(time.time() * 1000)
        assistant_msg = AssistantMessage(
            id=f"message_{ULID()}",
            session_id=session_id,
            parent_id=last_user.info.id,
            model_id=model_info.get("model_id", ""),
            provider_id=model_info.get("provider_id", ""),
            agent=agent,
            path={"cwd": str(cls._directory), "root": str(cls._worktree)},
            time={"created": now},
        )
        
        await Session.add_message(session_id, assistant_msg, [])
        
        # Yield message created event
        yield SSEEvent(event="message_start", data={
            "message_id": assistant_msg.id,
            "session_id": session_id,
        })
        
        # Publish message created event to Bus (for 方案 B)
        if cls._bus:
            from talor.bus.events import MessageCreated, MessageCreatedData
            await cls._bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id=session_id,
                    message_id=assistant_msg.id,
                    role="assistant",
                    content="",
                )
            )
        
        # Publish agent started event
        if cls._bus:
            from talor.bus.events import AgentStarted, AgentStartedData
            await cls._bus.publish(
                AgentStarted,
                AgentStartedData(
                    session_id=session_id,
                    agent=agent,
                    model_id=model_info.get("model_id", ""),
                    provider_id=model_info.get("provider_id", ""),
                )
            )
        
        try:
            # Build LLM messages
            llm_messages = cls._build_llm_messages(messages)
            
            # Get tool definitions
            tool_defs = []
            if cls._tool_registry:
                tool_defs = await cls._tool_registry.get_llm_definitions(agent=agent)
            
            # Call LLM with streaming
            stream_response = await cls._provider.complete(
                model=model_info.get("model_id", ""),
                messages=llm_messages,
                tools=tool_defs,
                stream=True,
            )
            
            # Collect response
            full_content = ""
            tool_calls: list[dict[str, Any]] = []
            finish_reason = "stop"
            
            # Process stream
            async for chunk in stream_response:
                if abort.is_set():
                    # Publish stream done event
                    if cls._bus:
                        from talor.bus.events import StreamDone, StreamDoneData
                        await cls._bus.publish(
                            StreamDone,
                            StreamDoneData(
                                session_id=session_id,
                                message_id=assistant_msg.id,
                                reason="cancelled",
                            )
                        )
                    yield SSEEvent(event="done", data={"reason": "cancelled"})
                    return
                
                # Handle text content
                content = chunk.get("content", "")
                if content:
                    full_content += content
                    yield SSEEvent(event="text", data={
                        "content": content,
                        "message_id": assistant_msg.id,
                    })
                    
                    # Publish stream text event to Bus (for 方案 B)
                    if cls._bus:
                        from talor.bus.events import StreamText, StreamTextData
                        await cls._bus.publish(
                            StreamText,
                            StreamTextData(
                                session_id=session_id,
                                message_id=assistant_msg.id,
                                content=content,
                            )
                        )
                
                # Handle tool calls (accumulated)
                chunk_tool_calls = chunk.get("tool_calls")
                if chunk_tool_calls:
                    for tc in chunk_tool_calls:
                        # Merge tool call chunks
                        tc_id = tc.get("id") or tc.get("index", 0)
                        existing = None
                        for existing_tc in tool_calls:
                            if existing_tc.get("id") == tc_id or existing_tc.get("index") == tc_id:
                                existing = existing_tc
                                break
                        
                        if existing:
                            # Merge function arguments
                            if "function" in tc and "arguments" in tc["function"]:
                                if "function" not in existing:
                                    existing["function"] = {}
                                existing["function"]["arguments"] = existing["function"].get("arguments", "") + tc["function"]["arguments"]
                        else:
                            tool_calls.append(tc)
                
                # Check finish reason
                if chunk.get("finish_reason"):
                    finish_reason = chunk["finish_reason"]
            
            # Add text content to message
            if full_content:
                text_part = TextPart(
                    text=full_content,
                    session_id=session_id,
                    message_id=assistant_msg.id,
                )
                await Session.add_part(session_id, assistant_msg.id, text_part)
            
            # Handle tool calls
            if tool_calls:
                finish_reason = "tool-calls"
                for tc in tool_calls:
                    # Yield tool call event
                    yield SSEEvent(event="tool_call", data={
                        "message_id": assistant_msg.id,
                        "tool_call": tc,
                    })
                    
                    # Publish stream tool call event to Bus
                    tool_name = tc.get("function", {}).get("name", "")
                    call_id = tc.get("id", str(uuid4()))
                    try:
                        args_str = tc.get("function", {}).get("arguments", "{}")
                        arguments = json.loads(args_str)
                    except json.JSONDecodeError:
                        arguments = {}
                    
                    if cls._bus:
                        from talor.bus.events import StreamToolCall, StreamToolCallData
                        await cls._bus.publish(
                            StreamToolCall,
                            StreamToolCallData(
                                session_id=session_id,
                                message_id=assistant_msg.id,
                                call_id=call_id,
                                tool=tool_name,
                                input=arguments,
                            )
                        )
                    
                    # Execute tool
                    async for tool_event in cls._handle_tool_call_stream(
                        session_id=session_id,
                        message_id=assistant_msg.id,
                        tool_call=tc,
                        abort=abort,
                    ):
                        yield tool_event
            
            # Update message with finish reason
            await Session.update_message(
                session_id,
                assistant_msg.id,
                lambda m: setattr(m.info, "finish", finish_reason) if isinstance(m.info, AssistantMessage) else None,
            )
            
            # Publish agent completed event
            if cls._bus:
                from talor.bus.events import AgentCompleted, AgentCompletedData
                await cls._bus.publish(
                    AgentCompleted,
                    AgentCompletedData(
                        session_id=session_id,
                        agent=agent,
                        iterations=1,
                        reason=finish_reason,
                    )
                )
            
            # Yield completion event if not tool calls
            if finish_reason not in ["tool-calls"]:
                # Publish stream done event to Bus
                if cls._bus:
                    from talor.bus.events import StreamDone, StreamDoneData
                    await cls._bus.publish(
                        StreamDone,
                        StreamDoneData(
                            session_id=session_id,
                            message_id=assistant_msg.id,
                            reason=finish_reason,
                        )
                    )
                
                yield SSEEvent(event="done", data={
                    "message_id": assistant_msg.id,
                    "reason": finish_reason,
                })
            
        except Exception as e:
            logger.error(f"Error in process step stream: {e}", exc_info=True)
            
            # Update message with error
            await Session.update_message(
                session_id,
                assistant_msg.id,
                lambda m: setattr(m.info, "error", {"message": str(e)}) if isinstance(m.info, AssistantMessage) else None,
            )
            
            # Publish error events
            if cls._bus:
                from talor.bus.events import AgentError, AgentErrorData, StreamError, StreamErrorData
                await cls._bus.publish(
                    AgentError,
                    AgentErrorData(
                        session_id=session_id,
                        agent=agent,
                        error=str(e),
                    )
                )
                await cls._bus.publish(
                    StreamError,
                    StreamErrorData(
                        session_id=session_id,
                        message_id=assistant_msg.id,
                        error=str(e),
                    )
                )
            
            yield SSEEvent(event="error", data={"message": str(e)})
    
    @classmethod
    def _build_llm_messages(cls, messages: list[MessageWithParts]) -> list[dict[str, Any]]:
        """Build LLM-compatible messages.
        
        Args:
            messages: Session messages
        
        Returns:
            List of LLM message dicts
        """
        llm_messages = []
        
        for msg in messages:
            role = msg.info.role
            
            if role == "user":
                content = msg.get_text_content()
                if content:
                    llm_messages.append({"role": "user", "content": content})
            
            elif role == "assistant":
                content = msg.get_text_content()
                tool_parts = msg.get_tool_parts()
                
                if content or tool_parts:
                    llm_msg: dict[str, Any] = {"role": "assistant"}
                    
                    if content:
                        llm_msg["content"] = content
                    
                    if tool_parts:
                        llm_msg["tool_calls"] = [
                            {
                                "id": tp.call_id,
                                "type": "function",
                                "function": {
                                    "name": tp.tool,
                                    "arguments": json.dumps(tp.input),
                                }
                            }
                            for tp in tool_parts
                        ]
                    
                    llm_messages.append(llm_msg)
                
                # Add tool results
                for tp in tool_parts:
                    if tp.state == "completed" and tp.output:
                        llm_messages.append({
                            "role": "tool",
                            "tool_call_id": tp.call_id,
                            "content": tp.output,
                        })
            
            elif role == "system":
                if hasattr(msg.info, "content"):
                    llm_messages.append({"role": "system", "content": msg.info.content})
        
        return llm_messages
    
    @classmethod
    async def _handle_tool_call(
        cls,
        session_id: str,
        message_id: str,
        tool_call: dict[str, Any],
        abort: asyncio.Event,
    ) -> None:
        """Handle a tool call.
        
        Args:
            session_id: Session ID
            message_id: Message ID
            tool_call: Tool call data
            abort: Abort event
        """
        if not cls._tool_registry:
            return
        
        tool_name = tool_call.get("function", {}).get("name", "")
        call_id = tool_call.get("id", str(uuid4()))
        
        # Parse arguments
        try:
            args_str = tool_call.get("function", {}).get("arguments", "{}")
            arguments = json.loads(args_str)
        except json.JSONDecodeError:
            arguments = {}
        
        # Create tool part
        now = int(time.time() * 1000)
        tool_part = ToolPart(
            tool=tool_name,
            call_id=call_id,
            state="pending",
            input=arguments,
            time={"created": now},
            session_id=session_id,
            message_id=message_id,
        )
        
        await Session.add_part(session_id, message_id, tool_part)
        
        # Create context
        from talor.tool.context import ToolContext
        context = ToolContext(
            session_id=session_id,
            message_id=message_id,
            agent="build",
            abort=abort,
            call_id=call_id,
            _bus=cls._bus,
            _workspace=cls._directory,
            _worktree=cls._worktree,
        )
        
        # Execute tool
        try:
            # Update state to running
            tool_part.state = "running"
            tool_part.time["started"] = int(time.time() * 1000)
            
            result = await cls._tool_registry.execute(tool_name, arguments, context)
            
            # Update with result
            tool_part.state = "completed"
            tool_part.output = result.output
            tool_part.title = result.title
            tool_part.metadata = result.metadata
            tool_part.time["completed"] = int(time.time() * 1000)
            
        except Exception as e:
            logger.error(f"Tool execution error: {e}")
            tool_part.state = "error"
            tool_part.error = str(e)
            tool_part.time["completed"] = int(time.time() * 1000)
    
    @classmethod
    async def _handle_tool_call_stream(
        cls,
        session_id: str,
        message_id: str,
        tool_call: dict[str, Any],
        abort: asyncio.Event,
    ) -> AsyncIterator[SSEEvent]:
        """Handle a tool call with streaming events.
        
        Publishes events to Bus for 方案 B (分离式架构).
        
        Args:
            session_id: Session ID
            message_id: Message ID
            tool_call: Tool call data
            abort: Abort event
        
        Yields:
            SSEEvent objects
        """
        if not cls._tool_registry:
            yield SSEEvent(event="error", data={"message": "Tool registry not configured"})
            return
        
        tool_name = tool_call.get("function", {}).get("name", "")
        call_id = tool_call.get("id", str(uuid4()))
        
        # Parse arguments
        try:
            args_str = tool_call.get("function", {}).get("arguments", "{}")
            arguments = json.loads(args_str)
        except json.JSONDecodeError:
            arguments = {}
        
        # Create tool part
        now = int(time.time() * 1000)
        tool_part = ToolPart(
            tool=tool_name,
            call_id=call_id,
            state="pending",
            input=arguments,
            time={"created": now},
            session_id=session_id,
            message_id=message_id,
        )
        
        await Session.add_part(session_id, message_id, tool_part)
        
        # Yield tool executing event
        yield SSEEvent(event="tool_executing", data={
            "call_id": call_id,
            "tool": tool_name,
            "input": arguments,
            "message_id": message_id,
        })
        
        # Create context
        from talor.tool.context import ToolContext
        context = ToolContext(
            session_id=session_id,
            message_id=message_id,
            agent="build",
            abort=abort,
            call_id=call_id,
            _bus=cls._bus,
            _workspace=cls._directory,
            _worktree=cls._worktree,
        )
        
        # Execute tool
        try:
            # Update state to running
            tool_part.state = "running"
            tool_part.time["started"] = int(time.time() * 1000)
            
            result = await cls._tool_registry.execute(tool_name, arguments, context)
            
            # Update with result
            tool_part.state = "completed"
            tool_part.output = result.output
            tool_part.title = result.title
            tool_part.metadata = result.metadata
            tool_part.time["completed"] = int(time.time() * 1000)
            
            # Yield tool result event
            yield SSEEvent(event="tool_result", data={
                "call_id": call_id,
                "tool": tool_name,
                "output": result.output,
                "title": result.title,
                "metadata": result.metadata,
                "message_id": message_id,
            })
            
            # Publish stream tool result event to Bus (for 方案 B)
            if cls._bus:
                from talor.bus.events import StreamToolResult, StreamToolResultData
                await cls._bus.publish(
                    StreamToolResult,
                    StreamToolResultData(
                        session_id=session_id,
                        message_id=message_id,
                        call_id=call_id,
                        tool=tool_name,
                        output=result.output,
                        title=result.title,
                        metadata=result.metadata or {},
                    )
                )
            
        except Exception as e:
            logger.error(f"Tool execution error: {e}")
            tool_part.state = "error"
            tool_part.error = str(e)
            tool_part.time["completed"] = int(time.time() * 1000)
            
            # Yield tool error event
            yield SSEEvent(event="tool_error", data={
                "call_id": call_id,
                "tool": tool_name,
                "error": str(e),
                "message_id": message_id,
            })
            
            # Publish stream tool result event with error to Bus
            if cls._bus:
                from talor.bus.events import StreamToolResult, StreamToolResultData
                await cls._bus.publish(
                    StreamToolResult,
                    StreamToolResultData(
                        session_id=session_id,
                        message_id=message_id,
                        call_id=call_id,
                        tool=tool_name,
                        output="",
                        error=str(e),
                    )
                )
    
    @classmethod
    async def _create_max_steps_message(cls, session_id: str) -> MessageWithParts:
        """Create a message for max steps reached.
        
        Args:
            session_id: Session ID
        
        Returns:
            Message indicating max steps
        """
        now = int(time.time() * 1000)
        
        message = AssistantMessage(
            id=f"message_{ULID()}",
            session_id=session_id,
            model_id="",
            provider_id="",
            agent="build",
            finish="max_steps",
            time={"created": now},
        )
        
        text_part = TextPart(
            text="I've reached the maximum number of steps. Please try rephrasing your request.",
            session_id=session_id,
            message_id=message.id,
        )
        
        return await Session.add_message(session_id, message, [text_part])
