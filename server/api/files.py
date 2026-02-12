"""File management API endpoints with user data isolation."""

import contextlib
import hashlib
import logging
from datetime import datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import File, get_db, utcnow
from exceptions import (
    AppException,
    BadRequestError,
    DocumentNotFoundError,
    InternalError,
    NotFoundError,
    UnauthorizedError,
)
from services.auth_service import TokenData, require_auth
from services.llm_service import LLMService
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


MAX_FOLDER_DEPTH = 3  # Maximum nesting depth (root=1, sub=2, sub-sub=3)


async def get_folder_depth(db: AsyncSession, folder_id: str | None) -> int:
    """Get the depth of a folder (root level = 0, first subfolder = 1, etc.)."""
    depth = 0
    current_id = folder_id
    visited = set()

    while current_id is not None:
        if current_id in visited:
            raise BadRequestError(message="Circular folder reference detected")
        visited.add(current_id)
        result = await db.execute(select(File.parent_id).where(File.id == current_id))
        row = result.scalar_one_or_none()
        if row is None:
            # parent_id is None means root level
            break
        current_id = row
        depth += 1

    return depth


async def get_max_subtree_depth(db: AsyncSession, folder_id: str) -> int:
    """Get the maximum depth of a folder's subtree (the folder itself = 0)."""
    max_depth = 0

    # Find direct children that are folders
    result = await db.execute(
        select(File.id).where(
            File.parent_id == folder_id,
            File.is_folder.is_(True),
            File.deleted_at.is_(None),
        )
    )
    child_folder_ids = result.scalars().all()

    for child_id in child_folder_ids:
        child_depth = await get_max_subtree_depth(db, child_id)
        max_depth = max(max_depth, 1 + child_depth)

    return max_depth


async def would_create_cycle(db: AsyncSession, folder_id: str, target_parent_id: str) -> bool:
    """Check if moving folder_id under target_parent_id would create a cycle."""
    current_id: str | None = target_parent_id
    visited = set()

    while current_id is not None:
        if current_id == folder_id:
            return True
        if current_id in visited:
            return True
        visited.add(current_id)
        result = await db.execute(select(File.parent_id).where(File.id == current_id))
        parent = result.scalar_one_or_none()
        current_id = parent

    return False


class FileCreate(BaseModel):
    """File creation model."""

    name: str
    content: str = ""
    parent_id: str | None = None  # Optional parent folder


class FileUpdate(BaseModel):
    """File update model."""

    name: str | None = None
    content: str | None = None
    is_favorite: bool | None = None
    icon: str | None = None


class FolderCreate(BaseModel):
    """Folder creation model."""

    name: str
    parent_id: str | None = None  # Optional parent folder (for nested folders)


class MoveRequest(BaseModel):
    """File move request model."""

    target_folder_id: str | None = None  # None means root level


class FileResponse(BaseModel):
    """File response model."""

    id: str
    name: str
    content: str
    is_folder: bool = False
    parent_id: str | None = None
    position: int = 0
    summary: str | None = None
    is_favorite: bool = False
    icon: str | None = None
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


@router.get("/", response_model=list[FileResponse])
async def list_files(
    parent_id: str | None = Query(None),
    filter_by_parent: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """List files for the current user, optionally filtered by parent folder.

    Args:
        parent_id: If provided with filter_by_parent=True, only return files/folders within this folder.
        filter_by_parent: If True, filter by parent_id. If False (default), return all files.
    """
    user_id = get_user_id(token)

    # Build query with folder-aware ordering: folders first, then by position, then by date
    query = (
        select(File)
        .where(File.deleted_at.is_(None))
        .order_by(
            File.is_folder.desc(),  # Folders first
            File.position.asc(),  # Then by position
            File.updated_at.desc(),  # Then by recency
        )
    )

    # Filter by user (None means shared/dev mode, for dev/anonymous users only show files with no user_id)
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    # Filter by parent folder only if explicitly requested
    if filter_by_parent:
        query = query.where(File.parent_id == parent_id)

    result = await db.execute(query)
    files = result.scalars().all()
    return [
        FileResponse(
            id=f.id,
            name=f.name,
            content=f.content,
            is_folder=f.is_folder,
            parent_id=f.parent_id,
            position=f.position,
            summary=f.summary,
            is_favorite=f.is_favorite or False,
            icon=f.icon,
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

    # Validate parent_id if provided (must not be in trash)
    if file.parent_id is not None:
        parent_query = select(File).where(File.id == file.parent_id, File.deleted_at.is_(None))
        parent_query = (
            parent_query.where(File.user_id == user_id)
            if user_id
            else parent_query.where(File.user_id.is_(None))
        )

        parent_result = await db.execute(parent_query)
        parent = parent_result.scalar_one_or_none()

        if not parent:
            raise NotFoundError(resource="Folder", message="Parent folder not found")

        if not parent.is_folder:
            raise BadRequestError(message="Parent must be a folder")

    try:
        result = await db.execute(
            insert(File)
            .values(
                name=file.name,
                content=file.content,
                content_hash=content_hash,
                user_id=user_id,
                parent_id=file.parent_id,  # Use the validated parent_id
            )
            .returning(
                File.id,
                File.name,
                File.content,
                File.parent_id,
                File.position,
                File.created_at,
                File.updated_at,
            )
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
            is_folder=False,
            parent_id=cast(str | None, created["parent_id"]),
            position=cast(int, created["position"]),
            summary=None,
            is_favorite=False,
            icon=None,
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
            raise UnauthorizedError(message="User session invalid. Please log in again.")
        raise InternalError(message=str(e))


@router.get("/{file_id}", response_model=FileResponse)
async def get_file(
    file_id: str, db: AsyncSession = Depends(get_db), token: TokenData = Depends(require_auth)
):
    """Get a file by ID (must belong to current user, not in trash)."""
    user_id = get_user_id(token)

    query = select(File).where(File.id == file_id, File.deleted_at.is_(None))
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise DocumentNotFoundError(file_id=file_id)

    return FileResponse(
        id=file.id,
        name=file.name,
        content=file.content,
        is_folder=file.is_folder,
        parent_id=file.parent_id,
        position=file.position,
        summary=file.summary,
        is_favorite=file.is_favorite or False,
        icon=file.icon,
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
    """Update a file (must belong to current user, not in trash)."""
    user_id = get_user_id(token)

    query = select(File).where(File.id == file_id, File.deleted_at.is_(None))
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise DocumentNotFoundError(file_id=file_id)

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

    if update.is_favorite is not None:
        file.is_favorite = update.is_favorite

    if update.icon is not None:
        file.icon = update.icon if update.icon != "" else None

    await db.commit()
    await db.refresh(file)

    # Extract all values before any async operations to avoid lazy loading issues
    file_id = file.id
    file_name = file.name
    file_content = file.content
    file_summary = file.summary
    file_is_favorite = file.is_favorite or False
    file_icon = file.icon
    file_created_at = file.created_at.isoformat()
    file_updated_at = file.updated_at.isoformat()
    file_is_folder = file.is_folder
    file_parent_id = file.parent_id
    file_position = file.position

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
        is_folder=file_is_folder,
        parent_id=file_parent_id,
        position=file_position,
        summary=file_summary,
        is_favorite=file_is_favorite,
        icon=file_icon,
        created_at=file_created_at,
        updated_at=file_updated_at,
    )


@router.delete("/{file_id}")
async def delete_file(
    file_id: str, db: AsyncSession = Depends(get_db), token: TokenData = Depends(require_auth)
):
    """Soft-delete a file (move to trash). Must belong to current user."""
    user_id = get_user_id(token)

    query = select(File).where(File.id == file_id, File.deleted_at.is_(None))
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise DocumentNotFoundError(file_id=file_id)

    now = utcnow()

    # Collect all descendant IDs for recursive soft-delete (for folders)
    descendant_ids: list[str] = []
    if file.is_folder:
        # Recursively find all descendants
        async def collect_descendants(parent_id: str) -> None:
            result = await db.execute(
                select(File.id, File.is_folder).where(
                    File.parent_id == parent_id, File.deleted_at.is_(None)
                )
            )
            for row in result.all():
                descendant_ids.append(row[0])
                if row[1]:  # is_folder
                    await collect_descendants(row[0])

        await collect_descendants(file_id)

        # Soft-delete all descendants
        if descendant_ids:
            await db.execute(update(File).where(File.id.in_(descendant_ids)).values(deleted_at=now))

    # Soft delete the file/folder
    file.deleted_at = now
    await db.commit()

    # Remove from vector store (trashed files shouldn't appear in search)
    try:
        rag = RAGService(db)
        await rag.delete_file(file_id)
        for desc_id in descendant_ids:
            with contextlib.suppress(Exception):
                await rag.delete_file(desc_id)
    except Exception as e:
        logger.warning(f"Failed to delete file from vector store: {e}")

    return {"status": "trashed"}


@router.post("/folders", response_model=FileResponse)
async def create_folder(
    folder: FolderCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Create a new folder, optionally nested inside another folder.

    Folders:
    - Can be nested up to 3 levels deep
    - Have empty content
    - Are not indexed in vector store
    """
    user_id = get_user_id(token)

    # Validate parent folder if provided
    if folder.parent_id is not None:
        parent_query = select(File).where(
            File.id == folder.parent_id,
            File.is_folder.is_(True),
            File.deleted_at.is_(None),
        )
        parent_query = (
            parent_query.where(File.user_id == user_id)
            if user_id
            else parent_query.where(File.user_id.is_(None))
        )
        parent_result = await db.execute(parent_query)
        parent = parent_result.scalar_one_or_none()

        if not parent:
            raise NotFoundError(resource="Folder", message="Parent folder not found")

        # Check depth limit: parent depth + 1 (for the new folder) must be < MAX_FOLDER_DEPTH
        parent_depth = await get_folder_depth(db, folder.parent_id)
        if parent_depth + 1 >= MAX_FOLDER_DEPTH:
            raise BadRequestError(
                message=f"Maximum folder nesting depth is {MAX_FOLDER_DEPTH} levels"
            )

    # Validate: Check for duplicate folder name at the same level (excluding trash)
    dup_query = select(File).where(
        File.name == folder.name,
        File.is_folder.is_(True),
        File.parent_id == folder.parent_id,
        File.deleted_at.is_(None),
    )
    dup_query = (
        dup_query.where(File.user_id == user_id)
        if user_id
        else dup_query.where(File.user_id.is_(None))
    )

    result = await db.execute(dup_query)
    existing = result.scalar_one_or_none()

    if existing:
        raise BadRequestError(message=f"A folder named '{folder.name}' already exists here")

    try:
        result = await db.execute(
            insert(File)
            .values(
                name=folder.name,
                content="",  # Folders have no content
                is_folder=True,
                parent_id=folder.parent_id,
                user_id=user_id,
            )
            .returning(
                File.id,
                File.name,
                File.content,
                File.is_folder,
                File.parent_id,
                File.position,
                File.created_at,
                File.updated_at,
            )
        )
        await db.commit()
        created_row = result.mappings().first()
        if not created_row:
            raise RuntimeError("Failed to create folder")
        created = cast(dict[str, Any], created_row)

        return FileResponse(
            id=cast(str, created["id"]),
            name=cast(str, created["name"]),
            content=cast(str, created["content"]),
            is_folder=cast(bool, created["is_folder"]),
            parent_id=cast(str | None, created["parent_id"]),
            position=cast(int, created["position"]),
            summary=None,
            is_favorite=False,
            icon=None,
            created_at=cast(datetime, created["created_at"]).isoformat(),
            updated_at=cast(datetime, created["updated_at"]).isoformat(),
        )
    except AppException:
        raise
    except Exception as e:
        await db.rollback()
        error_str = str(e)
        logger.error(f"Failed to create folder: {e}")
        if "ForeignKeyViolationError" in error_str and "user_id" in error_str:
            raise UnauthorizedError(message="User session invalid. Please log in again.")
        raise InternalError(message=str(e))


@router.post("/{file_id}/move")
async def move_file(
    file_id: str,
    move_request: MoveRequest,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Move a file or folder to a different folder (or root).

    Rules:
    - Files and folders can be moved
    - Target must be a folder or None (root)
    - Moving a folder checks for circular references and depth limits
    - User must own both file and target folder
    """
    user_id = get_user_id(token)

    # Get the file to move (must not be in trash)
    query = select(File).where(File.id == file_id, File.deleted_at.is_(None))
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise DocumentNotFoundError(file_id=file_id)

    # Validate: If target is provided, verify it's a folder and user owns it
    if move_request.target_folder_id is not None:
        target_query = select(File).where(
            File.id == move_request.target_folder_id,
            File.deleted_at.is_(None),
        )
        target_query = (
            target_query.where(File.user_id == user_id)
            if user_id
            else target_query.where(File.user_id.is_(None))
        )

        target_result = await db.execute(target_query)
        target = target_result.scalar_one_or_none()

        if not target:
            raise NotFoundError(resource="Folder", message="Target folder not found")

        if not target.is_folder:
            raise BadRequestError(message="Target must be a folder")

    # Additional checks for moving folders
    if file.is_folder:
        # Cannot move a folder into itself
        if move_request.target_folder_id == file_id:
            raise BadRequestError(message="Cannot move a folder into itself")

        # Check for circular reference
        if move_request.target_folder_id is not None:
            if await would_create_cycle(db, file_id, move_request.target_folder_id):
                raise BadRequestError(message="Cannot move folder: would create circular reference")

            # Check depth limit: target depth + subtree depth of moved folder + 1
            target_depth = await get_folder_depth(db, move_request.target_folder_id)
            subtree_depth = await get_max_subtree_depth(db, file_id)
            if target_depth + 1 + subtree_depth >= MAX_FOLDER_DEPTH:
                raise BadRequestError(
                    message=f"Cannot move folder: would exceed maximum depth of {MAX_FOLDER_DEPTH} levels",
                )

    # Move the file/folder
    file.parent_id = move_request.target_folder_id
    await db.commit()
    await db.refresh(file)

    return FileResponse(
        id=file.id,
        name=file.name,
        content=file.content,
        is_folder=file.is_folder,
        parent_id=file.parent_id,
        position=file.position,
        summary=file.summary,
        is_favorite=file.is_favorite or False,
        icon=file.icon,
        created_at=file.created_at.isoformat(),
        updated_at=file.updated_at.isoformat(),
    )


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
        raise InternalError(message=str(e))


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
        # Verify file exists, belongs to user, and is not in trash
        query = select(File).where(File.id == request.file_id, File.deleted_at.is_(None))
        if user_id:
            query = query.where(File.user_id == user_id)
        else:
            query = query.where(File.user_id.is_(None))

        result = await db.execute(query)
        file = result.scalar_one_or_none()

        if not file:
            raise DocumentNotFoundError(file_id=request.file_id)

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
    except AppException:
        raise
    except Exception as e:
        logger.error(f"In-document search error: {e}")
        raise InternalError(message=str(e))


class SummaryResponse(BaseModel):
    """Summary generation response."""

    summary: str


@router.post("/{file_id}/summarize", response_model=SummaryResponse)
async def generate_summary(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Generate an AI summary for a file (not in trash)."""
    user_id = get_user_id(token)

    query = select(File).where(File.id == file_id, File.deleted_at.is_(None))
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise DocumentNotFoundError(file_id=file_id)

    # Skip if content is too short
    if not file.content or len(file.content.strip()) < 50:
        return SummaryResponse(summary="")

    try:
        llm = LLMService()
        prompt = f"""Summarize this document in one evocative sentence (max 80 characters).
Write in the same tone as the document. Be poetic, not descriptive.
Do not start with "This document..." or similar. Just give the summary.

Document:
{file.content[:2000]}"""

        summary = await llm.complete(
            prompt=prompt,
            max_tokens=100,
            temperature=0.7,
        )

        # Clean up the summary
        summary = summary.strip().strip('"').strip("'")
        if len(summary) > 100:
            summary = summary[:97] + "..."

        # Save to database
        file.summary = summary
        await db.commit()

        return SummaryResponse(summary=summary)
    except Exception as e:
        logger.error(f"Summary generation error: {e}")
        raise InternalError(message="Failed to generate summary")


# =============================================================================
# Trash / Soft-Delete Endpoints
# =============================================================================


class TrashFileResponse(BaseModel):
    """Trash file response model (includes deleted_at)."""

    id: str
    name: str
    is_folder: bool = False
    parent_id: str | None = None
    deleted_at: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


@router.get("/trash/list", response_model=list[TrashFileResponse])
async def list_trash(
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """List all soft-deleted files in the trash."""
    user_id = get_user_id(token)

    query = select(File).where(File.deleted_at.is_not(None)).order_by(File.deleted_at.desc())
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    files = result.scalars().all()

    return [
        TrashFileResponse(
            id=f.id,
            name=f.name,
            is_folder=f.is_folder,
            parent_id=f.parent_id,
            deleted_at=f.deleted_at.isoformat(),
            created_at=f.created_at.isoformat(),
            updated_at=f.updated_at.isoformat(),
        )
        for f in files
    ]


@router.post("/{file_id}/restore")
async def restore_file(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Restore a soft-deleted file from the trash."""
    user_id = get_user_id(token)

    query = select(File).where(File.id == file_id, File.deleted_at.is_not(None))
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise DocumentNotFoundError(message="File not found in trash")

    # If it's a folder, recursively restore all descendants
    if file.is_folder:

        async def restore_descendants(parent_id: str) -> None:
            result = await db.execute(
                select(File.id, File.is_folder).where(
                    File.parent_id == parent_id, File.deleted_at.is_not(None)
                )
            )
            children = result.all()
            child_ids = [row[0] for row in children]
            if child_ids:
                await db.execute(update(File).where(File.id.in_(child_ids)).values(deleted_at=None))
            for row in children:
                if row[1]:  # is_folder
                    await restore_descendants(row[0])

        await restore_descendants(file_id)

    # Restore the file/folder
    file.deleted_at = None
    await db.commit()

    # Re-index in vector store
    try:
        rag = RAGService(db)
        if not file.is_folder:
            strategy = DEFAULT_STRATEGY_FACTORY.get_strategy(file.content, file.name)
            await rag.index_file(
                file_id=file.id,
                content=file.content,
                metadata={"name": file.name, "user_id": user_id},
                strategy=strategy,
            )
            await rag.index_file_sentences(
                file_id=file.id,
                content=file.content,
                metadata={"name": file.name, "user_id": user_id},
            )
    except Exception as e:
        logger.warning(f"Failed to re-index restored file: {e}")

    return {"status": "restored"}


@router.delete("/{file_id}/permanent")
async def permanent_delete_file(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Permanently delete a file that is already in the trash."""
    user_id = get_user_id(token)

    query = select(File).where(File.id == file_id, File.deleted_at.is_not(None))
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise DocumentNotFoundError(message="File not found in trash")

    # Extract image keys from content before deletion
    from api.images import delete_orphaned_images, extract_image_keys_from_content

    image_keys = extract_image_keys_from_content(file.content) if file.content else []

    # Remove from vector store (may already be removed)
    try:
        rag = RAGService(db)
        await rag.delete_file(file_id)
    except Exception as e:
        logger.warning(f"Failed to delete file from vector store: {e}")

    await db.delete(file)
    await db.commit()

    # Clean up orphaned images from S3
    if image_keys:
        try:
            await delete_orphaned_images(db, image_keys, exclude_file_ids=[file_id])
        except Exception as e:
            logger.warning(f"Failed to clean up images for file {file_id}: {e}")

    return {"status": "permanently_deleted"}


@router.delete("/trash/empty")
async def empty_trash(
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Permanently delete all files in the trash."""
    user_id = get_user_id(token)

    query = select(File).where(File.deleted_at.is_not(None))
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    trash_files = result.scalars().all()

    if not trash_files:
        return {"status": "empty", "count": 0}

    # Collect image keys from all trash files before deletion
    from api.images import delete_orphaned_images, extract_image_keys_from_content

    all_image_keys: list[str] = []
    trash_file_ids: list[str] = []
    for f in trash_files:
        trash_file_ids.append(f.id)
        if f.content:
            all_image_keys.extend(extract_image_keys_from_content(f.content))

    # Remove all from vector store
    rag = RAGService(db)
    for f in trash_files:
        try:
            await rag.delete_file(f.id)
        except Exception as e:
            logger.warning(f"Failed to delete file {f.id} from vector store: {e}")

    # Permanently delete all
    for f in trash_files:
        await db.delete(f)

    await db.commit()

    # Clean up orphaned images from S3
    if all_image_keys:
        try:
            unique_keys = list(set(all_image_keys))
            await delete_orphaned_images(db, unique_keys, exclude_file_ids=trash_file_ids)
        except Exception as e:
            logger.warning(f"Failed to clean up images during trash empty: {e}")

    return {"status": "emptied", "count": len(trash_files)}
