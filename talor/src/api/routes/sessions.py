"""Session Routes."""

from fastapi import APIRouter, HTTPException

from src.api.models import SessionCreateRequest, SessionResponse
from src.session import Session


router = APIRouter()


@router.get("", response_model=list[SessionResponse])
async def list_sessions() -> list[SessionResponse]:
    """List all sessions."""
    sessions = await Session.list()
    return [
        SessionResponse(
            id=s.id,
            title=s.title,
            directory=s.directory,
            parent_id=s.parent_id,
            time=s.time,
        )
        for s in sessions
    ]


@router.post("", response_model=SessionResponse)
async def create_session(request: SessionCreateRequest) -> SessionResponse:
    """Create a new session."""
    session = await Session.create(
        title=request.title,
        parent_id=request.parent_id,
    )
    return SessionResponse(
        id=session.id,
        title=session.title,
        directory=session.directory,
        parent_id=session.parent_id,
        time=session.time,
    )


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str) -> SessionResponse:
    """Get a session by ID."""
    session = await Session.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return SessionResponse(
        id=session.id,
        title=session.title,
        directory=session.directory,
        parent_id=session.parent_id,
        time=session.time,
    )


@router.delete("/{session_id}")
async def delete_session(session_id: str) -> dict:
    """Delete a session."""
    session = await Session.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await Session.delete(session_id)
    return {"status": "deleted"}


@router.get("/{session_id}/messages")
async def get_session_messages(session_id: str) -> list[dict]:
    """Get messages for a session."""
    session = await Session.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = await Session.messages(session_id)
    return [msg.to_dict() for msg in messages]
