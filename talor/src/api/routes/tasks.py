"""Tasks Routes — background task management API."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import src.task.service as task_service
from src.task.task import Task, TaskStatus
from src.session import get_messages, get_session


logger = logging.getLogger(__name__)
router = APIRouter()


# =============================================================================
# Request / Response Models
# =============================================================================

class TaskCreateRequest(BaseModel):
    title: str
    agent_id: str
    prompt: str
    model: dict | None = None
    use_worktree: bool = False


class TaskArtifactResponse(BaseModel):
    path: str
    type: str
    updated_at: int


class TaskResponse(BaseModel):
    id: str
    session_id: str
    agent_id: str
    title: str
    status: str
    progress: int
    current_action: str | None
    artifacts: list[TaskArtifactResponse]
    result: str | None
    error: str | None
    created_at: int
    updated_at: int
    started_at: int | None
    completed_at: int | None


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    progress: int
    current_action: str | None


def _to_response(task: Task) -> TaskResponse:
    return TaskResponse(
        id=task.id,
        session_id=task.session_id,
        agent_id=task.agent_id,
        title=task.title,
        status=task.status.value,
        progress=task.progress,
        current_action=task.current_action,
        artifacts=[
            TaskArtifactResponse(path=a.path, type=a.type, updated_at=a.updated_at)
            for a in task.artifacts
        ],
        result=task.result,
        error=task.error,
        created_at=task.created_at,
        updated_at=task.updated_at,
        started_at=task.started_at,
        completed_at=task.completed_at,
    )


# =============================================================================
# Endpoints
# =============================================================================

@router.post("", response_model=TaskResponse)
async def create_task(request: TaskCreateRequest) -> TaskResponse:
    """Create a background task and immediately start executing it."""
    try:
        task = await task_service.create_task(
            title=request.title,
            agent_id=request.agent_id,
            prompt=request.prompt,
            model=request.model,
            use_worktree=request.use_worktree,
        )
        return _to_response(task)
    except Exception as e:
        logger.error(f"Failed to create task: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    status: str | None = Query(default=None, description="Filter by status"),
    limit: int = Query(default=50, le=200),
) -> list[TaskResponse]:
    """List background tasks, optionally filtered by status."""
    valid_statuses = {s.value for s in TaskStatus}
    if status and status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{status}'. Valid: {', '.join(valid_statuses)}",
        )
    tasks = await task_service.list_tasks(status=status)
    return [_to_response(t) for t in tasks[:limit]]


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str) -> TaskResponse:
    """Get full task details including artifacts and progress."""
    task = await task_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    return _to_response(task)


@router.get("/{task_id}/status", response_model=TaskStatusResponse)
async def get_task_status(task_id: str) -> TaskStatusResponse:
    """Lightweight status poll — returns only status, progress, current_action."""
    task = await task_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    return TaskStatusResponse(
        task_id=task.id,
        status=task.status.value,
        progress=task.progress,
        current_action=task.current_action,
    )


@router.get("/{task_id}/session")
async def get_task_session(task_id: str) -> dict:
    """Get the full message history for a task's associated session."""
    task = await task_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")

    session = await get_session(task.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session for task '{task_id}' not found")

    messages = await get_messages(task.session_id)
    return {
        "task_id": task_id,
        "session_id": task.session_id,
        "messages": [
            {
                "id": msg.info.id,
                "role": msg.info.role,
                "content": msg.get_text_content(),
                "created_at": msg.info.time.get("created"),
                "parts": [
                    p.model_dump() if hasattr(p, "model_dump") else vars(p)
                    for p in msg.parts
                ],
            }
            for msg in messages
        ],
    }


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str) -> dict:
    """Cancel a running or queued task."""
    task = await task_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")

    if task.status not in (TaskStatus.RUNNING, TaskStatus.QUEUED, TaskStatus.PENDING):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel task with status '{task.status.value}'",
        )

    try:
        await task_service.cancel_task(task_id)
        return {"status": "cancelled", "task_id": task_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{task_id}/workspace")
async def get_task_workspace(task_id: str) -> dict:
    """Get workspace info: artifact file list and optional git diff summary."""
    task = await task_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    try:
        return await task_service.get_workspace(task_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{task_id}/workspace/preview")
async def preview_task_file(
    task_id: str,
    path: str = Query(..., description="Relative file path within workspace"),
) -> dict:
    """Read and return the content of a file produced by the task."""
    task = await task_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    try:
        content = await task_service.get_file_preview(task_id, path)
        return {"task_id": task_id, "path": path, "content": content}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{path}' not found in task workspace")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
