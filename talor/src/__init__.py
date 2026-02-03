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

Example (Simplified Architecture):
    ```python
    from pathlib import Path
    from src import initialize, shutdown
    from src.session import create_session
    from src.agent import AgentExecutor

    # Initialize all modules
    storage = ...  # Your storage instance
    await initialize(workspace=Path("."), storage=storage)

    # Create session via module function
    # Each session automatically gets its own isolated Bus via SessionBusManager
    session = await create_session(title="New Session")

    # Execute prompt via AgentExecutor
    executor = AgentExecutor(workspace=Path("."))
    async for event in executor.execute_stream(
        session_id=session.id,
        parts=[{"type": "text", "text": "Hello!"}],
        model={"provider_id": "openai", "model_id": "gpt-4"},
    ):
        print(event)

    # Cleanup on shutdown
    shutdown()
    ```
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from src.bus import Bus

__version__ = "0.1.0"


# =============================================================================
# Module Initialization Functions
# =============================================================================

async def initialize(
    workspace: Path,
    storage: Any = None,
    bus: Any = None,
    worktree: Path | None = None,
) -> None:
    """Initialize all Talor modules.

    This function configures all core modules with the provided dependencies.
    Should be called once at application startup.

    Note: The bus parameter is only used for config module events (ConfigReloaded,
    ConfigChanged). Session events use SessionBusManager for per-session isolation.

    Args:
        workspace: Working directory path
        storage: Storage instance for persistence (e.g., aiosqlite connection)
        bus: Event bus instance for config events (optional)
        worktree: Project worktree root (defaults to workspace if not provided)

    Example:
        ```python
        from pathlib import Path
        from src import initialize

        storage = await create_storage()
        await initialize(workspace=Path("."), storage=storage)
        ```
    """
    from src.config import config
    from src import provider
    from src import session
    from src import agent

    # Use workspace as worktree if not provided
    effective_worktree = worktree or workspace

    # 1. Configure config module
    config.configure(
        workspace=workspace,
        worktree=effective_worktree,
        bus=bus,
    )

    # Create config getter for other modules
    async def config_getter() -> dict[str, Any]:
        return await config.get()

    # 2. Configure provider module
    provider.configure(config_getter=config_getter)

    # 3. Configure session module
    # Note: bus parameter removed - session module now uses SessionBusManager internally
    session.configure(
        workspace=workspace,
        storage=storage,
    )

    # 4. Configure agent module
    agent.configure(config_getter=config_getter)


def shutdown() -> None:
    """Shutdown and clear all module caches.

    This function clears all cached state in the modules.
    Should be called on application shutdown or when reinitializing.

    Example:
        ```python
        from src import shutdown

        # On application exit
        shutdown()
        ```
    """
    from src.config import config
    from src import provider
    from src import session
    from src import agent

    # Clear all module caches
    config.clear_cache()
    provider.clear_cache()
    session.clear_cache()
    agent.clear_cache()

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
    # Module initialization
    "initialize",
    "shutdown",
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
