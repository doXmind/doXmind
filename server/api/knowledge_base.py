"""Knowledge Base API - Conversation-level document attachments."""

import asyncio
import logging
import os
from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import ConversationAttachment, async_session
from dependencies import get_conversation_by_file_id, get_db
from exceptions import (
    AttachmentNotFoundError,
    ConversationNotFoundError,
    FileTooLargeError,
    InternalError,
    UnsupportedFileTypeError,
)
from services.gemini_converter import convert_file_to_markdown, is_converter_configured
from services.rag_service import RAGService

logger = logging.getLogger(__name__)
router = APIRouter()

# Configuration from settings
settings = get_settings()
MAX_FILE_SIZE = settings.max_file_size
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".pptx"}


# Pydantic models
class AttachmentResponse(BaseModel):
    id: str
    original_filename: str
    file_type: str
    file_size: int
    status: str
    chunk_count: int
    error_message: str | None = None
    created_at: str


class AttachmentListResponse(BaseModel):
    attachments: list[AttachmentResponse]
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
    results: list[KBSearchResult]


class BatchUploadResponse(BaseModel):
    results: list[AttachmentResponse]
    successful: int
    failed: int


def get_file_extension(filename: str) -> str:
    """Get lowercase file extension."""
    return os.path.splitext(filename)[1].lower()


async def extract_text_content(content: bytes, filename: str, ext: str) -> str:
    """Extract text content from uploaded file via OpenRouter API."""
    if not is_converter_configured():
        raise ValueError("File conversion requires OPENROUTER_API_KEY to be configured")
    return await convert_file_to_markdown(content, filename, ext)


@router.post("/{conversation_id}/attachments", response_model=AttachmentResponse)
async def upload_attachment(
    conversation_id: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)
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
        raise UnsupportedFileTypeError(file_type=ext, allowed_types=list(ALLOWED_EXTENSIONS))

    # Read file content
    content = await file.read()

    # Validate file size
    if len(content) > MAX_FILE_SIZE:
        raise FileTooLargeError(max_size=MAX_FILE_SIZE, actual_size=len(content))

    # Create attachment record
    file_type = ext[1:]  # Remove the dot
    attachment = ConversationAttachment(
        conversation_id=conv.id,
        original_filename=file.filename or "unknown",
        file_type=file_type,
        file_size=len(content),
        status="processing",
    )
    db.add(attachment)
    await db.commit()
    await db.refresh(attachment)

    # Process file
    try:
        extracted_text = await extract_text_content(content, file.filename or "", ext)

        # Track file conversion usage
        import asyncio

        from services.gemini_converter import _last_conversion_usage
        from services.usage_tracker import track_usage

        if _last_conversion_usage:
            asyncio.create_task(
                track_usage(
                    service="file_conversion",
                    model=_last_conversion_usage.get("model"),
                    input_tokens=_last_conversion_usage.get("input_tokens"),
                    output_tokens=_last_conversion_usage.get("output_tokens"),
                    cost=_last_conversion_usage.get("cost"),
                )
            )

        attachment.extracted_text = extracted_text

        rag = RAGService(db)
        chunk_count = await rag.index_kb_attachment(
            attachment_id=attachment.id,
            conversation_id=conv.id,
            content=extracted_text,
            filename=file.filename or "unknown",
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
        created_at=attachment.created_at.isoformat(),
    )


@router.post("/{conversation_id}/attachments/batch", response_model=BatchUploadResponse)
async def upload_attachments_batch(
    conversation_id: str,
    files: Annotated[list[UploadFile], File(...)],
    db: AsyncSession = Depends(get_db),
):
    """Upload multiple documents to the conversation's knowledge base.

    - Accepts: PDF, DOCX, PPTX files (up to 10 files per request)
    - Max size: 50MB per file
    - Returns immediately with "processing" status
    - Files are processed in the background
    - Frontend should poll for status updates
    """
    MAX_FILES = 10

    if len(files) > MAX_FILES:
        raise FileTooLargeError(max_size=MAX_FILES, actual_size=len(files))

    # Get or create conversation
    conv = await get_conversation_by_file_id(conversation_id, db, create_if_missing=True)
    conv_db_id = conv.id

    results: list[AttachmentResponse] = []

    # Read files and create attachment records immediately
    file_data: list[tuple[str, bytes, str]] = []  # (attachment_id, content, filename)

    for file in files:
        # Validate file extension
        ext = get_file_extension(file.filename or "")
        if ext not in ALLOWED_EXTENSIONS:
            results.append(
                AttachmentResponse(
                    id="",
                    original_filename=file.filename or "unknown",
                    file_type="unknown",
                    file_size=0,
                    status="error",
                    chunk_count=0,
                    error_message=f"Unsupported file type: {ext}",
                    created_at="",
                )
            )
            continue

        # Read file content
        content = await file.read()

        # Validate file size
        if len(content) > MAX_FILE_SIZE:
            results.append(
                AttachmentResponse(
                    id="",
                    original_filename=file.filename or "unknown",
                    file_type="unknown",
                    file_size=len(content),
                    status="error",
                    chunk_count=0,
                    error_message=f"File too large: {len(content)} bytes (max {MAX_FILE_SIZE})",
                    created_at="",
                )
            )
            continue

        # Create attachment record with "processing" status
        file_type = ext[1:]
        attachment = ConversationAttachment(
            conversation_id=conv_db_id,
            original_filename=file.filename or "unknown",
            file_type=file_type,
            file_size=len(content),
            status="processing",
        )
        db.add(attachment)
        await db.commit()
        await db.refresh(attachment)

        results.append(
            AttachmentResponse(
                id=attachment.id,
                original_filename=attachment.original_filename,
                file_type=attachment.file_type,
                file_size=attachment.file_size,
                status=attachment.status,
                chunk_count=attachment.chunk_count,
                error_message=attachment.error_message,
                created_at=attachment.created_at.isoformat(),
            )
        )

        file_data.append((attachment.id, content, file.filename or "unknown"))

    # Start background processing for valid files
    if file_data:
        asyncio.create_task(_process_files_background(conv_db_id, file_data))

    successful = sum(1 for r in results if r.status == "processing")
    failed = sum(1 for r in results if r.status == "error")

    return BatchUploadResponse(results=results, successful=successful, failed=failed)


async def _process_files_background(
    conv_db_id: str, file_data: list[tuple[str, bytes, str]]
) -> None:
    """Process files in the background after the API has returned.

    Each file gets its own database session to avoid concurrency issues.
    """
    MAX_CONCURRENT = 3

    async def process_single_file(attachment_id: str, content: bytes, filename: str) -> None:
        """Process a single file with its own database session."""
        ext = get_file_extension(filename)

        async with async_session() as file_db:
            # Get the attachment record
            attachment = await file_db.get(ConversationAttachment, attachment_id)
            if not attachment:
                logger.error(f"Attachment {attachment_id} not found for background processing")
                return

            try:
                extracted_text = await extract_text_content(content, filename, ext)
                attachment.extracted_text = extracted_text

                rag = RAGService(file_db)
                chunk_count = await rag.index_kb_attachment(
                    attachment_id=attachment.id,
                    conversation_id=conv_db_id,
                    content=extracted_text,
                    filename=filename,
                )

                attachment.chunk_count = chunk_count
                attachment.status = "indexed"
                await file_db.commit()

                logger.info(
                    f"Successfully indexed KB attachment: {filename} ({chunk_count} chunks)"
                )

            except Exception as e:
                logger.error(f"Failed to process KB attachment {filename}: {e}")
                attachment.status = "error"
                attachment.error_message = str(e)
                await file_db.commit()

    # Process files in batches with concurrency limit
    for i in range(0, len(file_data), MAX_CONCURRENT):
        batch = file_data[i : i + MAX_CONCURRENT]
        await asyncio.gather(
            *[process_single_file(att_id, content, fname) for att_id, content, fname in batch],
            return_exceptions=True,  # Don't let one failure stop others
        )


@router.get("/{conversation_id}/attachments", response_model=AttachmentListResponse)
async def list_attachments(conversation_id: str, db: AsyncSession = Depends(get_db)):
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
            created_at=att.created_at.isoformat(),
        )
        for att in attachments
    ]

    total_size = sum(att.file_size for att in attachments)

    return AttachmentListResponse(
        attachments=attachment_list, total_size=total_size, count=len(attachment_list)
    )


@router.delete("/{conversation_id}/attachments/{attachment_id}")
async def delete_attachment(
    conversation_id: str, attachment_id: str, db: AsyncSession = Depends(get_db)
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
        rag = RAGService(db)
        await rag.delete_kb_attachment(attachment_id)
    except Exception as e:
        logger.warning(f"Failed to delete KB vectors: {e}")

    await db.delete(attachment)
    await db.commit()

    return {"status": "deleted", "id": attachment_id}


@router.post("/{conversation_id}/search", response_model=KBSearchResponse)
async def search_knowledge_base(
    conversation_id: str, request: KBSearchRequest, db: AsyncSession = Depends(get_db)
):
    """Search within the conversation's knowledge base."""
    conv = await get_conversation_by_file_id(conversation_id, db)
    if not conv:
        raise ConversationNotFoundError(conversation_id)

    try:
        rag = RAGService(db)
        results = await rag.search_kb(
            conversation_id=conv.id, query=request.query, top_k=request.top_k
        )

        return KBSearchResponse(
            results=[
                KBSearchResult(content=r["content"], source_file=r["source_file"], score=r["score"])
                for r in results
            ]
        )
    except Exception as e:
        logger.error(f"KB search failed: {e}")
        raise InternalError(message="Search failed", details={"error": str(e)})


@router.get("/{conversation_id}/attachments/{attachment_id}/content")
async def get_attachment_content(
    conversation_id: str, attachment_id: str, db: AsyncSession = Depends(get_db)
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
        "chunk_count": attachment.chunk_count,
    }
