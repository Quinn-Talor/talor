"""Agent System for Talor.

This module provides the agent system with ReAct loop support.

Architecture:
- Agent: Rich domain entity for agent configuration
- AgentExecutor: Core execution engine for ReAct cycle
- Module-level functions for agent management (get_agent, list_agents, etc.)

Usage:
    ```python
    from src.agent import (
        # Entity classes
        Agent,
        ModelConfig,
        Permission,
        PermissionRule,
        PermissionAction,
        Ruleset,
        # Executor
        AgentExecutor,
        # Module-level functions
        configure,
        clear_cache,
        get_agent,
        list_agents,
        get_default_agent,
        list_agents_for_mode,
    )

    # Configure module (typically done at startup)
    configure(config_getter=my_config_getter)

    # Agent management
    agents = await list_agents()
    agent = await get_agent("build")
    default = await get_default_agent()

    # Execute prompts
    result = await executor.execute_stream(
        session_id="...",
        parts=[{"type": "text", "text": "Hello"}],
        model={"provider_id": "...", "model_id": "..."},
    )
    ```
"""

# Entity classes and permission system
from src.agent.agent import (
    Agent,
    ModelConfig,
    Permission,
    PermissionRule,
    PermissionAction,
    Ruleset,
)

# Module-level functions (merged from service.py)
from src.agent.agent import (
    configure,
    clear_cache,
    get_agent,
    list_agents,
    get_default_agent,
    list_agents_for_mode,
)

# Backward-compatible AgentService class
from src.agent.agent import AgentService

# Executor and loop types
from src.agent.executor import (
    # Executor
    AgentExecutor,
    SSEEvent,
    ExecutionStatus,
    # Loop types (merged from loop.py)
    AgentLoop,
    LoopConfig,
    LoopContext,
    LoopPhase,
    StopReason,
    Thought,
    ToolCall,
    Action,
    Observation,
)

__all__ = [
    # Domain entities
    "Agent",
    "ModelConfig",
    # Permission system
    "Permission",
    "PermissionRule",
    "PermissionAction",
    "Ruleset",
    # Module-level functions
    "configure",
    "clear_cache",
    "get_agent",
    "list_agents",
    "get_default_agent",
    "list_agents_for_mode",
    # Loop types
    "AgentLoop",
    "LoopConfig",
    "LoopContext",
    "LoopPhase",
    "StopReason",
    "Thought",
    "ToolCall",
    "Action",
    "Observation",
    # Services (backward compatibility)
    "AgentService",
    "AgentExecutor",
    # Types
    "SSEEvent",
    "ExecutionStatus",
]
