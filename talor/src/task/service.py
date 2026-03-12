"""Task Service — background task lifecycle management."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

from ulid import ULID

from src.task.task import Task, TaskArtifact, TaskStatus


logger = logging.getLogger(__name__)

# =============================================================================
# Module-level State
# =============================================================================

_storage: Any = None  # StorageSystem instance
_workspace: Path = Path(".")
_running: dict[str, asyncio.Task] = {}        # task_id → asyncio.Task
_task_requests: dict[str, dict] = {}           # task_id → create request (for queue)
_queued: list[str] = []                        # queued task_ids (FIFO)

MAX_CONCURRENT_TASKS = 5


def configure(workspace: Path, storage: Any) -> None:
    """Configure the task service.

    Args:
        workspace: Working directory path
        storage: StorageSystem instance for persistence
    """
    global _storage, _workspace
    _workspace = workspace
    _storage = storage


# =============================================================================
# Storage Helpers
# =============================================================================

async def _save_task(task: Task) -> None:
    row = task.to_db_row()
    if _storage:
        await _storage.execute(
            """INSERT OR REPLACE INTO tasks
               (id, session_id, agent_id, title, status, progress, current_action,
                artifacts, checkpoint_path, worktree_path, result, error,
                created_at, updated_at, started_at, completed_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                row["id"], row["session_id"], row["agent_id"], row["title"],
                row["status"], row["progress"], row["current_action"],
                row["artifacts"], row["checkpoint_path"], row["worktree_path"],
                row["result"], row["error"],
                row["created_at"], row["updated_at"], row["started_at"], row["completed_at"],
            ),
        )


async def _update_task_fields(task_id: str, **fields: Any) -> None:
    if not _storage:
        return
    set_clauses = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [task_id]
    await _storage.execute(
        f"UPDATE tasks SET {set_clauses} WHERE id = ?",
        tuple(values),
    )


async def _get_task_from_storage(task_id: str) -> Task | None:
    if not _storage:
        return None
    row = await _storage.fetch_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
    if not row:
        return None
    return Task.from_db_row(row)


async def _get_task_by_session(session_id: str) -> Task | None:
    if not _storage:
        return None
    row = await _storage.fetch_one("SELECT * FROM tasks WHERE session_id = ?", (session_id,))
    if not row:
        return None
    return Task.from_db_row(row)


async def _list_tasks_from_storage(status: str | None = None) -> list[Task]:
    if not _storage:
        return []
    if status:
        rows = await _storage.fetch_all(
            "SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC",
            (status,),
        )
    else:
        rows = await _storage.fetch_all(
            "SELECT * FROM tasks ORDER BY created_at DESC"
        )
    return [Task.from_db_row(r) for r in rows]


async def _count_by_status(status: TaskStatus) -> int:
    if not _storage:
        return len([t_id for t_id in _running])
    row = await _storage.fetch_one(
        "SELECT COUNT(*) as cnt FROM tasks WHERE status = ?", (status.value,)
    )
    return row["cnt"] if row else 0


# =============================================================================
# Public API
# =============================================================================

async def create_task(
    title: str,
    agent_id: str,
    prompt: str,
    model: dict | None = None,
    use_worktree: bool = False,
) -> Task:
    """Create a background task and immediately queue it for execution.

    Args:
        title: Task title shown in UI
        agent_id: ID of the worker agent to execute this task
        prompt: Initial prompt / task instructions
        model: Optional model override dict
        use_worktree: Whether to create a git worktree for isolation

    Returns:
        Created Task entity
    """
    from src.session import create_session

    # Create associated session
    session = await create_session(title=title)

    now = int(time.time() * 1000)
    task_id = f"task_{ULID()}"

    running_count = await _count_by_status(TaskStatus.RUNNING)
    status = TaskStatus.QUEUED if running_count >= MAX_CONCURRENT_TASKS else TaskStatus.PENDING

    task = Task(
        id=task_id,
        session_id=session.id,
        agent_id=agent_id,
        title=title,
        status=status,
        created_at=now,
        updated_at=now,
    )
    await _save_task(task)

    # Store request data for deferred execution (queued tasks)
    _task_requests[task_id] = {
        "prompt": prompt,
        "model": model,
        "use_worktree": use_worktree,
    }

    # Publish task.created event
    await _publish_task_created(task)

    if status == TaskStatus.PENDING:
        asyncio.create_task(_run_task(task_id))
    else:
        _queued.append(task_id)
        logger.info(f"Task {task_id} queued (running: {running_count}/{MAX_CONCURRENT_TASKS})")

    return task


async def get_task(task_id: str) -> Task | None:
    """Get a task by ID."""
    return await _get_task_from_storage(task_id)


async def list_tasks(status: str | None = None) -> list[Task]:
    """List tasks, optionally filtered by status."""
    return await _list_tasks_from_storage(status=status)


async def cancel_task(task_id: str) -> None:
    """Cancel a running or queued task."""
    task = await _get_task_from_storage(task_id)
    if not task:
        raise ValueError(f"Task {task_id} not found")

    if task.status == TaskStatus.QUEUED:
        if task_id in _queued:
            _queued.remove(task_id)
        await _update_status(task_id, TaskStatus.CANCELLED)
        return

    if task.status != TaskStatus.RUNNING:
        raise ValueError(f"Task {task_id} is not running (status: {task.status})")

    # Cancel asyncio task
    if asyncio_task := _running.get(task_id):
        asyncio_task.cancel()

    # Set abort event on executor
    from src.core.state import state
    if state.agent_executor:
        state.agent_executor.cancel(task.session_id)

    await _update_status(task_id, TaskStatus.CANCELLED)
    logger.info(f"Task {task_id} cancelled")


async def get_workspace(task_id: str) -> dict:
    """Get workspace info for a task (artifacts + optional git diff)."""
    task = await _get_task_from_storage(task_id)
    if not task:
        raise ValueError(f"Task {task_id} not found")

    result: dict = {
        "task_id": task_id,
        "worktree_path": task.worktree_path,
        "artifacts": [
            {"path": a.path, "type": a.type, "updated_at": a.updated_at}
            for a in task.artifacts
        ],
        "git_diff_stat": None,
    }

    if task.worktree_path:
        try:
            import subprocess
            proc = subprocess.run(
                ["git", "diff", "--stat", "HEAD"],
                cwd=task.worktree_path,
                capture_output=True,
                text=True,
                timeout=5,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                result["git_diff_stat"] = proc.stdout.strip()
        except Exception:
            pass

    return result


async def get_file_preview(task_id: str, file_path: str) -> str:
    """Read a file from a task's workspace."""
    task = await _get_task_from_storage(task_id)
    if not task:
        raise ValueError(f"Task {task_id} not found")

    base = Path(task.worktree_path) if task.worktree_path else _workspace
    full_path = (base / file_path).resolve()

    # Security: ensure path stays within workspace
    try:
        full_path.relative_to(base.resolve())
    except ValueError:
        raise ValueError(f"Path {file_path} is outside workspace")

    if not full_path.exists():
        raise FileNotFoundError(f"File {file_path} not found")

    return full_path.read_text(errors="replace")[:50000]  # cap at 50KB


async def recover_interrupted_tasks() -> None:
    """On server startup, recover tasks that were running when server stopped.

    RUNNING tasks have lost their in-memory executor state.
    PENDING/QUEUED tasks have lost their request data (_task_requests is empty on restart).
    All of these are unrecoverable without checkpoints, so mark them as failed.
    """
    for status in (TaskStatus.RUNNING, TaskStatus.PENDING, TaskStatus.QUEUED):
        stuck_tasks = await _list_tasks_from_storage(status=status.value)
        for task in stuck_tasks:
            await _update_status(
                task.id,
                TaskStatus.FAILED,
                error="服务重启，任务中断",
            )
            logger.warning(f"Task {task.id} ({status.value}) marked failed after restart")


# =============================================================================
# Internal Execution
# =============================================================================

async def _run_task(task_id: str) -> None:
    """Execute a task in the background (fire-and-forget)."""
    from src.core.state import state
    from src.provider import get_default_model
    from src.bus.events import (
        ToolExecuting, ToolExecuted,
    )

    task = await _get_task_from_storage(task_id)
    if not task:
        logger.error(f"Task {task_id} not found in storage, cannot run")
        return

    request = _task_requests.pop(task_id, {})
    prompt = request.get("prompt", "")
    model = request.get("model")
    use_worktree = request.get("use_worktree", False)

    current = asyncio.current_task()
    if current is not None:
        _running[task_id] = current

    try:
        # Setup worktree if requested
        worktree_path = await _setup_worktree(task) if use_worktree else None

        # Update status to running
        now = int(time.time() * 1000)
        task.status = TaskStatus.RUNNING
        task.started_at = now
        task.updated_at = now
        if worktree_path:
            task.worktree_path = worktree_path
        await _save_task(task)
        await _publish_status_changed(task.id, TaskStatus.RUNNING, TaskStatus.PENDING)

        # Resolve model
        if not model:
            model = await get_default_model()

        executor = state.agent_executor
        if not executor:
            raise RuntimeError("AgentExecutor not available")

        # Subscribe to tool events for artifact tracking and progress updates
        from src import get_global_bus
        bus = get_global_bus()

        async def on_tool_executing(event: Any) -> None:
            if event.properties.session_id != task.session_id:
                return
            action_desc = f"{event.properties.tool_name}: {_format_args(event.properties.arguments)}"
            await _update_task_fields(
                task_id,
                current_action=action_desc[:200],
                updated_at=int(time.time() * 1000),
            )
            await _publish_progress(task_id, task.progress, action_desc)

        async def on_tool_executed(event: Any) -> None:
            if event.properties.session_id != task.session_id:
                return
            if not event.properties.success:
                return
            if event.properties.tool_name not in ("write", "edit"):
                return
            output = event.properties.output
            file_path = None
            if isinstance(output, dict):
                file_path = output.get("file_path") or output.get("path")
            if file_path:
                await _add_artifact(task_id, file_path)

        unsub_executing = bus.subscribe(ToolExecuting, on_tool_executing)
        unsub_executed = bus.subscribe(ToolExecuted, on_tool_executed)

        try:
            # Execute via existing executor; raise on error event so task is marked FAILED
            async for event in executor.execute_stream(
                session_id=task.session_id,
                parts=[{"type": "text", "text": prompt}],
                model=model,
                agent=task.agent_id,
            ):
                if event.event == "error":
                    error_msg = event.data.get("message", "Agent execution failed")
                    raise RuntimeError(error_msg)
        finally:
            unsub_executing()
            unsub_executed()

        # Completed successfully
        now = int(time.time() * 1000)
        await _update_task_fields(
            task_id,
            status=TaskStatus.COMPLETED.value,
            current_action=None,
            updated_at=now,
            completed_at=now,
        )
        await _publish_status_changed(task_id, TaskStatus.COMPLETED, TaskStatus.RUNNING)

        task_final = await _get_task_from_storage(task_id)
        await _publish_task_completed(task_id, task_final)
        logger.info(f"Task {task_id} completed")

    except asyncio.CancelledError:
        now = int(time.time() * 1000)
        await _update_task_fields(
            task_id,
            status=TaskStatus.CANCELLED.value,
            current_action=None,
            updated_at=now,
            completed_at=now,
        )
        logger.info(f"Task {task_id} cancelled")
        raise

    except Exception as exc:
        now = int(time.time() * 1000)
        await _update_task_fields(
            task_id,
            status=TaskStatus.FAILED.value,
            error=str(exc)[:500],
            current_action=None,
            updated_at=now,
            completed_at=now,
        )
        await _publish_task_failed(task_id, str(exc))
        logger.error(f"Task {task_id} failed: {exc}", exc_info=True)

    finally:
        _running.pop(task_id, None)
        # Start next queued task if any
        asyncio.create_task(_start_next_queued())


async def _start_next_queued() -> None:
    """Start the next queued task if concurrency allows."""
    running_count = len(_running)
    if running_count >= MAX_CONCURRENT_TASKS or not _queued:
        return
    next_id = _queued.pop(0)
    asyncio.create_task(_run_task(next_id))


async def _setup_worktree(task: Task) -> str | None:
    """Create a git worktree for isolated task execution."""
    import subprocess
    worktree_dir = _workspace / ".talor" / "tasks" / task.id / "worktree"
    branch = f"task/{task.id[:12]}"
    try:
        worktree_dir.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            ["git", "worktree", "add", str(worktree_dir), "-b", branch],
            cwd=str(_workspace),
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode == 0:
            logger.info(f"Created worktree at {worktree_dir}")
            return str(worktree_dir)
        else:
            logger.warning(f"Failed to create worktree: {result.stderr}")
            return None
    except Exception as e:
        logger.warning(f"Worktree setup failed: {e}")
        return None


async def _add_artifact(task_id: str, file_path: str) -> None:
    """Add a file artifact to a task."""
    task = await _get_task_from_storage(task_id)
    if not task:
        return
    now = int(time.time() * 1000)
    # Deduplicate by path
    existing_paths = {a.path for a in task.artifacts}
    if file_path in existing_paths:
        # Update updated_at
        updated = [
            TaskArtifact(path=a.path, type=a.type, updated_at=now if a.path == file_path else a.updated_at)
            for a in task.artifacts
        ]
    else:
        artifact = TaskArtifact(path=file_path, type="file", updated_at=now)
        updated = task.artifacts + [artifact]
        await _publish_artifact_added(task_id, task.session_id, file_path)

    artifacts_json = json.dumps([
        {"path": a.path, "type": a.type, "updated_at": a.updated_at}
        for a in updated
    ])
    await _update_task_fields(task_id, artifacts=artifacts_json, updated_at=now)


def _format_args(arguments: dict) -> str:
    """Format tool arguments into a short description."""
    if not arguments:
        return ""
    # Show first key-value pair
    k, v = next(iter(arguments.items()))
    v_str = str(v)[:60]
    if len(v_str) < len(str(v)):
        v_str += "..."
    return f"{k}={v_str}"


async def _update_status(task_id: str, status: TaskStatus, error: str | None = None) -> None:
    now = int(time.time() * 1000)
    fields: dict = {"status": status.value, "updated_at": now}
    if status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
        fields["completed_at"] = now
    if error:
        fields["error"] = error
    await _update_task_fields(task_id, **fields)


# =============================================================================
# Event Publishing
# =============================================================================

async def _publish_task_created(task: Task) -> None:
    try:
        from src import get_global_bus
        from src.bus.events import TaskCreated, TaskCreatedData
        bus = get_global_bus()
        await bus.publish(
            TaskCreated,
            TaskCreatedData(
                task_id=task.id,
                session_id=task.session_id,
                agent_id=task.agent_id,
                title=task.title,
            ),
        )
    except Exception as e:
        logger.debug(f"Failed to publish task.created: {e}")


async def _publish_status_changed(
    task_id: str, status: TaskStatus, previous: TaskStatus
) -> None:
    try:
        from src import get_global_bus
        from src.bus.events import TaskStatusChanged, TaskStatusChangedData
        task = await _get_task_from_storage(task_id)
        bus = get_global_bus()
        await bus.publish(
            TaskStatusChanged,
            TaskStatusChangedData(
                task_id=task_id,
                session_id=task.session_id if task else "",
                status=status.value,
                previous_status=previous.value,
            ),
        )
    except Exception as e:
        logger.debug(f"Failed to publish task.status_changed: {e}")


async def _publish_progress(task_id: str, progress: int, current_action: str | None) -> None:
    try:
        from src import get_global_bus
        from src.bus.events import TaskProgress, TaskProgressData
        task = await _get_task_from_storage(task_id)
        bus = get_global_bus()
        await bus.publish(
            TaskProgress,
            TaskProgressData(
                task_id=task_id,
                session_id=task.session_id if task else "",
                progress=progress,
                current_action=current_action,
            ),
        )
    except Exception as e:
        logger.debug(f"Failed to publish task.progress: {e}")


async def _publish_artifact_added(task_id: str, session_id: str, path: str) -> None:
    try:
        from src import get_global_bus
        from src.bus.events import TaskArtifactAdded, TaskArtifactAddedData
        bus = get_global_bus()
        await bus.publish(
            TaskArtifactAdded,
            TaskArtifactAddedData(
                task_id=task_id,
                session_id=session_id,
                path=path,
                artifact_type="file",
            ),
        )
    except Exception as e:
        logger.debug(f"Failed to publish task.artifact_added: {e}")


async def _publish_task_completed(task_id: str, task: Task | None) -> None:
    try:
        from src import get_global_bus
        from src.bus.events import TaskCompleted, TaskCompletedData
        bus = get_global_bus()
        elapsed = 0
        if task and task.started_at and task.completed_at:
            elapsed = task.completed_at - task.started_at
        await bus.publish(
            TaskCompleted,
            TaskCompletedData(
                task_id=task_id,
                session_id=task.session_id if task else "",
                result=task.result if task else None,
                artifacts_count=len(task.artifacts) if task else 0,
                elapsed_ms=float(elapsed),
            ),
        )
    except Exception as e:
        logger.debug(f"Failed to publish task.completed: {e}")


async def _publish_task_failed(task_id: str, error: str) -> None:
    try:
        from src import get_global_bus
        from src.bus.events import TaskFailed, TaskFailedData
        task = await _get_task_from_storage(task_id)
        bus = get_global_bus()
        await bus.publish(
            TaskFailed,
            TaskFailedData(
                task_id=task_id,
                session_id=task.session_id if task else "",
                error=error,
            ),
        )
    except Exception as e:
        logger.debug(f"Failed to publish task.failed: {e}")
