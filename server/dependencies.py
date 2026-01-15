"""FastAPI Dependencies.

This module provides dependency injection for services used across the API.
Using DI ensures consistent service usage and easier testing.
"""

from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from services.rag_service import RAGService, get_vector_store_manager


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


# ============================================================================
# Service Dependencies
# ============================================================================

# Singleton RAG service instance
_rag_service: RAGService | None = None


def get_rag_service() -> RAGService:
    """Get RAG service dependency.

    Returns a singleton instance of RAGService.

    Usage:
        @router.post("/search")
        async def search(
            request: SearchRequest,
            rag: RAGService = Depends(get_rag_service)
        ):
            results = await rag.search(request.query)
            ...
    """
    global _rag_service
    if _rag_service is None:
        _rag_service = RAGService()
    return _rag_service


# ============================================================================
# Conversation Lookup Helpers
# ============================================================================

async def get_conversation_by_file_id(
    file_id: str,
    db: AsyncSession,
    create_if_missing: bool = False
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
    from sqlalchemy import select
    from db.database import Conversation
    import uuid

    # First try to find by conversation ID directly
    conv = await db.get(Conversation, file_id)
    if conv:
        return conv

    # Try to find by file_id
    result = await db.execute(
        select(Conversation).where(Conversation.file_id == file_id)
    )
    conv = result.scalar_one_or_none()
    if conv:
        return conv

    # Create if requested
    if create_if_missing:
        conv = Conversation(
            id=str(uuid.uuid4()),
            file_id=file_id if file_id != "global" else None
        )
        db.add(conv)
        await db.commit()
        await db.refresh(conv)
        return conv

    return None
