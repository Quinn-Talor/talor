"""Message Models for Talor.

This module provides message models following opencode's MessageV2 pattern
with parts-based architecture.

Message types:
- User: User input messages
- Assistant: AI response messages
- System: System messages

Part types:
- TextPart: Text content
- FilePart: File attachments
- ToolPart: Tool call and result
- AgentPart: Agent reference
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


# =============================================================================
# Message Parts
# =============================================================================

class TextPart(BaseModel):
    """Text content part."""
    
    id: str = Field(default_factory=lambda: str(uuid4()))
    type: Literal["text"] = "text"
    text: str
    session_id: str | None = None
    message_id: str | None = None


class FilePart(BaseModel):
    """File attachment part."""
    
    id: str = Field(default_factory=lambda: str(uuid4()))
    type: Literal["file"] = "file"
    url: str
    filename: str
    mime: str = "text/plain"
    session_id: str | None = None
    message_id: str | None = None


class ToolPart(BaseModel):
    """Tool call and result part."""
    
    id: str = Field(default_factory=lambda: str(uuid4()))
    type: Literal["tool"] = "tool"
    tool: str
    call_id: str
    state: Literal["pending", "running", "completed", "error"] = "pending"
    input: dict[str, Any] = Field(default_factory=dict)
    output: str | None = None
    error: str | None = None
    title: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    time: dict[str, int] = Field(default_factory=dict)
    session_id: str | None = None
    message_id: str | None = None


class AgentPart(BaseModel):
    """Agent reference part."""
    
    id: str = Field(default_factory=lambda: str(uuid4()))
    type: Literal["agent"] = "agent"
    name: str
    session_id: str | None = None
    message_id: str | None = None


class ReasoningPart(BaseModel):
    """Reasoning/thinking part."""
    
    id: str = Field(default_factory=lambda: str(uuid4()))
    type: Literal["reasoning"] = "reasoning"
    text: str
    session_id: str | None = None
    message_id: str | None = None


# Union type for all parts
MessagePart = TextPart | FilePart | ToolPart | AgentPart | ReasoningPart


# =============================================================================
# Message Models
# =============================================================================

class UserMessage(BaseModel):
    """User message."""
    
    id: str = Field(default_factory=lambda: str(uuid4()))
    role: Literal["user"] = "user"
    session_id: str
    model: dict[str, str]  # {"provider_id": "...", "model_id": "..."}
    agent: str | None = None
    time: dict[str, int] = Field(default_factory=dict)


class AssistantMessage(BaseModel):
    """Assistant message."""
    
    id: str = Field(default_factory=lambda: str(uuid4()))
    role: Literal["assistant"] = "assistant"
    session_id: str
    parent_id: str | None = None
    model_id: str
    provider_id: str
    agent: str
    mode: str | None = None
    finish: str | None = None  # "stop", "tool-calls", "length", etc.
    error: dict[str, Any] | None = None
    cost: float = 0
    tokens: dict[str, int] = Field(default_factory=lambda: {
        "input": 0,
        "output": 0,
        "reasoning": 0,
        "cache_read": 0,
        "cache_write": 0,
    })
    path: dict[str, str] = Field(default_factory=dict)  # {"cwd": "...", "root": "..."}
    time: dict[str, int] = Field(default_factory=dict)


class SystemMessage(BaseModel):
    """System message."""
    
    id: str = Field(default_factory=lambda: str(uuid4()))
    role: Literal["system"] = "system"
    session_id: str
    content: str
    time: dict[str, int] = Field(default_factory=dict)


# Union type for all messages
Message = UserMessage | AssistantMessage | SystemMessage


# =============================================================================
# Message with Parts
# =============================================================================

@dataclass
class MessageWithParts:
    """Message with its associated parts.
    
    Corresponds to opencode's MessageV2.WithParts.
    """
    
    info: Message
    parts: list[MessagePart] = field(default_factory=list)
    
    def get_text_content(self) -> str:
        """Get combined text content from all text parts."""
        texts = []
        for part in self.parts:
            if isinstance(part, TextPart):
                texts.append(part.text)
        return "\n".join(texts)
    
    def get_tool_parts(self) -> list[ToolPart]:
        """Get all tool parts."""
        return [p for p in self.parts if isinstance(p, ToolPart)]
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "info": self.info.model_dump(),
            "parts": [p.model_dump() for p in self.parts],
        }
