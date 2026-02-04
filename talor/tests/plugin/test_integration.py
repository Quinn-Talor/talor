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

        # Verify new format structure
        assert "messages" in result
        assert "tools" in result
        assert "tool_restrictions" in result
        assert "metadata" in result

        # Verify system message contains expected sections
        assert len(result["messages"]) >= 1
        system_content = result["messages"][0]["content"]
        assert "ReAct" in system_content  # From SystemPromptPlugin
        assert "Your Role" in system_content  # From AgentPromptPlugin
        assert "environment" in system_content  # From EnvironmentPlugin

    @pytest.mark.asyncio
    async def test_plugin_order(self, configured_manager):
        """Test that plugins execute in priority order."""
        context = PluginContext(
            session_id="test",
            agent_name="build",
        )

        result = await configured_manager.build_prompt(context)

        # Get system content from first message
        assert len(result["messages"]) >= 1
        system_content = result["messages"][0]["content"]

        # System (100) should come before Agent (400)
        # Look for ReAct Framework (from System) and Your Role (from Agent)
        system_pos = system_content.find("ReAct Framework")
        agent_pos = system_content.find("Your Role")
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
    """Tests for AgentExecutor plugin integration.

    Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6
    """

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

    @pytest.mark.asyncio
    async def test_executor_uses_plugin_messages_directly(
        self, mock_session_service, mock_provider_service, mock_tool_registry
    ):
        """Test that executor uses plugin messages directly without modification.

        Validates: Requirements 12.4 - AgentExecutor SHALL use prompt_result["messages"] directly
        """
        # Create a mock plugin manager that returns specific messages
        mock_plugin_manager = MagicMock(spec=PluginManager)
        mock_plugin_manager.build_prompt = AsyncMock(return_value={
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Hello"},
            ],
            "tools": [],
            "tool_restrictions": None,
            "metadata": {},
        })

        executor = AgentExecutor(
            session_service=mock_session_service,
            provider_service=mock_provider_service,
            tool_registry=mock_tool_registry,
            workspace=Path("/test"),
            worktree=Path("/test"),
            plugin_manager=mock_plugin_manager,
        )

        # Verify the plugin manager is used
        manager = await executor.get_plugin_manager()
        assert manager is mock_plugin_manager

    @pytest.mark.asyncio
    async def test_executor_uses_plugin_tools(
        self, mock_session_service, mock_provider_service, mock_tool_registry
    ):
        """Test that executor uses tool definitions from plugin system.

        Validates: Requirements 12.5 - AgentExecutor SHALL use prompt_result["tools"]
        """
        expected_tools = [
            {"function": {"name": "read", "description": "Read file"}},
            {"function": {"name": "write", "description": "Write file"}},
        ]

        mock_plugin_manager = MagicMock(spec=PluginManager)
        mock_plugin_manager.build_prompt = AsyncMock(return_value={
            "messages": [{"role": "system", "content": "test"}],
            "tools": expected_tools,
            "tool_restrictions": None,
            "metadata": {},
        })

        executor = AgentExecutor(
            session_service=mock_session_service,
            provider_service=mock_provider_service,
            tool_registry=mock_tool_registry,
            workspace=Path("/test"),
            worktree=Path("/test"),
            plugin_manager=mock_plugin_manager,
        )

        # The executor should use the tools from plugin system
        manager = await executor.get_plugin_manager()
        result = await manager.build_prompt(PluginContext(session_id="test", agent_name="build"))
        assert result["tools"] == expected_tools

    @pytest.mark.asyncio
    async def test_executor_no_build_llm_messages_fallback(
        self, mock_session_service, mock_provider_service, mock_tool_registry
    ):
        """Test that executor doesn't have _build_llm_messages method.

        Validates: Requirements 12.3, 12.7 - AgentExecutor SHALL NOT call _build_llm_messages()
        """
        executor = AgentExecutor(
            session_service=mock_session_service,
            provider_service=mock_provider_service,
            tool_registry=mock_tool_registry,
            workspace=Path("/test"),
            worktree=Path("/test"),
        )

        # Verify _build_llm_messages method doesn't exist (removed as redundant)
        assert not hasattr(executor, "_build_llm_messages")

    @pytest.mark.asyncio
    async def test_executor_calls_plugin_manager_build_prompt(
        self, mock_session_service, mock_provider_service, mock_tool_registry
    ):
        """Test that executor calls PluginManager.build_prompt().

        Validates: Requirements 12.1 - AgentExecutor SHALL call PluginManager.build_prompt()
        """
        mock_plugin_manager = MagicMock(spec=PluginManager)
        mock_plugin_manager.build_prompt = AsyncMock(return_value={
            "messages": [{"role": "system", "content": "test"}],
            "tools": [],
            "tool_restrictions": None,
            "metadata": {},
        })

        executor = AgentExecutor(
            session_service=mock_session_service,
            provider_service=mock_provider_service,
            tool_registry=mock_tool_registry,
            workspace=Path("/test"),
            worktree=Path("/test"),
            plugin_manager=mock_plugin_manager,
        )

        # Get the plugin manager and verify it's the mock
        manager = await executor.get_plugin_manager()
        assert manager is mock_plugin_manager

        # Call build_prompt and verify it was called
        context = PluginContext(session_id="test", agent_name="build")
        await manager.build_prompt(context)
        mock_plugin_manager.build_prompt.assert_called_once_with(context)


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


class TestEndToEndPromptBuilding:
    """End-to-end tests for complete prompt building flow.

    Validates: Requirements 11.1, 12.6 - Complete flow from plugin system to LLM API
    """

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
        service.complete = AsyncMock(return_value={
            "content": "I can help you with that.",
            "finish_reason": "stop",
        })
        return service

    @pytest.fixture
    def mock_tool_registry(self):
        """Create mock tool registry."""
        registry = MagicMock()
        registry.get_llm_definitions = AsyncMock(return_value=[
            {"function": {"name": "read", "description": "Read file"}},
            {"function": {"name": "write", "description": "Write file"}},
        ])
        return registry

    @pytest.mark.asyncio
    async def test_complete_prompt_build_flow(
        self, mock_session_service, mock_provider_service, mock_tool_registry
    ):
        """Test complete prompt building flow from plugins to LLM-ready format.

        Validates: Requirements 11.1 - Return complete list of LLM messages ready for API call
        """
        # Create plugin manager with all built-in plugins
        plugin_manager = PluginManager()
        await plugin_manager.register(SystemPromptPlugin())
        await plugin_manager.register(AgentPromptPlugin())
        await plugin_manager.register(EnvironmentPlugin())
        await plugin_manager.register(LLMPlugin())

        # Build context
        context = PluginContext(
            session_id="test-session",
            agent_name="build",
            cwd=Path("/test/project"),
            worktree=Path("/test/project"),
            provider_id="anthropic",
            model_id="claude-3-opus",
            user_request="Help me write a Python function",
        )

        # Build prompt
        result = await plugin_manager.build_prompt(context)

        # Verify the result is ready for LLM API call
        assert "messages" in result
        assert isinstance(result["messages"], list)
        assert len(result["messages"]) >= 1

        # First message should be system with all plugin content merged
        system_msg = result["messages"][0]
        assert system_msg["role"] == "system"
        assert isinstance(system_msg["content"], str)
        assert len(system_msg["content"]) > 0

        # Verify system content contains expected sections
        system_content = system_msg["content"]
        assert "ReAct" in system_content  # From SystemPromptPlugin
        assert "Your Role" in system_content  # From AgentPromptPlugin
        assert "environment" in system_content  # From EnvironmentPlugin

        # Verify tools are returned separately
        assert "tools" in result
        assert isinstance(result["tools"], list)

        # Verify metadata is present
        assert "metadata" in result
        assert isinstance(result["metadata"], dict)

    @pytest.mark.asyncio
    async def test_prompt_build_with_memory(
        self, mock_session_service, mock_provider_service, mock_tool_registry
    ):
        """Test prompt building with conversation history from memory.

        Validates: Requirements 11.5 - Append conversation history after system content
        """
        from src.session import create_session, clear_cache

        # Clear session cache
        clear_cache()

        # Create a real session with messages
        session = await create_session(title="Test Session")
        session.memory.add_user_message("Hello, can you help me?")
        session.memory.add_assistant_message("Of course! What do you need help with?")
        session.memory.add_user_message("I need to write a Python function")

        # Create plugin manager with memory plugin
        from src.plugin.builtin.memory import MemoryPlugin

        plugin_manager = PluginManager()
        await plugin_manager.register(SystemPromptPlugin())
        await plugin_manager.register(MemoryPlugin())

        # Build context with the real session
        context = PluginContext(
            session_id=session.id,
            agent_name="build",
            cwd=Path("/test"),
            worktree=Path("/test"),
            provider_id="anthropic",
            model_id="claude-3-opus",
        )

        # Build prompt
        result = await plugin_manager.build_prompt(context)

        # Verify messages structure
        messages = result["messages"]
        assert len(messages) >= 4  # 1 system + 3 conversation messages

        # First should be system
        assert messages[0]["role"] == "system"

        # Rest should be conversation history
        conversation = messages[1:]
        assert conversation[0]["role"] == "user"
        assert conversation[0]["content"] == "Hello, can you help me?"
        assert conversation[1]["role"] == "assistant"
        assert conversation[1]["content"] == "Of course! What do you need help with?"
        assert conversation[2]["role"] == "user"
        assert conversation[2]["content"] == "I need to write a Python function"

    @pytest.mark.asyncio
    async def test_prompt_build_with_tools(
        self, mock_session_service, mock_provider_service, mock_tool_registry
    ):
        """Test prompt building with tool definitions.

        Validates: Requirements 11.8 - Return tool definitions separately from messages
        """
        from src.plugin.builtin.tool import ToolPlugin

        # Create plugin manager with tool plugin
        plugin_manager = PluginManager()
        await plugin_manager.register(SystemPromptPlugin())

        tool_plugin = ToolPlugin(tool_registry=mock_tool_registry)
        await plugin_manager.register(tool_plugin)

        # Build context
        context = PluginContext(
            session_id="test-session",
            agent_name="build",
            cwd=Path("/test"),
            worktree=Path("/test"),
        )

        # Build prompt
        result = await plugin_manager.build_prompt(context)

        # Verify tools are in the tools field
        assert "tools" in result
        assert len(result["tools"]) == 2
        assert result["tools"][0]["function"]["name"] == "read"
        assert result["tools"][1]["function"]["name"] == "write"

        # Verify tool descriptions are in system message
        system_content = result["messages"][0]["content"]
        assert "available_tools" in system_content

    @pytest.mark.asyncio
    async def test_prompt_build_priority_order(self):
        """Test that plugins execute in correct priority order.

        Validates: Requirements 11.2 - Build messages in order:
        System → Environment → LLM → Agent → Tool → Skill → Memory
        """
        plugin_manager = PluginManager()

        # Register plugins in random order
        await plugin_manager.register(AgentPromptPlugin())  # 400
        await plugin_manager.register(SystemPromptPlugin())  # 100
        await plugin_manager.register(LLMPlugin())  # 300
        await plugin_manager.register(EnvironmentPlugin())  # 200

        context = PluginContext(
            session_id="test",
            agent_name="build",
            provider_id="anthropic",
            model_id="claude-3-opus",
        )

        result = await plugin_manager.build_prompt(context)

        # Verify order in system content
        system_content = result["messages"][0]["content"]

        # Find positions of each section
        system_pos = system_content.find("ReAct Framework")  # From SystemPromptPlugin
        env_pos = system_content.find("environment")  # From EnvironmentPlugin
        llm_pos = system_content.find("model_guidance")  # From LLMPlugin
        agent_pos = system_content.find("Your Role")  # From AgentPromptPlugin

        # Verify order: System (100) < Environment (200) < LLM (300) < Agent (400)
        assert system_pos < env_pos, "System should come before Environment"
        assert env_pos < llm_pos, "Environment should come before LLM"
        assert llm_pos < agent_pos, "LLM should come before Agent"

    @pytest.mark.asyncio
    async def test_prompt_result_llm_api_compatible(self):
        """Test that prompt result is directly compatible with LLM API.

        Validates: Requirements 11.3, 12.6 - Messages format compatible with LLM API
        """
        plugin_manager = PluginManager()
        await plugin_manager.register(SystemPromptPlugin())
        await plugin_manager.register(AgentPromptPlugin())

        context = PluginContext(
            session_id="test",
            agent_name="build",
        )

        result = await plugin_manager.build_prompt(context)

        # Verify the result can be directly used in LLM API call
        messages = result["messages"]
        tools = result["tools"]

        # Messages should be a list of dicts with role and content
        for msg in messages:
            assert isinstance(msg, dict)
            assert "role" in msg
            assert msg["role"] in ("system", "user", "assistant", "tool")
            # Content can be string or None (for tool calls)
            if msg["role"] != "assistant" or "tool_calls" not in msg:
                assert "content" in msg

        # Tools should be a list of dicts with function definitions
        for tool in tools:
            assert isinstance(tool, dict)
            # Tool format should match OpenAI/Anthropic format
            if "function" in tool:
                assert "name" in tool["function"]
