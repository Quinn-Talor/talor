"""Request/Response Models for Talor API."""

from typing import Any

from pydantic import BaseModel


# =============================================================================
# Health
# =============================================================================

class HealthResponse(BaseModel):
    status: str
    version: str


# =============================================================================
# Session
# =============================================================================

class SessionCreateRequest(BaseModel):
    title: str | None = None
    parent_id: str | None = None


class SessionResponse(BaseModel):
    id: str
    title: str
    directory: str
    parent_id: str | None = None
    time: dict[str, int]


# =============================================================================
# Prompt
# =============================================================================

class MessagePartInput(BaseModel):
    type: str
    text: str | None = None
    url: str | None = None
    filename: str | None = None
    mime: str | None = None
    name: str | None = None


class PromptRequest(BaseModel):
    session_id: str
    parts: list[MessagePartInput]
    model: dict[str, str] | None = None
    agent: str | None = None
    no_reply: bool = False


# =============================================================================
# Tool
# =============================================================================

class ToolResponse(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any]
    source: str


# =============================================================================
# Agent
# =============================================================================

class AgentResponse(BaseModel):
    name: str
    description: str | None
    mode: str
    native: bool
    hidden: bool


# =============================================================================
# Provider
# =============================================================================

class ProviderResponse(BaseModel):
    id: str
    name: str
    models: list[dict[str, Any]]


# =============================================================================
# MCP
# =============================================================================

class MCPServerResponse(BaseModel):
    name: str
    status: str
    tools_count: int


# =============================================================================
# Config
# =============================================================================

class ConfigResponse(BaseModel):
    default_agent: str | None
    default_model: str | None
    providers: dict[str, Any]
    mcp: dict[str, Any]
