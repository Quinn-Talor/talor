"""Talor - A ReAct-based AI Agent Framework.

This package provides an event-driven architecture for building AI agents:
- Event Bus: Typed event publishing and subscription
- Tool System: Unified tool definitions with Pydantic validation
- Session Management: Message-based conversation handling
- Main Event Loop: Prompt processing with tool execution
- Agent System: Permission-based agent management
- Config System: Layered configuration loading
- Provider System: Multi-provider LLM support
- MCP Integration: Model Context Protocol support

Example:
    ```python
    from src import Bus, Session, SessionPrompt, Agent, Provider, Config
    from src.session.prompt import PromptInput

    # Configure systems
    Config.configure(directory=".")
    Session.configure(storage=None, bus=Bus)
    Agent.configure(config=Config)
    Provider.configure(config=Config)

    # Create session and process prompt
    session = await Session.create()
    result = await SessionPrompt.prompt(PromptInput(
        session_id=session.id,
        parts=[{"type": "text", "text": "Hello!"}],
        model={"provider_id": "openai", "model_id": "gpt-4"},
    ))
    ```
"""

__version__ = "0.1.0"

# Re-export main components
from src.bus import Bus, BusEvent, GlobalBus
from src.tool import Tool, ToolRegistry, ToolContext, ToolOutput
from src.session import Session, SessionPrompt, Message, MessagePart
from src.agent import Agent, Permission
from src.config import Config
from src.provider import Provider

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
    "SessionPrompt",
    "Message",
    "MessagePart",
    # Agent
    "Agent",
    "Permission",
    # Config
    "Config",
    # Provider
    "Provider",
    # MCP
    "MCP",
]
