"""Agent System for Talor.

This module provides the agent system following opencode's pattern:
- Agent.Info for agent configuration
- Built-in agents (build, plan, general, explore)
- Permission system (PermissionNext)
- Agent filtering and selection

Example:
    ```python
    from talor.agent import Agent, Permission
    
    # Get default agent
    agent = await Agent.default_agent()
    
    # List all agents
    agents = await Agent.list()
    
    # Get specific agent
    build_agent = await Agent.get("build")
    ```
"""

from talor.agent.agent import Agent
from talor.agent.permission import Permission, PermissionRule, PermissionAction

__all__ = ["Agent", "Permission", "PermissionRule", "PermissionAction"]
