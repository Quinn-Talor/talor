"""Plugin Context for Talor.

This module provides the PluginContext dataclass that contains
all runtime information needed by plugins during prompt building.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class PluginContext:
    """Plugin execution context.

    Contains all runtime information needed by plugins during prompt building.

    Attributes:
        session_id: Session identifier
        agent_name: Current agent name
        agent_prompt: Agent's custom prompt (if any)
        agent_permissions: Agent's permission rules
        provider_id: LLM provider identifier
        model_id: LLM model identifier
        cwd: Current working directory
        worktree: Project root directory
        platform: Platform information
        messages: Conversation history
        user_request: Current user request (for skill matching)
        extra: Additional data for custom plugins
    """

    # Session information
    session_id: str

    # Agent configuration
    agent_name: str
    agent_prompt: str | None = None
    agent_permissions: list[dict[str, Any]] = field(default_factory=list)

    # Model information
    provider_id: str = ""
    model_id: str = ""

    # Environment information
    cwd: Path = field(default_factory=Path.cwd)
    worktree: Path = field(default_factory=Path.cwd)
    platform: str = ""

    # Conversation history
    messages: list[dict[str, Any]] = field(default_factory=list)

    # User request (for skill matching)
    user_request: str = ""

    # Extra data for custom plugins
    extra: dict[str, Any] = field(default_factory=dict)
