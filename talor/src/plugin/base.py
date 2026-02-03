"""Plugin Base Classes for Talor.

This module provides the base classes and enums for the plugin system.

Features:
- PluginPriority enum for execution order
- PromptPlugin abstract base class
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import IntEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.plugin.context import PluginContext
    from src.plugin.result import PluginResult


class PluginPriority(IntEnum):
    """Plugin priority enum (lower number = higher priority).

    Determines the execution order of plugins during prompt building.
    """
    SYSTEM = 100       # System Prompt (global identity)
    AGENT = 150        # Agent Prompt (specialized role)
    LLM = 200          # LLM-specific configuration
    ENVIRONMENT = 300  # Environment information
    SKILL = 400        # Skill plugins
    TOOL = 500         # Tool definitions
    MEMORY = 600       # Memory/history
    CUSTOM = 1000      # Custom plugins


class PromptPlugin(ABC):
    """Abstract base class for prompt plugins.

    All plugins must inherit from this class and implement the build method.

    Attributes:
        name: Unique identifier for the plugin
        priority: Execution order (lower = earlier)
        enabled: Whether the plugin is active
        required: Whether the plugin is mandatory
    """

    def __init__(
        self,
        name: str,
        priority: int = PluginPriority.CUSTOM,
        enabled: bool = True,
        required: bool = False,
    ) -> None:
        """Initialize the plugin.

        Args:
            name: Unique identifier for the plugin
            priority: Execution order (lower = earlier)
            enabled: Whether the plugin is active
            required: Whether the plugin is mandatory
        """
        self._name = name
        self._priority = priority
        self._enabled = enabled
        self._required = required

    @property
    def name(self) -> str:
        """Get the plugin name."""
        return self._name

    @property
    def priority(self) -> int:
        """Get the plugin priority."""
        return self._priority

    @priority.setter
    def priority(self, value: int) -> None:
        """Set the plugin priority."""
        self._priority = value

    @property
    def enabled(self) -> bool:
        """Check if the plugin is enabled."""
        return self._enabled

    @enabled.setter
    def enabled(self, value: bool) -> None:
        """Enable or disable the plugin."""
        self._enabled = value

    @property
    def required(self) -> bool:
        """Check if the plugin is required."""
        return self._required

    @abstractmethod
    async def build(self, context: "PluginContext") -> "PluginResult | None":
        """Build prompt content.

        Args:
            context: Plugin execution context

        Returns:
            PluginResult with generated content, or None if no content
        """
        pass

    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}("
            f"name={self._name!r}, "
            f"priority={self._priority}, "
            f"enabled={self._enabled}, "
            f"required={self._required})"
        )
