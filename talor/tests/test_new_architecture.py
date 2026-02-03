"""Tests for the event-driven architecture.

This module tests the new event-driven architecture components:
- Event Bus (Bus, BusEvent, GlobalBus)
- Tool System (Tool, ToolRegistry, ToolContext, ToolOutput)
- Session Management (Session, Message)
- Agent Executor (AgentExecutor)
"""

import asyncio
import pytest
from pathlib import Path
from pydantic import BaseModel

# Import new architecture components
from src.bus import Bus, BusEvent, GlobalBus
from src.bus.events import (
    SessionCreated,
    SessionCreatedData,
    SessionInfo,
    ToolRegistered,
    ToolRegisteredData,
    ToolExecuted,
    ToolExecutedData,
)
from src.tool import Tool, ToolRegistry, ToolContext, ToolOutput
from src.tool.builtin import get_all_builtin_tools, ReadTool, WriteTool, EditTool
from src.session import Session
from src.session.message import TextPart, ToolPart, UserMessage, AssistantMessage
from src.agent import AgentExecutor


# =============================================================================
# Event Bus Tests
# =============================================================================

class TestBusEvent:
    """Tests for BusEvent.define()."""

    def test_define_event(self):
        """Test defining a typed event."""
        class TestData(BaseModel):
            value: str
            count: int

        TestEvent = BusEvent.define("test.custom", TestData)

        assert TestEvent.type == "test.custom"
        assert TestEvent.properties_class == TestData

    def test_create_payload(self):
        """Test creating event payload."""
        class TestData(BaseModel):
            message: str

        TestEvent = BusEvent.define("test.payload", TestData)
        payload = TestEvent.create_payload(TestData(message="hello"))

        assert payload.type == "test.payload"
        assert payload.properties.message == "hello"

    def test_event_registry(self):
        """Test event registry."""
        class TestData(BaseModel):
            id: str

        BusEvent.define("test.registry", TestData)

        assert "test.registry" in BusEvent.all_types()
        assert BusEvent.get("test.registry") is not None


class TestBus:
    """Tests for Bus publish/subscribe (DDD-compliant instance-based)."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Create fresh bus instance for each test."""
        self.bus = Bus()
        yield
        self.bus.clear()

    @pytest.mark.asyncio
    async def test_publish_subscribe(self):
        """Test basic publish/subscribe."""
        received = []

        class TestData(BaseModel):
            value: str

        TestEvent = BusEvent.define("test.pubsub", TestData)

        async def handler(event):
            received.append(event.properties.value)

        self.bus.subscribe(TestEvent, handler)
        await self.bus.publish(TestEvent, TestData(value="test1"))
        await self.bus.publish(TestEvent, TestData(value="test2"))

        # Allow async handlers to complete
        await asyncio.sleep(0.1)

        assert received == ["test1", "test2"]

    @pytest.mark.asyncio
    async def test_unsubscribe(self):
        """Test unsubscribe."""
        received = []

        class TestData(BaseModel):
            value: str

        TestEvent = BusEvent.define("test.unsub", TestData)

        async def handler(event):
            received.append(event.properties.value)

        unsub = self.bus.subscribe(TestEvent, handler)
        await self.bus.publish(TestEvent, TestData(value="before"))

        unsub()
        await self.bus.publish(TestEvent, TestData(value="after"))

        await asyncio.sleep(0.1)

        assert received == ["before"]

    @pytest.mark.asyncio
    async def test_subscribe_all(self):
        """Test wildcard subscription."""
        received = []

        class TestData(BaseModel):
            value: str

        TestEvent1 = BusEvent.define("test.all.1", TestData)
        TestEvent2 = BusEvent.define("test.all.2", TestData)

        async def handler(event):
            received.append(event.type)

        self.bus.subscribe_all(handler)
        await self.bus.publish(TestEvent1, TestData(value="a"))
        await self.bus.publish(TestEvent2, TestData(value="b"))

        await asyncio.sleep(0.1)

        assert "test.all.1" in received
        assert "test.all.2" in received

class TestGlobalBus:
    """Tests for GlobalBus."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Clear global bus state."""
        GlobalBus.remove_all_listeners()
        yield
        GlobalBus.remove_all_listeners()

    def test_on_emit(self):
        """Test on/emit."""
        received = []

        def handler(data):
            received.append(data)

        GlobalBus.on("test", handler)
        GlobalBus.emit("test", {"value": 1})
        GlobalBus.emit("test", {"value": 2})

        assert len(received) == 2
        assert received[0]["value"] == 1

    def test_once(self):
        """Test once (one-time listener)."""
        received = []

        def handler(data):
            received.append(data)

        GlobalBus.once("test.once", handler)
        GlobalBus.emit("test.once", {"value": 1})
        GlobalBus.emit("test.once", {"value": 2})

        assert len(received) == 1


# =============================================================================
# Tool System Tests
# =============================================================================

class TestTool:
    """Tests for Tool.define()."""

    def test_define_tool(self):
        """Test defining a tool."""
        class TestParams(BaseModel):
            name: str
            count: int = 1

        async def handler(params: TestParams, ctx: ToolContext) -> ToolOutput:
            return ToolOutput(
                title="Test",
                output=f"Hello {params.name} x{params.count}",
            )

        tool = Tool.define(
            id="test_tool",
            description="A test tool",
            parameters=TestParams,
            execute=handler,
        )

        assert tool.id == "test_tool"
        assert tool.description == "A test tool"
        assert "name" in tool.get_parameters_schema()["properties"]

    @pytest.mark.asyncio
    async def test_execute_tool(self):
        """Test executing a tool."""
        class TestParams(BaseModel):
            value: str

        async def handler(params: TestParams, ctx: ToolContext) -> ToolOutput:
            return ToolOutput(
                title="Result",
                output=f"Got: {params.value}",
                metadata={"processed": True},
            )

        tool = Tool.define(
            id="exec_test",
            description="Test",
            parameters=TestParams,
            execute=handler,
        )

        ctx = ToolContext(
            session_id="test_session",
            message_id="test_message",
            agent="test",
        )

        result = await tool({"value": "hello"}, ctx)

        assert result.output == "Got: hello"
        assert result.metadata["processed"] is True

    @pytest.mark.asyncio
    async def test_validation_error(self):
        """Test parameter validation."""
        class TestParams(BaseModel):
            required_field: str

        async def handler(params: TestParams, ctx: ToolContext) -> ToolOutput:
            return ToolOutput(title="", output="")

        tool = Tool.define(
            id="validation_test",
            description="Test",
            parameters=TestParams,
            execute=handler,
        )

        ctx = ToolContext(
            session_id="test",
            message_id="test",
            agent="test",
        )

        with pytest.raises(ValueError, match="invalid arguments"):
            await tool({}, ctx)  # Missing required_field


class TestToolRegistry:
    """Tests for ToolRegistry."""

    @pytest.fixture
    def registry(self):
        """Create a fresh registry."""
        return ToolRegistry()

    @pytest.mark.asyncio
    async def test_register_tool(self, registry):
        """Test registering a tool."""
        class TestParams(BaseModel):
            x: int

        async def handler(params: TestParams, ctx: ToolContext) -> ToolOutput:
            return ToolOutput(title="", output=str(params.x))

        tool = Tool.define(
            id="reg_test",
            description="Test",
            parameters=TestParams,
            execute=handler,
        )

        await registry.register(tool, source="test")

        assert registry.tool_count == 1
        assert await registry.get("reg_test") is not None

    @pytest.mark.asyncio
    async def test_list_tools(self, registry):
        """Test listing tools."""
        tools = get_all_builtin_tools()
        for tool in tools:
            await registry.register(tool, source="builtin")

        tool_list = await registry.list()

        assert len(tool_list) == len(tools)
        assert any(t["name"] == "read" for t in tool_list)

    @pytest.mark.asyncio
    async def test_get_llm_definitions(self, registry):
        """Test getting LLM-compatible definitions."""
        await registry.register(ReadTool, source="builtin")

        defs = await registry.get_llm_definitions()

        assert len(defs) == 1
        assert defs[0]["type"] == "function"
        assert defs[0]["function"]["name"] == "read"


class TestBuiltinTools:
    """Tests for built-in tools."""

    @pytest.fixture
    def ctx(self, tmp_path):
        """Create a tool context with temp directory."""
        return ToolContext(
            session_id="test",
            message_id="test",
            agent="test",
            _workspace=tmp_path,
            _worktree=tmp_path,
        )

    @pytest.mark.asyncio
    async def test_read_tool(self, ctx, tmp_path):
        """Test read tool."""
        # Create test file
        test_file = tmp_path / "test.txt"
        test_file.write_text("line1\nline2\nline3\n")

        result = await ReadTool({"file_path": "test.txt"}, ctx)

        assert "line1" in result.output
        assert "line2" in result.output
        assert result.metadata["total_lines"] == 3

    @pytest.mark.asyncio
    async def test_write_tool(self, ctx, tmp_path):
        """Test write tool."""
        result = await WriteTool({
            "file_path": "new_file.txt",
            "content": "Hello World",
        }, ctx)

        assert (tmp_path / "new_file.txt").exists()
        assert (tmp_path / "new_file.txt").read_text() == "Hello World"
        assert result.metadata["created"] is True

    @pytest.mark.asyncio
    async def test_edit_tool(self, ctx, tmp_path):
        """Test edit tool."""
        # Create test file
        test_file = tmp_path / "edit_test.txt"
        test_file.write_text("Hello World")

        result = await EditTool({
            "file_path": "edit_test.txt",
            "old_string": "World",
            "new_string": "Python",
        }, ctx)

        assert test_file.read_text() == "Hello Python"
        assert result.metadata["occurrences_replaced"] == 1


# =============================================================================
# Session Tests
# =============================================================================

class TestSession:
    """Tests for Session management using DDD architecture."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Clear session state."""
        from src.session import clear_cache
        clear_cache()
        yield
        clear_cache()

    @pytest.mark.asyncio
    async def test_create_session(self):
        """Test creating a session."""
        from src.session import create_session
        session = await create_session(title="Test Session")

        assert session.id.startswith("session_")
        assert session.title == "Test Session"
        assert "created" in session.time

    @pytest.mark.asyncio
    async def test_get_session(self):
        """Test getting a session."""
        from src.session import create_session, get_session
        created = await create_session(title="Get Test")

        retrieved = await get_session(created.id)

        assert retrieved is not None
        assert retrieved.id == created.id
        assert retrieved.title == "Get Test"

    @pytest.mark.asyncio
    async def test_update_session(self):
        """Test updating a session."""
        from src.session import create_session, update_session
        session = await create_session(title="Original")

        updated = await update_session(
            session.id,
            lambda s: setattr(s, "title", "Updated"),
        )

        assert updated.title == "Updated"

    @pytest.mark.asyncio
    async def test_list_sessions(self):
        """Test listing sessions."""
        from src.session import create_session, list_sessions
        await create_session(title="Session 1")
        await create_session(title="Session 2")

        sessions = await list_sessions()

        assert len(sessions) >= 2

    @pytest.mark.asyncio
    async def test_add_message(self):
        """Test adding messages."""
        from src.session import create_session, add_message
        session = await create_session()

        message = UserMessage(
            session_id=session.id,
            model={"provider_id": "test", "model_id": "test"},
        )

        text_part = TextPart(text="Hello!")

        msg_with_parts = await add_message(
            session.id,
            message,
            [text_part],
        )

        assert msg_with_parts.info.id == message.id
        assert len(msg_with_parts.parts) == 1
        assert msg_with_parts.get_text_content() == "Hello!"


# =============================================================================
# Integration Tests
# =============================================================================

class TestIntegration:
    """Integration tests for the full architecture."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup for integration tests."""
        from src.session import clear_cache
        self.bus = Bus()
        clear_cache()
        yield
        self.bus.clear()
        clear_cache()

    @pytest.mark.asyncio
    async def test_event_flow(self):
        """Test event flow through the system."""
        from src.session import configure as configure_session, create_session
        from src.bus import manager as bus_manager

        events_received = []

        async def handler(event):
            events_received.append(event.type)

        # Configure session module (no bus parameter needed now)
        configure_session()

        # Create session (should emit event to session's bus)
        session = await create_session(title="Event Test")

        # Get the session's bus and subscribe
        session_bus = bus_manager.get_bus(session.id)
        session_bus.subscribe(SessionCreated, handler)

        # Create registry with separate bus for tool events
        registry = ToolRegistry(bus=self.bus)
        self.bus.subscribe(ToolRegistered, handler)
        await registry.register(ReadTool, source="builtin")

        await asyncio.sleep(0.1)

        # Session events go to session's bus, tool events go to registry's bus
        assert "tool.registered" in events_received

        # Clean up
        await bus_manager.remove_bus(session.id)

    @pytest.mark.asyncio
    async def test_tool_execution_with_events(self, tmp_path):
        """Test tool execution with event publishing."""
        events_received = []

        async def handler(event):
            events_received.append({
                "type": event.type,
                "tool": getattr(event.properties, "tool_name", None),
            })

        self.bus.subscribe_all(handler)

        registry = ToolRegistry(bus=self.bus)
        await registry.register(ReadTool, source="builtin")

        # Create test file
        test_file = tmp_path / "test.txt"
        test_file.write_text("content")

        ctx = ToolContext(
            session_id="test",
            message_id="test",
            agent="test",
            _workspace=tmp_path,
            _worktree=tmp_path,
        )

        await registry.execute("read", {"file_path": "test.txt"}, ctx)

        await asyncio.sleep(0.1)

        # Check events
        event_types = [e["type"] for e in events_received]
        assert "tool.executing" in event_types
        assert "tool.executed" in event_types


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
