"""SSE and WebSocket Event Routes."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from starlette.responses import StreamingResponse

from src.core.state import state, SSEClient


logger = logging.getLogger(__name__)
router = APIRouter()


# Event history for reconnection support
_event_history: dict[str, list[dict]] = {}
_event_counter: int = 0
_max_history_per_session: int = 1000


async def store_event(event_data: dict) -> int:
    """Store event in history and return event ID."""
    global _event_counter
    _event_counter += 1
    event_id = _event_counter

    session_id = event_data.get("properties", {}).get("session_id", "_global")

    if session_id not in _event_history:
        _event_history[session_id] = []

    event_with_id = {**event_data, "id": event_id}
    _event_history[session_id].append(event_with_id)

    if len(_event_history[session_id]) > _max_history_per_session:
        _event_history[session_id] = _event_history[session_id][-_max_history_per_session:]

    return event_id


def get_events_since(last_event_id: int, session_id: str | None = None) -> list[dict]:
    """Get events since a given event ID."""
    events = []

    if session_id:
        session_events = _event_history.get(session_id, [])
        events.extend([e for e in session_events if e.get("id", 0) > last_event_id])
    else:
        for session_events in _event_history.values():
            events.extend([e for e in session_events if e.get("id", 0) > last_event_id])

    events.sort(key=lambda e: e.get("id", 0))
    return events


async def sse_event_generator(client: SSEClient, last_event_id: int | None = None):
    """Generate SSE events from queue with reconnection support."""
    if last_event_id is not None:
        if client.subscribe_all:
            missed_events = get_events_since(last_event_id)
        else:
            missed_events = []
            for session_id in client.subscribed_sessions:
                missed_events.extend(get_events_since(last_event_id, session_id))
            missed_events.extend(get_events_since(last_event_id, "_global"))
            missed_events.sort(key=lambda e: e.get("id", 0))

        for event in missed_events:
            event_id = event.get("id", 0)
            event_data = {k: v for k, v in event.items() if k != "id"}
            yield f"id: {event_id}\ndata: {json.dumps(event_data)}\n\n"

    try:
        while True:
            try:
                event = await asyncio.wait_for(client.queue.get(), timeout=30.0)
                event_id = await store_event(event)
                yield f"id: {event_id}\ndata: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
    except asyncio.CancelledError:
        pass


@router.get("/event")
async def event_stream(request: Request):
    """SSE event stream for real-time updates."""
    last_event_id_str = request.headers.get("Last-Event-ID")
    last_event_id = int(last_event_id_str) if last_event_id_str else None

    client = SSEClient()
    state.sse_clients.append(client)

    async def generate():
        try:
            async for event in sse_event_generator(client, last_event_id):
                yield event
        finally:
            if client in state.sse_clients:
                state.sse_clients.remove(client)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time updates."""
    await websocket.accept()
    state.websockets.append(websocket)

    logger.info(f"WebSocket connected. Total: {len(state.websockets)}")

    try:
        while True:
            data = await websocket.receive_text()

            try:
                message = json.loads(data)
                event_type = message.get("type")
                payload = message.get("payload", {})

                if event_type == "ping":
                    await websocket.send_json({"type": "pong"})
                elif event_type == "subscribe":
                    await websocket.send_json({
                        "type": "subscribed",
                        "payload": {"channel": payload.get("channel")},
                    })
                else:
                    logger.debug(f"Unknown WebSocket event: {event_type}")

            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON: {data}")

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if websocket in state.websockets:
            state.websockets.remove(websocket)
