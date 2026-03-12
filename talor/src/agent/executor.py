"""Agent Executor Service for Talor.

This module provides the core execution engine for AI agents,
implementing the ReAct (Reasoning + Acting) cycle.

Features:
- Prompt processing with tool execution
- Main event loop with step tracking
- Cancellation support
- Event publishing for status updates
- SSE streaming support for real-time inference
- ReAct loop state and context management (merged from loop.py)

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
from dataclasses import dataclass, field
from enum import Enum
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
    from src.bus.global_bus import GlobalBus
    from src.tool import ToolRegistry
    from src.session import SessionService
    from src.provider import ProviderService
    from src.agent import AgentService
    from src.agent.agent import Agent


logger = logging.getLogger(__name__)


# =============================================================================
# ReAct Loop State and Events (merged from loop.py)
# =============================================================================


class LoopPhase(str, Enum):
    """Current phase in the ReAct loop."""

    IDLE = "idle"
    REASONING = "reasoning"
    ACTING = "acting"
    OBSERVING = "observing"
    COMPLETED = "completed"
    ERROR = "error"


class StopReason(str, Enum):
    """Reason for loop termination."""

    COMPLETED = "completed"  # Natural completion
    MAX_ITERATIONS = "max_iterations"  # Hit iteration limit
    CANCELLED = "cancelled"  # User cancelled
    ERROR = "error"  # Error occurred
    NO_ACTION = "no_action"  # LLM decided no action needed


@dataclass
class Thought:
    """Represents the agent's reasoning output.

    Contains the LLM's analysis and decision about what to do next.
    """

    content: str  # Reasoning text
    requires_action: bool = False  # Whether action is needed
    tool_calls: list["ToolCall"] = field(default_factory=list)
    finish_reason: str | None = None
    confidence: float = 1.0  # Confidence in decision (0-1)

    @property
    def is_final(self) -> bool:
        """Check if this is a final response (no more actions)."""
        return not self.requires_action or self.finish_reason == "stop"


@dataclass
class ToolCall:
    """Represents a tool call decision."""

    id: str
    name: str
    arguments: dict[str, Any]

    @classmethod
    def from_llm_response(cls, tool_call: dict[str, Any]) -> "ToolCall":
        """Create from LLM response format."""
        return cls(
            id=tool_call.get("id", str(uuid4())),
            name=tool_call.get("function", {}).get("name", ""),
            arguments=tool_call.get("function", {}).get("arguments", {}),
        )


@dataclass
class Action:
    """Represents an executed action."""

    tool_call: ToolCall
    started_at: float = field(default_factory=time.time)
    completed_at: float | None = None

    @property
    def duration_ms(self) -> float:
        """Get execution duration in milliseconds."""
        if self.completed_at:
            return (self.completed_at - self.started_at) * 1000
        return 0


@dataclass
class Observation:
    """Represents the result of an action.

    Contains the tool execution result and any metadata.
    """

    action: Action
    success: bool
    output: str
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_message(self) -> dict[str, Any]:
        """Convert to message format for context."""
        return {
            "role": "tool",
            "tool_call_id": self.action.tool_call.id,
            "content": self.output if self.success else f"Error: {self.error}",
        }


@dataclass
class LoopContext:
    """Context maintained throughout the loop execution.

    Tracks the conversation history, iterations, and state.
    """

    session_id: str
    message_id: str
    messages: list[dict[str, Any]] = field(default_factory=list)
    iterations: int = 0
    thoughts: list[Thought] = field(default_factory=list)
    actions: list[Action] = field(default_factory=list)
    observations: list[Observation] = field(default_factory=list)
    phase: LoopPhase = LoopPhase.IDLE
    started_at: float = field(default_factory=time.time)

    def add_thought(self, thought: Thought) -> None:
        """Add a thought to history."""
        self.thoughts.append(thought)
        if thought.content:
            self.messages.append(
                {
                    "role": "assistant",
                    "content": thought.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.name, "arguments": tc.arguments},
                        }
                        for tc in thought.tool_calls
                    ]
                    if thought.tool_calls
                    else None,
                }
            )

    def add_observation(self, observation: Observation) -> None:
        """Add an observation to history."""
        self.observations.append(observation)
        self.messages.append(observation.to_message())

    @property
    def elapsed_ms(self) -> float:
        """Get elapsed time in milliseconds."""
        return (time.time() - self.started_at) * 1000


# =============================================================================
# Loop Configuration
# =============================================================================


@dataclass
class LoopConfig:
    """Configuration for the agent loop."""

    max_iterations: int = 50  # Maximum reasoning cycles
    max_tool_calls_per_iteration: int = 10  # Max tools per cycle
    timeout_seconds: float = 300  # Overall timeout
    enable_reflection: bool = False  # Enable self-reflection
    reflection_frequency: int = 5  # Reflect every N iterations
    retry_on_error: bool = True  # Retry failed tool calls
    max_retries: int = 2  # Max retries per tool


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
        agent_service: "AgentService | None" = None,
        workspace: Path | None = None,
        worktree: Path | None = None,
        plugin_manager: PluginManager | None = None,
    ) -> None:
        """Initialize agent executor.

        Args:
            session_service: Session management service
            provider_service: LLM provider service
            tool_registry: Tool registry for tool execution
            agent_service: Agent service for agent configuration
            workspace: Working directory
            worktree: Project worktree root
            plugin_manager: Plugin manager for prompt building
        """
        self._session_service = session_service
        self._provider_service = provider_service
        self._tool_registry = tool_registry
        self._agent_service = agent_service
        self._workspace = workspace or Path(".")
        self._worktree = worktree or self._workspace
        self._plugin_manager = plugin_manager

        # Active executions (session_id -> ActiveExecution)
        self._active: dict[str, ActiveExecution] = {}
        self._status: dict[str, ExecutionStatus] = {}
        self._skill_registry: Any | None = None  # Set after plugin setup
        self._memory_lock = asyncio.Lock()  # Protects memory sync during parallel tool execution

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
        await self._plugin_manager.register(MemoryPlugin(provider_service=self._provider_service))
        await self._plugin_manager.register(LLMPlugin())

        # Tool plugin with registry
        tool_plugin = ToolPlugin(tool_registry=self._tool_registry)
        await self._plugin_manager.register(tool_plugin)

        # Skill plugin (Stage 1: description index in system prompt)
        skill_plugin = SkillPlugin()
        await skill_plugin.initialize(self._worktree)
        await self._plugin_manager.register(skill_plugin)

        # Register Skill tool (Stage 2: load full instructions on-demand)
        if skill_plugin.registry:
            from src.skill.tool import create_skill_tool

            skill_tool = create_skill_tool()
            try:
                await self._tool_registry.register(skill_tool, source="skill")
            except ValueError:
                pass  # Already registered
            # Store registry reference for ToolContext injection
            self._skill_registry = skill_plugin.registry

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
            agent_prompt: Optional custom agent prompt (deprecated)

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

        # 获取 agent 的手册路径（manual 字段）
        agent_prompt_path: str | None = None

        if self._agent_service:
            agent_obj = await self._agent_service.get_agent(agent_name)
            if agent_obj:
                agent_prompt_path = agent_obj.manual

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
            agent_prompt_path=agent_prompt_path,
            extra={},
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
            max_steps = 100  # Default

            # Get max_steps from agent config
            messages = await self._session_service.get_messages(session_id)
            last_user, _ = self._find_last_messages(messages)
            if last_user and self._agent_service:
                agent_name = getattr(last_user.info, "agent", None) or "build"
                agent = await self._agent_service.get_agent(agent_name)
                if agent:
                    max_steps = agent.max_steps

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
            max_steps = 100  # Default

            # Get max_steps from agent config
            messages = await self._session_service.get_messages(session_id)
            last_user, _ = self._find_last_messages(messages)
            if last_user and self._agent_service:
                agent_name = getattr(last_user.info, "agent", None) or "build"
                agent = await self._agent_service.get_agent(agent_name)
                if agent:
                    max_steps = agent.max_steps

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
                    yield SSEEvent(
                        event="done",
                        data={
                            "message_id": last_assistant.info.id,  # type: ignore
                            "reason": last_assistant.info.finish,  # type: ignore
                        },
                    )
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
                        logger.info(f"Loop stopping: event={event.event}")
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

        Handles /skill-name commands by prepending a skill invocation note.

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

        # Check for /skill-name command in text parts
        parts = await self._preprocess_skill_command(session_id, parts)

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
                message_parts.append(
                    TextPart(
                        text=text,
                        session_id=session_id,
                        message_id=message.id,
                    )
                )

        result = await self._session_service.add_message(session_id, message, message_parts)

        # Sync to short-term memory
        if user_text:
            await self._sync_to_memory(
                session_id=session_id,
                role="user",
                content=user_text,
            )

        return result

    async def _preprocess_skill_command(
        self,
        session_id: str,
        parts: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Detect /skill-name commands and rewrite parts to trigger skill loading.

        When user types `/skill-name [arguments]`, we rewrite the text to
        instruct the LLM to invoke the skill tool immediately.

        Args:
            session_id: Session ID
            parts: Original message parts

        Returns:
            Possibly modified parts
        """
        if not self._skill_registry:
            return parts

        import re

        for part in parts:
            if part.get("type") != "text":
                continue
            text = part.get("text", "").strip()
            # Match /skill-name with optional arguments
            m = re.match(r"^/([a-z][a-z0-9-]*)(?:\s+(.*))?$", text, re.DOTALL)
            if not m:
                continue
            skill_name, arguments = m.group(1), (m.group(2) or "").strip()
            skill = await self._skill_registry.get_skill(skill_name)
            if not skill:
                continue
            # Rewrite: tell LLM to invoke the skill tool with these args
            new_text = (
                f"Please use the `skill` tool to load the `{skill_name}` skill"
                + (f" with arguments: {arguments}" if arguments else "")
                + ", then follow its instructions."
            )
            part["text"] = new_text
            logger.info(f"Rewrote /skill command: /{skill_name} -> skill tool invocation")
            break

        return parts

    async def _check_skill_tool_allowed(
        self,
        session_id: str,
        tool_name: str,
    ) -> str | None:
        """Check if a tool is allowed by the active skill for this session.

        Returns an error message string if the tool is blocked, None if allowed.
        Mirrors Claude Code's execution-time enforcement of allowed-tools.

        Args:
            session_id: Session ID
            tool_name: Tool name to check

        Returns:
            Error message if blocked, None if allowed
        """
        if not self._skill_registry:
            return None

        allowed = await self._skill_registry.get_active_skill_tools(session_id)
        if allowed is None:
            return None  # No active skill restrictions

        if tool_name not in allowed:
            active = self._skill_registry.get_active_skills(session_id)
            return (
                f"Tool '{tool_name}' is not allowed by the active skill(s): "
                f"{', '.join(active)}. Allowed tools: {', '.join(sorted(allowed))}."
            )
        return None

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

        Uses a lock to ensure correct ordering when tools execute in parallel.

        Args:
            session_id: Session ID
            role: Message role (user, assistant, tool)
            content: Message content
            tool_calls: Tool calls (for assistant messages)
            tool_call_id: Tool call ID (for tool result messages)
        """
        async with self._memory_lock:
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

            # Use messages directly from plugin system (includes system prompt)
            llm_messages = prompt_result.get("messages", [])

            # Use tool definitions from plugin system
            tool_defs = prompt_result.get("tools", [])

            # Call LLM - use full provider/model format
            model_str = (
                f"{model_info.get('provider_id', 'ollama')}/{model_info.get('model_id', '')}"
            )
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

            # Handle tool calls — execute in parallel for independent tools
            if tool_calls:
                tasks = [
                    self._handle_tool_call(
                        session_id=session_id,
                        message_id=assistant_msg.id,
                        tool_call=tc,
                        abort=abort,
                    )
                    for tc in tool_calls
                ]
                await asyncio.gather(*tasks, return_exceptions=True)
                finish_reason = "tool-calls"

            # Update message with finish reason
            await self._session_service.update_message(
                session_id,
                assistant_msg.id,
                lambda m: setattr(m.info, "finish", finish_reason)
                if isinstance(m.info, AssistantMessage)
                else None,
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
                lambda m: setattr(m.info, "error", {"message": str(e)})
                if isinstance(m.info, AssistantMessage)
                else None,
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

        yield SSEEvent(
            event="message_start",
            data={
                "message_id": assistant_msg.id,
                "session_id": session_id,
            },
        )

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

            # Use messages directly from plugin system (includes system prompt)
            llm_messages = prompt_result.get("messages", [])

            # Use tool definitions from plugin system
            tool_defs = prompt_result.get("tools", [])

            # Call LLM with streaming - use full provider/model format
            model_str = (
                f"{model_info.get('provider_id', 'ollama')}/{model_info.get('model_id', '')}"
            )
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
                    yield SSEEvent(
                        event="text",
                        data={
                            "content": content,
                            "message_id": assistant_msg.id,
                        },
                    )
                    await self._publish_stream_text(session_id, assistant_msg.id, content)

                # Handle tool calls (accumulated)
                chunk_tool_calls = chunk.get("tool_calls")
                if chunk_tool_calls:
                    tool_calls = self._merge_tool_calls(tool_calls, chunk_tool_calls)

                if chunk.get("finish_reason"):
                    finish_reason = chunk["finish_reason"]

            # Parse Qwen3 tool calls from content if no standard tool_calls found
            if not tool_calls and full_content:
                logger.info(f"Checking for Qwen3 tool calls in content (len={len(full_content)})")
                from src.provider.provider import parse_qwen3_tool_calls

                xml_tool_calls, cleaned_content = parse_qwen3_tool_calls(full_content)
                if xml_tool_calls:
                    logger.info(f"Qwen3 tool calls parsed: {len(xml_tool_calls)} calls")
                    tool_calls = xml_tool_calls
                    full_content = cleaned_content
                else:
                    logger.info("No Qwen3 tool calls found in content")

            # Add text content to message
            if full_content:
                text_part = TextPart(
                    text=full_content,
                    session_id=session_id,
                    message_id=assistant_msg.id,
                )
                await self._session_service.add_part(session_id, assistant_msg.id, text_part)

            # Handle tool calls — execute in parallel, collect events, yield in order
            if tool_calls:
                finish_reason = "tool-calls"
                logger.info(
                    f"Tool calls detected: {len(tool_calls)} calls, setting finish_reason='tool-calls'"
                )

                # Notify frontend of all tool calls first
                for tc in tool_calls:
                    tool_name = tc.get("function", {}).get("name", "unknown")
                    logger.debug(f"  - Tool call: {tool_name}")
                    yield SSEEvent(
                        event="tool_call",
                        data={
                            "message_id": assistant_msg.id,
                            "tool_call": tc,
                        },
                    )
                    await self._publish_stream_tool_call(session_id, assistant_msg.id, tc)

                # Execute all tool calls in parallel, collecting events
                async def _collect_tool_events(tc: dict[str, Any]) -> list[SSEEvent]:
                    events: list[SSEEvent] = []
                    async for event in self._handle_tool_call_stream(
                        session_id=session_id,
                        message_id=assistant_msg.id,
                        tool_call=tc,
                        abort=abort,
                    ):
                        events.append(event)
                    return events

                results = await asyncio.gather(
                    *[_collect_tool_events(tc) for tc in tool_calls],
                    return_exceptions=True,
                )

                # Yield events in order (one tool at a time)
                for result in results:
                    if isinstance(result, list):
                        for event in result:
                            yield event
                    elif isinstance(result, Exception):
                        logger.error(f"Parallel tool execution error: {result}")

            # Update message with finish reason
            logger.info(
                f"Step complete: finish_reason='{finish_reason}', tool_calls_count={len(tool_calls)}"
            )
            await self._session_service.update_message(
                session_id,
                assistant_msg.id,
                lambda m: setattr(m.info, "finish", finish_reason)
                if isinstance(m.info, AssistantMessage)
                else None,
            )

            await self._publish_agent_completed(session_id, agent, finish_reason)

            if finish_reason not in ("tool-calls",):
                logger.info(f"Yielding done event: finish_reason='{finish_reason}'")
                await self._publish_stream_done(session_id, assistant_msg.id, finish_reason)
                yield SSEEvent(
                    event="done",
                    data={
                        "message_id": assistant_msg.id,
                        "reason": finish_reason,
                    },
                )
            else:
                logger.info(f"Not yielding done: finish_reason='tool-calls', loop should continue")

        except Exception as e:
            logger.error(f"Error in process step stream: {e}", exc_info=True)
            import traceback

            logger.error(f"Full traceback:\n{traceback.format_exc()}")

            await self._session_service.update_message(
                session_id,
                assistant_msg.id,
                lambda m: setattr(m.info, "error", {"message": str(e)})
                if isinstance(m.info, AssistantMessage)
                else None,
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
                    found["function"]["arguments"] = (
                        found["function"].get("arguments", "") + tc["function"]["arguments"]
                    )
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
        from src import get_global_bus

        context = ToolContext(
            session_id=session_id,
            message_id=message_id,
            agent="build",
            abort=abort,
            call_id=call_id,
            extra={
                **({"skill_registry": self._skill_registry} if self._skill_registry else {}),
                "executor": self,
                "agent_service": self._agent_service,
                "session_service": self._session_service,
                "tool_registry": self._tool_registry,
            },
            _bus=get_global_bus(),
            _workspace=self._workspace,
            _worktree=self._worktree,
        )

        # Enforce skill tool restrictions at execution time (Claude Code style)
        blocked = await self._check_skill_tool_allowed(session_id, tool_name)
        if blocked:
            tool_part.state = "error"
            tool_part.error = blocked
            tool_part.time["completed"] = int(time.time() * 1000)
            await self._sync_to_memory(
                session_id=session_id,
                role="tool",
                content=f"Error: {blocked}",
                tool_call_id=call_id,
            )
            return

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

        yield SSEEvent(
            event="tool_executing",
            data={
                "call_id": call_id,
                "tool": tool_name,
                "input": arguments,
                "message_id": message_id,
            },
        )

        # Create context
        from src.tool.context import ToolContext
        from src import get_global_bus

        context = ToolContext(
            session_id=session_id,
            message_id=message_id,
            agent="build",
            abort=abort,
            call_id=call_id,
            extra={
                **({"skill_registry": self._skill_registry} if self._skill_registry else {}),
                "executor": self,
                "agent_service": self._agent_service,
                "session_service": self._session_service,
                "tool_registry": self._tool_registry,
            },
            _bus=get_global_bus(),
            _workspace=self._workspace,
            _worktree=self._worktree,
        )

        # Enforce skill tool restrictions at execution time (Claude Code style)
        blocked = await self._check_skill_tool_allowed(session_id, tool_name)
        if blocked:
            tool_part.state = "error"
            tool_part.error = blocked
            tool_part.time["completed"] = int(time.time() * 1000)
            await self._sync_to_memory(
                session_id=session_id,
                role="tool",
                content=f"Error: {blocked}",
                tool_call_id=call_id,
            )
            yield SSEEvent(
                event="tool_error",
                data={
                    "call_id": call_id,
                    "tool": tool_name,
                    "error": blocked,
                    "message_id": message_id,
                },
            )
            await self._publish_stream_tool_result(
                session_id, message_id, call_id, tool_name, "", error=blocked
            )
            return

        try:
            tool_part.state = "running"
            tool_part.time["started"] = int(time.time() * 1000)

            logger.info(f"Executing tool: {tool_name} with args: {arguments}")
            result = await self._tool_registry.execute(tool_name, arguments, context)
            logger.info(f"Tool executed successfully: {tool_name}")

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

            yield SSEEvent(
                event="tool_result",
                data={
                    "call_id": call_id,
                    "tool": tool_name,
                    "output": result.output,
                    "title": result.title,
                    "metadata": result.metadata,
                    "message_id": message_id,
                },
            )

            await self._publish_stream_tool_result(
                session_id,
                message_id,
                call_id,
                tool_name,
                result.output,
                result.title,
                result.metadata,
            )

        except Exception as e:
            logger.error(f"Tool execution error for {tool_name}: {e}", exc_info=True)
            tool_part.state = "error"
            tool_part.error = str(e)
            tool_part.time["completed"] = int(time.time() * 1000)

            await self._sync_to_memory(
                session_id=session_id,
                role="tool",
                content=f"Error: {str(e)}",
                tool_call_id=call_id,
            )

            yield SSEEvent(
                event="tool_error",
                data={
                    "call_id": call_id,
                    "tool": tool_name,
                    "error": str(e),
                    "message_id": message_id,
                },
            )

            await self._publish_stream_tool_result(
                session_id, message_id, call_id, tool_name, "", error=str(e)
            )

    # =========================================================================
    # Event Publishing
    # =========================================================================

    def _get_global_bus(self) -> "GlobalBus":
        """Get the global event bus.

        Returns:
            GlobalBus instance
        """
        from src import get_global_bus

        return get_global_bus()

    async def _publish_agent_started(
        self, session_id: str, agent: str, model_info: dict[str, str]
    ) -> None:
        """Publish agent started event."""
        bus = self._get_global_bus()
        from src.bus.events import AgentStarted, AgentStartedData

        await bus.publish(
            AgentStarted,
            AgentStartedData(
                session_id=session_id,
                agent=agent,
                model_id=model_info.get("model_id", ""),
                provider_id=model_info.get("provider_id", ""),
            ),
        )

    async def _publish_agent_completed(self, session_id: str, agent: str, reason: str) -> None:
        """Publish agent completed event."""
        bus = self._get_global_bus()
        from src.bus.events import AgentCompleted, AgentCompletedData

        await bus.publish(
            AgentCompleted,
            AgentCompletedData(
                session_id=session_id,
                agent=agent,
                iterations=1,
                reason=reason,
            ),
        )

    async def _publish_agent_error(self, session_id: str, agent: str, error: str) -> None:
        """Publish agent error event."""
        bus = self._get_global_bus()
        from src.bus.events import AgentError, AgentErrorData

        await bus.publish(
            AgentError,
            AgentErrorData(
                session_id=session_id,
                agent=agent,
                error=error,
            ),
        )

    async def _publish_message_created(self, session_id: str, message_id: str) -> None:
        """Publish message created event."""
        bus = self._get_global_bus()
        from src.bus.events import MessageCreated, MessageCreatedData

        await bus.publish(
            MessageCreated,
            MessageCreatedData(
                session_id=session_id,
                message_id=message_id,
                role="assistant",
                content="",
            ),
        )

    async def _publish_stream_text(self, session_id: str, message_id: str, content: str) -> None:
        """Publish stream text event."""
        bus = self._get_global_bus()
        from src.bus.events import StreamText, StreamTextData

        await bus.publish(
            StreamText,
            StreamTextData(
                session_id=session_id,
                message_id=message_id,
                content=content,
            ),
        )

    async def _publish_stream_tool_call(
        self, session_id: str, message_id: str, tool_call: dict[str, Any]
    ) -> None:
        """Publish stream tool call event."""
        bus = self._get_global_bus()
        tool_name = tool_call.get("function", {}).get("name", "")
        call_id = tool_call.get("id", str(uuid4()))
        try:
            args_str = tool_call.get("function", {}).get("arguments", "{}")
            arguments = json.loads(args_str)
        except json.JSONDecodeError:
            arguments = {}

        from src.bus.events import StreamToolCall, StreamToolCallData

        await bus.publish(
            StreamToolCall,
            StreamToolCallData(
                session_id=session_id,
                message_id=message_id,
                call_id=call_id,
                tool=tool_name,
                input=arguments,
            ),
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
        bus = self._get_global_bus()
        from src.bus.events import StreamToolResult, StreamToolResultData

        await bus.publish(
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
            ),
        )

    async def _publish_stream_done(self, session_id: str, message_id: str, reason: str) -> None:
        """Publish stream done event."""
        bus = self._get_global_bus()
        from src.bus.events import StreamDone, StreamDoneData

        await bus.publish(
            StreamDone,
            StreamDoneData(
                session_id=session_id,
                message_id=message_id,
                reason=reason,
            ),
        )

    async def _publish_stream_error(self, session_id: str, message_id: str, error: str) -> None:
        """Publish stream error event."""
        bus = self._get_global_bus()
        from src.bus.events import StreamError, StreamErrorData

        await bus.publish(
            StreamError,
            StreamErrorData(
                session_id=session_id,
                message_id=message_id,
                error=error,
            ),
        )


# =============================================================================
# AgentLoop - Backward Compatible Wrapper (merged from loop.py)
# =============================================================================


class AgentLoop:
    """Core ReAct loop implementation.

    Implements the Reasoning-Acting-Observing cycle for agent execution.
    This is the heart of the agent system, coordinating between:
    - LLM for reasoning and planning
    - Tool registry for action execution
    - Event bus for state updates

    The loop continues until:
    - LLM indicates completion (no more tool calls)
    - Maximum iterations reached
    - Error occurs
    - User cancels

    Note: This class is kept for backward compatibility. The core logic
    has been merged into AgentExecutor.
    """

    def __init__(
        self,
        session_id: str,
        message_id: str,
        agent: "Agent",
        provider: Any,  # Provider class
        tool_registry: "ToolRegistry",
        bus: "Bus | None" = None,
        config: LoopConfig | None = None,
        system_prompt: str | None = None,
    ) -> None:
        """Initialize the agent loop.

        Args:
            session_id: Current session ID
            message_id: Current message ID
            agent: Agent configuration
            provider: Provider for LLM calls
            tool_registry: Tool registry for execution
            bus: Event bus for publishing events
            config: Loop configuration
            system_prompt: Optional system prompt override
        """
        self.session_id = session_id
        self.message_id = message_id
        self.agent = agent
        self.provider = provider
        self.tool_registry = tool_registry
        self.bus = bus
        self.config = config or LoopConfig()
        self.system_prompt = system_prompt or agent.build_structured_prompt() or None

        # State
        self._abort = asyncio.Event()
        self._context: LoopContext | None = None

    @property
    def context(self) -> LoopContext | None:
        """Get current loop context."""
        return self._context

    def abort(self) -> None:
        """Signal the loop to abort."""
        self._abort.set()

    @property
    def is_aborted(self) -> bool:
        """Check if loop has been aborted."""
        return self._abort.is_set()

    async def run(
        self,
        prompt: str,
        messages: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Run the ReAct loop.

        Args:
            prompt: User prompt to process
            messages: Optional conversation history

        Yields:
            Events during loop execution
        """
        # Initialize context
        self._context = LoopContext(
            session_id=self.session_id,
            message_id=self.message_id,
            messages=list(messages) if messages else [],
        )

        # Add system prompt
        if self.system_prompt:
            self._context.messages.insert(
                0,
                {
                    "role": "system",
                    "content": self.system_prompt,
                },
            )

        # Add user prompt
        self._context.messages.append(
            {
                "role": "user",
                "content": prompt,
            }
        )

        # Emit start event
        yield await self._emit_started()

        try:
            # Main loop
            while not self._should_stop():
                self._context.iterations += 1

                # Phase 1: Reasoning
                self._context.phase = LoopPhase.REASONING
                yield await self._emit_phase_change()

                thought = await self._reason()
                yield await self._emit_thought(thought)

                # Check if done
                if thought.is_final:
                    self._context.phase = LoopPhase.COMPLETED
                    yield await self._emit_completed(StopReason.COMPLETED)
                    return

                # Phase 2: Acting
                self._context.phase = LoopPhase.ACTING
                yield await self._emit_phase_change()

                # Determine whether to execute tool calls in parallel
                use_parallel = (
                    len(thought.tool_calls) > 1
                    and self.agent.model is not None
                    and await self._model_supports_parallel_tool_calls()
                )

                if use_parallel:
                    # Prepare all actions and emit tool call events first
                    actions: list[Action] = []
                    for tool_call in thought.tool_calls:
                        action = Action(tool_call=tool_call)
                        self._context.actions.append(action)
                        actions.append(action)
                        yield await self._emit_tool_call(tool_call)

                    # Execute all tools concurrently
                    results = await asyncio.gather(
                        *[self._act(a) for a in actions],
                        return_exceptions=True,
                    )

                    # Phase 3: Observing — emit all observations
                    self._context.phase = LoopPhase.OBSERVING
                    for action, result in zip(actions, results):
                        action.completed_at = time.time()
                        if isinstance(result, BaseException):
                            observation = Observation(
                                action=action,
                                success=False,
                                output="",
                                error=str(result),
                            )
                        else:
                            observation = result
                        self._context.add_observation(observation)
                        yield await self._emit_observation(observation)
                else:
                    for tool_call in thought.tool_calls:
                        if self.is_aborted:
                            break

                        action = Action(tool_call=tool_call)
                        self._context.actions.append(action)

                        yield await self._emit_tool_call(tool_call)

                        # Execute tool
                        observation = await self._act(action)
                        action.completed_at = time.time()

                        # Phase 3: Observing
                        self._context.phase = LoopPhase.OBSERVING
                        self._context.add_observation(observation)

                        yield await self._emit_observation(observation)

                # Optional: Reflection
                if self._should_reflect():
                    yield await self._reflect()

            # Determine stop reason
            if self.is_aborted:
                stop_reason = StopReason.CANCELLED
            elif self._context.iterations >= self.config.max_iterations:
                stop_reason = StopReason.MAX_ITERATIONS
            else:
                stop_reason = StopReason.COMPLETED

            self._context.phase = LoopPhase.COMPLETED
            yield await self._emit_completed(stop_reason)

        except Exception as e:
            logger.exception(f"Loop error: {e}")
            self._context.phase = LoopPhase.ERROR
            yield await self._emit_error(str(e))
            raise

    def _should_stop(self) -> bool:
        """Check if loop should stop."""
        if self.is_aborted:
            return True
        if self._context and self._context.iterations >= self.config.max_iterations:
            return True
        if self._context and self._context.elapsed_ms > self.config.timeout_seconds * 1000:
            return True
        return False

    def _should_reflect(self) -> bool:
        """Check if should perform reflection."""
        if not self.config.enable_reflection:
            return False
        if not self._context:
            return False
        return self._context.iterations % self.config.reflection_frequency == 0

    async def _reason(self) -> Thought:
        """Execute reasoning phase - call LLM for next action.

        Returns:
            Thought containing LLM's reasoning and decisions
        """
        if not self._context:
            raise RuntimeError("Context not initialized")

        # Get tool definitions
        tools = await self.tool_registry.get_llm_definitions()

        # Build model string
        model = self._get_model_string()

        # Call LLM
        response = await self.provider.complete(
            model=model,
            messages=self._context.messages,
            tools=tools if tools else None,
            temperature=self.agent.temperature,
        )

        # Parse response
        content = response.get("content", "")
        tool_calls_raw = response.get("tool_calls") or []
        finish_reason = response.get("finish_reason")

        # Convert tool calls
        tool_calls = []
        for tc in tool_calls_raw:
            tool_calls.append(ToolCall.from_llm_response(tc))

        thought = Thought(
            content=content,
            requires_action=len(tool_calls) > 0,
            tool_calls=tool_calls,
            finish_reason=finish_reason,
        )

        self._context.add_thought(thought)

        return thought

    async def _act(self, action: Action) -> Observation:
        """Execute action phase - run tool.

        Args:
            action: Action to execute

        Returns:
            Observation with result
        """
        from src.tool.context import ToolContext

        tool_call = action.tool_call

        # Create tool context
        ctx = ToolContext(
            session_id=self.session_id,
            message_id=self.message_id,
            agent=self.agent.name,
            call_id=tool_call.id,
            _bus=self.bus,
        )

        # Parse arguments if string
        arguments = tool_call.arguments
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError:
                return Observation(
                    action=action,
                    success=False,
                    output="",
                    error=f"Invalid JSON arguments: {arguments}",
                )

        # Execute with retry
        retries = 0
        last_error = None

        while retries <= self.config.max_retries:
            try:
                result = await self.tool_registry.execute(
                    tool_name=tool_call.name,
                    arguments=arguments,
                    context=ctx,
                )

                return Observation(
                    action=action,
                    success=True,
                    output=result.output,
                    metadata={"title": result.title},
                )

            except Exception as e:
                last_error = str(e)
                retries += 1

                if not self.config.retry_on_error or retries > self.config.max_retries:
                    break

                logger.warning(f"Tool {tool_call.name} failed, retry {retries}: {e}")
                await asyncio.sleep(0.5 * retries)  # Exponential backoff

        return Observation(
            action=action,
            success=False,
            output="",
            error=last_error,
        )

    async def _reflect(self) -> dict[str, Any]:
        """Perform self-reflection on progress.

        Returns:
            Reflection event
        """
        if not self._context:
            return {}

        # Build reflection prompt
        reflection_prompt = f"""
Reflect on your progress so far:
- Iterations: {self._context.iterations}
- Actions taken: {len(self._context.actions)}
- Successful: {sum(1 for o in self._context.observations if o.success)}
- Failed: {sum(1 for o in self._context.observations if not o.success)}

Are you making progress toward the goal? Should you adjust your approach?
"""

        # This is a simplified reflection - could be expanded
        logger.info(f"Reflection at iteration {self._context.iterations}")

        return {
            "type": "agent.reflection",
            "properties": {
                "session_id": self.session_id,
                "iteration": self._context.iterations,
                "actions_count": len(self._context.actions),
                "success_rate": (
                    sum(1 for o in self._context.observations if o.success)
                    / len(self._context.observations)
                    if self._context.observations
                    else 1.0
                ),
            },
        }

    def _get_model_string(self) -> str:
        """Get model string for provider."""
        if self.agent.model:
            return f"{self.agent.model.provider_id}/{self.agent.model.model_id}"
        # Default model - should come from config
        return "ollama/deepseek-v3.1:671b-cloud"

    async def _model_supports_parallel_tool_calls(self) -> bool:
        """Return True if the current model supports parallel tool calls."""
        from src.provider import get_model as provider_get_model

        if not self.agent.model:
            return False
        model_info = await provider_get_model(
            self.agent.model.provider_id,
            self.agent.model.model_id,
        )
        return model_info is not None and model_info.capabilities.parallel_tool_calls

    # =========================================================================
    # Event Emission
    # =========================================================================

    async def _emit_started(self) -> dict[str, Any]:
        """Emit loop started event."""
        event = {
            "type": "agent.loop.started",
            "properties": {
                "session_id": self.session_id,
                "message_id": self.message_id,
                "agent": self.agent.name,
                "config": {
                    "max_iterations": self.config.max_iterations,
                    "enable_reflection": self.config.enable_reflection,
                },
            },
        }
        await self._publish_event(event)
        return event

    async def _emit_phase_change(self) -> dict[str, Any]:
        """Emit phase change event."""
        if not self._context:
            return {}

        event = {
            "type": "agent.loop.phase",
            "properties": {
                "session_id": self.session_id,
                "phase": self._context.phase.value,
                "iteration": self._context.iterations,
            },
        }
        await self._publish_event(event)
        return event

    async def _emit_thought(self, thought: Thought) -> dict[str, Any]:
        """Emit thought/reasoning event."""
        event = {
            "type": "agent.thought",
            "properties": {
                "session_id": self.session_id,
                "message_id": self.message_id,
                "content": thought.content,
                "requires_action": thought.requires_action,
                "tool_calls": [{"id": tc.id, "name": tc.name} for tc in thought.tool_calls],
                "is_final": thought.is_final,
            },
        }
        await self._publish_event(event)
        return event

    async def _emit_tool_call(self, tool_call: ToolCall) -> dict[str, Any]:
        """Emit tool call event."""
        event = {
            "type": "agent.action",
            "properties": {
                "session_id": self.session_id,
                "message_id": self.message_id,
                "call_id": tool_call.id,
                "tool": tool_call.name,
                "arguments": tool_call.arguments,
            },
        }
        await self._publish_event(event)
        return event

    async def _emit_observation(self, observation: Observation) -> dict[str, Any]:
        """Emit observation event."""
        event = {
            "type": "agent.observation",
            "properties": {
                "session_id": self.session_id,
                "message_id": self.message_id,
                "call_id": observation.action.tool_call.id,
                "tool": observation.action.tool_call.name,
                "success": observation.success,
                "output": observation.output[:500] if observation.output else "",
                "error": observation.error,
                "duration_ms": observation.action.duration_ms,
            },
        }
        await self._publish_event(event)
        return event

    async def _emit_completed(self, reason: StopReason) -> dict[str, Any]:
        """Emit loop completed event."""
        if not self._context:
            return {}

        event = {
            "type": "agent.loop.completed",
            "properties": {
                "session_id": self.session_id,
                "message_id": self.message_id,
                "agent": self.agent.name,
                "reason": reason.value,
                "iterations": self._context.iterations,
                "actions_count": len(self._context.actions),
                "elapsed_ms": self._context.elapsed_ms,
            },
        }
        await self._publish_event(event)
        return event

    async def _emit_error(self, error: str) -> dict[str, Any]:
        """Emit error event."""
        event = {
            "type": "agent.loop.error",
            "properties": {
                "session_id": self.session_id,
                "message_id": self.message_id,
                "agent": self.agent.name,
                "error": error,
                "iteration": self._context.iterations if self._context else 0,
            },
        }
        await self._publish_event(event)
        return event

    async def _publish_event(self, event: dict[str, Any]) -> None:
        """Publish event to bus if available."""
        if self.bus:
            # Use raw event publishing for flexibility
            try:
                await self.bus.publish_raw(event["type"], event["properties"])
            except Exception as e:
                logger.warning(f"Failed to publish event: {e}")
