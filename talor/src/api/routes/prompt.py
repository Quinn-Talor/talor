"""Prompt Routes."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException
from starlette.responses import StreamingResponse
from ulid import ULID

from src.api.models import PromptRequest
from src.bus import Bus
from src.session import Session, SessionPrompt
from src.session.prompt import PromptInput
from src.provider import Provider


logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/prompt")
async def send_prompt(request: PromptRequest) -> StreamingResponse:
    """Send a prompt to the agent with SSE streaming response."""
    session = await Session.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    model = request.model
    if not model:
        model = await Provider.default_model()

    parts = [p.model_dump() for p in request.parts]

    prompt_input = PromptInput(
        session_id=request.session_id,
        parts=parts,
        model=model,
        agent=request.agent,
        no_reply=request.no_reply,
    )

    event_counter = [0]

    async def generate_sse():
        try:
            async for event in SessionPrompt.prompt_stream(prompt_input):
                event_counter[0] += 1
                data = json.dumps({
                    "event": event.event,
                    **event.data,
                })
                yield f"id: {event_counter[0]}\ndata: {data}\n\n"
        except Exception as e:
            logger.error(f"Prompt stream error: {e}", exc_info=True)
            event_counter[0] += 1
            error_data = json.dumps({
                "event": "error",
                "message": str(e),
            })
            yield f"id: {event_counter[0]}\ndata: {error_data}\n\n"

    return StreamingResponse(
        generate_sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/prompt/async")
async def send_prompt_async(request: PromptRequest) -> dict:
    """Send a prompt asynchronously (fire-and-forget)."""
    session = await Session.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    model = request.model
    if not model:
        model = await Provider.default_model()

    parts = [p.model_dump() for p in request.parts]

    prompt_input = PromptInput(
        session_id=request.session_id,
        parts=parts,
        model=model,
        agent=request.agent,
        no_reply=request.no_reply,
    )

    message_id = f"message_{ULID()}"

    async def process_in_background():
        try:
            async for event in SessionPrompt.prompt_stream(prompt_input):
                pass
        except Exception as e:
            logger.error(f"Background prompt error: {e}", exc_info=True)
            if Bus:
                from src.bus.events import StreamError, StreamErrorData
                await Bus.publish(
                    StreamError,
                    StreamErrorData(
                        session_id=request.session_id,
                        message_id=None,
                        error=str(e),
                    )
                )

    asyncio.create_task(process_in_background())

    return {
        "status": "processing",
        "session_id": request.session_id,
        "message_id": message_id,
    }


@router.post("/prompt/sync")
async def send_prompt_sync(request: PromptRequest) -> dict:
    """Send a prompt to the agent (synchronous, non-streaming)."""
    session = await Session.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    model = request.model
    if not model:
        model = await Provider.default_model()

    parts = [p.model_dump() for p in request.parts]

    prompt_input = PromptInput(
        session_id=request.session_id,
        parts=parts,
        model=model,
        agent=request.agent,
        no_reply=request.no_reply,
    )

    try:
        result = await SessionPrompt.prompt(prompt_input)

        return {
            "session_id": request.session_id,
            "message_id": result.info.id,
            "content": result.get_text_content(),
            "parts": [p.model_dump() if hasattr(p, "model_dump") else p for p in result.parts],
        }
    except Exception as e:
        logger.error(f"Prompt error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{session_id}/cancel")
async def cancel_session(session_id: str) -> dict:
    """Cancel processing for a session."""
    SessionPrompt.cancel(session_id)
    return {"status": "cancelled"}
