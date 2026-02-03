"""Agent System for Talor.

This module provides the agent system with ReAct loop support.

DDD Architecture:
- Agent: Rich domain entity for agent configuration
- AgentService: Application service for agent management
- AgentExecutor: Core execution engine for ReAct cycle
- AgentLoop: ReAct loop implementation

Usage:
    ```python
    from src.core.container import get_container

    container = get_container()

    # Agent management
    agents = await container.agent_service.list_agents()
    agent = await container.agent_service.get_agent("build")

    # Execute prompts
    result = await container.agent_executor.execute_stream(
        session_id="...",
        parts=[{"type": "text", "text": "Hello"}],
        model={"provider_id": "...", "model_id": "..."},
    )
    ```
"""

from src.agent.agent import Agent, ModelConfig
from src.agent.permission import Permission, PermissionRule, PermissionAction
from src.agent.loop import (
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
from src.agent.service import AgentService
from src.agent.executor import AgentExecutor, SSEEvent, ExecutionStatus

__all__ = [
    # Domain entities
    "Agent",
    "ModelConfig",
    # Permission
    "Permission",
    "PermissionRule",
    "PermissionAction",
    # Loop
    "AgentLoop",
    "LoopConfig",
    "LoopContext",
    "LoopPhase",
    "StopReason",
    "Thought",
    "ToolCall",
    "Action",
    "Observation",
    # Services
    "AgentService",
    "AgentExecutor",
    # Types
    "SSEEvent",
    "ExecutionStatus",
]
