"""Talor - Python reimplementation of opencode, an AI-powered IDE and coding assistant.

This package provides an event-driven architecture following opencode's patterns:
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
    from talor import Bus, Session, SessionPrompt, Agent, Provider, Config
    from talor.session.prompt import PromptInput
    
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
from talor.bus import Bus, BusEvent, GlobalBus
from talor.tool import Tool, ToolRegistry, ToolContext, ToolOutput
from talor.session import Session, SessionPrompt, Message, MessagePart
from talor.agent import Agent, Permission
from talor.config import Config
from talor.provider import Provider
from talor.mcp import MCP

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
