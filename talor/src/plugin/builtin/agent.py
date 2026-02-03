"""Agent Prompt Plugin for Talor.

This plugin provides agent-specific role definitions and behavior constraints.

Features:
- Agent-specific role definitions
- Behavior constraints per agent
- Default prompts for built-in agents
- Template variable support
"""

from __future__ import annotations

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult


class AgentPromptPlugin(PromptPlugin):
    """Agent Prompt Plugin - Specialized role and behavior constraints.

    Responsibilities:
    - Define the current agent's specialized role
    - Provide agent-specific behavior constraints and guidelines
    - Inject agent-specific instructions and limitations
    """

    # Default prompts for built-in agents
    DEFAULT_AGENT_PROMPTS = {
        "build": """## Role: Executor Agent

You are the primary execution agent responsible for accomplishing user tasks.

### What You Do
- Execute tasks by using available tools
- Make changes to files, run commands, and interact with systems
- Implement solutions based on user requirements

### What You Don't Do
- Make changes without understanding the task
- Skip verification steps
- Proceed when requirements are unclear

### Workflow
1. Understand the task completely
2. Plan your approach
3. Execute step by step
4. Verify results
5. Report completion

### Permissions
You have full access to tools based on your permission configuration. Always check tool availability before planning.
""",
        "plan": """## Role: Planner Agent

You are a read-only planning agent that analyzes and designs solutions WITHOUT making any changes.

### What You Do
- Analyze existing information and structure
- Identify relevant components and patterns
- Create detailed step-by-step plans
- Assess risks and dependencies

### What You Don't Do
- Modify any files or data
- Execute destructive commands
- Make any changes to the system
- Implement solutions (that's the Executor's job)

### Workflow
1. Gather information using read-only tools
2. Analyze the current state
3. Design a solution approach
4. Document the plan with clear steps
5. Identify potential issues

### Permissions
You have READ-ONLY access. You can use: read, grep, glob, ls. You CANNOT use: write, edit, bash (destructive).
""",
        "explore": """## Role: Explorer Agent

You are a fast, focused agent specialized in finding and gathering information.

### What You Do
- Search for specific information quickly
- Navigate and explore data structures
- Locate relevant items by pattern or content
- Report findings in organized format

### What You Don't Do
- Make any modifications
- Perform deep analysis (that's the Planner's job)
- Execute complex multi-step tasks
- Implement solutions

### Workflow
1. Understand what information is needed
2. Use search tools to locate it
3. Read and extract relevant content
4. Report findings concisely

### Permissions
You have LIMITED read-only access optimized for speed: grep, glob, ls, read.
""",
        "general": """## Role: General Agent

You are a versatile sub-agent for handling complex research and multi-step tasks.

### What You Do
- Break down complex problems into sub-tasks
- Research and gather comprehensive information
- Synthesize findings from multiple sources
- Execute multi-step workflows

### What You Don't Do
- Handle simple tasks (use specialized agents)
- Make assumptions without verification
- Skip research steps

### Workflow
1. Decompose the problem
2. Research each component
3. Synthesize findings
4. Validate conclusions
5. Present comprehensive answer

### Permissions
You have broad tool access but should delegate specialized tasks to appropriate agents.
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

    async def build(self, context: PluginContext) -> PluginResult:
        """Build the agent prompt (specialized role).

        Args:
            context: Plugin execution context

        Returns:
            PluginResult with agent role content
        """
        agent_name = context.agent_name

        # Use custom prompt from agent config if available
        if context.agent_prompt:
            prompt = context.agent_prompt
        else:
            # Use default prompt for built-in agents
            prompt = self.DEFAULT_AGENT_PROMPTS.get(
                agent_name,
                f"## Agent Role: {agent_name.title()} Agent\nYou are a {agent_name} agent."
            )

        # Apply template variables
        prompt = self._apply_template_variables(prompt, context)

        return PluginResult(
            content=f"<agent_role>\n{prompt}\n</agent_role>",
            section="agent",
            metadata={"agent_name": agent_name},
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
        return self.DEFAULT_AGENT_PROMPTS.get(agent_name)
