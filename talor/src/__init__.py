"""Talor - A ReAct-based AI Agent Framework.

This package provides an event-driven architecture for building AI agents:
- Event Bus: Typed event publishing and subscription
- Tool System: Unified tool definitions with Pydantic validation
- Session Management: Message-based conversation handling
- Agent Executor: ReAct cycle execution engine
- Agent System: Permission-based agent management
- Config System: Layered configuration loading
- Provider System: Multi-provider LLM support
- MCP Integration: Model Context Protocol support

Example (DDD Architecture):
    ```python
    from src.core.container import get_container

    # Configure container
    container = get_container()
    container.configure(workspace=Path("."), bus=Bus)

    # Create session via service
    session = await container.session_service.create_session(title="New Session")

    # Execute prompt via AgentExecutor
    async for event in container.agent_executor.execute_stream(
        session_id=session.id,
        parts=[{"type": "text", "text": "Hello!"}],
        model={"provider_id": "openai", "model_id": "gpt-4"},
    ):
        print(event)
    ```
"""

__version__ = "0.1.0"

# Re-export main components
from src.bus import Bus, BusEvent, GlobalBus
from src.tool import Tool, ToolRegistry, ToolContext, ToolOutput
from src.session import Session, MessagePart
from src.session.message import UserMessage, AssistantMessage, SystemMessage
from src.agent import Agent, Permission, AgentExecutor, SSEEvent
from src.config import Config
from src.provider import Provider, ProviderService

# Lazy import for MCP to avoid circular import with fastmcp
def __getattr__(name: str):
    if name == "MCP":
        from src.mcp_client import MCP
        return MCP
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    # Version
    "__version__",
    # Bus
    "Bus",
    "BusEvent",
    "GlobalBus",
    # Tool
    "Tool",
    "ToolRegistry",
    "ToolContext",
    "ToolOutput",
    # Session
    "Session",
    "MessagePart",
    "UserMessage",
    "AssistantMessage",
    "SystemMessage",
    # Agent
    "Agent",
    "Permission",
    "AgentExecutor",
    "SSEEvent",
    # Config
    "Config",
    # Provider
    "Provider",
    "ProviderService",
    # MCP
    "MCP",
]
