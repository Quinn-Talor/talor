"""Tests for the new opencode-aligned architecture.

This module tests the new event-driven architecture components:
- Event Bus (Bus, BusEvent, GlobalBus)
- Tool System (Tool, ToolRegistry, ToolContext, ToolOutput)
- Session Management (Session, SessionPrompt, Message)
"""

import asyncio
import pytest
from pathlib import Path
from pydantic import BaseModel

# Import new architecture components
from talor.bus import Bus, BusEvent, GlobalBus
from talor.bus.events import (
    SessionCreated,
    SessionCreatedData,
    SessionInfo,
    ToolRegistered,
    ToolRegisteredData,
    ToolExecuted,
    ToolExecutedData,
)
from talor.tool import Tool, ToolRegistry, ToolContext, ToolOutput
from talor.tool.builtin import get_all_builtin_tools, ReadTool, WriteTool, EditTool
from talor.session import Session, SessionPrompt
from talor.session.message import TextPart, ToolPart, UserMessage, AssistantMessage


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
    """Tests for Bus publish/subscribe."""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Clear bus state before each test."""
        Bus.clear()
        yield
        Bus.clear()
    
    @pytest.mark.asyncio
    async def test_publish_subscribe(self):
        """Test basic publish/subscribe."""
        received = []
        
        class TestData(BaseModel):
            value: str
        
        TestEvent = BusEvent.define("test.pubsub", TestData)
        
        async def handler(event):
            received.append(event.properties.value)
        
        Bus.subscribe(TestEvent, handler)
        await Bus.publish(TestEvent, TestData(value="test1"))
        await Bus.publish(TestEvent, TestData(value="test2"))
        
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
        
        unsub = Bus.subscribe(TestEvent, handler)
        await Bus.publish(TestEvent, TestData(value="before"))
        
        unsub()
        await Bus.publish(TestEvent, TestData(value="after"))
        
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
        
        Bus.subscribe_all(handler)
        await Bus.publish(TestEvent1, TestData(value="a"))
        await Bus.publish(TestEvent2, TestData(value="b"))
        
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
    """Tests for Session management."""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Clear session state."""
        Session.clear_cache()
        yield
        Session.clear_cache()
    
    @pytest.mark.asyncio
    async def test_create_session(self):
        """Test creating a session."""
        session = await Session.create(title="Test Session")
        
        assert session.id.startswith("session_")
        assert session.title == "Test Session"
        assert "created" in session.time
    
    @pytest.mark.asyncio
    async def test_get_session(self):
        """Test getting a session."""
        created = await Session.create(title="Get Test")
        
        retrieved = await Session.get(created.id)
        
        assert retrieved is not None
        assert retrieved.id == created.id
        assert retrieved.title == "Get Test"
    
    @pytest.mark.asyncio
    async def test_update_session(self):
        """Test updating a session."""
        session = await Session.create(title="Original")
        
        updated = await Session.update(
            session.id,
            lambda s: setattr(s, "title", "Updated"),
        )
        
        assert updated.title == "Updated"
    
    @pytest.mark.asyncio
    async def test_list_sessions(self):
        """Test listing sessions."""
        await Session.create(title="Session 1")
        await Session.create(title="Session 2")
        
        sessions = await Session.list()
        
        assert len(sessions) >= 2
    
    @pytest.mark.asyncio
    async def test_add_message(self):
        """Test adding messages."""
        session = await Session.create()
        
        message = UserMessage(
            session_id=session.id,
            model={"provider_id": "test", "model_id": "test"},
        )
        
        text_part = TextPart(text="Hello!")
        
        msg_with_parts = await Session.add_message(
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
        Bus.clear()
        Session.clear_cache()
        yield
        Bus.clear()
        Session.clear_cache()
    
    @pytest.mark.asyncio
    async def test_event_flow(self):
        """Test event flow through the system."""
        events_received = []
        
        async def handler(event):
            events_received.append(event.type)
        
        Bus.subscribe(SessionCreated, handler)
        Bus.subscribe(ToolRegistered, handler)
        
        # Configure session with bus
        Session._bus = Bus
        
        # Create session (should emit event)
        session = await Session.create(title="Event Test")
        
        # Create registry with bus
        registry = ToolRegistry(bus=Bus)
        await registry.register(ReadTool, source="builtin")
        
        await asyncio.sleep(0.1)
        
        assert "session.created" in events_received
        assert "tool.registered" in events_received
    
    @pytest.mark.asyncio
    async def test_tool_execution_with_events(self, tmp_path):
        """Test tool execution with event publishing."""
        events_received = []
        
        async def handler(event):
            events_received.append({
                "type": event.type,
                "tool": getattr(event.properties, "tool_name", None),
            })
        
        Bus.subscribe_all(handler)
        
        registry = ToolRegistry(bus=Bus)
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
