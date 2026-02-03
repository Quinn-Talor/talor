"""Tests for AgentLoop.

Tests the ReAct loop implementation.
Note: AgentLoop and related classes have been merged into executor.py
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from src.agent.executor import (
    AgentLoop,
    LoopConfig,
    LoopContext,
    LoopPhase,
    StopReason,
    Thought,
    ToolCall,
    Action,
    Observation,
)
from src.agent.agent import Agent


@pytest.fixture
def mock_agent():
    """Create a mock agent."""
    return Agent(
        name="test_agent",
        description="Test agent",
        mode="primary",
        native=True,
        temperature=0.7,
    )


@pytest.fixture
def mock_provider():
    """Create a mock provider."""
    provider = MagicMock()
    provider.complete = AsyncMock(return_value={
        "content": "I'll help you with that.",
        "tool_calls": None,
        "finish_reason": "stop",
    })
    return provider


@pytest.fixture
def mock_tool_registry():
    """Create a mock tool registry."""
    registry = MagicMock()
    registry.get_llm_definitions = AsyncMock(return_value=[
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a file",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ])
    registry.execute = AsyncMock(return_value=MagicMock(
        output="File content here",
        title="Read file.txt",
    ))
    return registry


class TestLoopDataClasses:
    """Test loop data classes."""

    def test_thought_is_final(self):
        """Test Thought.is_final property."""
        # Final when no action required
        thought = Thought(content="Done", requires_action=False)
        assert thought.is_final is True

        # Final when finish_reason is stop
        thought = Thought(content="Done", requires_action=True, finish_reason="stop")
        assert thought.is_final is True

        # Not final when action required
        thought = Thought(
            content="Let me check",
            requires_action=True,
            tool_calls=[ToolCall(id="1", name="read", arguments={})],
        )
        assert thought.is_final is False

    def test_tool_call_from_llm_response(self):
        """Test ToolCall.from_llm_response."""
        llm_response = {
            "id": "call_123",
            "function": {
                "name": "read_file",
                "arguments": {"path": "test.txt"},
            },
        }

        tc = ToolCall.from_llm_response(llm_response)

        assert tc.id == "call_123"
        assert tc.name == "read_file"
        assert tc.arguments == {"path": "test.txt"}

    def test_observation_to_message(self):
        """Test Observation.to_message."""
        action = Action(tool_call=ToolCall(id="call_1", name="read", arguments={}))

        # Success case
        obs = Observation(action=action, success=True, output="Content")
        msg = obs.to_message()

        assert msg["role"] == "tool"
        assert msg["tool_call_id"] == "call_1"
        assert msg["content"] == "Content"

        # Error case
        obs = Observation(action=action, success=False, output="", error="Not found")
        msg = obs.to_message()

        assert "Error: Not found" in msg["content"]

    def test_loop_context_add_thought(self):
        """Test LoopContext.add_thought."""
        ctx = LoopContext(session_id="s1", message_id="m1")

        thought = Thought(
            content="Thinking...",
            requires_action=True,
            tool_calls=[ToolCall(id="tc1", name="read", arguments={"x": 1})],
        )

        ctx.add_thought(thought)

        assert len(ctx.thoughts) == 1
        assert len(ctx.messages) == 1
        assert ctx.messages[0]["role"] == "assistant"
        assert ctx.messages[0]["content"] == "Thinking..."


class TestLoopConfig:
    """Test LoopConfig."""

    def test_default_config(self):
        """Test default configuration values."""
        config = LoopConfig()

        assert config.max_iterations == 50
        assert config.max_tool_calls_per_iteration == 10
        assert config.timeout_seconds == 300
        assert config.enable_reflection is False
        assert config.retry_on_error is True
        assert config.max_retries == 2

    def test_custom_config(self):
        """Test custom configuration."""
        config = LoopConfig(
            max_iterations=10,
            enable_reflection=True,
            reflection_frequency=3,
        )

        assert config.max_iterations == 10
        assert config.enable_reflection is True
        assert config.reflection_frequency == 3


class TestAgentLoop:
    """Test AgentLoop class."""

    @pytest.mark.asyncio
    async def test_simple_completion(self, mock_agent, mock_provider, mock_tool_registry):
        """Test simple completion without tool calls."""
        loop = AgentLoop(
            session_id="session_1",
            message_id="msg_1",
            agent=mock_agent,
            provider=mock_provider,
            tool_registry=mock_tool_registry,
        )

        events = []
        async for event in loop.run("Hello"):
            events.append(event)

        # Should have started, thought, and completed events
        event_types = [e.get("type") for e in events]
        assert "agent.loop.started" in event_types
        assert "agent.thought" in event_types
        assert "agent.loop.completed" in event_types

        # Check completion reason
        completed = next(e for e in events if e.get("type") == "agent.loop.completed")
        assert completed["properties"]["reason"] == "completed"

    @pytest.mark.asyncio
    async def test_with_tool_calls(self, mock_agent, mock_provider, mock_tool_registry):
        """Test loop with tool calls."""
        # First call returns tool call, second returns final response
        mock_provider.complete = AsyncMock(side_effect=[
            {
                "content": "Let me read that file.",
                "tool_calls": [{
                    "id": "call_1",
                    "function": {"name": "read_file", "arguments": '{"path": "test.txt"}'},
                }],
                "finish_reason": "tool_calls",
            },
            {
                "content": "The file contains: test content",
                "tool_calls": None,
                "finish_reason": "stop",
            },
        ])

        loop = AgentLoop(
            session_id="session_1",
            message_id="msg_1",
            agent=mock_agent,
            provider=mock_provider,
            tool_registry=mock_tool_registry,
        )

        events = []
        async for event in loop.run("Read test.txt"):
            events.append(event)

        event_types = [e.get("type") for e in events]

        # Should have action and observation events
        assert "agent.action" in event_types
        assert "agent.observation" in event_types

        # Verify tool was executed
        mock_tool_registry.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_max_iterations(self, mock_agent, mock_provider, mock_tool_registry):
        """Test max iterations limit."""
        # Always return tool calls
        mock_provider.complete = AsyncMock(return_value={
            "content": "Checking...",
            "tool_calls": [{
                "id": "call_1",
                "function": {"name": "read_file", "arguments": "{}"},
            }],
            "finish_reason": "tool_calls",
        })

        config = LoopConfig(max_iterations=3)

        loop = AgentLoop(
            session_id="session_1",
            message_id="msg_1",
            agent=mock_agent,
            provider=mock_provider,
            tool_registry=mock_tool_registry,
            config=config,
        )

        events = []
        async for event in loop.run("Keep going"):
            events.append(event)

        # Should stop at max iterations
        completed = next(e for e in events if e.get("type") == "agent.loop.completed")
        assert completed["properties"]["reason"] == "max_iterations"
        assert completed["properties"]["iterations"] == 3

    @pytest.mark.asyncio
    async def test_abort(self, mock_agent, mock_provider, mock_tool_registry):
        """Test loop abort."""
        # Slow provider
        async def slow_complete(*args, **kwargs):
            await asyncio.sleep(0.5)
            return {
                "content": "Done",
                "tool_calls": None,
                "finish_reason": "stop",
            }

        mock_provider.complete = slow_complete

        loop = AgentLoop(
            session_id="session_1",
            message_id="msg_1",
            agent=mock_agent,
            provider=mock_provider,
            tool_registry=mock_tool_registry,
        )

        # Abort after short delay
        async def abort_soon():
            await asyncio.sleep(0.1)
            loop.abort()

        asyncio.create_task(abort_soon())

        events = []
        async for event in loop.run("Hello"):
            events.append(event)
            if loop.is_aborted:
                break

        assert loop.is_aborted is True

    def test_should_stop_conditions(self, mock_agent, mock_provider, mock_tool_registry):
        """Test _should_stop conditions."""
        loop = AgentLoop(
            session_id="session_1",
            message_id="msg_1",
            agent=mock_agent,
            provider=mock_provider,
            tool_registry=mock_tool_registry,
            config=LoopConfig(max_iterations=5),
        )

        # No context yet
        assert loop._should_stop() is False

        # Initialize context
        loop._context = LoopContext(session_id="s1", message_id="m1")
        assert loop._should_stop() is False

        # At max iterations
        loop._context.iterations = 5
        assert loop._should_stop() is True

        # Aborted
        loop._context.iterations = 1
        loop.abort()
        assert loop._should_stop() is True


class TestMemoryIntegration:
    """Test memory integration with loop."""

    def test_context_messages_tracking(self):
        """Test that context tracks messages correctly."""
        ctx = LoopContext(session_id="s1", message_id="m1")

        # Add initial messages
        ctx.messages.append({"role": "system", "content": "You are helpful."})
        ctx.messages.append({"role": "user", "content": "Hello"})

        # Add thought
        thought = Thought(content="Hi there!", requires_action=False)
        ctx.add_thought(thought)

        assert len(ctx.messages) == 3
        assert ctx.messages[-1]["role"] == "assistant"
        assert ctx.messages[-1]["content"] == "Hi there!"
