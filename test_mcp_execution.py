#!/usr/bin/env python3
"""
Test script to debug MCP tool execution flow.

This script:
1. Creates a session
2. Sends a stock analysis request
3. Traces message flow and tool execution
4. Verifies tool results are returned in subsequent iterations
"""

import asyncio
import json
import sys
from pathlib import Path

# Add project to path
sys.path.insert(0, str(Path(__file__).parent))

async def test_mcp_execution():
    """Test MCP tool execution in ReAct loop."""
    # Initialize
    from src import initialize
    from src.session import create_session
    from src.agent import AgentExecutor
    from src.tool import ToolRegistry
    from src.tool.builtin import get_all_builtin_tools
    from src.provider import ProviderService
    from src.session import SessionService
    from src.agent import AgentService
    from src.mcp_client import MCPManager
    from src.config import Config
    from src.bus import Bus
    from src.core.state import state

    workspace = Path(".")

    print("=" * 80)
    print("MCP EXECUTION FLOW TEST")
    print("=" * 80)

    # Initialize modules
    print("\n1. Initializing modules...")
    bus = Bus()
    await initialize(workspace=workspace, worktree=workspace, storage=None, bus=bus)

    # Setup config and MCP
    print("2. Setting up config and MCP...")
    Config.configure(bus=bus, directory=workspace, worktree=workspace)
    mcp_manager = MCPManager(bus=bus, config=Config)
    state.mcp_manager = mcp_manager

    # Create tool registry
    print("3. Creating tool registry...")
    tool_registry = ToolRegistry(bus=bus)
    state.tool_registry = tool_registry

    # Register built-in tools
    print("4. Registering built-in tools...")
    for tool in get_all_builtin_tools():
        await state.tool_registry.register(tool, source="builtin")

    # Connect MCP servers
    print("5. Connecting MCP servers...")
    try:
        await mcp_manager.connect_from_config()
        print(f"   ✓ MCP servers connected")

        from src.mcp_client import register_mcp_tools
        await register_mcp_tools(state.tool_registry, mcp_manager)
        print(f"   ✓ MCP tools registered. Total: {state.tool_registry.tool_count}")
    except Exception as e:
        print(f"   ✗ Failed to connect MCP: {e}")
        return

    # Create services
    print("6. Creating services...")
    session_service = SessionService(bus=bus)
    provider_service = ProviderService()
    agent_service = AgentService()

    # Create executor
    print("7. Creating executor...")
    executor = AgentExecutor(
        session_service=session_service,
        provider_service=provider_service,
        tool_registry=tool_registry,
        agent_service=agent_service,
        workspace=workspace,
        worktree=workspace,
    )
    state.agent_executor = executor

    # Create session
    print("\n8. Creating session...")
    session = await create_session(title="MCP Test Session")
    session_id = session.id
    print(f"   Session ID: {session_id}")

    # Send request
    print("\n9. Sending stock analysis request...")
    request = "使用浏览器工具分析阿里巴巴(BABA)股票，收集最新的股票信息，分析其价格走势和技术指标。"

    parts = [{"type": "text", "text": request}]
    model = {"provider_id": "ollama", "model_id": "qwen3:4b"}

    print(f"   Request: {request}")
    print(f"   Model: {model['provider_id']}/{model['model_id']}")

    # Execute with streaming
    print("\n10. Executing prompt stream...")
    iteration = 0
    tool_calls_found = []
    tool_results_found = []

    async for event in executor.execute_stream(
        session_id=session_id,
        parts=parts,
        model=model,
        agent="build",
    ):
        if event.event == "text":
            print(f"    [TEXT] {event.data['content']}", end="", flush=True)

        elif event.event == "tool_call":
            tool_call = event.data["tool_call"]
            tool_name = tool_call.get("function", {}).get("name", "unknown")
            tool_calls_found.append(tool_name)
            print(f"\n    [TOOL_CALL] {tool_name}")

        elif event.event == "tool_result":
            tool_name = event.data["tool"]
            tool_results_found.append(tool_name)
            output = event.data["output"][:100] if event.data.get("output") else "(no output)"
            print(f"    [TOOL_RESULT] {tool_name}: {output}...")

        elif event.event == "done":
            print(f"\n    [DONE] reason={event.data.get('reason')}")

        elif event.event == "error":
            print(f"\n    [ERROR] {event.data.get('message')}")

    print("\n" + "=" * 80)
    print("EXECUTION SUMMARY")
    print("=" * 80)

    # Get final session
    final_session = await session_service.get_session(session_id)
    messages = await session_service.get_messages(session_id)

    print(f"\nTotal messages: {len(messages)}")
    print(f"Tool calls made: {tool_calls_found}")
    print(f"Tool results received: {tool_results_found}")

    # Print message details
    print("\nMessage sequence:")
    for i, msg in enumerate(messages):
        role = msg.info.role
        finish = getattr(msg.info, "finish", None)
        parts_count = len(msg.parts)
        print(f"\n  {i+1}. {role.upper()} (finish={finish}, parts={parts_count})")

        # Show text content
        for part in msg.parts:
            if hasattr(part, "text") and part.text:
                text = part.text[:100].replace("\n", "\\n")
                print(f"     - Text: {text}...")
            elif hasattr(part, "tool"):
                tool_name = part.tool
                call_id = getattr(part, "call_id", "?")
                state = getattr(part, "state", "?")
                print(f"     - Tool: {tool_name} (id={call_id}, state={state})")
                output = getattr(part, "output", None)
                if output:
                    print(f"       Output: {str(output)[:100]}...")

    # Check if flow was correct
    print("\n" + "=" * 80)
    print("ANALYSIS")
    print("=" * 80)

    expected_flow = [
        ("mcp_search" in tool_calls_found, "mcp_search should be called"),
        (len(messages) > 2 or "navigate" in tool_calls_found, "Should have multiple iterations or browser tools"),
    ]

    for check, desc in expected_flow:
        status = "✓" if check else "✗"
        print(f"{status} {desc}")

    await mcp_manager.disconnect_all()
    print("\nDone!")

if __name__ == "__main__":
    asyncio.run(test_mcp_execution())
