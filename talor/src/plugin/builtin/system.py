"""System Prompt Plugin for Talor.

This plugin provides the universal ReAct framework definition and
system-level rules that apply to all agents.

Responsibilities:
- Define the ReAct (Reasoning + Acting) framework
- Provide universal behavioral principles
- Establish system-level boundaries and constraints
- Set communication guidelines

This plugin focuses on the FRAMEWORK, not the role.
Role-specific definitions are handled by AgentPromptPlugin.
"""

from __future__ import annotations

import logging
from pathlib import Path

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult

logger = logging.getLogger(__name__)


class SystemPromptPlugin(PromptPlugin):
    """System Prompt Plugin - ReAct framework and universal rules.

    Responsibilities:
    - Define the ReAct framework (Reason → Act → Observe → Repeat)
    - Provide universal behavioral principles shared by all agents
    - Establish system-level boundaries (tools, permissions, sessions)
    - Set communication guidelines (clarity, structure, transparency)

    This plugin is framework-focused and agent-agnostic.
    """

    # Fallback prompt if file cannot be loaded
    FALLBACK_SYSTEM_PROMPT = """You are an AI Agent powered by the ReAct (Reasoning + Acting) architecture.

## ReAct Framework
You operate in an iterative loop to accomplish tasks:

1. **Reason** - Analyze the current situation and plan your next action
2. **Act** - Execute a tool to gather information or make changes
3. **Observe** - Review the tool result and update your understanding
4. **Repeat** - Continue the loop until the task is complete

## Universal Principles
- **Think before acting** - Always explain your reasoning process
- **Verify with tools** - Use tools to verify assumptions, don't guess
- **Break down complexity** - Decompose complex tasks into manageable steps
- **Acknowledge uncertainty** - Ask for clarification when requirements are unclear
- **Learn from results** - Adapt your approach based on tool outputs

## System Boundaries
- **Tool-based capabilities** - You can only act through the tools provided to you
- **Permission constraints** - You must respect the permission boundaries of your role
- **Session isolation** - You cannot remember information across different sessions
- **No external access** - You cannot access external resources without appropriate tools

## Communication Guidelines
- Be direct and concise in your responses
- Explain your reasoning when it aids understanding
- Use structured formats (lists, tables, code blocks) for clarity
- Provide clear summaries when completing tasks
- Report errors and obstacles transparently
"""

    def __init__(self) -> None:
        """Initialize the system prompt plugin."""
        super().__init__(
            name="system",
            priority=PluginPriority.SYSTEM,
            enabled=True,
            required=True,
        )
        self._custom_prompt: str | None = None
        self._cached_prompt: str | None = None

    def set_custom_prompt(self, prompt: str) -> None:
        """Set a custom system prompt.

        Args:
            prompt: Custom system prompt content
        """
        self._custom_prompt = prompt

    def _load_prompt_from_file(self) -> str:
        """Load system prompt from file.

        Returns:
            Prompt content from file or fallback prompt

        The prompt file is located at: prompts/system.md
        """
        if self._cached_prompt:
            return self._cached_prompt

        try:
            # Get the project root (talor/)
            # This file is at: talor/src/plugin/builtin/system.py
            # We need to go up 3 levels to reach talor/
            plugin_file = Path(__file__)
            project_root = plugin_file.parent.parent.parent.parent
            prompt_file = project_root / "prompts" / "system.md"

            if prompt_file.exists():
                content = prompt_file.read_text(encoding="utf-8")
                # Strip markdown header if present
                if content.startswith("# "):
                    lines = content.split("\n", 1)
                    content = lines[1].strip() if len(lines) > 1 else content
                self._cached_prompt = content
                logger.info(f"Loaded system prompt from {prompt_file}")
                return content
            else:
                logger.warning(f"System prompt file not found: {prompt_file}, using fallback")
                return self.FALLBACK_SYSTEM_PROMPT

        except Exception as e:
            logger.error(f"Failed to load system prompt from file: {e}, using fallback")
            return self.FALLBACK_SYSTEM_PROMPT

    async def build(self, context: PluginContext) -> PluginResult:
        """Build the system prompt (framework and universal rules).

        Args:
            context: Plugin execution context

        Returns:
            PluginResult with system framework content
        """
        # Priority: custom prompt > file prompt > fallback prompt
        if self._custom_prompt:
            prompt = self._custom_prompt
        else:
            prompt = self._load_prompt_from_file()

        # Apply template variables if needed
        prompt = self._apply_template_variables(prompt, context)

        return PluginResult(
            content=prompt,
            section="system",
            metadata={"type": "framework"},
        )

    def _apply_template_variables(
        self,
        prompt: str,
        context: PluginContext,
    ) -> str:
        """Apply template variables to the prompt.

        Args:
            prompt: Prompt template
            context: Plugin context with variable values

        Returns:
            Prompt with variables replaced
        """
        # Simple template variable replacement
        variables = {
            "{{session_id}}": context.session_id,
            "{{agent_name}}": context.agent_name,
            "{{cwd}}": str(context.cwd),
            "{{worktree}}": str(context.worktree),
        }

        for var, value in variables.items():
            prompt = prompt.replace(var, value)

        return prompt
