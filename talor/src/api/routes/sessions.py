"""Session Routes."""

from fastapi import APIRouter, HTTPException, Depends

from src.api.models import SessionCreateRequest, SessionResponse
from src.core.container import get_container
from src.session.service import SessionService


router = APIRouter()


def get_session_service() -> SessionService:
    """Get session service from container."""
    return get_container().session_service


@router.get("", response_model=list[SessionResponse])
async def list_sessions(
    service: SessionService = Depends(get_session_service),
) -> list[SessionResponse]:
    """List all sessions."""
    sessions = await service.list_sessions()
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
async def create_session(
    request: SessionCreateRequest,
    service: SessionService = Depends(get_session_service),
) -> SessionResponse:
    """Create a new session."""
    session = await service.create_session(
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
async def get_session(
    session_id: str,
    service: SessionService = Depends(get_session_service),
) -> SessionResponse:
    """Get a session by ID."""
    session = await service.get_session(session_id)
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
async def delete_session(
    session_id: str,
    service: SessionService = Depends(get_session_service),
) -> dict:
    """Delete a session."""
    session = await service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await service.delete_session(session_id)
    return {"status": "deleted"}


@router.get("/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    service: SessionService = Depends(get_session_service),
) -> list[dict]:
    """Get messages for a session."""
    session = await service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Use instance property directly
    return [msg.to_dict() for msg in session.messages]
