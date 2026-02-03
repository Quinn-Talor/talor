"""Agent Executor Service for Talor.

This module provides the core execution engine for AI agents,
implementing the ReAct (Reasoning + Acting) cycle.

Features:
- Prompt processing with tool execution
- Main event loop with step tracking
- Cancellation support
- Event publishing for status updates
- SSE streaming support for real-time inference

Architecture:
    AgentExecutor is a proper service class following DDD principles:
    - Constructor dependency injection
    - Instance methods instead of class methods
    - No class-level state
    - Single responsibility: execute agent inference loop
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator, TYPE_CHECKING
from uuid import uuid4

from ulid import ULID

from src.session.message import (
    MessagePart,
    MessageWithParts,
    UserMessage,
    AssistantMessage,
    TextPart,
    ToolPart,
)
from src.plugin.manager import PluginManager
from src.plugin.context import PluginContext

if TYPE_CHECKING:
    from src.bus import Bus
    from src.tool import ToolRegistry
    from src.session.service import SessionService
    from src.provider.service import ProviderService


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
# Execution Status
# =============================================================================

@dataclass
class ExecutionStatus:
    """Agent execution status."""
    type: str  # "idle", "busy", "error"
    step: int = 0
    message: str | None = None


# =============================================================================
# Active Execution Tracking
# =============================================================================

@dataclass
class ActiveExecution:
    """Tracks an active agent execution."""
    abort: asyncio.Event
    callbacks: list[dict]


# =============================================================================
# Agent Executor Service
# =============================================================================

class AgentExecutor:
    """Agent execution service.

    Executes the ReAct cycle for AI agents, coordinating:
    - LLM inference calls
    - Tool execution
    - Message management
    - Event publishing

    This is a proper service class with constructor dependency injection.
    """

    def __init__(
        self,
        session_service: "SessionService",
        provider_service: "ProviderService",
        tool_registry: "ToolRegistry",
        bus: "Bus | None" = None,
        workspace: Path | None = None,
        worktree: Path | None = None,
        plugin_manager: PluginManager | None = None,
    ) -> None:
        """Initialize agent executor.

        Args:
            session_service: Session management service
            provider_service: LLM provider service
            tool_registry: Tool registry for tool execution
            bus: Event bus for publishing events
            workspace: Working directory
            worktree: Project worktree root
            plugin_manager: Plugin manager for prompt building
        """
        self._session_service = session_service
        self._provider_service = provider_service
        self._tool_registry = tool_registry
        self._bus = bus
        self._workspace = workspace or Path(".")
        self._worktree = worktree or self._workspace
        self._plugin_manager = plugin_manager

        # Active executions (session_id -> ActiveExecution)
        self._active: dict[str, ActiveExecution] = {}
        self._status: dict[str, ExecutionStatus] = {}

    # =========================================================================
    # Plugin Management
    # =========================================================================

    async def get_plugin_manager(self) -> PluginManager:
        """Get or create the plugin manager with default plugins.

        Returns:
            Configured PluginManager instance
        """
        if self._plugin_manager is None:
            self._plugin_manager = PluginManager()
            await self._setup_default_plugins()
        return self._plugin_manager

    async def _setup_default_plugins(self) -> None:
        """Setup default built-in plugins."""
        if self._plugin_manager is None:
            return

        from src.plugin.builtin.system import SystemPromptPlugin
        from src.plugin.builtin.agent import AgentPromptPlugin
        from src.plugin.builtin.environment import EnvironmentPlugin
        from src.plugin.builtin.memory import MemoryPlugin
        from src.plugin.builtin.llm import LLMPlugin
        from src.plugin.builtin.tool import ToolPlugin
        from src.plugin.builtin.skill import SkillPlugin

        # Register built-in plugins
        await self._plugin_manager.register(SystemPromptPlugin())
        await self._plugin_manager.register(AgentPromptPlugin())
        await self._plugin_manager.register(EnvironmentPlugin())
        await self._plugin_manager.register(MemoryPlugin())
        await self._plugin_manager.register(LLMPlugin())

        # Tool plugin with registry
        tool_plugin = ToolPlugin(tool_registry=self._tool_registry)
        await self._plugin_manager.register(tool_plugin)

        # Skill plugin
        skill_plugin = SkillPlugin()
        await skill_plugin.initialize(self._worktree)
        await self._plugin_manager.register(skill_plugin)

    async def _build_plugin_context(
        self,
        session_id: str,
        agent_name: str,
        model_info: dict[str, str],
        messages: list[MessageWithParts],
        user_request: str = "",
        agent_prompt: str | None = None,
    ) -> PluginContext:
        """Build plugin context from session data.

        Args:
            session_id: Session ID
            agent_name: Agent name
            model_info: Model info dict with provider_id and model_id
            messages: Session messages
            user_request: Current user request text
            agent_prompt: Optional custom agent prompt

        Returns:
            PluginContext for plugin execution
        """
        # Convert messages to dict format
        message_dicts = []
        for msg in messages:
            msg_dict = {
                "role": msg.info.role,
                "content": msg.get_text_content() or "",
            }
            message_dicts.append(msg_dict)

        return PluginContext(
            session_id=session_id,
            agent_name=agent_name,
            cwd=self._workspace,
            worktree=self._worktree,
            provider_id=model_info.get("provider_id", ""),
            model_id=model_info.get("model_id", ""),
            messages=message_dicts,
            user_request=user_request,
            agent_prompt=agent_prompt,
        )

    # =========================================================================
    # Execution Control
    # =========================================================================

    def is_busy(self, session_id: str) -> bool:
        """Check if a session is currently executing.

        Args:
            session_id: Session ID

        Returns:
            True if session is busy
        """
        return session_id in self._active

    def cancel(self, session_id: str) -> None:
        """Cancel execution for a session.

        Args:
            session_id: Session ID
        """
        logger.info(f"Cancelling execution for session {session_id}")

        active = self._active.pop(session_id, None)
        if active:
            active.abort.set()
            for callback in active.callbacks:
                callback["reject"]()

        self._set_status(session_id, ExecutionStatus(type="idle"))

    def _start_execution(self, session_id: str) -> asyncio.Event | None:
        """Start execution for a session.

        Args:
            session_id: Session ID

        Returns:
            Abort event or None if already executing
        """
        if session_id in self._active:
            return None

        abort = asyncio.Event()
        self._active[session_id] = ActiveExecution(
            abort=abort,
            callbacks=[],
        )

        return abort

    def _set_status(self, session_id: str, status: ExecutionStatus) -> None:
        """Set execution status.

        Args:
            session_id: Session ID
            status: New status
        """
        self._status[session_id] = status

    def get_status(self, session_id: str) -> ExecutionStatus:
        """Get execution status.

        Args:
            session_id: Session ID

        Returns:
            Current status
        """
        return self._status.get(session_id, ExecutionStatus(type="idle"))

    # =========================================================================
    # Main Execution Loop
    # =========================================================================

    async def execute(
        self,
        session_id: str,
        parts: list[dict[str, Any]],
        model: dict[str, str],
        agent: str | None = None,
        message_id: str | None = None,
        no_reply: bool = False,
    ) -> MessageWithParts:
        """Execute a prompt (non-streaming).

        Args:
            session_id: Session ID
            parts: Message parts
            model: Model info {"provider_id": "...", "model_id": "..."}
            agent: Agent name
            message_id: Optional message ID
            no_reply: If True, don't generate a response

        Returns:
            Final assistant message
        """
        session = await self._session_service.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        # Create user message
        message = await self._create_user_message(
            session_id=session_id,
            parts=parts,
            model=model,
            agent=agent,
            message_id=message_id,
        )
        await self._session_service.touch_session(session_id)

        if no_reply:
            return message

        # Start the main loop
        return await self._run_loop(session_id)

    async def execute_stream(
        self,
        session_id: str,
        parts: list[dict[str, Any]],
        model: dict[str, str],
        agent: str | None = None,
        message_id: str | None = None,
        no_reply: bool = False,
    ) -> AsyncIterator[SSEEvent]:
        """Execute a prompt with streaming response.

        Yields SSE events during inference for real-time updates.

        Args:
            session_id: Session ID
            parts: Message parts
            model: Model info
            agent: Agent name
            message_id: Optional message ID
            no_reply: If True, don't generate a response

        Yields:
            SSEEvent objects for streaming
        """
        session = await self._session_service.get_session(session_id)
        if not session:
            yield SSEEvent(event="error", data={"message": f"Session not found: {session_id}"})
            return

        # Create user message
        message = await self._create_user_message(
            session_id=session_id,
            parts=parts,
            model=model,
            agent=agent,
            message_id=message_id,
        )
        await self._session_service.touch_session(session_id)

        if no_reply:
            yield SSEEvent(event="done", data={"message_id": message.info.id})
            return

        # Start the streaming loop
        async for event in self._run_loop_stream(session_id):
            yield event

    async def _run_loop(self, session_id: str) -> MessageWithParts:
        """Main execution loop (non-streaming).

        Args:
            session_id: Session ID

        Returns:
            Final assistant message
        """
        abort = self._start_execution(session_id)
        if not abort:
            return await self._wait_for_result(session_id)

        try:
            step = 0
            max_steps = 50

            while step < max_steps:
                self._set_status(session_id, ExecutionStatus(type="busy", step=step))
                logger.info(f"Execution step {step} for session {session_id}")

                if abort.is_set():
                    break

                messages = await self._session_service.get_messages(session_id)
                last_user, last_assistant = self._find_last_messages(messages)

                if not last_user:
                    raise ValueError("No user message found")

                # Check if we're done
                if self._is_execution_complete(last_user, last_assistant):
                    logger.info(f"Execution complete for session {session_id}")
                    return last_assistant  # type: ignore

                step += 1

                result = await self._process_step(
                    session_id=session_id,
                    messages=messages,
                    last_user=last_user,
                    abort=abort,
                )

                if result and self._is_final_response(result):
                    return result

            # Max steps reached
            logger.warning(f"Max steps reached for session {session_id}")
            return await self._create_max_steps_message(session_id)

        finally:
            self.cancel(session_id)

    async def _run_loop_stream(self, session_id: str) -> AsyncIterator[SSEEvent]:
        """Main execution loop with streaming.

        Args:
            session_id: Session ID

        Yields:
            SSEEvent objects
        """
        abort = self._start_execution(session_id)
        if not abort:
            yield SSEEvent(event="error", data={"message": "Session is busy"})
            return

        try:
            step = 0
            max_steps = 50

            while step < max_steps:
                self._set_status(session_id, ExecutionStatus(type="busy", step=step))
                logger.info(f"Execution stream step {step} for session {session_id}")

                if abort.is_set():
                    yield SSEEvent(event="done", data={"reason": "cancelled"})
                    break

                messages = await self._session_service.get_messages(session_id)
                last_user, last_assistant = self._find_last_messages(messages)

                if not last_user:
                    yield SSEEvent(event="error", data={"message": "No user message found"})
                    return

                # Check if we're done
                if self._is_execution_complete(last_user, last_assistant):
                    logger.info(f"Execution stream complete for session {session_id}")
                    yield SSEEvent(event="done", data={
                        "message_id": last_assistant.info.id,  # type: ignore
                        "reason": last_assistant.info.finish,  # type: ignore
                    })
                    return

                step += 1

                async for event in self._process_step_stream(
                    session_id=session_id,
                    messages=messages,
                    last_user=last_user,
                    abort=abort,
                ):
                    yield event

                    if event.event in ("done", "error"):
                        return

            # Max steps reached
            logger.warning(f"Max steps reached for session {session_id}")
            yield SSEEvent(event="error", data={"message": "Maximum steps reached"})

        finally:
            self.cancel(session_id)

    # =========================================================================
    # Helper Methods
    # =========================================================================

    def _find_last_messages(
        self, messages: list[MessageWithParts]
    ) -> tuple[MessageWithParts | None, MessageWithParts | None]:
        """Find last user and assistant messages.

        Args:
            messages: All messages

        Returns:
            Tuple of (last_user, last_assistant)
        """
        last_user: MessageWithParts | None = None
        last_assistant: MessageWithParts | None = None

        for msg in reversed(messages):
            if not last_user and msg.info.role == "user":
                last_user = msg
            if not last_assistant and msg.info.role == "assistant":
                last_assistant = msg
            if last_user and last_assistant:
                break

        return last_user, last_assistant

    def _is_execution_complete(
        self,
        last_user: MessageWithParts,
        last_assistant: MessageWithParts | None,
    ) -> bool:
        """Check if execution is complete.

        Args:
            last_user: Last user message
            last_assistant: Last assistant message

        Returns:
            True if execution is complete
        """
        if not last_assistant:
            return False

        if not isinstance(last_assistant.info, AssistantMessage):
            return False

        finish = last_assistant.info.finish
        if not finish or finish in ("tool-calls", "unknown"):
            return False

        return last_user.info.id < last_assistant.info.id

    def _is_final_response(self, message: MessageWithParts) -> bool:
        """Check if message is a final response.

        Args:
            message: Message to check

        Returns:
            True if this is a final response
        """
        if not isinstance(message.info, AssistantMessage):
            return False

        finish = message.info.finish
        return finish is not None and finish not in ("tool-calls",)

    async def _wait_for_result(self, session_id: str) -> MessageWithParts:
        """Wait for execution result.

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

        active = self._active.get(session_id)
        if active:
            active.callbacks.append({"resolve": resolve, "reject": reject})

        return await future

    # =========================================================================
    # Message Creation
    # =========================================================================

    async def _create_user_message(
        self,
        session_id: str,
        parts: list[dict[str, Any]],
        model: dict[str, str],
        agent: str | None = None,
        message_id: str | None = None,
    ) -> MessageWithParts:
        """Create a user message.

        Args:
            session_id: Session ID
            parts: Message parts
            model: Model info
            agent: Agent name
            message_id: Optional message ID

        Returns:
            Created message
        """
        now = int(time.time() * 1000)

        message = UserMessage(
            id=message_id or f"message_{ULID()}",
            session_id=session_id,
            model=model,
            agent=agent,
            time={"created": now},
        )

        # Convert parts
        message_parts: list[MessagePart] = []
        user_text = ""
        for part_data in parts:
            part_type = part_data.get("type")
            if part_type == "text":
                text = part_data.get("text", "")
                user_text += text
                message_parts.append(TextPart(
                    text=text,
                    session_id=session_id,
                    message_id=message.id,
                ))

        result = await self._session_service.add_message(session_id, message, message_parts)

        # Sync to short-term memory
        if user_text:
            await self._sync_to_memory(
                session_id=session_id,
                role="user",
                content=user_text,
            )

        return result

    async def _create_max_steps_message(self, session_id: str) -> MessageWithParts:
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

        return await self._session_service.add_message(session_id, message, [text_part])

    # =========================================================================
    # Memory Sync
    # =========================================================================

    async def _sync_to_memory(
        self,
        session_id: str,
        role: str,
        content: str | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
        tool_call_id: str | None = None,
    ) -> None:
        """Sync a message to short-term memory.

        Args:
            session_id: Session ID
            role: Message role (user, assistant, tool)
            content: Message content
            tool_calls: Tool calls (for assistant messages)
            tool_call_id: Tool call ID (for tool result messages)
        """
        try:
            session = await self._session_service.get_session(session_id)
            if not session:
                return

            message = {"role": role}
            if content:
                message["content"] = content
            if tool_calls:
                message["tool_calls"] = tool_calls
            if tool_call_id:
                message["tool_call_id"] = tool_call_id

            session.memory.add_message(message)

            logger.debug(f"Synced {role} message to memory for session {session_id}")

        except Exception as e:
            logger.warning(f"Failed to sync to memory: {e}")

    # =========================================================================
    # LLM Message Building
    # =========================================================================

    def _build_llm_messages(self, messages: list[MessageWithParts]) -> list[dict[str, Any]]:
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


    # =========================================================================
    # Step Processing (Non-Streaming)
    # =========================================================================

    async def _process_step(
        self,
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
        if not isinstance(last_user.info, UserMessage):
            raise ValueError("Invalid user message")

        model_info = last_user.info.model
        agent = last_user.info.agent or "build"
        user_request = last_user.get_text_content() or ""

        # Create assistant message
        now = int(time.time() * 1000)
        assistant_msg = AssistantMessage(
            id=f"message_{ULID()}",
            session_id=session_id,
            parent_id=last_user.info.id,
            model_id=model_info.get("model_id", ""),
            provider_id=model_info.get("provider_id", ""),
            agent=agent,
            path={"cwd": str(self._workspace), "root": str(self._worktree)},
            time={"created": now},
        )

        msg_with_parts = await self._session_service.add_message(session_id, assistant_msg, [])

        # Publish agent started event
        await self._publish_agent_started(session_id, agent, model_info)

        try:
            # Build prompt using plugin system
            plugin_manager = await self.get_plugin_manager()
            plugin_context = await self._build_plugin_context(
                session_id=session_id,
                agent_name=agent,
                model_info=model_info,
                messages=messages,
                user_request=user_request,
            )
            prompt_result = await plugin_manager.build_prompt(plugin_context)

            # Get LLM messages
            memory_metadata = prompt_result.get("metadata", {})
            llm_messages = memory_metadata.get("messages", [])
            if not llm_messages:
                llm_messages = self._build_llm_messages(messages)

            # Prepend system prompt
            system_prompt = prompt_result.get("system_prompt", "")
            if system_prompt:
                llm_messages.insert(0, {"role": "system", "content": system_prompt})

            # Get tool definitions
            tool_defs = []
            if self._tool_registry:
                tool_restrictions = prompt_result.get("tool_restrictions")
                tool_defs = await self._tool_registry.get_llm_definitions(
                    agent=agent,
                    allowed_tools=tool_restrictions,
                )

            # Call LLM - use full provider/model format
            model_str = f"{model_info.get('provider_id', 'ollama')}/{model_info.get('model_id', '')}"
            response = await self._provider_service.complete(
                model=model_str,
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
                await self._session_service.add_part(session_id, assistant_msg.id, text_part)

            # Sync to memory
            await self._sync_to_memory(
                session_id=session_id,
                role="assistant",
                content=content,
                tool_calls=tool_calls,
            )

            # Handle tool calls
            if tool_calls:
                for tc in tool_calls:
                    await self._handle_tool_call(
                        session_id=session_id,
                        message_id=assistant_msg.id,
                        tool_call=tc,
                        abort=abort,
                    )
                finish_reason = "tool-calls"

            # Update message with finish reason
            await self._session_service.update_message(
                session_id,
                assistant_msg.id,
                lambda m: setattr(m.info, "finish", finish_reason) if isinstance(m.info, AssistantMessage) else None,
            )

            # Publish agent completed event
            await self._publish_agent_completed(session_id, agent, finish_reason)

            # Get updated message
            messages = await self._session_service.get_messages(session_id)
            for msg in reversed(messages):
                if msg.info.id == assistant_msg.id:
                    return msg

            return msg_with_parts

        except Exception as e:
            logger.error(f"Error in process step: {e}", exc_info=True)

            await self._session_service.update_message(
                session_id,
                assistant_msg.id,
                lambda m: setattr(m.info, "error", {"message": str(e)}) if isinstance(m.info, AssistantMessage) else None,
            )

            await self._publish_agent_error(session_id, agent, str(e))
            raise

    # =========================================================================
    # Step Processing (Streaming)
    # =========================================================================

    async def _process_step_stream(
        self,
        session_id: str,
        messages: list[MessageWithParts],
        last_user: MessageWithParts,
        abort: asyncio.Event,
    ) -> AsyncIterator[SSEEvent]:
        """Process a single step with streaming response.

        Args:
            session_id: Session ID
            messages: All messages
            last_user: Last user message
            abort: Abort event

        Yields:
            SSEEvent objects
        """
        if not isinstance(last_user.info, UserMessage):
            yield SSEEvent(event="error", data={"message": "Invalid user message"})
            return

        model_info = last_user.info.model
        agent = last_user.info.agent or "build"
        user_request = last_user.get_text_content() or ""

        # Create assistant message
        now = int(time.time() * 1000)
        assistant_msg = AssistantMessage(
            id=f"message_{ULID()}",
            session_id=session_id,
            parent_id=last_user.info.id,
            model_id=model_info.get("model_id", ""),
            provider_id=model_info.get("provider_id", ""),
            agent=agent,
            path={"cwd": str(self._workspace), "root": str(self._worktree)},
            time={"created": now},
        )

        await self._session_service.add_message(session_id, assistant_msg, [])

        yield SSEEvent(event="message_start", data={
            "message_id": assistant_msg.id,
            "session_id": session_id,
        })

        await self._publish_message_created(session_id, assistant_msg.id)
        await self._publish_agent_started(session_id, agent, model_info)

        try:
            # Build prompt using plugin system
            plugin_manager = await self.get_plugin_manager()
            plugin_context = await self._build_plugin_context(
                session_id=session_id,
                agent_name=agent,
                model_info=model_info,
                messages=messages,
                user_request=user_request,
            )
            prompt_result = await plugin_manager.build_prompt(plugin_context)

            # Get LLM messages
            memory_metadata = prompt_result.get("metadata", {})
            llm_messages = memory_metadata.get("messages", [])
            if not llm_messages:
                llm_messages = self._build_llm_messages(messages)

            # Prepend system prompt
            system_prompt = prompt_result.get("system_prompt", "")
            if system_prompt:
                llm_messages.insert(0, {"role": "system", "content": system_prompt})

            # Get tool definitions
            tool_defs = []
            if self._tool_registry:
                tool_restrictions = prompt_result.get("tool_restrictions")
                tool_defs = await self._tool_registry.get_llm_definitions(
                    agent=agent,
                    allowed_tools=tool_restrictions,
                )

            # Call LLM with streaming - use full provider/model format
            model_str = f"{model_info.get('provider_id', 'ollama')}/{model_info.get('model_id', '')}"
            stream_response = await self._provider_service.complete(
                model=model_str,
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
                    await self._publish_stream_done(session_id, assistant_msg.id, "cancelled")
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
                    await self._publish_stream_text(session_id, assistant_msg.id, content)

                # Handle tool calls (accumulated)
                chunk_tool_calls = chunk.get("tool_calls")
                if chunk_tool_calls:
                    tool_calls = self._merge_tool_calls(tool_calls, chunk_tool_calls)

                if chunk.get("finish_reason"):
                    finish_reason = chunk["finish_reason"]

            # Add text content to message
            if full_content:
                text_part = TextPart(
                    text=full_content,
                    session_id=session_id,
                    message_id=assistant_msg.id,
                )
                await self._session_service.add_part(session_id, assistant_msg.id, text_part)

            # Handle tool calls
            if tool_calls:
                finish_reason = "tool-calls"
                for tc in tool_calls:
                    yield SSEEvent(event="tool_call", data={
                        "message_id": assistant_msg.id,
                        "tool_call": tc,
                    })

                    await self._publish_stream_tool_call(session_id, assistant_msg.id, tc)

                    async for tool_event in self._handle_tool_call_stream(
                        session_id=session_id,
                        message_id=assistant_msg.id,
                        tool_call=tc,
                        abort=abort,
                    ):
                        yield tool_event

            # Update message with finish reason
            await self._session_service.update_message(
                session_id,
                assistant_msg.id,
                lambda m: setattr(m.info, "finish", finish_reason) if isinstance(m.info, AssistantMessage) else None,
            )

            await self._publish_agent_completed(session_id, agent, finish_reason)

            if finish_reason not in ("tool-calls",):
                await self._publish_stream_done(session_id, assistant_msg.id, finish_reason)
                yield SSEEvent(event="done", data={
                    "message_id": assistant_msg.id,
                    "reason": finish_reason,
                })

        except Exception as e:
            logger.error(f"Error in process step stream: {e}", exc_info=True)

            await self._session_service.update_message(
                session_id,
                assistant_msg.id,
                lambda m: setattr(m.info, "error", {"message": str(e)}) if isinstance(m.info, AssistantMessage) else None,
            )

            await self._publish_agent_error(session_id, agent, str(e))
            await self._publish_stream_error(session_id, assistant_msg.id, str(e))

            yield SSEEvent(event="error", data={"message": str(e)})

    def _merge_tool_calls(
        self,
        existing: list[dict[str, Any]],
        new_chunks: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Merge tool call chunks.

        Args:
            existing: Existing tool calls
            new_chunks: New tool call chunks

        Returns:
            Merged tool calls
        """
        for tc in new_chunks:
            tc_id = tc.get("id") or tc.get("index", 0)
            found = None
            for existing_tc in existing:
                if existing_tc.get("id") == tc_id or existing_tc.get("index") == tc_id:
                    found = existing_tc
                    break

            if found:
                if "function" in tc and "arguments" in tc["function"]:
                    if "function" not in found:
                        found["function"] = {}
                    found["function"]["arguments"] = found["function"].get("arguments", "") + tc["function"]["arguments"]
            else:
                existing.append(tc)

        return existing


    # =========================================================================
    # Tool Execution
    # =========================================================================

    async def _handle_tool_call(
        self,
        session_id: str,
        message_id: str,
        tool_call: dict[str, Any],
        abort: asyncio.Event,
    ) -> None:
        """Handle a tool call (non-streaming).

        Args:
            session_id: Session ID
            message_id: Message ID
            tool_call: Tool call data
            abort: Abort event
        """
        if not self._tool_registry:
            return

        tool_name = tool_call.get("function", {}).get("name", "")
        call_id = tool_call.get("id", str(uuid4()))

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

        await self._session_service.add_part(session_id, message_id, tool_part)

        # Create context
        from src.tool.context import ToolContext
        context = ToolContext(
            session_id=session_id,
            message_id=message_id,
            agent="build",
            abort=abort,
            call_id=call_id,
            _bus=self._bus,
            _workspace=self._workspace,
            _worktree=self._worktree,
        )

        try:
            tool_part.state = "running"
            tool_part.time["started"] = int(time.time() * 1000)

            result = await self._tool_registry.execute(tool_name, arguments, context)

            tool_part.state = "completed"
            tool_part.output = result.output
            tool_part.title = result.title
            tool_part.metadata = result.metadata
            tool_part.time["completed"] = int(time.time() * 1000)

            await self._sync_to_memory(
                session_id=session_id,
                role="tool",
                content=result.output,
                tool_call_id=call_id,
            )

        except Exception as e:
            logger.error(f"Tool execution error: {e}")
            tool_part.state = "error"
            tool_part.error = str(e)
            tool_part.time["completed"] = int(time.time() * 1000)

            await self._sync_to_memory(
                session_id=session_id,
                role="tool",
                content=f"Error: {str(e)}",
                tool_call_id=call_id,
            )

    async def _handle_tool_call_stream(
        self,
        session_id: str,
        message_id: str,
        tool_call: dict[str, Any],
        abort: asyncio.Event,
    ) -> AsyncIterator[SSEEvent]:
        """Handle a tool call with streaming events.

        Args:
            session_id: Session ID
            message_id: Message ID
            tool_call: Tool call data
            abort: Abort event

        Yields:
            SSEEvent objects
        """
        if not self._tool_registry:
            yield SSEEvent(event="error", data={"message": "Tool registry not configured"})
            return

        tool_name = tool_call.get("function", {}).get("name", "")
        call_id = tool_call.get("id", str(uuid4()))

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

        await self._session_service.add_part(session_id, message_id, tool_part)

        yield SSEEvent(event="tool_executing", data={
            "call_id": call_id,
            "tool": tool_name,
            "input": arguments,
            "message_id": message_id,
        })

        # Create context
        from src.tool.context import ToolContext
        context = ToolContext(
            session_id=session_id,
            message_id=message_id,
            agent="build",
            abort=abort,
            call_id=call_id,
            _bus=self._bus,
            _workspace=self._workspace,
            _worktree=self._worktree,
        )

        try:
            tool_part.state = "running"
            tool_part.time["started"] = int(time.time() * 1000)

            result = await self._tool_registry.execute(tool_name, arguments, context)

            tool_part.state = "completed"
            tool_part.output = result.output
            tool_part.title = result.title
            tool_part.metadata = result.metadata
            tool_part.time["completed"] = int(time.time() * 1000)

            await self._sync_to_memory(
                session_id=session_id,
                role="tool",
                content=result.output,
                tool_call_id=call_id,
            )

            yield SSEEvent(event="tool_result", data={
                "call_id": call_id,
                "tool": tool_name,
                "output": result.output,
                "title": result.title,
                "metadata": result.metadata,
                "message_id": message_id,
            })

            await self._publish_stream_tool_result(
                session_id, message_id, call_id, tool_name, result.output, result.title, result.metadata
            )

        except Exception as e:
            logger.error(f"Tool execution error: {e}")
            tool_part.state = "error"
            tool_part.error = str(e)
            tool_part.time["completed"] = int(time.time() * 1000)

            await self._sync_to_memory(
                session_id=session_id,
                role="tool",
                content=f"Error: {str(e)}",
                tool_call_id=call_id,
            )

            yield SSEEvent(event="tool_error", data={
                "call_id": call_id,
                "tool": tool_name,
                "error": str(e),
                "message_id": message_id,
            })

            await self._publish_stream_tool_result(
                session_id, message_id, call_id, tool_name, "", error=str(e)
            )

    # =========================================================================
    # Event Publishing
    # =========================================================================

    async def _publish_agent_started(
        self, session_id: str, agent: str, model_info: dict[str, str]
    ) -> None:
        """Publish agent started event."""
        if self._bus:
            from src.bus.events import AgentStarted, AgentStartedData
            await self._bus.publish(
                AgentStarted,
                AgentStartedData(
                    session_id=session_id,
                    agent=agent,
                    model_id=model_info.get("model_id", ""),
                    provider_id=model_info.get("provider_id", ""),
                )
            )

    async def _publish_agent_completed(
        self, session_id: str, agent: str, reason: str
    ) -> None:
        """Publish agent completed event."""
        if self._bus:
            from src.bus.events import AgentCompleted, AgentCompletedData
            await self._bus.publish(
                AgentCompleted,
                AgentCompletedData(
                    session_id=session_id,
                    agent=agent,
                    iterations=1,
                    reason=reason,
                )
            )

    async def _publish_agent_error(
        self, session_id: str, agent: str, error: str
    ) -> None:
        """Publish agent error event."""
        if self._bus:
            from src.bus.events import AgentError, AgentErrorData
            await self._bus.publish(
                AgentError,
                AgentErrorData(
                    session_id=session_id,
                    agent=agent,
                    error=error,
                )
            )

    async def _publish_message_created(
        self, session_id: str, message_id: str
    ) -> None:
        """Publish message created event."""
        if self._bus:
            from src.bus.events import MessageCreated, MessageCreatedData
            await self._bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id=session_id,
                    message_id=message_id,
                    role="assistant",
                    content="",
                )
            )

    async def _publish_stream_text(
        self, session_id: str, message_id: str, content: str
    ) -> None:
        """Publish stream text event."""
        if self._bus:
            from src.bus.events import StreamText, StreamTextData
            await self._bus.publish(
                StreamText,
                StreamTextData(
                    session_id=session_id,
                    message_id=message_id,
                    content=content,
                )
            )

    async def _publish_stream_tool_call(
        self, session_id: str, message_id: str, tool_call: dict[str, Any]
    ) -> None:
        """Publish stream tool call event."""
        if self._bus:
            tool_name = tool_call.get("function", {}).get("name", "")
            call_id = tool_call.get("id", str(uuid4()))
            try:
                args_str = tool_call.get("function", {}).get("arguments", "{}")
                arguments = json.loads(args_str)
            except json.JSONDecodeError:
                arguments = {}

            from src.bus.events import StreamToolCall, StreamToolCallData
            await self._bus.publish(
                StreamToolCall,
                StreamToolCallData(
                    session_id=session_id,
                    message_id=message_id,
                    call_id=call_id,
                    tool=tool_name,
                    input=arguments,
                )
            )

    async def _publish_stream_tool_result(
        self,
        session_id: str,
        message_id: str,
        call_id: str,
        tool: str,
        output: str,
        title: str | None = None,
        metadata: dict | None = None,
        error: str | None = None,
    ) -> None:
        """Publish stream tool result event."""
        if self._bus:
            from src.bus.events import StreamToolResult, StreamToolResultData
            await self._bus.publish(
                StreamToolResult,
                StreamToolResultData(
                    session_id=session_id,
                    message_id=message_id,
                    call_id=call_id,
                    tool=tool,
                    output=output,
                    title=title,
                    metadata=metadata or {},
                    error=error,
                )
            )

    async def _publish_stream_done(
        self, session_id: str, message_id: str, reason: str
    ) -> None:
        """Publish stream done event."""
        if self._bus:
            from src.bus.events import StreamDone, StreamDoneData
            await self._bus.publish(
                StreamDone,
                StreamDoneData(
                    session_id=session_id,
                    message_id=message_id,
                    reason=reason,
                )
            )

    async def _publish_stream_error(
        self, session_id: str, message_id: str, error: str
    ) -> None:
        """Publish stream error event."""
        if self._bus:
            from src.bus.events import StreamError, StreamErrorData
            await self._bus.publish(
                StreamError,
                StreamErrorData(
                    session_id=session_id,
                    message_id=message_id,
                    error=error,
                )
            )
