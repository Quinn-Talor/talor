"""Subagent Tool for Talor.

Delegates subtasks to specialized subagents (explore, plan, general).
Each subagent runs in an independent session with its own memory context,
and returns the final result as tool output.

Supports 1-level nesting only (subagents cannot spawn subagents).
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field

from src.tool import Tool, ToolContext, ToolOutput


logger = logging.getLogger(__name__)

# Maximum nesting depth for subagent calls (1 = no nesting)
MAX_SUBAGENT_DEPTH = 1


class SubagentParams(BaseModel):
    """Parameters for subagent tool."""

    agent: str = Field(
        description=(
            "Subagent ID to delegate to. Available: "
            "explore (read-only codebase exploration), "
            "plan (task planning), "
            "general (general-purpose research)"
        )
    )
    prompt: str = Field(
        description="Task description for the subagent"
    )


async def subagent_execute(params: SubagentParams, ctx: ToolContext) -> ToolOutput:
    """Execute a subagent in an independent session.

    Args:
        params: Subagent parameters (agent ID and prompt)
        ctx: Tool execution context

    Returns:
        ToolOutput with the subagent's response
    """
    # 1. Check nesting depth
    depth = ctx.extra.get("subagent_depth", 0)
    if depth >= MAX_SUBAGENT_DEPTH:
        return ToolOutput.error(
            f"Subagent nesting limit reached (max depth: {MAX_SUBAGENT_DEPTH}). "
            "Subagents cannot spawn other subagents."
        )

    # 2. Get required services from context
    executor = ctx.extra.get("executor")
    agent_service = ctx.extra.get("agent_service")
    session_service = ctx.extra.get("session_service")

    if not executor or not agent_service or not session_service:
        return ToolOutput.error(
            "Subagent execution not available (missing executor/agent_service/session_service)"
        )

    # 3. Validate the target agent exists and has subagent scope
    agent = await agent_service.get_agent(params.agent)
    if not agent:
        return ToolOutput.error(f"Agent not found: {params.agent}")
    if not agent.is_subagent:
        return ToolOutput.error(
            f"Agent '{params.agent}' cannot be used as subagent (scope={agent.scope})"
        )

    # 4. Get model config from parent session
    messages = await session_service.get_messages(ctx.session_id)
    model_info: dict[str, Any] = {"provider_id": "ollama", "model_id": "qwen3:4b"}
    for msg in reversed(messages):
        if msg.info.role == "user":
            model_info = msg.info.model
            break

    # 5. Create independent session for subagent
    sub_session = await session_service.create_session(
        title=f"subagent:{params.agent}",
    )
    sub_session_id = sub_session.id

    logger.info(
        f"Spawning subagent '{params.agent}' in session {sub_session_id} "
        f"(parent: {ctx.session_id}, depth: {depth + 1})"
    )

    # 6. Execute subagent (non-streaming, blocks until complete)
    try:
        result = await executor.execute(
            session_id=sub_session_id,
            parts=[{"type": "text", "text": params.prompt}],
            model=model_info,
            agent=params.agent,
        )

        output_text = result.get_text_content() or "(no response)"

        logger.info(
            f"Subagent '{params.agent}' completed in session {sub_session_id} "
            f"({len(output_text)} chars)"
        )

        return ToolOutput(
            title=f"Subagent: {params.agent}",
            output=output_text,
            metadata={
                "agent": params.agent,
                "sub_session_id": sub_session_id,
                "depth": depth + 1,
            },
        )

    except Exception as e:
        logger.error(f"Subagent '{params.agent}' failed: {e}")
        return ToolOutput.error(f"Subagent execution failed: {e}")


SubagentTool = Tool.define(
    id="subagent",
    description=(
        "Delegate a subtask to a specialized subagent. "
        "Available subagents: explore (read-only codebase exploration), "
        "plan (task planning), general (general-purpose research). "
        "Each subagent runs in an independent context and returns a text result. "
        "Use this for tasks that require deep investigation or parallel research."
    ),
    parameters=SubagentParams,
    execute=subagent_execute,
)
