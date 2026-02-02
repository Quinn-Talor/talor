"""Agent System for Talor.

This module provides the agent system with ReAct loop support:
- Agent configuration and management
- Built-in agents (build, plan, general, explore)
- Permission system for tool access control
- ReAct loop for reasoning-acting-observing cycle

Example:
    ```python
    from src.agent import Agent, Permission, AgentLoop

    # Get default agent
    agent = await Agent.default_agent()

    # List all agents
    agents = await Agent.list()

    # Get specific agent
    build_agent = await Agent.get("build")

    # Run agent loop
    loop = AgentLoop(
        session_id="session_123",
        message_id="msg_456",
        agent=build_agent,
        provider=provider,
        tool_registry=registry,
    )
    async for event in loop.run("Help me with this"):
        print(event)
    ```
"""

from src.agent.agent import Agent, AgentInfo, AgentModel
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

__all__ = [
    "Agent",
    "AgentInfo",
    "AgentModel",
    "Permission",
    "PermissionRule",
    "PermissionAction",
    "AgentLoop",
    "LoopConfig",
    "LoopContext",
    "LoopPhase",
    "StopReason",
    "Thought",
    "ToolCall",
    "Action",
    "Observation",
]
