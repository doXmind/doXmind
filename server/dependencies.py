"""FastAPI Dependencies — local desktop edition (no auth)."""

import logging
import uuid
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import Conversation, async_session

logger = logging.getLogger(__name__)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db)]


async def resolve_user_api_key(
    user_id: str | None = None, db: AsyncSession | None = None
) -> str | None:  # noqa: ARG001
    """Return the active provider's API key, if any."""
    from provider.registry import active_api_key

    key = active_api_key()
    return key or None


def normalize_file_id(file_id: str | None) -> str | None:
    if file_id == "" or file_id is None:
        return None
    return file_id


async def get_conversation_by_file_id(
    file_id: str,
    db: AsyncSession,
    create_if_missing: bool = False,
    user_id: str | None = None,  # noqa: ARG001 — kept for call-site compatibility
):
    """Get or optionally create a conversation by file_id."""
    normalized_file_id = normalize_file_id(file_id)

    conv = await db.get(Conversation, file_id)
    if conv:
        return conv

    if normalized_file_id is None:
        query = select(Conversation).where(Conversation.file_id.is_(None))
    else:
        query = select(Conversation).where(Conversation.file_id == normalized_file_id)

    query = query.order_by(Conversation.created_at.desc()).limit(1)
    result = await db.execute(query)
    conv = result.scalar_one_or_none()
    if conv:
        return conv

    if create_if_missing:
        conv = Conversation(id=str(uuid.uuid4()), file_id=normalized_file_id)
        db.add(conv)
        await db.commit()
        await db.refresh(conv)
        return conv

    return None
