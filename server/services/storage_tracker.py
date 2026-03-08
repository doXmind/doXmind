"""Storage quota tracking service.

Tracks per-user storage usage across images, KB attachments, and data files.
Enforces plan-based storage limits on file uploads.
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import UserSubscription
from exceptions import StorageLimitExceededError

logger = logging.getLogger(__name__)

# Plan storage limits in bytes
PLAN_STORAGE_LIMITS = {
    "free": 100 * 1024 * 1024,       # 100 MB
    "pro": 500 * 1024 * 1024,        # 500 MB
    "max": 2 * 1024 * 1024 * 1024,   # 2 GB
}


class StorageTracker:
    """Tracks and enforces per-user storage quotas."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _get_subscription(self, user_id: str) -> UserSubscription | None:
        """Get user subscription record."""
        result = await self.db.execute(
            select(UserSubscription).where(UserSubscription.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def check_storage_limit(self, user_id: str, file_size: int) -> None:
        """Check if uploading a file would exceed storage limit.

        Raises StorageLimitExceededError if the upload would exceed the limit.

        Note: For race-safe check + add, prefer check_and_add_usage() instead.
        """
        sub = await self._get_subscription(user_id)
        if sub is None:
            # No subscription record = free tier defaults
            limit = PLAN_STORAGE_LIMITS["free"]
            used = 0
        else:
            limit = sub.storage_limit_bytes
            used = sub.storage_used_bytes

        if used + file_size > limit:
            raise StorageLimitExceededError(
                used_bytes=used,
                limit_bytes=limit,
                file_size=file_size,
            )

    async def check_and_add_usage(self, user_id: str, file_size: int) -> int:
        """Atomically check storage limit and record usage with row lock.

        Uses SELECT FOR UPDATE to prevent concurrent uploads from exceeding
        the storage quota through race conditions.

        Raises StorageLimitExceededError if the upload would exceed the limit.

        Returns:
            New total storage used in bytes.
        """
        result = await self.db.execute(
            select(UserSubscription)
            .where(UserSubscription.user_id == user_id)
            .with_for_update()
        )
        sub = result.scalar_one_or_none()

        if sub is None:
            limit = PLAN_STORAGE_LIMITS["free"]
            if file_size > limit:
                raise StorageLimitExceededError(
                    used_bytes=0, limit_bytes=limit, file_size=file_size
                )
            logger.warning(f"No subscription record for user {user_id}, skipping storage tracking")
            return 0

        if sub.storage_used_bytes + file_size > sub.storage_limit_bytes:
            raise StorageLimitExceededError(
                used_bytes=sub.storage_used_bytes,
                limit_bytes=sub.storage_limit_bytes,
                file_size=file_size,
            )

        sub.storage_used_bytes += file_size
        await self.db.commit()

        logger.info(
            f"Storage usage for {user_id}: +{file_size} bytes "
            f"(total: {sub.storage_used_bytes}/{sub.storage_limit_bytes})"
        )
        return sub.storage_used_bytes

    async def add_usage(self, user_id: str, file_size: int) -> int:
        """Record storage usage after a successful upload.

        Returns:
            New total storage used in bytes.
        """
        sub = await self._get_subscription(user_id)
        if sub is None:
            logger.warning(f"No subscription record for user {user_id}, skipping storage tracking")
            return 0

        sub.storage_used_bytes += file_size
        await self.db.commit()

        logger.info(
            f"Storage usage for {user_id}: +{file_size} bytes "
            f"(total: {sub.storage_used_bytes}/{sub.storage_limit_bytes})"
        )
        return sub.storage_used_bytes

    async def remove_usage(self, user_id: str, file_size: int) -> int:
        """Reduce storage usage after a file deletion.

        Returns:
            New total storage used in bytes.
        """
        sub = await self._get_subscription(user_id)
        if sub is None:
            return 0

        sub.storage_used_bytes = max(0, sub.storage_used_bytes - file_size)
        await self.db.commit()

        logger.info(
            f"Storage usage for {user_id}: -{file_size} bytes "
            f"(total: {sub.storage_used_bytes}/{sub.storage_limit_bytes})"
        )
        return sub.storage_used_bytes

    async def get_usage(self, user_id: str) -> dict:
        """Get storage usage info formatted for the API response."""
        sub = await self._get_subscription(user_id)
        if sub is None:
            return {
                "used_bytes": 0,
                "limit_bytes": PLAN_STORAGE_LIMITS["free"],
            }

        return {
            "used_bytes": sub.storage_used_bytes,
            "limit_bytes": sub.storage_limit_bytes,
        }

    async def update_plan_limit(self, user_id: str, plan: str) -> None:
        """Update storage limit when plan changes."""
        sub = await self._get_subscription(user_id)
        if sub is None:
            return

        new_limit = PLAN_STORAGE_LIMITS.get(plan, PLAN_STORAGE_LIMITS["free"])
        sub.storage_limit_bytes = new_limit
        await self.db.commit()

        logger.info(f"Storage limit updated for {user_id}: {new_limit} bytes ({plan} plan)")
