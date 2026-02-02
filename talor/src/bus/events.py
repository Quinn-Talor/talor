"""Pre-defined Events for Talor.

This module defines all the standard events used throughout Talor.

Events are organized by domain:
- Session events (session.created, session.updated, etc.)
- Message events (message.created, message.updated, etc.)
- Tool events (tool.registered, tool.executed, etc.)
- Agent events (agent.started, agent.completed, etc.)
- MCP events (mcp.tools.changed, mcp.connected, etc.)
- Permission events (permission.requested, permission.granted, etc.)
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

from src.bus.bus_event import BusEvent


# =============================================================================
# Session Events
# =============================================================================

class SessionInfo(BaseModel):
    """Session information for events."""
    id: str
    title: str
    directory: str
    parent_id: str | None = None
    time: dict[str, int]


class SessionCreatedData(BaseModel):
    """Data for session.created event."""
    info: SessionInfo


class SessionUpdatedData(BaseModel):
    """Data for session.updated event."""
    info: SessionInfo


class SessionDeletedData(BaseModel):
    """Data for session.deleted event."""
    info: SessionInfo


class SessionDiffData(BaseModel):
    """Data for session.diff event."""
    session_id: str
    diff: list[dict[str, Any]]


class SessionErrorData(BaseModel):
    """Data for session.error event."""
    session_id: str | None = None
    error: dict[str, Any]


# Define session events
SessionCreated = BusEvent.define("session.created", SessionCreatedData)
SessionUpdated = BusEvent.define("session.updated", SessionUpdatedData)
SessionDeleted = BusEvent.define("session.deleted", SessionDeletedData)
SessionDiff = BusEvent.define("session.diff", SessionDiffData)
SessionError = BusEvent.define("session.error", SessionErrorData)


# =============================================================================
# Message Events
# =============================================================================

class MessageCreatedData(BaseModel):
    """Data for message.created event."""
    session_id: str
    message_id: str
    role: str
    content: str | None = None


class MessageUpdatedData(BaseModel):
    """Data for message.updated event."""
    session_id: str
    message_id: str
    role: str
    content: str | None = None


class MessagePartCreatedData(BaseModel):
    """Data for message.part.created event."""
    session_id: str
    message_id: str
    part_id: str
    part_type: str
    content: Any = None


class MessagePartUpdatedData(BaseModel):
    """Data for message.part.updated event."""
    session_id: str
    message_id: str
    part_id: str
    part_type: str
    content: Any = None


# Define message events
MessageCreated = BusEvent.define("message.created", MessageCreatedData)
MessageUpdated = BusEvent.define("message.updated", MessageUpdatedData)
MessagePartCreated = BusEvent.define("message.part.created", MessagePartCreatedData)
MessagePartUpdated = BusEvent.define("message.part.updated", MessagePartUpdatedData)


# =============================================================================
# Tool Events
# =============================================================================

class ToolRegisteredData(BaseModel):
    """Data for tool.registered event."""
    tool_name: str
    source: str
    description: str


class ToolUnregisteredData(BaseModel):
    """Data for tool.unregistered event."""
    tool_name: str


class ToolExecutingData(BaseModel):
    """Data for tool.executing event."""
    session_id: str
    message_id: str
    tool_name: str
    call_id: str
    arguments: dict[str, Any]


class ToolExecutedData(BaseModel):
    """Data for tool.executed event."""
    session_id: str
    message_id: str
    tool_name: str
    call_id: str
    success: bool
    output: Any = None
    error: str | None = None
    duration_ms: float = 0


class ToolMetadataData(BaseModel):
    """Data for tool.metadata event."""
    session_id: str
    call_id: str | None = None
    title: str | None = None
    metadata: dict[str, Any] = {}


# Define tool events
ToolRegistered = BusEvent.define("tool.registered", ToolRegisteredData)
ToolUnregistered = BusEvent.define("tool.unregistered", ToolUnregisteredData)
ToolExecuting = BusEvent.define("tool.executing", ToolExecutingData)
ToolExecuted = BusEvent.define("tool.executed", ToolExecutedData)
ToolMetadata = BusEvent.define("tool.metadata", ToolMetadataData)


# =============================================================================
# Agent Events
# =============================================================================

class AgentStartedData(BaseModel):
    """Data for agent.started event."""
    session_id: str
    agent: str
    model_id: str
    provider_id: str


class AgentCompletedData(BaseModel):
    """Data for agent.completed event."""
    session_id: str
    agent: str
    iterations: int
    reason: str | None = None


class AgentErrorData(BaseModel):
    """Data for agent.error event."""
    session_id: str
    agent: str
    error: str


class AgentToolCallData(BaseModel):
    """Data for agent.tool_call event."""
    session_id: str
    agent: str
    tool_name: str
    call_id: str
    arguments: dict[str, Any]


# Define agent events
AgentStarted = BusEvent.define("agent.started", AgentStartedData)
AgentCompleted = BusEvent.define("agent.completed", AgentCompletedData)
AgentError = BusEvent.define("agent.error", AgentErrorData)
AgentToolCall = BusEvent.define("agent.tool_call", AgentToolCallData)


# =============================================================================
# ReAct Loop Events (New)
# =============================================================================

class AgentLoopStartedData(BaseModel):
    """Data for agent.loop.started event."""
    session_id: str
    message_id: str
    agent: str
    config: dict[str, Any] = {}


class AgentLoopPhaseData(BaseModel):
    """Data for agent.loop.phase event."""
    session_id: str
    phase: str  # "reasoning", "acting", "observing", "completed", "error"
    iteration: int


class AgentThoughtData(BaseModel):
    """Data for agent.thought event - reasoning output."""
    session_id: str
    message_id: str
    content: str
    requires_action: bool
    tool_calls: list[dict[str, Any]] = []
    is_final: bool = False


class AgentActionData(BaseModel):
    """Data for agent.action event - tool execution."""
    session_id: str
    message_id: str
    call_id: str
    tool: str
    arguments: dict[str, Any]


class AgentObservationData(BaseModel):
    """Data for agent.observation event - tool result."""
    session_id: str
    message_id: str
    call_id: str
    tool: str
    success: bool
    output: str
    error: str | None = None
    duration_ms: float = 0


class AgentReflectionData(BaseModel):
    """Data for agent.reflection event - self-reflection."""
    session_id: str
    iteration: int
    actions_count: int
    success_rate: float
    insights: str | None = None


class AgentLoopCompletedData(BaseModel):
    """Data for agent.loop.completed event."""
    session_id: str
    message_id: str
    agent: str
    reason: str  # "completed", "max_iterations", "cancelled", "error"
    iterations: int
    actions_count: int
    elapsed_ms: float


class AgentLoopErrorData(BaseModel):
    """Data for agent.loop.error event."""
    session_id: str
    message_id: str
    agent: str
    error: str
    iteration: int


# Define ReAct loop events
AgentLoopStarted = BusEvent.define("agent.loop.started", AgentLoopStartedData)
AgentLoopPhase = BusEvent.define("agent.loop.phase", AgentLoopPhaseData)
AgentThought = BusEvent.define("agent.thought", AgentThoughtData)
AgentAction = BusEvent.define("agent.action", AgentActionData)
AgentObservation = BusEvent.define("agent.observation", AgentObservationData)
AgentReflection = BusEvent.define("agent.reflection", AgentReflectionData)
AgentLoopCompleted = BusEvent.define("agent.loop.completed", AgentLoopCompletedData)
AgentLoopError = BusEvent.define("agent.loop.error", AgentLoopErrorData)


# =============================================================================
# MCP Events
# =============================================================================

class MCPToolsChangedData(BaseModel):
    """Data for mcp.tools.changed event."""
    server: str


class MCPConnectedData(BaseModel):
    """Data for mcp.connected event."""
    server: str
    tools_count: int


class MCPDisconnectedData(BaseModel):
    """Data for mcp.disconnected event."""
    server: str
    reason: str | None = None


class MCPErrorData(BaseModel):
    """Data for mcp.error event."""
    server: str
    error: str


# Define MCP events
MCPToolsChanged = BusEvent.define("mcp.tools.changed", MCPToolsChangedData)
MCPConnected = BusEvent.define("mcp.connected", MCPConnectedData)
MCPDisconnected = BusEvent.define("mcp.disconnected", MCPDisconnectedData)
MCPError = BusEvent.define("mcp.error", MCPErrorData)


# =============================================================================
# Permission Events
# =============================================================================

class PermissionRequestedData(BaseModel):
    """Data for permission.requested event."""
    session_id: str
    request_id: str
    tool: str
    permission: str
    patterns: list[str]
    always: list[str]
    metadata: dict[str, Any] = {}


class PermissionGrantedData(BaseModel):
    """Data for permission.granted event."""
    session_id: str
    request_id: str
    tool: str
    permission: str


class PermissionDeniedData(BaseModel):
    """Data for permission.denied event."""
    session_id: str
    request_id: str
    tool: str
    permission: str
    reason: str | None = None


# Define permission events
PermissionRequested = BusEvent.define("permission.requested", PermissionRequestedData)
PermissionGranted = BusEvent.define("permission.granted", PermissionGrantedData)
PermissionDenied = BusEvent.define("permission.denied", PermissionDeniedData)


# =============================================================================
# Provider Events
# =============================================================================

class ProviderStreamingData(BaseModel):
    """Data for provider.streaming event - streaming text chunk."""
    session_id: str
    message_id: str
    content: str
    tokens: int | None = None


class ProviderCompletedData(BaseModel):
    """Data for provider.completed event."""
    session_id: str
    message_id: str
    finish_reason: str
    tokens: dict[str, int]
    cost: float | None = None


# Define provider events
ProviderStreaming = BusEvent.define("provider.streaming", ProviderStreamingData)
ProviderCompleted = BusEvent.define("provider.completed", ProviderCompletedData)


# =============================================================================
# Streaming Events (for 方案 B - 分离式架构)
# =============================================================================

class StreamTextData(BaseModel):
    """Data for stream.text event - streaming text chunk."""
    session_id: str
    message_id: str
    content: str  # Incremental text chunk


class StreamToolCallData(BaseModel):
    """Data for stream.tool_call event."""
    session_id: str
    message_id: str
    call_id: str
    tool: str
    input: dict[str, Any]


class StreamToolResultData(BaseModel):
    """Data for stream.tool_result event."""
    session_id: str
    message_id: str
    call_id: str
    tool: str
    output: str
    title: str | None = None
    metadata: dict[str, Any] = {}
    error: str | None = None


class StreamDoneData(BaseModel):
    """Data for stream.done event."""
    session_id: str
    message_id: str
    reason: str  # "stop", "tool-calls", "max_steps", "cancelled", "error"


class StreamErrorData(BaseModel):
    """Data for stream.error event."""
    session_id: str
    message_id: str | None = None
    error: str


# Define streaming events
StreamText = BusEvent.define("stream.text", StreamTextData)
StreamToolCall = BusEvent.define("stream.tool_call", StreamToolCallData)
StreamToolResult = BusEvent.define("stream.tool_result", StreamToolResultData)
StreamDone = BusEvent.define("stream.done", StreamDoneData)
StreamError = BusEvent.define("stream.error", StreamErrorData)


# =============================================================================
# Config Events
# =============================================================================

class ConfigChangedData(BaseModel):
    """Data for config.changed event."""
    path: str
    source: str


ConfigChanged = BusEvent.define("config.changed", ConfigChangedData)
