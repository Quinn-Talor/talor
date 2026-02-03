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

        # Low priority (100) should come first
        assert "first" in result["system_prompt"]
        assert result["system_prompt"].index("first") < result["system_prompt"].index("second")

    @pytest.mark.asyncio
    async def test_disabled_plugin_skipped(self, manager, context):
        """Test that disabled plugins are skipped."""
        plugin = MockPlugin(name="disabled", enabled=False, content="should not appear")
        await manager.register(plugin)

        result = await manager.build_prompt(context)

        assert "should not appear" not in result["system_prompt"]

    @pytest.mark.asyncio
    async def test_non_required_failure_continues(self, manager, context):
        """Test that non-required plugin failure doesn't stop execution."""
        failing = FailingPlugin(name="failing", required=False)
        working = MockPlugin(name="working", content="success")

        await manager.register(failing)
        await manager.register(working)

        result = await manager.build_prompt(context)

        assert "success" in result["system_prompt"]

    @pytest.mark.asyncio
    async def test_required_failure_raises(self, manager, context):
        """Test that required plugin failure raises error."""
        failing = FailingPlugin(name="failing", required=True)
        await manager.register(failing)

        with pytest.raises(RuntimeError, match="Plugin failed"):
            await manager.build_prompt(context)


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
