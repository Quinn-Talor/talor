"""Built-in Plugins for Talor.

This module provides all built-in plugins for the prompt system.
"""

from src.plugin.builtin.system import SystemPromptPlugin
from src.plugin.builtin.agent import AgentPromptPlugin
from src.plugin.builtin.environment import EnvironmentPlugin
from src.plugin.builtin.memory import MemoryPlugin
from src.plugin.builtin.skill import SkillPlugin
from src.plugin.builtin.llm import LLMPlugin
from src.plugin.builtin.tool import ToolPlugin

__all__ = [
    "SystemPromptPlugin",
    "AgentPromptPlugin",
    "EnvironmentPlugin",
    "MemoryPlugin",
    "SkillPlugin",
    "LLMPlugin",
    "ToolPlugin",
]
