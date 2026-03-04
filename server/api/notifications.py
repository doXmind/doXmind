"""In-app notification API endpoints."""

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_cors_headers, get_settings
from db.database import get_db
from middleware.rate_limit import limiter
from services.auth_service import TokenData, require_auth
from services.notification_broadcaster import notification_broadcaster
from services.notification_service import NotificationService

logger = logging.getLogger(__name__)
router = APIRouter()


def get_user_id(token: TokenData) -> str | None:
    """Get user ID from token for data isolation."""
    if token.sub in ("dev-user", "api-key-user", "anonymous"):
        return None
    return token.sub


@router.get("")
@limiter.limit("60/minute")
async def list_notifications(
    request: Request,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """List notifications for the current user, newest first."""
    user_id = get_user_id(token)
    if not user_id:
        return {"notifications": [], "total": 0, "has_more": False}

    service = NotificationService(db)
    items, total = await service.list_for_user(user_id, offset, limit)

    return {
        "notifications": items,
        "total": total,
        "has_more": offset + limit < total,
    }


@router.get("/unread-count")
@limiter.limit("120/minute")
async def get_unread_count(
    request: Request,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Return unread notification count."""
    user_id = get_user_id(token)
    if not user_id:
        return {"count": 0}

    service = NotificationService(db)
    count = await service.unread_count(user_id)

    return {"count": count}


@router.get("/stream")
async def notification_stream(
    request: Request,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """SSE stream for real-time notification push."""
    user_id = get_user_id(token)
    if not user_id:
        return StreamingResponse(
            iter([b'data: {"event": "error", "message": "Auth required"}\n\n']),
            media_type="text/event-stream",
        )

    settings = get_settings()
    origin = request.headers.get("origin")
    heartbeat_interval = settings.streaming_heartbeat_interval

    service = NotificationService(db)
    initial_count = await service.unread_count(user_id)

    queue = notification_broadcaster.subscribe(user_id)

    async def event_generator():
        try:
            connected = json.dumps(
                {"event": "connected", "unread_count": initial_count}
            )
            yield f"data: {connected}\n\n".encode()

            while True:
                try:
                    event = await asyncio.wait_for(
                        queue.get(), timeout=heartbeat_interval
                    )
                    data = json.dumps(event, ensure_ascii=False)
                    yield f"data: {data}\n\n".encode()
                except TimeoutError:
                    yield b'data: {"event": "heartbeat"}\n\n'

                if await request.is_disconnected():
                    break
        except asyncio.CancelledError:
            pass
        finally:
            notification_broadcaster.unsubscribe(user_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Content-Type": "text/event-stream; charset=utf-8",
            **get_cors_headers(origin),
        },
    )


@router.patch("/{notification_id}/read")
@limiter.limit("60/minute")
async def mark_read(
    request: Request,
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Mark a single notification as read."""
    user_id = get_user_id(token)
    if not user_id:
        return {"status": "ok"}

    service = NotificationService(db)
    await service.mark_read(notification_id, user_id)

    # Broadcast updated count to other tabs
    new_count = await service.unread_count(user_id)
    await notification_broadcaster.publish(
        user_id, {"event": "unread_count", "unread_count": new_count}
    )

    return {"status": "ok"}


@router.patch("/read-all")
@limiter.limit("10/minute")
async def mark_all_read(
    request: Request,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Mark all notifications as read for the current user."""
    user_id = get_user_id(token)
    if not user_id:
        return {"status": "ok", "updated": 0}

    service = NotificationService(db)
    updated = await service.mark_all_read(user_id)

    # Broadcast zero count to other tabs
    await notification_broadcaster.publish(
        user_id, {"event": "unread_count", "unread_count": 0}
    )

    return {"status": "ok", "updated": updated}
