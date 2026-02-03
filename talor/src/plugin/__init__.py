"""Plugin System for Talor.

This module provides a plugin-based architecture for building LLM prompts.
It supports various plugin types including system, agent, environment,
memory, skill, LLM, and tool plugins.

Example:
    ```python
    from src.plugin import PluginManager, PluginContext

    # Initialize plugin manager
    manager = PluginManager()
    await manager.initialize()

    # Build prompt
    context = PluginContext(session_id="session_123", agent_name="build")
    result = await manager.build_prompt(context)
    ```
"""

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult
from src.plugin.manager import PluginManager
from src.plugin.loader import PluginLoader, PluginValidationError

__all__ = [
    "PromptPlugin",
    "PluginPriority",
    "PluginContext",
    "PluginResult",
    "PluginManager",
    "PluginLoader",
    "PluginValidationError",
]
