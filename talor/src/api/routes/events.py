"""SSE and WebSocket Event Routes."""

from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from starlette.responses import StreamingResponse

from src.core.state import state


logger = logging.getLogger(__name__)
router = APIRouter()


# Event history for reconnection support
_event_history: list[dict] = []
_event_counter: int = 0
_max_history: int = 1000


async def store_event(event_data: dict) -> int:
    """Store event in history and return event ID."""
    global _event_counter
    _event_counter += 1

    event_with_id = {**event_data, "id": _event_counter}
    _event_history.append(event_with_id)

    # Trim old events
    if len(_event_history) > _max_history:
        _event_history[:] = _event_history[-_max_history:]

    return _event_counter


def get_events_since(last_event_id: int) -> list[dict]:
    """Get events since a given event ID."""
    return [e for e in _event_history if e.get("id", 0) > last_event_id]


@router.get("/event")
async def event_stream(request: Request):
    """Global SSE event stream.

    Single connection for the desktop client to receive all events.

    Returns:
        StreamingResponse with SSE events
    """
    from src import get_global_bus

    global_bus = get_global_bus()
    queue: asyncio.Queue = asyncio.Queue()

    async def event_handler(event):
        event_data = {
            "type": event.type,
            "properties": event.properties.model_dump()
            if hasattr(event.properties, "model_dump")
            else event.properties,
            "timestamp": int(time.time() * 1000),
        }
        await queue.put(event_data)

    unsub = global_bus.subscribe_all(event_handler)

    async def generate():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    event_id = await store_event(event)
                    yield f"id: {event_id}\ndata: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            unsub()

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
