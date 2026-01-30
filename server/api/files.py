"""File management API endpoints with user data isolation."""

import hashlib
import logging
from datetime import datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import File, get_db
from services.auth_service import TokenData, require_auth
from services.rag_service import DEFAULT_STRATEGY_FACTORY, RAGService

logger = logging.getLogger(__name__)
router = APIRouter()


def get_user_id(token: TokenData) -> str | None:
    """Get user ID from token for data isolation.

    Returns None only for special dev/api-key users (which share data).
    Real users always get their user_id for proper isolation.
    """
    # Special token types share data (no user isolation)
    if token.sub in ("dev-user", "api-key-user", "anonymous"):
        return None

    return token.sub


def compute_content_hash(content: str) -> str:
    """Compute SHA-256 hash of content for change detection."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


class FileCreate(BaseModel):
    """File creation model."""

    name: str
    content: str = ""


class FileUpdate(BaseModel):
    """File update model."""

    name: str | None = None
    content: str | None = None


class FileResponse(BaseModel):
    """File response model."""

    id: str
    name: str
    content: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


@router.get("/", response_model=list[FileResponse])
async def list_files(db: AsyncSession = Depends(get_db), token: TokenData = Depends(require_auth)):
    """List files for the current user."""
    user_id = get_user_id(token)

    query = select(File).order_by(File.updated_at.desc())

    # Filter by user (None means shared/dev mode, for dev/anonymous users only show files with no user_id)
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    files = result.scalars().all()
    return [
        FileResponse(
            id=f.id,
            name=f.name,
            content=f.content,
            created_at=f.created_at.isoformat(),
            updated_at=f.updated_at.isoformat(),
        )
        for f in files
    ]


@router.post("/", response_model=FileResponse)
async def create_file(
    file: FileCreate, db: AsyncSession = Depends(get_db), token: TokenData = Depends(require_auth)
):
    """Create a new file for the current user."""
    user_id = get_user_id(token)
    content_hash = compute_content_hash(file.content) if file.content else None

    try:
        result = await db.execute(
            insert(File)
            .values(
                name=file.name, content=file.content, content_hash=content_hash, user_id=user_id
            )
            .returning(File.id, File.name, File.content, File.created_at, File.updated_at)
        )
        await db.commit()
        created_row = result.mappings().first()
        if not created_row:
            raise RuntimeError("Failed to create file")
        created = cast(dict[str, Any], created_row)
        file_id = cast(str, created["id"])

        # Index in vector store with auto-selected chunking strategy
        try:
            rag = RAGService(db)
            # Auto-select chunking strategy based on document type
            strategy = DEFAULT_STRATEGY_FACTORY.get_strategy(file.content, file.name)
            await rag.index_file(
                file_id=file_id,
                content=file.content,
                metadata={"name": file.name, "user_id": user_id},
                strategy=strategy,
            )
            # Also index at sentence level for in-document search
            await rag.index_file_sentences(
                file_id=file_id,
                content=file.content,
                metadata={"name": file.name, "user_id": user_id},
            )
        except Exception as e:
            logger.warning(f"Failed to index file: {e}")

        return FileResponse(
            id=file_id,
            name=cast(str, created["name"]),
            content=cast(str, created["content"]),
            created_at=cast(datetime, created["created_at"]).isoformat(),
            updated_at=cast(datetime, created["updated_at"]).isoformat(),
        )
    except Exception as e:
        await db.rollback()
        error_str = str(e)
        logger.error(f"Failed to create file: {e}")
        # Foreign key violation on user_id means the user doesn't exist in DB
        # This happens when token is valid but user was deleted or never created
        if "ForeignKeyViolationError" in error_str and "user_id" in error_str:
            raise HTTPException(
                status_code=401, detail="User session invalid. Please log in again."
            )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{file_id}", response_model=FileResponse)
async def get_file(
    file_id: str, db: AsyncSession = Depends(get_db), token: TokenData = Depends(require_auth)
):
    """Get a file by ID (must belong to current user)."""
    user_id = get_user_id(token)

    query = select(File).where(File.id == file_id)
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        id=file.id,
        name=file.name,
        content=file.content,
        created_at=file.created_at.isoformat(),
        updated_at=file.updated_at.isoformat(),
    )


@router.put("/{file_id}", response_model=FileResponse)
async def update_file(
    file_id: str,
    update: FileUpdate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Update a file (must belong to current user)."""
    user_id = get_user_id(token)

    query = select(File).where(File.id == file_id)
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    # Determine if re-indexing is needed based on actual content changes
    need_reindex = False

    if update.name is not None:
        file.name = update.name
        need_reindex = True  # Name change affects metadata in index

    if update.content is not None:
        new_hash = compute_content_hash(update.content)
        if file.content_hash != new_hash:
            file.content = update.content
            file.content_hash = new_hash
            need_reindex = True

    await db.commit()
    await db.refresh(file)

    # Extract all values before any async operations to avoid lazy loading issues
    file_id = file.id
    file_name = file.name
    file_content = file.content
    file_created_at = file.created_at.isoformat()
    file_updated_at = file.updated_at.isoformat()

    # Re-index in vector store only when content or name actually changed
    if need_reindex:
        try:
            rag = RAGService(db)
            # Auto-select chunking strategy based on document type
            strategy = DEFAULT_STRATEGY_FACTORY.get_strategy(file_content, file_name)
            await rag.index_file(
                file_id=file_id,
                content=file_content,
                metadata={"name": file_name, "user_id": user_id},
                strategy=strategy,
            )
            # Also re-index at sentence level for in-document search
            await rag.index_file_sentences(
                file_id=file_id,
                content=file_content,
                metadata={"name": file_name, "user_id": user_id},
            )
        except Exception as e:
            logger.warning(f"Failed to re-index file: {e}")

    return FileResponse(
        id=file_id,
        name=file_name,
        content=file_content,
        created_at=file_created_at,
        updated_at=file_updated_at,
    )


@router.delete("/{file_id}")
async def delete_file(
    file_id: str, db: AsyncSession = Depends(get_db), token: TokenData = Depends(require_auth)
):
    """Delete a file (must belong to current user)."""
    user_id = get_user_id(token)

    query = select(File).where(File.id == file_id)
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    # Remove from vector store
    try:
        rag = RAGService(db)
        await rag.delete_file(file_id)
    except Exception as e:
        logger.warning(f"Failed to delete file from vector store: {e}")

    await db.delete(file)
    await db.commit()

    return {"status": "deleted"}


class SearchRequest(BaseModel):
    """Search request model."""

    query: str
    file_ids: list[str] | None = None
    top_k: int = 5
    use_hybrid: bool = True  # Use hybrid search (vector + keyword with RRF)
    use_reranking: bool = False  # Use GPT reranking for improved relevance


@router.post("/search")
async def search_files(
    request: SearchRequest,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Search files using RAG (within user's files).

    Supports three search modes:
    - Basic: Pure vector similarity search (use_hybrid=False, use_reranking=False)
    - Hybrid: Vector + keyword search with RRF fusion (use_hybrid=True)
    - Hybrid + Reranking: Hybrid search with GPT reranking (use_reranking=True)
    """
    user_id = get_user_id(token)

    try:
        rag = RAGService(db)

        if request.use_reranking:
            # Full pipeline: hybrid search + GPT reranking
            results = await rag.hybrid_search_with_rerank(
                query=request.query, file_ids=request.file_ids, top_k=request.top_k, user_id=user_id
            )
        elif request.use_hybrid:
            # Hybrid search: vector + keyword with RRF
            results = await rag.hybrid_search(
                query=request.query, file_ids=request.file_ids, top_k=request.top_k, user_id=user_id
            )
        else:
            # Basic: pure vector similarity search
            results = await rag.search(
                query=request.query, file_ids=request.file_ids, top_k=request.top_k, user_id=user_id
            )

        return {"results": results}
    except Exception as e:
        logger.error(f"Search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class InDocSearchRequest(BaseModel):
    """In-document search request model for hybrid sentence-level search."""

    query: str
    file_id: str
    top_k: int = 10
    min_score: float = 0.3  # Minimum similarity score (0-1)
    use_hybrid: bool = True  # Use hybrid search (semantic + keyword with RRF)


@router.post("/search/in-document")
async def search_in_document(
    request: InDocSearchRequest,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Search within a single document using sentence-level chunks.

    Supports two search modes:
    - Hybrid (default): Combines semantic (vector) and keyword (BM25) search with RRF fusion
    - Semantic only: Pure vector similarity search (use_hybrid=False)

    Results are filtered by min_score to only return sufficiently similar matches.
    """
    user_id = get_user_id(token)

    try:
        # Verify file exists and belongs to user
        query = select(File).where(File.id == request.file_id)
        if user_id:
            query = query.where(File.user_id == user_id)
        else:
            query = query.where(File.user_id.is_(None))

        result = await db.execute(query)
        file = result.scalar_one_or_none()

        if not file:
            raise HTTPException(status_code=404, detail="File not found")

        rag = RAGService(db)

        # Use sentence-level search for precise in-document matching
        results = await rag.search_sentences(
            query=request.query,
            file_id=request.file_id,
            top_k=request.top_k,
            min_score=request.min_score,
            use_hybrid=request.use_hybrid,
        )

        # Calculate scores for logging
        scores = [(1 - r.get("distance", 1)) for r in results]
        mode = "hybrid" if request.use_hybrid else "semantic"
        logger.info(
            f"In-document search ({mode}): query='{request.query}', file_id={request.file_id}, "
            f"results={len(results)}, scores={scores}"
        )

        return {"results": results}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"In-document search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
