"""Tests for built-in plugins."""

import pytest
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock

from src.plugin.base import PluginPriority
from src.plugin.context import PluginContext
from src.plugin.builtin.system import SystemPromptPlugin
from src.plugin.builtin.agent import AgentPromptPlugin
from src.plugin.builtin.environment import EnvironmentPlugin
from src.plugin.builtin.memory import MemoryPlugin
from src.plugin.builtin.llm import LLMPlugin
from src.plugin.builtin.tool import ToolPlugin


@pytest.fixture
def context():
    """Create a test context."""
    return PluginContext(
        session_id="test-session",
        agent_name="build",
        cwd=Path("/test/cwd"),
        worktree=Path("/test/worktree"),
    )


class TestSystemPromptPlugin:
    """Tests for SystemPromptPlugin."""

    @pytest.mark.asyncio
    async def test_default_prompt(self, context):
        """Test default system prompt."""
        plugin = SystemPromptPlugin()
        result = await plugin.build(context)

        assert result is not None
        assert "ReAct" in result.content
        assert "Reason" in result.content
        assert "Act" in result.content
        assert "Observe" in result.content
        assert result.section == "system"
        assert result.metadata.get("type") == "framework"

    @pytest.mark.asyncio
    async def test_custom_prompt(self, context):
        """Test custom system prompt."""
        plugin = SystemPromptPlugin()
        plugin.set_custom_prompt("Custom identity prompt")
        result = await plugin.build(context)

        assert "Custom identity prompt" in result.content

    @pytest.mark.asyncio
    async def test_template_variables(self, context):
        """Test template variable replacement."""
        plugin = SystemPromptPlugin()
        plugin.set_custom_prompt("Session: {{session_id}}, Agent: {{agent_name}}")
        result = await plugin.build(context)

        assert "test-session" in result.content
        assert "build" in result.content

    def test_priority(self):
        """Test plugin priority."""
        plugin = SystemPromptPlugin()
        assert plugin.priority == PluginPriority.SYSTEM
        assert plugin.required is True


class TestAgentPromptPlugin:
    """Tests for AgentPromptPlugin."""

    @pytest.mark.asyncio
    async def test_default_agent_prompt(self, context):
        """Test default prompt for built-in agent."""
        plugin = AgentPromptPlugin()
        result = await plugin.build(context)

        assert result is not None
        assert "Your Role" in result.content
        assert "Executor" in result.content
        assert result.section == "agent"
        assert result.metadata.get("agent_name") == "build"
        assert result.metadata.get("type") == "role_definition"

    @pytest.mark.asyncio
    async def test_custom_agent_prompt(self, context):
        """Test custom agent prompt from context."""
        context.agent_prompt = "Custom agent instructions"
        plugin = AgentPromptPlugin()
        result = await plugin.build(context)

        assert "Custom agent instructions" in result.content

    @pytest.mark.asyncio
    async def test_unknown_agent(self):
        """Test prompt for unknown agent."""
        context = PluginContext(
            session_id="test",
            agent_name="custom-agent",
        )
        plugin = AgentPromptPlugin()
        result = await plugin.build(context)

        assert "Your Role: Custom-Agent" in result.content
        assert "custom-agent agent" in result.content

    def test_get_default_prompt(self):
        """Test getting default prompt by name."""
        plugin = AgentPromptPlugin()

        assert plugin.get_default_prompt("build") is not None
        assert plugin.get_default_prompt("plan") is not None
        assert plugin.get_default_prompt("nonexistent") is None

    def test_priority(self):
        """Test plugin priority."""
        plugin = AgentPromptPlugin()
        assert plugin.priority == PluginPriority.AGENT
        assert plugin.required is True


class TestEnvironmentPlugin:
    """Tests for EnvironmentPlugin."""

    @pytest.mark.asyncio
    async def test_environment_info(self, context):
        """Test environment information."""
        plugin = EnvironmentPlugin()
        result = await plugin.build(context)

        assert result is not None
        assert "environment" in result.content
        assert "Operating System" in result.content
        assert "/test/cwd" in result.content
        assert result.section == "environment"

    @pytest.mark.asyncio
    async def test_custom_variable(self, context):
        """Test custom environment variable."""
        plugin = EnvironmentPlugin()
        plugin.set_custom_variable("Custom_Var", "custom_value")
        result = await plugin.build(context)

        assert "Custom_Var: custom_value" in result.content

    def test_priority(self):
        """Test plugin priority."""
        plugin = EnvironmentPlugin()
        assert plugin.priority == PluginPriority.ENVIRONMENT
        assert plugin.required is True


class TestMemoryPlugin:
    """Tests for MemoryPlugin."""

    def setup_method(self):
        """Clear session cache before each test."""
        from src.session import clear_cache
        clear_cache()

    @pytest.mark.asyncio
    async def test_no_messages(self, context):
        """Test with no messages - returns empty result with metadata."""
        from src.session import create_session

        # Create session for the context
        session = await create_session(title="Test")
        # Update context to use the created session
        context.session_id = session.id

        plugin = MemoryPlugin()
        result = await plugin.build(context)

        assert result is not None
        assert result.section == "memory"
        assert result.metadata["messages"] == []
        assert result.metadata["message_count"] == 0

    @pytest.mark.asyncio
    async def test_with_messages(self, context):
        """Test with messages in session memory."""
        from src.session import create_session

        # Create session and add messages to its memory
        session = await create_session(title="Test")
        context.session_id = session.id

        session.memory.add_user_message("Hello")
        session.memory.add_assistant_message("Hi there")

        plugin = MemoryPlugin()
        result = await plugin.build(context)

        assert result is not None
        assert result.section == "memory"
        assert result.metadata["message_count"] == 2
        assert len(result.metadata["messages"]) == 2

    @pytest.mark.asyncio
    async def test_message_format_llm_api_compatible(self, context):
        """Test that returned messages are LLM API compatible.

        Validates: Requirements 11.5 - Messages must be in LLM API format.
        """
        from src.session import create_session

        # Create session and add various message types
        session = await create_session(title="Test")
        context.session_id = session.id

        # Add user message
        session.memory.add_user_message("Hello, can you help me?")

        # Add assistant message with tool call
        session.memory.add_assistant_message(
            content=None,
            tool_calls=[{
                "id": "call_123",
                "type": "function",
                "function": {
                    "name": "read_file",
                    "arguments": '{"path": "test.txt"}'
                }
            }]
        )

        # Add tool result
        session.memory.add_tool_result(
            tool_call_id="call_123",
            content="File content here",
            name="read_file"
        )

        # Add final assistant response
        session.memory.add_assistant_message("Here's what I found in the file.")

        plugin = MemoryPlugin()
        result = await plugin.build(context)

        assert result is not None
        messages = result.metadata["messages"]
        assert len(messages) == 4

        # Verify user message format
        user_msg = messages[0]
        assert user_msg["role"] == "user"
        assert "content" in user_msg
        assert user_msg["content"] == "Hello, can you help me?"

        # Verify assistant message with tool call format
        assistant_tool_msg = messages[1]
        assert assistant_tool_msg["role"] == "assistant"
        assert "tool_calls" in assistant_tool_msg
        assert len(assistant_tool_msg["tool_calls"]) == 1
        assert assistant_tool_msg["tool_calls"][0]["id"] == "call_123"
        assert assistant_tool_msg["tool_calls"][0]["function"]["name"] == "read_file"

        # Verify tool result format
        tool_msg = messages[2]
        assert tool_msg["role"] == "tool"
        assert tool_msg["tool_call_id"] == "call_123"
        assert tool_msg["content"] == "File content here"
        assert tool_msg["name"] == "read_file"

        # Verify final assistant message format
        final_msg = messages[3]
        assert final_msg["role"] == "assistant"
        assert final_msg["content"] == "Here's what I found in the file."

    @pytest.mark.asyncio
    async def test_model_context_configuration(self, context):
        """Test that memory is configured with model context length."""
        from src.session import create_session

        session = await create_session(title="Test")
        context.session_id = session.id

        plugin = MemoryPlugin()
        await plugin.build(context)

        # Memory should be configured with default context length
        assert session.memory._model_context_length > 0

    def test_priority(self):
        """Test plugin priority."""
        plugin = MemoryPlugin()
        assert plugin.priority == PluginPriority.MEMORY
        assert plugin.required is True


class TestLLMPlugin:
    """Tests for LLMPlugin."""

    @pytest.mark.asyncio
    async def test_model_config(self, context):
        """Test model configuration."""
        context.provider_id = "anthropic"
        context.model_id = "claude-3-opus"

        plugin = LLMPlugin()
        result = await plugin.build(context)

        assert result is not None
        assert "model_config" in result.metadata
        assert result.metadata["model_config"]["max_tokens"] == 200000

    @pytest.mark.asyncio
    async def test_unknown_model(self, context):
        """Test unknown model uses default config."""
        context.provider_id = "unknown"
        context.model_id = "unknown-model"

        plugin = LLMPlugin()
        result = await plugin.build(context)

        assert result.metadata["model_config"]["max_tokens"] == 8192

    def test_get_max_tokens(self):
        """Test getting max tokens."""
        plugin = LLMPlugin()

        assert plugin.get_max_tokens("anthropic", "claude-3-opus") == 200000
        assert plugin.get_max_tokens("openai", "gpt-4") == 8192
        assert plugin.get_max_tokens("unknown", "unknown") == 8192

    def test_supports_tools(self):
        """Test tool support check."""
        plugin = LLMPlugin()

        assert plugin.supports_tools("anthropic", "claude-3-opus") is True
        assert plugin.supports_tools("openai", "gpt-4") is True

    def test_supports_vision(self):
        """Test vision support check."""
        plugin = LLMPlugin()

        assert plugin.supports_vision("anthropic", "claude-3-opus") is True
        assert plugin.supports_vision("openai", "gpt-4") is False

    def test_priority(self):
        """Test plugin priority."""
        plugin = LLMPlugin()
        assert plugin.priority == PluginPriority.LLM
        assert plugin.required is True

    @pytest.mark.asyncio
    async def test_model_specific_prompt(self, context):
        """Test model-specific prompt guidance is included."""
        context.provider_id = "anthropic"
        context.model_id = "claude-3-opus"

        plugin = LLMPlugin()
        result = await plugin.build(context)

        assert result is not None
        assert "model_guidance" in result.content
        assert "Claude" in result.content
        assert result.metadata["model_family"] == "claude3"

    def test_get_model_family(self):
        """Test getting model family."""
        plugin = LLMPlugin()

        assert plugin.get_model_family("anthropic", "claude-3-opus") == "claude3"
        assert plugin.get_model_family("anthropic", "claude-opus-4.5") == "claude4"
        assert plugin.get_model_family("openai", "gpt-4") == "gpt4"
        assert plugin.get_model_family("openai", "gpt-5.2") == "gpt5"
        assert plugin.get_model_family("openai", "o1") == "o1"
        assert plugin.get_model_family("openai", "o3") == "o3"
        assert plugin.get_model_family("deepseek", "deepseek-r1") == "deepseek-r1"
        assert plugin.get_model_family("google", "gemini-3-pro") == "gemini3"
        assert plugin.get_model_family("unknown", "unknown") == "default"


class TestToolPlugin:
    """Tests for ToolPlugin."""

    @pytest.mark.asyncio
    async def test_no_registry(self, context):
        """Test with no registry."""
        plugin = ToolPlugin()
        result = await plugin.build(context)

        assert result is None

    @pytest.mark.asyncio
    async def test_with_registry(self, context):
        """Test with mock registry."""
        mock_registry = MagicMock()
        tool_definitions = [
            {"function": {"name": "read", "description": "Read a file"}},
            {"function": {"name": "write", "description": "Write a file"}},
        ]
        mock_registry.get_llm_definitions = AsyncMock(return_value=tool_definitions)

        plugin = ToolPlugin(tool_registry=mock_registry)
        result = await plugin.build(context)

        assert result is not None
        # Verify tool descriptions in content (for system prompt)
        assert "available_tools" in result.content
        assert "read" in result.content
        assert "write" in result.content
        # Verify tool definitions in metadata (for LLM API)
        assert result.metadata["tool_count"] == 2
        assert result.metadata["tools"] == tool_definitions

    @pytest.mark.asyncio
    async def test_empty_tools(self, context):
        """Test with empty tool list."""
        mock_registry = MagicMock()
        mock_registry.get_llm_definitions = AsyncMock(return_value=[])

        plugin = ToolPlugin(tool_registry=mock_registry)
        result = await plugin.build(context)

        # Should return result with empty tools list
        assert result is not None
        assert result.content == ""
        assert result.metadata["tools"] == []
        assert result.metadata["tool_count"] == 0

    def test_set_registry(self):
        """Test setting registry."""
        plugin = ToolPlugin()
        mock_registry = MagicMock()
        plugin.set_registry(mock_registry)

        assert plugin._registry is mock_registry

    def test_priority(self):
        """Test plugin priority."""
        plugin = ToolPlugin()
        assert plugin.priority == PluginPriority.TOOL
        assert plugin.required is True



class TestSkillPlugin:
    """Tests for SkillPlugin."""

    @pytest.fixture
    def skill_context(self, tmp_path):
        """Create context with skill directory."""
        # Create skill directory
        skill_dir = tmp_path / ".talor" / "skills" / "test-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("""---
name: test-skill
description: A test skill for python testing
allowed-tools: read, write
---

# Test Skill

Use pytest for testing.
""")

        return PluginContext(
            session_id="test",
            agent_name="build",
            worktree=tmp_path,
            user_request="help me with python testing",
        )

    @pytest.mark.asyncio
    async def test_skill_matching(self, skill_context):
        """Test skill matching based on request."""
        from src.plugin.builtin.skill import SkillPlugin

        plugin = SkillPlugin()
        result = await plugin.build(skill_context)

        assert result is not None
        assert "test-skill" in result.content
        assert result.section == "skill"

    @pytest.mark.asyncio
    async def test_tool_restrictions(self, skill_context):
        """Test tool restrictions from skill."""
        from src.plugin.builtin.skill import SkillPlugin

        plugin = SkillPlugin()
        result = await plugin.build(skill_context)

        assert result is not None
        assert result.tool_restrictions is not None
        assert "read" in result.tool_restrictions
        assert "write" in result.tool_restrictions

    @pytest.mark.asyncio
    async def test_no_matching_skills(self, tmp_path):
        """Test with no matching skills."""
        from src.plugin.builtin.skill import SkillPlugin

        context = PluginContext(
            session_id="test",
            agent_name="build",
            worktree=tmp_path,
            user_request="completely unrelated request xyz",
        )

        plugin = SkillPlugin()
        result = await plugin.build(context)

        # May return None or result with no matches
        if result:
            assert result.section == "skill"

    @pytest.mark.asyncio
    async def test_list_skills(self, skill_context):
        """Test listing skills."""
        from src.plugin.builtin.skill import SkillPlugin

        plugin = SkillPlugin()
        await plugin.initialize(skill_context.worktree)

        skills = await plugin.list_skills()

        assert len(skills) >= 1
        assert any(s["name"] == "test-skill" for s in skills)

    @pytest.mark.asyncio
    async def test_get_skill(self, skill_context):
        """Test getting skill by name."""
        from src.plugin.builtin.skill import SkillPlugin

        plugin = SkillPlugin()
        await plugin.initialize(skill_context.worktree)

        skill = await plugin.get_skill("test-skill")

        assert skill is not None
        assert skill["name"] == "test-skill"

    def test_priority(self):
        """Test plugin priority."""
        from src.plugin.builtin.skill import SkillPlugin

        plugin = SkillPlugin()
        assert plugin.priority == PluginPriority.SKILL
        assert plugin.required is True
