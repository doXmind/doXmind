"""In-app notification service."""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import Notification

RETENTION_DAYS = 90

logger = logging.getLogger(__name__)


class NotificationService:
    """Service for creating and managing in-app notifications."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(
        self,
        *,
        user_id: str,
        type: str,
        title: str,
        message: str,
        link: str | None = None,
        actor_id: str | None = None,
        actor_name: str | None = None,
        actor_avatar: str | None = None,
    ) -> Notification:
        """Create a notification record."""
        notification = Notification(
            id=str(uuid.uuid4()),
            user_id=user_id,
            type=type,
            title=title,
            message=message,
            link=link,
            actor_id=actor_id,
            actor_name=actor_name,
            actor_avatar=actor_avatar,
            is_read=False,
            created_at=datetime.now(UTC),
        )
        self.db.add(notification)
        await self.db.commit()
        return notification

    async def list_for_user(
        self, user_id: str, offset: int = 0, limit: int = 20
    ) -> tuple[list[dict], int]:
        """Return paginated notifications within retention window, newest first."""
        cutoff = datetime.now(UTC) - timedelta(days=RETENTION_DAYS)

        # Lazy cleanup: delete expired notifications
        await self.db.execute(
            delete(Notification).where(
                Notification.user_id == user_id,
                Notification.created_at < cutoff,
            )
        )
        await self.db.commit()

        # Total count (within retention window)
        count_result = await self.db.execute(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.created_at >= cutoff,
            )
        )
        total = count_result.scalar() or 0

        # Fetch items
        result = await self.db.execute(
            select(Notification)
            .where(Notification.user_id == user_id, Notification.created_at >= cutoff)
            .order_by(Notification.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        notifications = result.scalars().all()

        items = [
            {
                "id": n.id,
                "type": n.type,
                "title": n.title,
                "message": n.message,
                "link": n.link,
                "actor_id": n.actor_id,
                "actor_name": n.actor_name,
                "actor_avatar": n.actor_avatar,
                "is_read": n.is_read,
                "created_at": n.created_at.isoformat() if n.created_at else "",
            }
            for n in notifications
        ]

        return items, total

    async def unread_count(self, user_id: str) -> int:
        """Return count of unread notifications."""
        result = await self.db.execute(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.is_read == False,  # noqa: E712
            )
        )
        return result.scalar() or 0

    async def mark_read(self, notification_id: str, user_id: str) -> bool:
        """Mark a single notification as read. Returns True if found."""
        result = await self.db.execute(
            update(Notification)
            .where(Notification.id == notification_id, Notification.user_id == user_id)
            .values(is_read=True)
        )
        await self.db.commit()
        return result.rowcount > 0

    async def mark_all_read(self, user_id: str) -> int:
        """Mark all notifications as read for a user. Returns count updated."""
        result = await self.db.execute(
            update(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.is_read == False,  # noqa: E712
            )
            .values(is_read=True)
        )
        await self.db.commit()
        return result.rowcount

    async def cleanup_old(self, user_id: str) -> int:
        """Delete notifications older than RETENTION_DAYS for a user."""
        cutoff = datetime.now(UTC) - timedelta(days=RETENTION_DAYS)
        result = await self.db.execute(
            delete(Notification).where(
                Notification.user_id == user_id,
                Notification.created_at < cutoff,
            )
        )
        await self.db.commit()
        return result.rowcount


async def create_notification(
    *,
    user_id: str,
    type: str,
    title: str,
    message: str,
    link: str | None = None,
    actor_id: str | None = None,
    actor_name: str | None = None,
    actor_avatar: str | None = None,
) -> None:
    """Fire-and-forget helper to create a notification using a fresh session."""
    try:
        from db.database import User, async_session

        async with async_session() as session:
            # Auto-lookup actor avatar if not provided
            if actor_id and not actor_avatar:
                result = await session.execute(select(User.avatar_url).where(User.id == actor_id))
                row = result.one_or_none()
                if row and row.avatar_url:
                    actor_avatar = row.avatar_url

            service = NotificationService(session)
            notification = await service.create(
                user_id=user_id,
                type=type,
                title=title,
                message=message,
                link=link,
                actor_id=actor_id,
                actor_name=actor_name,
                actor_avatar=actor_avatar,
            )

            # Broadcast to connected SSE clients
            from services.notification_broadcaster import notification_broadcaster

            new_count = await service.unread_count(user_id)
            await notification_broadcaster.publish(
                user_id,
                {
                    "event": "notification",
                    "notification": {
                        "id": notification.id,
                        "type": notification.type,
                        "title": notification.title,
                        "message": notification.message,
                        "link": notification.link,
                        "actor_id": notification.actor_id,
                        "actor_name": notification.actor_name,
                        "actor_avatar": notification.actor_avatar,
                        "is_read": notification.is_read,
                        "created_at": (
                            notification.created_at.isoformat() if notification.created_at else ""
                        ),
                    },
                    "unread_count": new_count,
                },
            )
    except Exception:
        logger.exception("Failed to create notification")
