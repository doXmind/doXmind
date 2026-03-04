"""In-process notification event broadcaster for SSE push."""

import asyncio
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)


class NotificationBroadcaster:
    """Manages SSE connections for real-time notification delivery.

    Supports multiple concurrent connections per user (multiple tabs).
    Single-server only; for multi-server, replace with Redis pub/sub.
    """

    def __init__(self):
        self._subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)

    def subscribe(self, user_id: str) -> asyncio.Queue:
        """Register a new SSE connection. Returns a Queue to await events on."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._subscribers[user_id].add(queue)
        logger.info(
            "SSE subscribe: user=%s, connections=%d",
            user_id,
            len(self._subscribers[user_id]),
        )
        return queue

    def unsubscribe(self, user_id: str, queue: asyncio.Queue) -> None:
        """Remove an SSE connection."""
        queues = self._subscribers.get(user_id)
        if queues:
            queues.discard(queue)
            if not queues:
                del self._subscribers[user_id]
        logger.info(
            "SSE unsubscribe: user=%s, remaining=%d",
            user_id,
            len(self._subscribers.get(user_id, set())),
        )

    async def publish(self, user_id: str, event: dict) -> None:
        """Push an event to all SSE connections for a user.

        Drops the event for any queue that is full (backpressure).
        """
        queues = self._subscribers.get(user_id)
        if not queues:
            return

        for queue in list(queues):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("SSE queue full for user=%s, dropping event", user_id)


# Module-level singleton
notification_broadcaster = NotificationBroadcaster()
