"""FastAPI Application for Talor Backend.

Provides REST API and WebSocket endpoints following opencode's server pattern.
Uses the new event-driven architecture with Bus, Tool, Session, Agent, Provider, MCP.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

# Import new architecture components
from talor.bus import Bus, BusEvent
from talor.bus.events import (
    SessionCreated, SessionUpdated, SessionDeleted,
    MessageCreated, MessageUpdated,
    ToolExecuting, ToolExecuted,
    AgentStarted, AgentCompleted, AgentError,
)
from talor.tool import ToolRegistry
from talor.tool.builtin import get_all_builtin_tools
from talor.session import Session, SessionPrompt
from talor.session.prompt import PromptInput
from talor.agent import Agent
from talor.config import Config
from talor.provider import Provider
from talor.mcp import MCP


logger = logging.getLogger(__name__)


# =============================================================================
# Application State
# =============================================================================

class SSEClient:
    """SSE client with session subscriptions."""
    
    def __init__(self):
        self.queue: asyncio.Queue = asyncio.Queue()
        self.subscribed_sessions: set[str] = set()  # Empty means subscribe to all
        self.subscribe_all: bool = True  # Default: receive all events
    
    def should_receive(self, session_id: str | None) -> bool:
        """Check if this client should receive events for a session."""
        if self.subscribe_all:
            return True
        if session_id is None:
            return True  # Global events go to everyone
        return session_id in self.subscribed_sessions
    
    def subscribe(self, session_id: str) -> None:
        """Subscribe to a specific session."""
        self.subscribe_all = False
        self.subscribed_sessions.add(session_id)
    
    def unsubscribe(self, session_id: str) -> None:
        """Unsubscribe from a specific session."""
        self.subscribed_sessions.discard(session_id)
        if not self.subscribed_sessions:
            self.subscribe_all = True


class AppState:
    """Application state container."""
    
    tool_registry: ToolRegistry | None = None
    workspace: Path = Path(".")
    worktree: Path = Path(".")
    sse_clients: list[SSEClient] = []
    websockets: list[WebSocket] = []


state = AppState()


# =============================================================================
# MCP Tool Integration
# =============================================================================

from talor.tool.tool import ToolInfo as _BaseToolInfo
from talor.tool.output import ToolOutput as _ToolOutput


class _MCPToolInfo(_BaseToolInfo):
    """ToolInfo subclass for MCP tools with custom JSON schema."""
    
    def __init__(self, json_schema: dict, **kwargs):
        super().__init__(**kwargs)
        self._json_schema = json_schema
    
    def get_parameters_schema(self) -> dict:
        """Return the MCP tool's JSON schema directly."""
        schema = self._json_schema.copy()
        schema.setdefault("type", "object")
        schema.setdefault("properties", {})
        schema["additionalProperties"] = False
        return schema
    
    async def __call__(self, args: dict, ctx: Any) -> _ToolOutput:
        """Execute the MCP tool without strict Pydantic validation."""
        class SimpleParams:
            def model_dump(self, **kwargs):
                return args
        return await self.execute(SimpleParams(), ctx)


async def _register_mcp_tools(registry: ToolRegistry) -> None:
    """Register MCP tools to the ToolRegistry."""
    from pydantic import BaseModel
    
    mcp_tools = await MCP.tools()
    
    for mcp_tool in mcp_tools:
        server_name = mcp_tool.server
        tool_name = mcp_tool.name
        
        class MCPParams(BaseModel):
            class Config:
                extra = "allow"
        
        _server = server_name
        _tool = tool_name
        
        async def execute_mcp_tool(
            params: MCPParams,
            ctx: Any,
            server: str = _server,
            tool: str = _tool,
        ) -> _ToolOutput:
            """Execute MCP tool."""
            try:
                args = params.model_dump(exclude_unset=True)
                result = await MCP.call_tool(server, tool, args)
                
                if isinstance(result, list):
                    output_parts = []
                    for item in result:
                        if isinstance(item, dict):
                            if item.get("type") == "text":
                                output_parts.append(item.get("text", ""))
                            else:
                                output_parts.append(str(item))
                        else:
                            output_parts.append(str(item))
                    output = "\n".join(output_parts)
                elif isinstance(result, dict):
                    output = json.dumps(result, indent=2)
                else:
                    output = str(result)
                
                return _ToolOutput(
                    title=f"MCP: {tool}",
                    output=output,
                    metadata={"server": server, "tool": tool},
                )
            except Exception as e:
                return _ToolOutput(
                    title=f"MCP Error: {tool}",
                    output=f"Error: {str(e)}",
                    metadata={"server": server, "tool": tool, "error": True},
                )
        
        prefixed_name = f"mcp_{server_name}_{tool_name}"
        
        tool_info = _MCPToolInfo(
            id=prefixed_name,
            description=mcp_tool.description or f"MCP tool: {tool_name} from {server_name}",
            parameters=MCPParams,
            execute=execute_mcp_tool,
            json_schema=mcp_tool.input_schema or {"type": "object", "properties": {}},
        )
        
        try:
            await registry.register(tool_info, source="mcp")
            logger.debug(f"Registered MCP tool: {prefixed_name}")
        except ValueError as e:
            logger.warning(f"Failed to register MCP tool {prefixed_name}: {e}")
    
    logger.info(f"Registered {len(mcp_tools)} MCP tools")


# =============================================================================
# Lifespan Management
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan manager."""
    logger.info("Starting Talor API server...")
    
    # Set workspace
    workspace = Path(os.environ.get("TALOR_WORKSPACE", os.getcwd()))
    state.workspace = workspace
    state.worktree = workspace
    
    # Configure systems
    Config.configure(bus=Bus, directory=workspace, worktree=workspace)
    Session.configure(storage=None, bus=Bus)
    Agent.configure(config=Config)
    Provider.configure(config=Config)
    MCP.configure(bus=Bus, config=Config)
    
    # Create tool registry
    state.tool_registry = ToolRegistry(bus=Bus)
    
    # Register built-in tools
    for tool in get_all_builtin_tools():
        await state.tool_registry.register(tool, source="builtin")
    
    # Configure session prompt
    SessionPrompt.configure(
        bus=Bus,
        tool_registry=state.tool_registry,
        provider=Provider,
        directory=workspace,
        worktree=workspace,
    )
    
    # Connect to MCP servers from config
    try:
        await MCP.connect_from_config()
        
        # Register MCP tools to ToolRegistry
        await _register_mcp_tools(state.tool_registry)
    except Exception as e:
        logger.warning(f"Failed to connect MCP servers: {e}")
    
    # Subscribe to events for SSE/WebSocket broadcasting
    Bus.subscribe_all(_broadcast_event)
    
    logger.info(f"Workspace: {workspace}")
    logger.info(f"Tools registered: {state.tool_registry.tool_count}")
    logger.info("Talor API server started")
    
    yield
    
    # Shutdown
    logger.info("Shutting down Talor API server...")
    
    # Disconnect MCP servers
    await MCP.disconnect_all()
    
    # Clear tool registry
    if state.tool_registry:
        await state.tool_registry.clear()
    
    # Close websockets
    for ws in state.websockets:
        try:
            await ws.close()
        except Exception:
            pass
    
    logger.info("Talor API server stopped")


async def _broadcast_event(event) -> None:
    """Broadcast event to SSE and WebSocket clients."""
    event_data = {
        "type": event.type,
        "properties": event.properties.model_dump() if hasattr(event.properties, "model_dump") else event.properties,
        "timestamp": int(time.time() * 1000),
    }
    
    # Extract session_id for filtering
    session_id = event_data.get("properties", {}).get("session_id")
    
    # SSE clients - only send to subscribed clients
    for client in state.sse_clients:
        if client.should_receive(session_id):
            try:
                await client.queue.put(event_data)
            except Exception:
                pass
    
    # WebSocket clients
    message = json.dumps(event_data)
    disconnected = []
    for ws in state.websockets:
        try:
            await ws.send_text(message)
        except Exception:
            disconnected.append(ws)
    
    for ws in disconnected:
        if ws in state.websockets:
            state.websockets.remove(ws)


# =============================================================================
# FastAPI App
# =============================================================================

app = FastAPI(
    title="Talor API",
    description="Backend API for Talor AI Assistant (OpenCode-compatible)",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def create_app() -> FastAPI:
    """Create and return the FastAPI application."""
    return app


# =============================================================================
# Request/Response Models
# =============================================================================

class HealthResponse(BaseModel):
    status: str
    version: str


class SessionCreateRequest(BaseModel):
    title: str | None = None
    parent_id: str | None = None


class SessionResponse(BaseModel):
    id: str
    title: str
    directory: str
    parent_id: str | None = None
    time: dict[str, int]


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


class ToolResponse(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any]
    source: str


class AgentResponse(BaseModel):
    name: str
    description: str | None
    mode: str
    native: bool
    hidden: bool


class ProviderResponse(BaseModel):
    id: str
    name: str
    models: list[dict[str, Any]]


class MCPServerResponse(BaseModel):
    name: str
    status: str
    tools_count: int


class ConfigResponse(BaseModel):
    default_agent: str | None
    default_model: str | None
    providers: dict[str, Any]
    mcp: dict[str, Any]


# =============================================================================
# Root and Health Endpoints
# =============================================================================

@app.get("/", response_class=JSONResponse)
async def root() -> dict:
    """Root endpoint - API info."""
    return {
        "name": "Talor API",
        "version": "0.1.0",
        "status": "running",
        "architecture": "opencode-compatible",
    }


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Health check."""
    return HealthResponse(status="ok", version="0.1.0")


@app.get("/api/health", response_model=HealthResponse)
async def api_health() -> HealthResponse:
    """API health check."""
    return HealthResponse(status="ok", version="0.1.0")


# =============================================================================
# Session Endpoints
# =============================================================================

@app.get("/api/sessions", response_model=list[SessionResponse])
async def list_sessions() -> list[SessionResponse]:
    """List all sessions."""
    sessions = await Session.list()
    return [
        SessionResponse(
            id=s.id,
            title=s.title,
            directory=s.directory,
            parent_id=s.parent_id,
            time=s.time,
        )
        for s in sessions
    ]


@app.post("/api/sessions", response_model=SessionResponse)
async def create_session(request: SessionCreateRequest) -> SessionResponse:
    """Create a new session."""
    session = await Session.create(
        title=request.title,
        parent_id=request.parent_id,
    )
    return SessionResponse(
        id=session.id,
        title=session.title,
        directory=session.directory,
        parent_id=session.parent_id,
        time=session.time,
    )


@app.get("/api/sessions/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str) -> SessionResponse:
    """Get a session by ID."""
    session = await Session.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return SessionResponse(
        id=session.id,
        title=session.title,
        directory=session.directory,
        parent_id=session.parent_id,
        time=session.time,
    )


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str) -> dict:
    """Delete a session."""
    session = await Session.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    await Session.delete(session_id)
    return {"status": "deleted"}


@app.get("/api/sessions/{session_id}/messages")
async def get_session_messages(session_id: str) -> list[dict]:
    """Get messages for a session."""
    session = await Session.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    messages = await Session.messages(session_id)
    return [msg.to_dict() for msg in messages]


# =============================================================================
# Prompt Endpoint
# =============================================================================

@app.post("/api/session/prompt")
async def send_prompt(request: PromptRequest) -> StreamingResponse:
    """Send a prompt to the agent with SSE streaming response.
    
    Returns Server-Sent Events for real-time inference progress.
    Each event includes an 'id' field for reconnection support.
    """
    # Verify session exists
    session = await Session.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Get default model if not specified
    model = request.model
    if not model:
        model = await Provider.default_model()
    
    # Convert parts
    parts = [p.model_dump() for p in request.parts]
    
    # Create prompt input
    prompt_input = PromptInput(
        session_id=request.session_id,
        parts=parts,
        model=model,
        agent=request.agent,
        no_reply=request.no_reply,
    )
    
    # Event counter for SSE id
    event_counter = [0]
    
    async def generate_sse():
        """Generate SSE events from prompt processing."""
        try:
            async for event in SessionPrompt.prompt_stream(prompt_input):
                event_counter[0] += 1
                # Format as SSE with id for reconnection support
                data = json.dumps({
                    "event": event.event,
                    **event.data,
                })
                yield f"id: {event_counter[0]}\ndata: {data}\n\n"
        except Exception as e:
            logger.error(f"Prompt stream error: {e}", exc_info=True)
            event_counter[0] += 1
            error_data = json.dumps({
                "event": "error",
                "message": str(e),
            })
            yield f"id: {event_counter[0]}\ndata: {error_data}\n\n"
    
    return StreamingResponse(
        generate_sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/session/prompt/async")
async def send_prompt_async(request: PromptRequest) -> dict:
    """Send a prompt asynchronously (fire-and-forget).
    
    The prompt is processed in the background and results are
    delivered via the /event SSE stream. This allows the client
    to reconnect to the event stream without losing messages.
    
    Returns immediately with the message ID.
    """
    # Verify session exists
    session = await Session.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Get default model if not specified
    model = request.model
    if not model:
        model = await Provider.default_model()
    
    # Convert parts
    parts = [p.model_dump() for p in request.parts]
    
    # Create prompt input
    prompt_input = PromptInput(
        session_id=request.session_id,
        parts=parts,
        model=model,
        agent=request.agent,
        no_reply=request.no_reply,
    )
    
    # Generate message ID for tracking
    from ulid import ULID
    message_id = f"message_{ULID()}"
    
    # Start background task - use prompt_stream to publish events to Bus
    async def process_in_background():
        try:
            # Use prompt_stream instead of prompt to publish streaming events to Bus
            async for event in SessionPrompt.prompt_stream(prompt_input):
                # Events are already published to Bus in prompt_stream
                # We just need to consume the generator
                pass
        except Exception as e:
            logger.error(f"Background prompt error: {e}", exc_info=True)
            # Publish error event
            if Bus:
                from talor.bus.events import StreamError, StreamErrorData
                await Bus.publish(
                    StreamError,
                    StreamErrorData(
                        session_id=request.session_id,
                        message_id=None,
                        error=str(e),
                    )
                )
    
    # Schedule background task
    asyncio.create_task(process_in_background())
    
    return {
        "status": "processing",
        "session_id": request.session_id,
        "message_id": message_id,
    }


@app.post("/api/session/prompt/sync")
async def send_prompt_sync(request: PromptRequest) -> dict:
    """Send a prompt to the agent (synchronous, non-streaming).
    
    Waits for complete response before returning.
    """
    # Verify session exists
    session = await Session.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Get default model if not specified
    model = request.model
    if not model:
        model = await Provider.default_model()
    
    # Convert parts
    parts = [p.model_dump() for p in request.parts]
    
    # Create prompt input
    prompt_input = PromptInput(
        session_id=request.session_id,
        parts=parts,
        model=model,
        agent=request.agent,
        no_reply=request.no_reply,
    )
    
    try:
        # Process prompt
        result = await SessionPrompt.prompt(prompt_input)
        
        return {
            "session_id": request.session_id,
            "message_id": result.info.id,
            "content": result.get_text_content(),
            "parts": [p.model_dump() if hasattr(p, "model_dump") else p for p in result.parts],
        }
    except Exception as e:
        logger.error(f"Prompt error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/cancel")
async def cancel_session(session_id: str) -> dict:
    """Cancel processing for a session."""
    SessionPrompt.cancel(session_id)
    return {"status": "cancelled"}


# =============================================================================
# Tool Endpoints
# =============================================================================

@app.get("/api/tools", response_model=list[ToolResponse])
async def list_tools() -> list[ToolResponse]:
    """List available tools."""
    if not state.tool_registry:
        return []
    
    tools = await state.tool_registry.list()
    return [
        ToolResponse(
            name=t["name"],
            description=t["description"][:200] + "..." if len(t["description"]) > 200 else t["description"],
            parameters=t["parameters"],
            source=t["source"],
        )
        for t in tools
    ]


@app.post("/api/tools/{tool_name}/execute")
async def execute_tool(tool_name: str, arguments: dict[str, Any]) -> dict:
    """Execute a tool directly."""
    if not state.tool_registry:
        raise HTTPException(status_code=500, detail="Tool registry not initialized")
    
    from talor.tool.context import ToolContext
    
    ctx = ToolContext(
        session_id="direct",
        message_id="direct",
        agent="build",
        _workspace=state.workspace,
        _worktree=state.worktree,
    )
    
    try:
        result = await state.tool_registry.execute(tool_name, arguments, ctx)
        return {
            "success": True,
            "title": result.title,
            "output": result.output,
            "metadata": result.metadata,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }


# =============================================================================
# Agent Endpoints
# =============================================================================

@app.get("/api/agents", response_model=list[AgentResponse])
async def list_agents() -> list[AgentResponse]:
    """List available agents."""
    agents = await Agent.list()
    return [
        AgentResponse(
            name=a.name,
            description=a.description,
            mode=a.mode,
            native=a.native,
            hidden=a.hidden,
        )
        for a in agents
    ]


@app.get("/api/agents/{agent_name}", response_model=AgentResponse)
async def get_agent(agent_name: str) -> AgentResponse:
    """Get an agent by name."""
    agent = await Agent.get(agent_name)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    return AgentResponse(
        name=agent.name,
        description=agent.description,
        mode=agent.mode,
        native=agent.native,
        hidden=agent.hidden,
    )


# =============================================================================
# Provider Endpoints
# =============================================================================

@app.get("/api/providers", response_model=list[ProviderResponse])
async def list_providers() -> list[ProviderResponse]:
    """List available providers."""
    providers = await Provider.list()
    return [
        ProviderResponse(
            id=p.id,
            name=p.name,
            models=[m.model_dump() for m in p.models],
        )
        for p in providers
    ]


@app.get("/api/provider/models")
async def list_models() -> list[dict]:
    """List all available models."""
    providers = await Provider.list()
    models = []
    
    for provider in providers:
        for model in provider.models:
            models.append({
                "id": f"{provider.id}/{model.id}",
                "name": model.name,
                "provider": provider.id,
                "context_length": model.context_length,
                "max_output_tokens": model.max_output_tokens,
            })
    
    return models


@app.post("/api/providers/refresh")
async def refresh_providers() -> dict[str, Any]:
    """Refresh provider cache and rediscover models.
    
    This is useful for discovering newly installed Ollama models
    without restarting the server.
    """
    # Clear cache to force rediscovery
    Provider.clear_cache()
    
    # Reload providers
    providers = await Provider.list()
    
    return {
        "success": True,
        "providers": len(providers),
        "models": sum(len(p.models) for p in providers),
    }


# =============================================================================
# MCP Endpoints
# =============================================================================

@app.get("/api/mcp/servers", response_model=list[MCPServerResponse])
async def list_mcp_servers() -> list[MCPServerResponse]:
    """List MCP servers."""
    servers = await MCP.list_servers()
    return [
        MCPServerResponse(
            name=s["name"],
            status=s["status"]["status"],
            tools_count=s["tools_count"],
        )
        for s in servers
    ]


@app.post("/api/mcp/servers/{server_name}/connect")
async def connect_mcp_server(server_name: str, config: dict[str, Any]) -> dict:
    """Connect to an MCP server."""
    status = await MCP.connect(server_name, config)
    return {"status": status.status, "error": status.error}


@app.post("/api/mcp/servers/{server_name}/disconnect")
async def disconnect_mcp_server(server_name: str) -> dict:
    """Disconnect from an MCP server."""
    await MCP.disconnect(server_name)
    return {"status": "disconnected"}


@app.get("/api/mcp/tools")
async def list_mcp_tools() -> list[dict]:
    """List tools from all MCP servers."""
    tools = await MCP.tools()
    return [t.model_dump() for t in tools]


# =============================================================================
# Config Endpoints
# =============================================================================

@app.get("/api/config", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    """Get current configuration."""
    config = await Config.get()
    return ConfigResponse(
        default_agent=config.get("default_agent"),
        default_model=config.get("default_model"),
        providers=config.get("provider", {}),
        mcp=config.get("mcp", {}),
    )


@app.put("/api/config/{key}")
async def set_config(key: str, value: Any, scope: str = "project") -> dict:
    """Set a configuration value."""
    await Config.set(key, value, scope=scope)
    return {"status": "updated"}


# =============================================================================
# SSE Event Stream
# =============================================================================

# Event history for reconnection support
# In production, this should be stored in Redis or similar
_event_history: dict[str, list[dict]] = {}  # session_id -> events
_event_counter: int = 0
_max_history_per_session: int = 1000


async def _store_event(event_data: dict) -> int:
    """Store event in history and return event ID."""
    global _event_counter
    _event_counter += 1
    event_id = _event_counter
    
    # Extract session_id from event if available
    session_id = event_data.get("properties", {}).get("session_id", "_global")
    
    if session_id not in _event_history:
        _event_history[session_id] = []
    
    # Add event with ID
    event_with_id = {**event_data, "id": event_id}
    _event_history[session_id].append(event_with_id)
    
    # Trim history if too long
    if len(_event_history[session_id]) > _max_history_per_session:
        _event_history[session_id] = _event_history[session_id][-_max_history_per_session:]
    
    return event_id


def _get_events_since(last_event_id: int, session_id: str | None = None) -> list[dict]:
    """Get events since a given event ID."""
    events = []
    
    if session_id:
        # Get events for specific session
        session_events = _event_history.get(session_id, [])
        events.extend([e for e in session_events if e.get("id", 0) > last_event_id])
    else:
        # Get all events
        for session_events in _event_history.values():
            events.extend([e for e in session_events if e.get("id", 0) > last_event_id])
    
    # Sort by ID
    events.sort(key=lambda e: e.get("id", 0))
    return events


async def sse_event_generator(client: SSEClient, last_event_id: int | None = None):
    """Generate SSE events from queue with reconnection support."""
    # First, send any missed events if reconnecting
    if last_event_id is not None:
        # Get events for subscribed sessions only
        if client.subscribe_all:
            missed_events = _get_events_since(last_event_id)
        else:
            missed_events = []
            for session_id in client.subscribed_sessions:
                missed_events.extend(_get_events_since(last_event_id, session_id))
            # Also get global events
            missed_events.extend(_get_events_since(last_event_id, "_global"))
            missed_events.sort(key=lambda e: e.get("id", 0))
        
        for event in missed_events:
            event_id = event.get("id", 0)
            event_data = {k: v for k, v in event.items() if k != "id"}
            yield f"id: {event_id}\ndata: {json.dumps(event_data)}\n\n"
    
    try:
        while True:
            try:
                event = await asyncio.wait_for(client.queue.get(), timeout=30.0)
                # Store event and get ID
                event_id = await _store_event(event)
                yield f"id: {event_id}\ndata: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
    except asyncio.CancelledError:
        pass


@app.get("/event")
async def event_stream(request: Request):
    """SSE event stream for real-time updates.
    
    This endpoint streams all events. The client is responsible for filtering
    events by session_id based on which sessions are currently open.
    
    Headers:
        Last-Event-ID: For reconnection support. Missed events will be replayed.
    
    Each event contains a session_id in its properties, allowing the client
    to route events to the correct session view.
    """
    # Get Last-Event-ID from header for reconnection
    last_event_id_str = request.headers.get("Last-Event-ID")
    last_event_id = int(last_event_id_str) if last_event_id_str else None
    
    # Create client - receives all events, client-side filtering
    client = SSEClient()
    state.sse_clients.append(client)
    
    async def generate():
        try:
            async for event in sse_event_generator(client, last_event_id):
                yield event
        finally:
            if client in state.sse_clients:
                state.sse_clients.remove(client)
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# =============================================================================
# WebSocket Endpoint
# =============================================================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time updates."""
    await websocket.accept()
    state.websockets.append(websocket)
    
    logger.info(f"WebSocket connected. Total: {len(state.websockets)}")
    
    try:
        while True:
            data = await websocket.receive_text()
            
            try:
                message = json.loads(data)
                event_type = message.get("type")
                payload = message.get("payload", {})
                
                if event_type == "ping":
                    await websocket.send_json({"type": "pong"})
                elif event_type == "subscribe":
                    await websocket.send_json({
                        "type": "subscribed",
                        "payload": {"channel": payload.get("channel")},
                    })
                else:
                    logger.debug(f"Unknown WebSocket event: {event_type}")
                    
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON: {data}")
                
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if websocket in state.websockets:
            state.websockets.remove(websocket)
