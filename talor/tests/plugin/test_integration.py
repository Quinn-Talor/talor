"""Integration tests for plugin system with AgentExecutor."""

import pytest
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock

from src.plugin.manager import PluginManager
from src.plugin.context import PluginContext
from src.plugin.builtin.system import SystemPromptPlugin
from src.plugin.builtin.agent import AgentPromptPlugin
from src.plugin.builtin.environment import EnvironmentPlugin
from src.plugin.builtin.llm import LLMPlugin
from src.agent.executor import AgentExecutor


class TestPluginIntegration:
    """Integration tests for plugin system."""

    @pytest.fixture
    def plugin_manager(self):
        """Create a plugin manager with default plugins."""
        return PluginManager()

    @pytest.fixture
    async def configured_manager(self, plugin_manager):
        """Create a configured plugin manager."""
        await plugin_manager.register(SystemPromptPlugin())
        await plugin_manager.register(AgentPromptPlugin())
        await plugin_manager.register(EnvironmentPlugin())
        await plugin_manager.register(LLMPlugin())
        return plugin_manager

    @pytest.mark.asyncio
    async def test_full_prompt_build(self, configured_manager):
        """Test building a complete prompt with all plugins."""
        context = PluginContext(
            session_id="test-session",
            agent_name="build",
            cwd=Path("/test/cwd"),
            worktree=Path("/test/worktree"),
            provider_id="anthropic",
            model_id="claude-3-opus",
        )

        result = await configured_manager.build_prompt(context)

        # Verify system prompt contains expected sections
        system_prompt = result["system_prompt"]
        assert "system_identity" in system_prompt
        assert "agent_role" in system_prompt
        assert "environment" in system_prompt

    @pytest.mark.asyncio
    async def test_plugin_order(self, configured_manager):
        """Test that plugins execute in priority order."""
        context = PluginContext(
            session_id="test",
            agent_name="build",
        )

        result = await configured_manager.build_prompt(context)
        system_prompt = result["system_prompt"]

        # System (100) should come before Agent (150)
        system_pos = system_prompt.find("system_identity")
        agent_pos = system_prompt.find("agent_role")
        assert system_pos < agent_pos

    @pytest.mark.asyncio
    async def test_metadata_aggregation(self, configured_manager):
        """Test that metadata from all plugins is aggregated."""
        context = PluginContext(
            session_id="test",
            agent_name="build",
            provider_id="anthropic",
            model_id="claude-3-opus",
        )

        result = await configured_manager.build_prompt(context)

        # Check metadata contains info from multiple plugins
        assert "metadata" in result
        metadata = result["metadata"]
        assert "agent_name" in metadata  # From AgentPromptPlugin
        assert "os" in metadata  # From EnvironmentPlugin


class TestAgentExecutorIntegration:
    """Tests for AgentExecutor plugin integration."""

    @pytest.fixture
    def mock_session_service(self):
        """Create mock session service."""
        service = MagicMock()
        service.get_session = AsyncMock(return_value=MagicMock())
        service.get_messages = AsyncMock(return_value=[])
        return service

    @pytest.fixture
    def mock_provider_service(self):
        """Create mock provider service."""
        service = MagicMock()
        service.complete = AsyncMock(return_value={"content": "test", "finish_reason": "stop"})
        return service

    @pytest.fixture
    def mock_tool_registry(self):
        """Create mock tool registry."""
        registry = MagicMock()
        registry.get_llm_definitions = AsyncMock(return_value=[])
        return registry

    @pytest.mark.asyncio
    async def test_build_plugin_context(
        self, mock_session_service, mock_provider_service, mock_tool_registry
    ):
        """Test building plugin context from session data."""
        executor = AgentExecutor(
            session_service=mock_session_service,
            provider_service=mock_provider_service,
            tool_registry=mock_tool_registry,
            workspace=Path("/test/cwd"),
            worktree=Path("/test/worktree"),
        )

        context = await executor._build_plugin_context(
            session_id="test-session",
            agent_name="build",
            model_info={"provider_id": "anthropic", "model_id": "claude-3-opus"},
            messages=[],
            user_request="Help me write code",
        )

        assert context.session_id == "test-session"
        assert context.agent_name == "build"
        assert context.provider_id == "anthropic"
        assert context.model_id == "claude-3-opus"
        assert context.user_request == "Help me write code"

    @pytest.mark.asyncio
    async def test_get_plugin_manager_creates_default(
        self, mock_session_service, mock_provider_service, mock_tool_registry
    ):
        """Test that get_plugin_manager creates default plugins."""
        executor = AgentExecutor(
            session_service=mock_session_service,
            provider_service=mock_provider_service,
            tool_registry=mock_tool_registry,
            workspace=Path("/test"),
            worktree=Path("/test"),
        )

        manager = await executor.get_plugin_manager()

        assert manager is not None
        assert manager.plugin_count >= 5  # At least 5 default plugins


class TestToolRestrictions:
    """Tests for tool restrictions from skills."""

    @pytest.mark.asyncio
    async def test_tool_restrictions_applied(self, tmp_path):
        """Test that tool restrictions from skills are applied."""
        from src.plugin.builtin.skill import SkillPlugin
        from src.tool.registry import ToolRegistry
        from src.tool.tool import ToolInfo

        # Create a skill with tool restrictions
        skill_dir = tmp_path / ".talor" / "skills" / "restricted-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("""---
name: restricted-skill
description: A skill that restricts tools for testing
allowed-tools: read, write
---

Only use read and write tools.
""")

        # Create tool registry with multiple tools
        registry = ToolRegistry()

        # Create mock tools
        for tool_name in ["read", "write", "bash", "grep"]:
            tool = MagicMock(spec=ToolInfo)
            tool.id = tool_name
            tool.description = f"{tool_name} tool"
            tool.get_parameters_schema.return_value = {"type": "object"}
            await registry.register(tool)

        # Get definitions with restrictions
        defs = await registry.get_llm_definitions(allowed_tools=["read", "write"])

        # Should only include read and write
        tool_names = [d["function"]["name"] for d in defs]
        assert "read" in tool_names
        assert "write" in tool_names
        assert "bash" not in tool_names
        assert "grep" not in tool_names
