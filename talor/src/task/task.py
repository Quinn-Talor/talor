"""Task entity — background task data model."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum


class TaskStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class TaskArtifact:
    path: str           # relative path within worktree/workspace
    type: str           # "file" | "directory"
    updated_at: int     # Unix ms


@dataclass
class Task:
    id: str
    session_id: str
    agent_id: str
    title: str
    status: TaskStatus = TaskStatus.PENDING
    progress: int = 0
    current_action: str | None = None
    artifacts: list[TaskArtifact] = field(default_factory=list)
    checkpoint_path: str | None = None
    worktree_path: str | None = None
    result: str | None = None
    error: str | None = None
    created_at: int = 0
    updated_at: int = 0
    started_at: int | None = None
    completed_at: int | None = None

    def to_db_row(self) -> dict:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "title": self.title,
            "status": self.status.value,
            "progress": self.progress,
            "current_action": self.current_action,
            "artifacts": json.dumps([
                {"path": a.path, "type": a.type, "updated_at": a.updated_at}
                for a in self.artifacts
            ]),
            "checkpoint_path": self.checkpoint_path,
            "worktree_path": self.worktree_path,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
        }

    @classmethod
    def from_db_row(cls, row: dict) -> "Task":
        artifacts_raw = json.loads(row.get("artifacts") or "[]")
        artifacts = [
            TaskArtifact(
                path=a["path"],
                type=a.get("type", "file"),
                updated_at=a.get("updated_at", 0),
            )
            for a in artifacts_raw
        ]
        return cls(
            id=row["id"],
            session_id=row["session_id"],
            agent_id=row["agent_id"],
            title=row["title"],
            status=TaskStatus(row["status"]),
            progress=row.get("progress", 0) or 0,
            current_action=row.get("current_action"),
            artifacts=artifacts,
            checkpoint_path=row.get("checkpoint_path"),
            worktree_path=row.get("worktree_path"),
            result=row.get("result"),
            error=row.get("error"),
            created_at=row.get("created_at", 0) or 0,
            updated_at=row.get("updated_at", 0) or 0,
            started_at=row.get("started_at"),
            completed_at=row.get("completed_at"),
        )
