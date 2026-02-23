"""FastAPI Dependencies.

This module provides dependency injection for services used across the API.
Using DI ensures consistent service usage and easier testing.
"""

import logging
import uuid
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import Conversation, async_session
from services.rag_service import RAGService

logger = logging.getLogger(__name__)

# ============================================================================
# Database Dependencies
# ============================================================================


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Get database session dependency.

    Usage:
        @router.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with async_session() as session:
        yield session


# Type alias for cleaner dependency injection
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ============================================================================
# Service Dependencies
# ============================================================================


async def get_rag_service(db: AsyncSession = Depends(get_db)) -> RAGService:
    """Get RAG service with database session.

    Usage:
        @router.post("/search")
        async def search(
            request: SearchRequest,
            rag: RAGService = Depends(get_rag_service)
        ):
            results = await rag.search(request.query)
            ...
    """
    return RAGService(db)


async def resolve_user_api_key(user_id: str, db: AsyncSession) -> str | None:
    """Resolve user's decrypted API key, or None if not configured.

    This is a shared helper used by multiple endpoints to pass the user's
    OpenRouter API key to services (embedding, file conversion, reranking).
    """
    try:
        from services.api_key_service import APIKeyService

        service = APIKeyService(db)
        user_settings = await service.get_user_settings(user_id)
        if service.has_api_key(user_settings):
            return await service.get_decrypted_key(user_id, settings=user_settings)
    except Exception as e:
        logger.debug(f"Could not resolve user API key: {e}")
    return None


# ============================================================================
# Conversation Lookup Helpers
# ============================================================================


def normalize_file_id(file_id: str | None) -> str | None:
    """Normalize file_id: empty string becomes None."""
    if file_id == "" or file_id is None:
        return None
    return file_id


async def get_conversation_by_file_id(
    file_id: str, db: AsyncSession, create_if_missing: bool = False
):
    """Get or optionally create a conversation by file_id.

    This consolidates the repeated conversation lookup logic.

    Args:
        file_id: The file ID to find conversation for
        db: Database session
        create_if_missing: If True, create conversation if not found

    Returns:
        Conversation or None
    """
    normalized_file_id = normalize_file_id(file_id)

    # First try to find by conversation ID directly (UUID)
    conv = await db.get(Conversation, file_id)
    if conv:
        return conv

    # Try to find by file_id (handle NULL for global conversations)
    if normalized_file_id is None:
        result = await db.execute(
            select(Conversation)
            .where(Conversation.file_id.is_(None))
            .order_by(Conversation.created_at.desc())
            .limit(1)
        )
    else:
        result = await db.execute(
            select(Conversation)
            .where(Conversation.file_id == normalized_file_id)
            .order_by(Conversation.created_at.desc())
            .limit(1)
        )
    conv = result.scalar_one_or_none()
    if conv:
        return conv

    # Create if requested
    if create_if_missing:
        conv = Conversation(id=str(uuid.uuid4()), file_id=normalized_file_id)
        db.add(conv)
        await db.commit()
        await db.refresh(conv)
        return conv

    return None
