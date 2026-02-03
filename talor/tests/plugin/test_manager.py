"""Tests for PluginManager."""

import pytest
from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult
from src.plugin.manager import PluginManager


class MockPlugin(PromptPlugin):
    """Mock plugin for testing."""

    def __init__(
        self,
        name: str = "mock",
        priority: int = PluginPriority.CUSTOM,
        enabled: bool = True,
        required: bool = False,
        content: str = "mock content",
    ):
        super().__init__(name, priority, enabled, required)
        self._content = content

    async def build(self, context: PluginContext) -> PluginResult:
        # Use "system" section so content appears in system_prompt
        return PluginResult(content=self._content, section="system")


class FailingPlugin(PromptPlugin):
    """Plugin that always fails."""

    def __init__(self, name: str = "failing", required: bool = False):
        super().__init__(name, PluginPriority.CUSTOM, True, required)

    async def build(self, context: PluginContext) -> PluginResult:
        raise RuntimeError("Plugin failed")


@pytest.fixture
def manager():
    """Create a fresh PluginManager."""
    return PluginManager()


@pytest.fixture
def context():
    """Create a test context."""
    return PluginContext(session_id="test-session", agent_name="build")


class TestPluginRegistration:
    """Tests for plugin registration."""

    @pytest.mark.asyncio
    async def test_register_plugin(self, manager):
        """Test registering a plugin."""
        plugin = MockPlugin(name="test-plugin")
        await manager.register(plugin)

        assert manager.plugin_count == 1
        assert await manager.get("test-plugin") is plugin

    @pytest.mark.asyncio
    async def test_register_duplicate_raises_error(self, manager):
        """Test that registering duplicate name raises error."""
        plugin1 = MockPlugin(name="duplicate")
        plugin2 = MockPlugin(name="duplicate")

        await manager.register(plugin1)

        with pytest.raises(ValueError, match="already registered"):
            await manager.register(plugin2)

    @pytest.mark.asyncio
    async def test_unregister_plugin(self, manager):
        """Test unregistering a plugin."""
        plugin = MockPlugin(name="removable", required=False)
        await manager.register(plugin)

        await manager.unregister("removable")

        assert manager.plugin_count == 0
        assert await manager.get("removable") is None

    @pytest.mark.asyncio
    async def test_unregister_required_raises_error(self, manager):
        """Test that unregistering required plugin raises error."""
        plugin = MockPlugin(name="required", required=True)
        await manager.register(plugin)

        with pytest.raises(ValueError, match="Cannot unregister required"):
            await manager.unregister("required")

    @pytest.mark.asyncio
    async def test_unregister_nonexistent_is_noop(self, manager):
        """Test that unregistering nonexistent plugin is a no-op."""
        await manager.unregister("nonexistent")  # Should not raise


class TestPluginExecution:
    """Tests for plugin execution."""

    @pytest.mark.asyncio
    async def test_priority_order(self, manager, context):
        """Test that plugins execute in priority order."""
        plugin_low = MockPlugin(name="low", priority=100, content="first")
        plugin_high = MockPlugin(name="high", priority=500, content="second")

        # Register in reverse order
        await manager.register(plugin_high)
        await manager.register(plugin_low)

        result = await manager.build_prompt(context)

        # New format: messages list with system message first
        assert "messages" in result
        assert len(result["messages"]) >= 1
        system_content = result["messages"][0]["content"]

        # Low priority (100) should come first
        assert "first" in system_content
        assert system_content.index("first") < system_content.index("second")

    @pytest.mark.asyncio
    async def test_disabled_plugin_skipped(self, manager, context):
        """Test that disabled plugins are skipped."""
        plugin = MockPlugin(name="disabled", enabled=False, content="should not appear")
        await manager.register(plugin)

        result = await manager.build_prompt(context)

        # New format: check messages list
        if result["messages"]:
            system_content = result["messages"][0].get("content", "")
            assert "should not appear" not in system_content
        else:
            # No messages means content was not added
            pass

    @pytest.mark.asyncio
    async def test_non_required_failure_continues(self, manager, context):
        """Test that non-required plugin failure doesn't stop execution."""
        failing = FailingPlugin(name="failing", required=False)
        working = MockPlugin(name="working", content="success")

        await manager.register(failing)
        await manager.register(working)

        result = await manager.build_prompt(context)

        # New format: check messages list
        assert len(result["messages"]) >= 1
        system_content = result["messages"][0]["content"]
        assert "success" in system_content

    @pytest.mark.asyncio
    async def test_required_failure_raises(self, manager, context):
        """Test that required plugin failure raises error."""
        failing = FailingPlugin(name="failing", required=True)
        await manager.register(failing)

        with pytest.raises(RuntimeError, match="Plugin failed"):
            await manager.build_prompt(context)

    @pytest.mark.asyncio
    async def test_return_format_structure(self, manager, context):
        """Test that build_prompt returns the correct structure."""
        plugin = MockPlugin(name="test", content="test content")
        await manager.register(plugin)

        result = await manager.build_prompt(context)

        # Verify new return format structure
        assert "messages" in result
        assert "tools" in result
        assert "tool_restrictions" in result
        assert "metadata" in result

        # messages should be a list
        assert isinstance(result["messages"], list)
        # tools should be a list
        assert isinstance(result["tools"], list)
        # metadata should be a dict
        assert isinstance(result["metadata"], dict)

    @pytest.mark.asyncio
    async def test_system_message_is_first(self, manager, context):
        """Test that system message is the first in messages list."""
        plugin = MockPlugin(name="test", content="system content")
        await manager.register(plugin)

        result = await manager.build_prompt(context)

        assert len(result["messages"]) >= 1
        assert result["messages"][0]["role"] == "system"
        assert "system content" in result["messages"][0]["content"]


class TestPluginEnableDisable:
    """Tests for enable/disable functionality."""

    @pytest.mark.asyncio
    async def test_enable_plugin(self, manager):
        """Test enabling a plugin."""
        plugin = MockPlugin(name="test", enabled=False)
        await manager.register(plugin)

        result = manager.enable_plugin("test")

        assert result is True
        assert plugin.enabled is True

    @pytest.mark.asyncio
    async def test_disable_plugin(self, manager):
        """Test disabling a plugin."""
        plugin = MockPlugin(name="test", enabled=True)
        await manager.register(plugin)

        result = manager.disable_plugin("test")

        assert result is True
        assert plugin.enabled is False

    @pytest.mark.asyncio
    async def test_enable_nonexistent_returns_false(self, manager):
        """Test enabling nonexistent plugin returns False."""
        result = manager.enable_plugin("nonexistent")
        assert result is False


class TestNewReturnFormat:
    """Tests for the new return format (Requirements 11.1-11.8).

    Validates: Requirements 11.1, 11.3, 11.4, 11.5, 11.8
    """

    @pytest.fixture
    def manager(self):
        """Create a fresh PluginManager."""
        return PluginManager()

    @pytest.fixture
    def context(self):
        """Create a test context."""
        return PluginContext(session_id="test-session", agent_name="build")

    @pytest.mark.asyncio
    async def test_messages_is_list_of_dicts(self, manager, context):
        """Test that messages is a list of dicts compatible with LLM API.

        Validates: Requirements 11.3 - Return messages in format list[dict[str, Any]]
        """
        plugin = MockPlugin(name="test", content="test content")
        await manager.register(plugin)

        result = await manager.build_prompt(context)

        assert isinstance(result["messages"], list)
        for msg in result["messages"]:
            assert isinstance(msg, dict)
            assert "role" in msg
            assert "content" in msg

    @pytest.mark.asyncio
    async def test_system_message_role_is_system(self, manager, context):
        """Test that system message has role='system'.

        Validates: Requirements 11.4 - Include system prompt as first message with role='system'
        """
        plugin = MockPlugin(name="test", content="system content")
        await manager.register(plugin)

        result = await manager.build_prompt(context)

        assert len(result["messages"]) >= 1
        assert result["messages"][0]["role"] == "system"

    @pytest.mark.asyncio
    async def test_tools_returned_separately(self, manager, context):
        """Test that tool definitions are returned separately from messages.

        Validates: Requirements 11.8 - Return tool definitions separately from messages
        """
        plugin = MockPlugin(name="test", content="test")
        await manager.register(plugin)

        result = await manager.build_prompt(context)

        assert "tools" in result
        assert isinstance(result["tools"], list)
        # Tools should not be in messages
        for msg in result["messages"]:
            assert "tools" not in msg or msg.get("tools") is None

    @pytest.mark.asyncio
    async def test_tool_restrictions_returned(self, manager, context):
        """Test that tool restrictions are returned when present."""
        # Create a plugin that returns tool restrictions
        class RestrictedPlugin(PromptPlugin):
            def __init__(self):
                super().__init__("restricted", PluginPriority.CUSTOM, True, False)

            async def build(self, ctx):
                return PluginResult(
                    content="restricted content",
                    section="system",
                    tool_restrictions=["read", "write"],
                )

        await manager.register(RestrictedPlugin())

        result = await manager.build_prompt(context)

        assert "tool_restrictions" in result
        assert result["tool_restrictions"] is not None
        assert "read" in result["tool_restrictions"]
        assert "write" in result["tool_restrictions"]

    @pytest.mark.asyncio
    async def test_metadata_aggregated(self, manager, context):
        """Test that metadata from all plugins is aggregated."""
        class MetadataPlugin(PromptPlugin):
            def __init__(self, name, meta_key, meta_value):
                super().__init__(name, PluginPriority.CUSTOM, True, False)
                self._meta_key = meta_key
                self._meta_value = meta_value

            async def build(self, ctx):
                return PluginResult(
                    content="content",
                    section="system",
                    metadata={self._meta_key: self._meta_value},
                )

        await manager.register(MetadataPlugin("plugin1", "key1", "value1"))
        await manager.register(MetadataPlugin("plugin2", "key2", "value2"))

        result = await manager.build_prompt(context)

        assert "metadata" in result
        assert result["metadata"]["key1"] == "value1"
        assert result["metadata"]["key2"] == "value2"

    @pytest.mark.asyncio
    async def test_empty_plugins_returns_empty_messages(self, manager, context):
        """Test that empty plugin list returns empty messages."""
        result = await manager.build_prompt(context)

        assert result["messages"] == []
        assert result["tools"] == []
        assert result["tool_restrictions"] is None
        assert result["metadata"] == {}

    @pytest.mark.asyncio
    async def test_multiple_system_parts_merged(self, manager, context):
        """Test that multiple system content parts are merged into one message."""
        plugin1 = MockPlugin(name="plugin1", priority=100, content="first part")
        plugin2 = MockPlugin(name="plugin2", priority=200, content="second part")

        await manager.register(plugin1)
        await manager.register(plugin2)

        result = await manager.build_prompt(context)

        # Should have exactly one system message
        system_messages = [m for m in result["messages"] if m["role"] == "system"]
        assert len(system_messages) == 1

        # Content should contain both parts
        system_content = system_messages[0]["content"]
        assert "first part" in system_content
        assert "second part" in system_content


class TestMemoryPluginIntegration:
    """Tests for memory plugin integration with new format.

    Validates: Requirements 11.5 - Append conversation history after system content
    """

    @pytest.fixture
    def manager(self):
        """Create a fresh PluginManager."""
        return PluginManager()

    @pytest.fixture
    def context(self):
        """Create a test context."""
        return PluginContext(session_id="test-session", agent_name="build")

    @pytest.mark.asyncio
    async def test_memory_messages_appended_after_system(self, manager, context):
        """Test that memory messages are appended after system message.

        Validates: Requirements 11.5
        """
        # Create a mock memory plugin that returns conversation messages
        class MockMemoryPlugin(PromptPlugin):
            def __init__(self):
                super().__init__("memory", PluginPriority.MEMORY, True, False)

            async def build(self, ctx):
                return PluginResult(
                    content="",
                    section="memory",
                    metadata={
                        "messages": [
                            {"role": "user", "content": "Hello"},
                            {"role": "assistant", "content": "Hi there"},
                        ],
                        "message_count": 2,
                    },
                )

        # System plugin
        system_plugin = MockPlugin(name="system", priority=100, content="system prompt")

        await manager.register(system_plugin)
        await manager.register(MockMemoryPlugin())

        result = await manager.build_prompt(context)

        # Should have system message first, then conversation
        assert len(result["messages"]) == 3
        assert result["messages"][0]["role"] == "system"
        assert result["messages"][1]["role"] == "user"
        assert result["messages"][2]["role"] == "assistant"


class TestToolPluginIntegration:
    """Tests for tool plugin integration with new format.

    Validates: Requirements 11.8
    """

    @pytest.fixture
    def manager(self):
        """Create a fresh PluginManager."""
        return PluginManager()

    @pytest.fixture
    def context(self):
        """Create a test context."""
        return PluginContext(session_id="test-session", agent_name="build")

    @pytest.mark.asyncio
    async def test_tool_definitions_in_tools_field(self, manager, context):
        """Test that tool definitions are returned in tools field.

        Validates: Requirements 11.8
        """
        # Create a mock tool plugin
        class MockToolPlugin(PromptPlugin):
            def __init__(self):
                super().__init__("tool", PluginPriority.TOOL, True, False)

            async def build(self, ctx):
                return PluginResult(
                    content="<available_tools>read, write</available_tools>",
                    section="tool",
                    metadata={
                        "tools": [
                            {"function": {"name": "read", "description": "Read file"}},
                            {"function": {"name": "write", "description": "Write file"}},
                        ],
                        "tool_count": 2,
                    },
                )

        await manager.register(MockToolPlugin())

        result = await manager.build_prompt(context)

        # Tools should be in the tools field
        assert len(result["tools"]) == 2
        assert result["tools"][0]["function"]["name"] == "read"
        assert result["tools"][1]["function"]["name"] == "write"

        # Tool descriptions may be in system message
        if result["messages"]:
            system_content = result["messages"][0]["content"]
            assert "available_tools" in system_content
