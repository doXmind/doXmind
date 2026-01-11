"""File management API endpoints."""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import logging

from db.database import get_db, File
from services.rag_service import RAGService

logger = logging.getLogger(__name__)
router = APIRouter()


class FileCreate(BaseModel):
    """File creation model."""
    name: str
    content: str = ""


class FileUpdate(BaseModel):
    """File update model."""
    name: Optional[str] = None
    content: Optional[str] = None


class FileResponse(BaseModel):
    """File response model."""
    id: str
    name: str
    content: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


@router.get("/", response_model=List[FileResponse])
async def list_files(db: AsyncSession = Depends(get_db)):
    """List all files."""
    result = await db.execute(select(File).order_by(File.updated_at.desc()))
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
async def create_file(file: FileCreate, db: AsyncSession = Depends(get_db)):
    """Create a new file."""
    try:
        new_file = File(name=file.name, content=file.content)
        db.add(new_file)
        await db.commit()
        await db.refresh(new_file)

        # Index in vector store (both chunk-level and sentence-level)
        try:
            rag = RAGService()
            await rag.index_file(
                file_id=new_file.id,
                content=file.content,
                metadata={"name": file.name}
            )
            # Also index at sentence level for in-document search
            await rag.index_file_sentences(
                file_id=new_file.id,
                content=file.content,
                metadata={"name": file.name}
            )
        except Exception as e:
            logger.warning(f"Failed to index file: {e}")

        return FileResponse(
            id=new_file.id,
            name=new_file.name,
            content=new_file.content,
            created_at=new_file.created_at.isoformat(),
            updated_at=new_file.updated_at.isoformat()
        )
    except Exception as e:
        logger.error(f"Failed to create file: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{file_id}", response_model=FileResponse)
async def get_file(file_id: str, db: AsyncSession = Depends(get_db)):
    """Get a file by ID."""
    result = await db.execute(select(File).where(File.id == file_id))
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
    db: AsyncSession = Depends(get_db)
):
    """Update a file."""
    result = await db.execute(select(File).where(File.id == file_id))
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
            rag = RAGService()
            await rag.index_file(
                file_id=file.id,
                content=file.content,
                metadata={"name": file.name}
            )
            # Also re-index at sentence level for in-document search
            await rag.index_file_sentences(
                file_id=file.id,
                content=file.content,
                metadata={"name": file.name}
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
async def delete_file(file_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a file."""
    result = await db.execute(select(File).where(File.id == file_id))
    file = result.scalar_one_or_none()

    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    # Remove from vector store
    try:
        rag = RAGService()
        await rag.delete_file(file_id)
    except Exception as e:
        logger.warning(f"Failed to delete file from vector store: {e}")

    await db.delete(file)
    await db.commit()

    return {"status": "deleted"}


class SearchRequest(BaseModel):
    """Search request model."""
    query: str
    file_ids: Optional[List[str]] = None
    top_k: int = 5


@router.post("/search")
async def search_files(request: SearchRequest):
    """Search files using RAG."""
    try:
        rag = RAGService()
        results = await rag.search(
            query=request.query,
            file_ids=request.file_ids,
            top_k=request.top_k
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
async def search_in_document(request: InDocSearchRequest, db: AsyncSession = Depends(get_db)):
    """Search within a single document at sentence level.

    This endpoint uses sentence-level chunking for precise in-document
    semantic search, enabling accurate highlighting in the editor.

    Results are filtered by min_score to only return sufficiently similar matches.
    """
    try:
        # Verify file exists
        result = await db.execute(select(File).where(File.id == request.file_id))
        file = result.scalar_one_or_none()

        if not file:
            raise HTTPException(status_code=404, detail="File not found")

        rag = RAGService()

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
                metadata={"name": file.name}
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
