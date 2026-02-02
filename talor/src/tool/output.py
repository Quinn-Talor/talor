"""Tool Output for Talor.

This module provides the ToolOutput class for tool execution results.

Features:
- Standardized output format
- Title for display
- Output string for LLM
- Metadata dictionary
- Optional file attachments
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolOutput:
    """Tool execution output.

    Contains the result of a tool execution including title, output, and metadata.

    Attributes:
        title: Display title for the tool result
        output: Tool output string (for LLM)
        metadata: Result metadata dictionary
        attachments: Optional file attachments
    """

    title: str
    output: str
    metadata: dict[str, Any] = field(default_factory=dict)
    attachments: list[dict] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        result = {
            "title": self.title,
            "output": self.output,
            "metadata": self.metadata,
        }
        if self.attachments:
            result["attachments"] = self.attachments
        return result

    @classmethod
    def success(
        cls,
        output: str,
        title: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> "ToolOutput":
        """Create a successful output.

        Args:
            output: Output string
            title: Optional title
            metadata: Optional metadata

        Returns:
            ToolOutput instance
        """
        return cls(
            title=title,
            output=output,
            metadata=metadata or {},
        )

    @classmethod
    def error(
        cls,
        error: str,
        title: str = "Error",
        metadata: dict[str, Any] | None = None,
    ) -> "ToolOutput":
        """Create an error output.

        Args:
            error: Error message
            title: Optional title
            metadata: Optional metadata

        Returns:
            ToolOutput instance
        """
        meta = metadata or {}
        meta["error"] = True
        return cls(
            title=title,
            output=error,
            metadata=meta,
        )


@dataclass
class FilePart:
    """File attachment for tool output.

    Represents a file that can be attached to tool output.

    Attributes:
        url: File URL (file:// or data:)
        filename: Display filename
        mime: MIME type
    """

    url: str
    filename: str
    mime: str = "text/plain"

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "url": self.url,
            "filename": self.filename,
            "mime": self.mime,
        }
