"""Knowledge Base API - Conversation-level document attachments."""

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import List, Optional
import tempfile
import os
import logging

from markitdown import MarkItDown

from db.database import get_db, Conversation, ConversationAttachment
from services.rag_service import RAGService

logger = logging.getLogger(__name__)
router = APIRouter()

# Configuration
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
ALLOWED_EXTENSIONS = {'.pdf', '.docx', '.pptx'}


# Pydantic models
class AttachmentResponse(BaseModel):
    id: str
    original_filename: str
    file_type: str
    file_size: int
    status: str
    chunk_count: int
    error_message: Optional[str] = None
    created_at: str


class AttachmentListResponse(BaseModel):
    attachments: List[AttachmentResponse]
    total_size: int
    count: int


class KBSearchRequest(BaseModel):
    query: str
    top_k: int = 5


class KBSearchResult(BaseModel):
    content: str
    source_file: str
    score: float


class KBSearchResponse(BaseModel):
    results: List[KBSearchResult]


def get_file_extension(filename: str) -> str:
    """Get lowercase file extension."""
    return os.path.splitext(filename)[1].lower()


def format_file_size(size_bytes: int) -> str:
    """Format file size for display."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"


async def extract_text_content(content: bytes, filename: str, ext: str) -> str:
    """Extract text content from uploaded file."""
    # MarkItDown requires a file path
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        md = MarkItDown()
        result = md.convert(tmp_path)
        return result.text_content
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


async def get_or_create_conversation_by_file_id(
    file_id: str,
    db: AsyncSession
) -> Conversation:
    """Get conversation by file_id, or create if not exists.

    The frontend passes file_id as conversation_id, so we need to look up
    the actual conversation by file_id (matching chat.py behavior).
    """
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

    # Create new conversation for this file
    conv = Conversation(
        id=str(uuid.uuid4()),
        file_id=file_id if file_id != "global" else None
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return conv


@router.post("/{conversation_id}/attachments", response_model=AttachmentResponse)
async def upload_attachment(
    conversation_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """Upload a document to the conversation's knowledge base.

    - Accepts: PDF, DOCX, PPTX files
    - Max size: 50MB
    - Extracts text and indexes in vector store
    """
    # Get or create conversation (frontend passes file_id as conversation_id)
    conv = await get_or_create_conversation_by_file_id(conversation_id, db)

    # Validate file extension
    ext = get_file_extension(file.filename or "")
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Read file content
    content = await file.read()

    # Validate file size
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024 * 1024)}MB"
        )

    # Create attachment record (use actual conversation UUID, not file_id)
    file_type = ext[1:]  # Remove the dot
    attachment = ConversationAttachment(
        conversation_id=conv.id,
        original_filename=file.filename or "unknown",
        file_type=file_type,
        file_size=len(content),
        status="processing"
    )
    db.add(attachment)
    await db.commit()
    await db.refresh(attachment)

    # Process in background-like manner (synchronous for now, can be made async with Celery/etc)
    try:
        # Extract text
        extracted_text = await extract_text_content(content, file.filename or "", ext)
        attachment.extracted_text = extracted_text

        # Index in vector store (use actual conversation UUID)
        rag = RAGService()
        chunk_count = await rag.index_kb_attachment(
            attachment_id=attachment.id,
            conversation_id=conv.id,
            content=extracted_text,
            filename=file.filename or "unknown"
        )

        attachment.chunk_count = chunk_count
        attachment.status = "indexed"
        await db.commit()
        await db.refresh(attachment)

        logger.info(f"Successfully indexed KB attachment: {file.filename} ({chunk_count} chunks)")

    except Exception as e:
        logger.error(f"Failed to process KB attachment: {e}")
        attachment.status = "error"
        attachment.error_message = str(e)
        await db.commit()
        await db.refresh(attachment)

    return AttachmentResponse(
        id=attachment.id,
        original_filename=attachment.original_filename,
        file_type=attachment.file_type,
        file_size=attachment.file_size,
        status=attachment.status,
        chunk_count=attachment.chunk_count,
        error_message=attachment.error_message,
        created_at=attachment.created_at.isoformat()
    )


async def get_conversation_by_file_id(
    file_id: str,
    db: AsyncSession
) -> Conversation | None:
    """Get conversation by file_id (without creating).

    Returns None if conversation doesn't exist.
    """
    # First try to find by conversation ID directly
    conv = await db.get(Conversation, file_id)
    if conv:
        return conv

    # Try to find by file_id
    result = await db.execute(
        select(Conversation).where(Conversation.file_id == file_id)
    )
    return result.scalar_one_or_none()


@router.get("/{conversation_id}/attachments", response_model=AttachmentListResponse)
async def list_attachments(
    conversation_id: str,
    db: AsyncSession = Depends(get_db)
):
    """List all attachments in a conversation's knowledge base."""
    # Find conversation by file_id (frontend passes file_id as conversation_id)
    conv = await get_conversation_by_file_id(conversation_id, db)
    if not conv:
        # Return empty list if conversation doesn't exist yet
        return AttachmentListResponse(attachments=[], total_size=0, count=0)

    # Get all attachments using actual conversation UUID
    result = await db.execute(
        select(ConversationAttachment)
        .where(ConversationAttachment.conversation_id == conv.id)
        .order_by(ConversationAttachment.created_at.desc())
    )
    attachments = result.scalars().all()

    attachment_list = [
        AttachmentResponse(
            id=att.id,
            original_filename=att.original_filename,
            file_type=att.file_type,
            file_size=att.file_size,
            status=att.status,
            chunk_count=att.chunk_count,
            error_message=att.error_message,
            created_at=att.created_at.isoformat()
        )
        for att in attachments
    ]

    total_size = sum(att.file_size for att in attachments)

    return AttachmentListResponse(
        attachments=attachment_list,
        total_size=total_size,
        count=len(attachment_list)
    )


@router.delete("/{conversation_id}/attachments/{attachment_id}")
async def delete_attachment(
    conversation_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete an attachment from the knowledge base."""
    # Find conversation by file_id
    conv = await get_conversation_by_file_id(conversation_id, db)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Get attachment and verify it belongs to this conversation
    attachment = await db.get(ConversationAttachment, attachment_id)
    if not attachment or attachment.conversation_id != conv.id:
        raise HTTPException(status_code=404, detail="Attachment not found")

    # Delete from vector store
    try:
        rag = RAGService()
        await rag.delete_kb_attachment(attachment_id)
    except Exception as e:
        logger.warning(f"Failed to delete KB vectors: {e}")

    # Delete from database
    await db.delete(attachment)
    await db.commit()

    return {"status": "deleted", "id": attachment_id}


@router.post("/{conversation_id}/search", response_model=KBSearchResponse)
async def search_knowledge_base(
    conversation_id: str,
    request: KBSearchRequest,
    db: AsyncSession = Depends(get_db)
):
    """Search within the conversation's knowledge base."""
    # Find conversation by file_id
    conv = await get_conversation_by_file_id(conversation_id, db)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Search using actual conversation UUID
    try:
        rag = RAGService()
        results = await rag.search_kb(
            conversation_id=conv.id,
            query=request.query,
            top_k=request.top_k
        )

        return KBSearchResponse(
            results=[
                KBSearchResult(
                    content=r["content"],
                    source_file=r["source_file"],
                    score=r["score"]
                )
                for r in results
            ]
        )
    except Exception as e:
        logger.error(f"KB search failed: {e}")
        raise HTTPException(status_code=500, detail="Search failed")


@router.get("/{conversation_id}/attachments/{attachment_id}/content")
async def get_attachment_content(
    conversation_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get the extracted text content of an attachment."""
    # Find conversation by file_id
    conv = await get_conversation_by_file_id(conversation_id, db)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Get attachment and verify it belongs to this conversation
    attachment = await db.get(ConversationAttachment, attachment_id)
    if not attachment or attachment.conversation_id != conv.id:
        raise HTTPException(status_code=404, detail="Attachment not found")

    return {
        "id": attachment.id,
        "filename": attachment.original_filename,
        "content": attachment.extracted_text or "",
        "chunk_count": attachment.chunk_count
    }
