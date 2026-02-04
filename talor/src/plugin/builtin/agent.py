"""Agent Prompt Plugin for Talor.

This plugin provides agent-specific role definitions, responsibilities,
and capability descriptions.

Responsibilities:
- Define the current agent's specific role (Executor, Planner, Explorer, etc.)
- Describe agent-specific responsibilities and workflows
- Specify tool access and permission boundaries for the role
- Provide behavioral guidelines specific to the role

This plugin focuses on the ROLE and CAPABILITIES, not the framework.
Framework definitions are handled by SystemPromptPlugin.
"""

from __future__ import annotations

import logging
from pathlib import Path

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult

logger = logging.getLogger(__name__)


class AgentPromptPlugin(PromptPlugin):
    """Agent Prompt Plugin - Role definition and capabilities.

    Responsibilities:
    - Define the current agent's specialized role and purpose
    - Describe specific responsibilities and what the agent should/shouldn't do
    - Specify tool access levels and permission boundaries
    - Provide role-specific workflow patterns and guidelines

    This plugin is role-focused and provides agent-specific context.
    """

    # Fallback prompts for built-in agents (used if files cannot be loaded)
    FALLBACK_AGENT_PROMPTS = {
        "build": """## Your Role: Executor

You are the primary execution agent responsible for accomplishing user tasks through tool usage.

### Core Responsibilities
- Execute tasks by using available tools effectively
- Make changes to files, run commands, and interact with systems
- Implement solutions based on user requirements
- Verify results and report completion status

### Behavioral Guidelines
- Understand the complete task before starting execution
- Plan your approach and explain your reasoning
- Execute changes step by step with verification
- Don't proceed when requirements are ambiguous
- Report obstacles and ask for guidance when stuck

### Tool Access
Full access to tools based on your permission configuration. Available tools include file operations, shell commands, and system interactions. Always verify tool availability before planning your approach.

### Workflow Pattern
Understand → Plan → Execute → Verify → Report
""",
        "plan": """## Your Role: Planner

You are a read-only analysis agent that designs solutions WITHOUT making any changes.

### Core Responsibilities
- Analyze existing code, files, and system structure
- Identify relevant components, patterns, and dependencies
- Create detailed step-by-step implementation plans
- Assess risks, edge cases, and potential issues
- Recommend best practices and optimal approaches

### Behavioral Guidelines
- Gather comprehensive information before planning
- Think through multiple solution approaches
- Document plans with clear, actionable steps
- Identify potential problems proactively
- Recommend the Executor agent for implementation

### Tool Access
READ-ONLY access only. You can use: read, grep, glob, ls for information gathering. You CANNOT use: write, edit, bash (destructive operations).

### Workflow Pattern
Gather → Analyze → Design → Document → Recommend
""",
        "explore": """## Your Role: Explorer

You are a fast, focused agent specialized in finding and gathering information quickly.

### Core Responsibilities
- Search for specific information across files and directories
- Navigate and explore code structures efficiently
- Locate relevant items by pattern, content, or name
- Extract and report findings in organized format

### Behavioral Guidelines
- Focus on speed and precision in information retrieval
- Use search tools effectively (grep, glob, ls)
- Report findings concisely without deep analysis
- Delegate complex analysis to the Planner agent
- Delegate implementation to the Executor agent

### Tool Access
LIMITED read-only access optimized for fast searching: grep, glob, ls, read. No write operations or deep analysis tools.

### Workflow Pattern
Search → Extract → Report
""",
        "general": """## Your Role: General Purpose Agent

You are a versatile sub-agent for handling complex research and multi-step reasoning tasks.

### Core Responsibilities
- Break down complex problems into manageable sub-tasks
- Research and gather comprehensive information from multiple sources
- Synthesize findings and identify patterns
- Execute multi-step analytical workflows
- Provide well-reasoned answers with supporting evidence

### Behavioral Guidelines
- Decompose complex questions systematically
- Research thoroughly before drawing conclusions
- Synthesize information from multiple perspectives
- Validate findings with evidence
- Present comprehensive, well-structured answers

### Tool Access
Broad tool access for research and analysis. Can use most tools except specialized ones reserved for other agents.

### Workflow Pattern
Decompose → Research → Synthesize → Validate → Present
""",
    }

    def __init__(self) -> None:
        """Initialize the agent prompt plugin."""
        super().__init__(
            name="agent",
            priority=PluginPriority.AGENT,
            enabled=True,
            required=True,
        )
        self._prompt_cache: dict[str, str] = {}

    def _load_agent_prompt_from_file(self, agent_name: str) -> str | None:
        """Load agent prompt from file.

        Args:
            agent_name: Name of the agent

        Returns:
            Prompt content from file or None if not found

        The prompt file is located at: prompts/agents/{agent_name}.md
        """
        # Check cache first
        if agent_name in self._prompt_cache:
            return self._prompt_cache[agent_name]

        try:
            # Get the project root (talor/)
            # This file is at: talor/src/plugin/builtin/agent.py
            # We need to go up 3 levels to reach talor/
            plugin_file = Path(__file__)
            project_root = plugin_file.parent.parent.parent.parent
            prompt_file = project_root / "prompts" / "agents" / f"{agent_name}.md"

            if prompt_file.exists():
                content = prompt_file.read_text(encoding="utf-8")
                # Strip markdown header if present
                if content.startswith("# "):
                    lines = content.split("\n", 1)
                    content = lines[1].strip() if len(lines) > 1 else content
                # Cache the loaded prompt
                self._prompt_cache[agent_name] = content
                logger.info(f"Loaded agent prompt for '{agent_name}' from {prompt_file}")
                return content
            else:
                logger.debug(f"Agent prompt file not found: {prompt_file}")
                return None

        except Exception as e:
            logger.error(f"Failed to load agent prompt for '{agent_name}': {e}")
            return None

    async def build(self, context: PluginContext) -> PluginResult:
        """Build the agent prompt (role definition and capabilities).

        Args:
            context: Plugin execution context

        Returns:
            PluginResult with agent role and capabilities
        """
        agent_name = context.agent_name

        # Priority: custom prompt > file prompt > fallback prompt > generic prompt
        if context.agent_prompt:
            # Custom prompt from agent config
            prompt = context.agent_prompt
        else:
            # Try to load from file
            prompt = self._load_agent_prompt_from_file(agent_name)

            if not prompt:
                # Use fallback prompt for built-in agents
                prompt = self.FALLBACK_AGENT_PROMPTS.get(agent_name)

                if not prompt:
                    # Generic prompt for unknown agents
                    prompt = f"## Your Role: {agent_name.title()}\n\nYou are a {agent_name} agent with standard capabilities."
                    logger.warning(f"Using generic prompt for unknown agent: {agent_name}")

        # Apply template variables
        prompt = self._apply_template_variables(prompt, context)

        return PluginResult(
            content=prompt,
            section="agent",
            metadata={
                "agent_name": agent_name,
                "type": "role_definition",
            },
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
        variables = {
            "{{agent_name}}": context.agent_name,
            "{{session_id}}": context.session_id,
            "{{cwd}}": str(context.cwd),
            "{{worktree}}": str(context.worktree),
        }

        for var, value in variables.items():
            prompt = prompt.replace(var, value)

        return prompt

    def get_default_prompt(self, agent_name: str) -> str | None:
        """Get the default prompt for an agent.

        Args:
            agent_name: Agent name

        Returns:
            Default prompt or None if not found
        """
        # Try to load from file first
        prompt = self._load_agent_prompt_from_file(agent_name)
        if prompt:
            return prompt

        # Fall back to hardcoded fallback prompts
        return self.FALLBACK_AGENT_PROMPTS.get(agent_name)
