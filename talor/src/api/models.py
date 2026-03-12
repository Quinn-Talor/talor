"""Request/Response Models for Talor API — AI Agent 平台。"""

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


class WorkflowStepResponse(BaseModel):
    id: str
    name: str
    description: str
    tool: str | None = None
    condition: str | None = None


class WorkflowDefinitionResponse(BaseModel):
    type: str
    steps: list[WorkflowStepResponse] = []
    max_iterations: int | None = None


class RoleDefinitionResponse(BaseModel):
    title: str
    persona: str
    responsibilities: list[str] = []


class CapabilityScopeResponse(BaseModel):
    domains: list[str] = []
    input_types: list[str] = []
    output_types: list[str] = []
    proficiency: dict[str, str] = {}
    constraints: list[str] = []


class DependencySpecResponse(BaseModel):
    tools: list[str] = []
    sub_agents: list[str] = []
    skills: list[str] = []
    mcp_servers: list[str] = []


class InputFieldResponse(BaseModel):
    name: str
    type: str
    description: str
    required: bool
    validation: str | None = None


class InputSpecResponse(BaseModel):
    fields: list[InputFieldResponse] = []
    format: str
    examples: list[str] = []


class DeliverableSpecResponse(BaseModel):
    name: str
    format: str
    description: str
    required: bool


class DeliveryStandardResponse(BaseModel):
    deliverables: list[DeliverableSpecResponse] = []
    quality_criteria: list[str] = []
    success_definition: str
    acceptance_tests: list[str] = []


class AgentResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    kind: str  # platform | worker
    scope: str  # primary | subagent | both
    hidden: bool
    is_worker: bool  # 是否为业务 Agent
    # 业务 Agent 字段（kind=worker 时有值）
    role: RoleDefinitionResponse | None = None
    capabilities: CapabilityScopeResponse | None = None
    workflow: WorkflowDefinitionResponse | None = None
    dependencies: DependencySpecResponse | None = None
    input_spec: InputSpecResponse | None = None
    delivery_standard: DeliveryStandardResponse | None = None
    manual: str | None = None


class AgentSystemPromptResponse(BaseModel):
    agent_id: str
    system_prompt: str


# =============================================================================
# Provider
# =============================================================================


class ModelCapabilitiesResponse(BaseModel):
    vision: bool
    function_calling: bool
    json_mode: bool
    streaming: bool
    reasoning: bool
    parallel_tool_calls: bool = False
    structured_output: bool = False


class ModelCostResponse(BaseModel):
    input: float  # per 1M tokens
    output: float  # per 1M tokens
    cache_read: float
    cache_write: float


class ModelResponse(BaseModel):
    id: str
    name: str
    provider_id: str
    context_length: int
    max_output_tokens: int
    capabilities: ModelCapabilitiesResponse
    cost: ModelCostResponse


class ProviderResponse(BaseModel):
    id: str
    name: str
    models: list[ModelResponse]


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
    language: str | None
    theme: str | None
    providers: dict[str, Any]
    mcp: dict[str, Any]
    plugins: dict[str, Any] = {}
    workspace: list[str] = []
    permission: dict[str, Any] = {}
    agent: dict[str, Any] = {}
