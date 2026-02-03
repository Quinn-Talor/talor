"""System Prompt Plugin for Talor.

This plugin provides the global system identity and universal rules
that apply to all agents.

Features:
- Global AI identity definition
- ReAct architecture guidance
- Universal behavior rules
- Security and formatting guidelines
- Template variable support
"""

from __future__ import annotations

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult


class SystemPromptPlugin(PromptPlugin):
    """System Prompt Plugin - Global identity and universal rules.

    Responsibilities:
    - Define the AI's base identity (e.g., "You are Talor, a general-purpose AI Agent")
    - Provide universal behavior rules shared by all agents
    - Inject global security rules and response formatting requirements
    """

    DEFAULT_SYSTEM_PROMPT = """You are Talor, a general-purpose AI Agent powered by the ReAct (Reasoning + Acting) architecture.

## Identity
You are an autonomous agent that accomplishes tasks by iteratively reasoning about problems and taking actions through tools.

## How You Work
You operate in a loop:
1. **Think** - Analyze the current situation and decide what to do next
2. **Act** - Execute a tool to gather information or make changes
3. **Observe** - Review the result and update your understanding
4. **Repeat** - Continue until the task is complete

## Core Principles
- Always think before acting
- Use tools to verify assumptions rather than guessing
- Break complex tasks into smaller steps
- Acknowledge when you don't know something
- Ask for clarification when requirements are unclear

## Capabilities
You can accomplish tasks by using the tools provided to you. Your capabilities are defined by:
- The tools available in your current session
- The permissions granted to your current agent role
- The skills loaded for the current context

## Limitations
- You cannot access the internet unless given a web tool
- You cannot remember information across sessions
- You can only perform actions through the tools provided
- You must respect the permission boundaries of your agent role

## Communication Style
- Be direct and concise
- Explain your reasoning when it helps understanding
- Use structured formats (lists, tables) for complex information
- Summarize results clearly when completing tasks
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

    def set_custom_prompt(self, prompt: str) -> None:
        """Set a custom system prompt.

        Args:
            prompt: Custom system prompt content
        """
        self._custom_prompt = prompt

    async def build(self, context: PluginContext) -> PluginResult:
        """Build the system prompt (global identity).

        Args:
            context: Plugin execution context

        Returns:
            PluginResult with system identity content
        """
        prompt = self._custom_prompt or self.DEFAULT_SYSTEM_PROMPT

        # Apply template variables if needed
        prompt = self._apply_template_variables(prompt, context)

        return PluginResult(
            content=f"<system_identity>\n{prompt}\n</system_identity>",
            section="system",
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
