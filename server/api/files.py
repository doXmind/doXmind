"""File management API endpoints with user data isolation."""

import logging
from datetime import datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import File, get_db
from services.auth_service import TokenData, require_auth
from services.rag_service import RAGService

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
async def list_files(
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth)
):
    """List files for the current user."""
    user_id = get_user_id(token)

    query = select(File).order_by(File.updated_at.desc())

    # Filter by user (None means shared/dev mode)
    if user_id:
        query = query.where(File.user_id == user_id)
    else:
        # For dev/anonymous users, only show files with no user_id
        query = query.where(File.user_id.is_(None))

    result = await db.execute(query)
    files = result.scalars().all()
    return [
        FileResponse(
            id=f.id,
            name=f.name,
            content=f.content,
            created_at=f.created_at.isoformat(),
            updated_at=f.updated_at.isoformat()
        )
        for f in files
    ]


@router.post("/", response_model=FileResponse)
async def create_file(
    file: FileCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth)
):
    """Create a new file for the current user."""
    user_id = get_user_id(token)

    try:
        result = await db.execute(
            insert(File)
            .values(name=file.name, content=file.content, user_id=user_id)
            .returning(File.id, File.name, File.content, File.created_at, File.updated_at)
        )
        await db.commit()
        created_row = result.mappings().first()
        if not created_row:
            raise RuntimeError("Failed to create file")
        created = cast(dict[str, Any], created_row)
        file_id = cast(str, created["id"])

        # Index in vector store (both chunk-level and sentence-level)
        try:
            rag = RAGService(db)
            await rag.index_file(
                file_id=file_id,
                content=file.content,
                metadata={"name": file.name, "user_id": user_id}
            )
            # Also index at sentence level for in-document search
            await rag.index_file_sentences(
                file_id=file_id,
                content=file.content,
                metadata={"name": file.name, "user_id": user_id}
            )
        except Exception as e:
            logger.warning(f"Failed to index file: {e}")

        return FileResponse(
            id=file_id,
            name=cast(str, created["name"]),
            content=cast(str, created["content"]),
            created_at=cast(datetime, created["created_at"]).isoformat(),
            updated_at=cast(datetime, created["updated_at"]).isoformat()
        )
    except Exception as e:
        await db.rollback()
        error_str = str(e)
        logger.error(f"Failed to create file: {e}")
        # Foreign key violation on user_id means the user doesn't exist in DB
        # This happens when token is valid but user was deleted or never created
        if "ForeignKeyViolationError" in error_str and "user_id" in error_str:
            raise HTTPException(
                status_code=401,
                detail="User session invalid. Please log in again."
            )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{file_id}", response_model=FileResponse)
async def get_file(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth)
):
    """Get a file by ID (must belong to current user)."""
    user_id = get_user_id(token)

    query = select(File).where(File.id == file_id)
    if user_id:
        query = query.where(File.user_id == user_id)
    else:
        query = query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        id=file.id,
        name=file.name,
        content=file.content,
        created_at=file.created_at.isoformat(),
        updated_at=file.updated_at.isoformat()
    )


@router.put("/{file_id}", response_model=FileResponse)
async def update_file(
    file_id: str,
    update: FileUpdate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth)
):
    """Update a file (must belong to current user)."""
    user_id = get_user_id(token)

    query = select(File).where(File.id == file_id)
    if user_id:
        query = query.where(File.user_id == user_id)
    else:
        query = query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    if update.name is not None:
        file.name = update.name
    if update.content is not None:
        file.content = update.content

    await db.commit()
    await db.refresh(file)

    # Re-index in vector store (when content or name changes)
    if update.content is not None or update.name is not None:
        try:
            rag = RAGService(db)
            await rag.index_file(
                file_id=file.id,
                content=file.content,
                metadata={"name": file.name, "user_id": user_id}
            )
            # Also re-index at sentence level for in-document search
            await rag.index_file_sentences(
                file_id=file.id,
                content=file.content,
                metadata={"name": file.name, "user_id": user_id}
            )
        except Exception as e:
            logger.warning(f"Failed to re-index file: {e}")

    return FileResponse(
        id=file.id,
        name=file.name,
        content=file.content,
        created_at=file.created_at.isoformat(),
        updated_at=file.updated_at.isoformat()
    )


@router.delete("/{file_id}")
async def delete_file(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth)
):
    """Delete a file (must belong to current user)."""
    user_id = get_user_id(token)

    query = select(File).where(File.id == file_id)
    if user_id:
        query = query.where(File.user_id == user_id)
    else:
        query = query.where(File.user_id.is_(None))

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


@router.post("/search")
async def search_files(
    request: SearchRequest,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth)
):
    """Search files using RAG (within user's files)."""
    user_id = get_user_id(token)

    try:
        rag = RAGService(db)
        results = await rag.search(
            query=request.query,
            file_ids=request.file_ids,
            top_k=request.top_k,
            user_id=user_id
        )
        return {"results": results}
    except Exception as e:
        logger.error(f"Search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class InDocSearchRequest(BaseModel):
    """In-document search request model for sentence-level semantic search."""
    query: str
    file_id: str
    top_k: int = 10
    min_score: float = 0.4  # Minimum similarity score (0-1), default 0.4 for OpenAI embeddings


@router.post("/search/in-document")
async def search_in_document(
    request: InDocSearchRequest,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth)
):
    """Search within a single document at sentence level.

    This endpoint uses sentence-level chunking for precise in-document
    semantic search, enabling accurate highlighting in the editor.

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

        # Check if sentence index exists, if not create it
        # Use a low min_score for existence check
        existing = await rag.search_sentences(
            query=request.query,
            file_id=request.file_id,
            top_k=1,
            min_score=0.0  # Don't filter for existence check
        )

        if not existing:
            # Index at sentence level first
            logger.info(f"Creating sentence index for file {request.file_id}")
            await rag.index_file_sentences(
                file_id=request.file_id,
                content=file.content,
                metadata={"name": file.name, "user_id": user_id}
            )

        # Perform sentence-level search with score filtering
        results = await rag.search_sentences(
            query=request.query,
            file_id=request.file_id,
            top_k=request.top_k,
            min_score=request.min_score
        )

        return {"results": results}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"In-document search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
