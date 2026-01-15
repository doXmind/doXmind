"""Knowledge Base API - Conversation-level document attachments."""

from fastapi import APIRouter, UploadFile, File, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import List, Optional
import tempfile
import os
import logging

from markitdown import MarkItDown

from db.database import Conversation, ConversationAttachment
from dependencies import get_db, get_rag_service, get_conversation_by_file_id
from services.rag_service import RAGService
from config import get_settings
from exceptions import (
    ConversationNotFoundError,
    AttachmentNotFoundError,
    FileTooLargeError,
    UnsupportedFileTypeError,
    InternalError,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Configuration from settings
settings = get_settings()
MAX_FILE_SIZE = settings.max_file_size
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


async def extract_text_content(content: bytes, filename: str, ext: str) -> str:
    """Extract text content from uploaded file."""
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


@router.post("/{conversation_id}/attachments", response_model=AttachmentResponse)
async def upload_attachment(
    conversation_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    rag: RAGService = Depends(get_rag_service)
):
    """Upload a document to the conversation's knowledge base.

    - Accepts: PDF, DOCX, PPTX files
    - Max size: 50MB (configurable)
    - Extracts text and indexes in vector store
    """
    # Get or create conversation
    conv = await get_conversation_by_file_id(conversation_id, db, create_if_missing=True)

    # Validate file extension
    ext = get_file_extension(file.filename or "")
    if ext not in ALLOWED_EXTENSIONS:
        raise UnsupportedFileTypeError(
            file_type=ext,
            allowed_types=list(ALLOWED_EXTENSIONS)
        )

    # Read file content
    content = await file.read()

    # Validate file size
    if len(content) > MAX_FILE_SIZE:
        raise FileTooLargeError(
            max_size=MAX_FILE_SIZE,
            actual_size=len(content)
        )

    # Create attachment record
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

    # Process file
    try:
        extracted_text = await extract_text_content(content, file.filename or "", ext)
        attachment.extracted_text = extracted_text

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


@router.get("/{conversation_id}/attachments", response_model=AttachmentListResponse)
async def list_attachments(
    conversation_id: str,
    db: AsyncSession = Depends(get_db)
):
    """List all attachments in a conversation's knowledge base."""
    conv = await get_conversation_by_file_id(conversation_id, db)
    if not conv:
        return AttachmentListResponse(attachments=[], total_size=0, count=0)

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
    db: AsyncSession = Depends(get_db),
    rag: RAGService = Depends(get_rag_service)
):
    """Delete an attachment from the knowledge base."""
    conv = await get_conversation_by_file_id(conversation_id, db)
    if not conv:
        raise ConversationNotFoundError(conversation_id)

    attachment = await db.get(ConversationAttachment, attachment_id)
    if not attachment or attachment.conversation_id != conv.id:
        raise AttachmentNotFoundError(attachment_id)

    # Delete from vector store
    try:
        await rag.delete_kb_attachment(attachment_id)
    except Exception as e:
        logger.warning(f"Failed to delete KB vectors: {e}")

    await db.delete(attachment)
    await db.commit()

    return {"status": "deleted", "id": attachment_id}


@router.post("/{conversation_id}/search", response_model=KBSearchResponse)
async def search_knowledge_base(
    conversation_id: str,
    request: KBSearchRequest,
    db: AsyncSession = Depends(get_db),
    rag: RAGService = Depends(get_rag_service)
):
    """Search within the conversation's knowledge base."""
    conv = await get_conversation_by_file_id(conversation_id, db)
    if not conv:
        raise ConversationNotFoundError(conversation_id)

    try:
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
        raise InternalError(message="Search failed", details={"error": str(e)})


@router.get("/{conversation_id}/attachments/{attachment_id}/content")
async def get_attachment_content(
    conversation_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get the extracted text content of an attachment."""
    conv = await get_conversation_by_file_id(conversation_id, db)
    if not conv:
        raise ConversationNotFoundError(conversation_id)

    attachment = await db.get(ConversationAttachment, attachment_id)
    if not attachment or attachment.conversation_id != conv.id:
        raise AttachmentNotFoundError(attachment_id)

    return {
        "id": attachment.id,
        "filename": attachment.original_filename,
        "content": attachment.extracted_text or "",
        "chunk_count": attachment.chunk_count
    }
