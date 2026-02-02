"""Tool Routes."""

from typing import Any

from fastapi import APIRouter, HTTPException

from src.api.models import ToolResponse
from src.core.state import state
from src.tool.context import ToolContext


router = APIRouter()


@router.get("", response_model=list[ToolResponse])
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


@router.post("/{tool_name}/execute")
async def execute_tool(tool_name: str, arguments: dict[str, Any]) -> dict:
    """Execute a tool directly."""
    if not state.tool_registry:
        raise HTTPException(status_code=500, detail="Tool registry not initialized")

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
