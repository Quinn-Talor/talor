"""Plugin Result for Talor.

This module provides the PluginResult dataclass that represents
the output of a plugin's build method.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class PluginResult:
    """Plugin execution result.

    Contains the generated prompt content and metadata from a plugin.

    Attributes:
        content: Generated prompt content
        section: Content section (system, environment, skill, tool, memory)
        metadata: Additional metadata about the result
        tool_restrictions: Tool restrictions from skills (allowed tools)
    """

    # Generated prompt content
    content: str

    # Content section for aggregation
    section: str

    # Additional metadata
    metadata: dict[str, Any] = field(default_factory=dict)

    # Tool restrictions (from skills)
    tool_restrictions: list[str] | None = None

    def __bool__(self) -> bool:
        """Check if the result has content or metadata.

        Returns True if there's content OR meaningful metadata (like messages).
        """
        return bool(self.content) or bool(self.metadata)
