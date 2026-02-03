"""ReAct Agent Loop for Talor.

This module implements the core ReAct (Reasoning + Acting) loop,
providing explicit abstraction for the agent's reasoning cycle.

The ReAct pattern consists of three phases:
1. Reasoning/Planning - Analyze context and decide next action
2. Action - Execute tool calls
3. Observation - Process results and update context

Example:
    ```python
    from src.agent.loop import AgentLoop

    loop = AgentLoop(
        session_id="session_123",
        agent_name="build",
        provider=provider,
        tool_registry=registry,
        bus=bus,
    )

    async for event in loop.run("Help me refactor this code"):
        print(event)
    ```
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator, TYPE_CHECKING
from uuid import uuid4

from pydantic import BaseModel

if TYPE_CHECKING:
    from src.agent.agent import Agent
    from src.bus import Bus
    from src.provider.service import ProviderService
    from src.tool.registry import ToolRegistry


logger = logging.getLogger(__name__)


# =============================================================================
# Loop State and Events
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
    COMPLETED = "completed"          # Natural completion
    MAX_ITERATIONS = "max_iterations"  # Hit iteration limit
    CANCELLED = "cancelled"          # User cancelled
    ERROR = "error"                  # Error occurred
    NO_ACTION = "no_action"          # LLM decided no action needed


@dataclass
class Thought:
    """Represents the agent's reasoning output.

    Contains the LLM's analysis and decision about what to do next.
    """
    content: str                     # Reasoning text
    requires_action: bool = False    # Whether action is needed
    tool_calls: list[ToolCall] = field(default_factory=list)
    finish_reason: str | None = None
    confidence: float = 1.0          # Confidence in decision (0-1)

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
            self.messages.append({
                "role": "assistant",
                "content": thought.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.name, "arguments": tc.arguments},
                    }
                    for tc in thought.tool_calls
                ] if thought.tool_calls else None,
            })

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
    max_iterations: int = 50         # Maximum reasoning cycles
    max_tool_calls_per_iteration: int = 10  # Max tools per cycle
    timeout_seconds: float = 300     # Overall timeout
    enable_reflection: bool = False  # Enable self-reflection
    reflection_frequency: int = 5    # Reflect every N iterations
    retry_on_error: bool = True      # Retry failed tool calls
    max_retries: int = 2             # Max retries per tool


# =============================================================================
# Agent Loop
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
        self.system_prompt = system_prompt or agent.prompt

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
            self._context.messages.insert(0, {
                "role": "system",
                "content": self.system_prompt,
            })

        # Add user prompt
        self._context.messages.append({
            "role": "user",
            "content": prompt,
        })

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
            top_p=self.agent.top_p,
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
            import json
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
                    sum(1 for o in self._context.observations if o.success) /
                    len(self._context.observations)
                    if self._context.observations else 1.0
                ),
            },
        }

    def _get_model_string(self) -> str:
        """Get model string for provider."""
        if self.agent.model:
            return f"{self.agent.model.provider_id}/{self.agent.model.model_id}"
        # Default model - should come from config
        return "ollama/deepseek-v3.1:671b-cloud"

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
                "tool_calls": [
                    {"id": tc.id, "name": tc.name}
                    for tc in thought.tool_calls
                ],
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
