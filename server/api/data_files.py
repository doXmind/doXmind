"""Data files API for code execution analysis.

Handles upload, listing, and deletion of data files (CSV, Excel, JSON, etc.)
that are passed to Claude's code execution sandbox.

Unlike KB files, data files are NOT vectorized. They are stored temporarily
and passed directly to the API as base64 content.

Upload strategy:
- Small files (<500KB): stored locally, sent as base64 inline (no Files API call)
- Large files: uploaded to Claude Files API asynchronously after local upload
  This reduces first-message latency by pre-uploading files in the background.
"""

import asyncio
import hashlib
import logging
import os
import tempfile
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import ConversationDataFile, async_session, get_db
from dependencies import get_conversation_by_file_id
from exceptions import (
    ConversationNotFoundError,
    FileTooLargeError,
    NotFoundError,
    UnsupportedFileTypeError,
)
from services.anthropic_files_service import get_anthropic_files_service
from services.data_parser_service import get_data_parser_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data-files", tags=["data-files"])

# Keep references to background tasks to prevent garbage collection
# See: https://docs.python.org/3/library/asyncio-task.html#creating-tasks
_background_tasks: set = set()

settings = get_settings()

# Allowed file extensions for data files
DATA_FILE_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json", ".txt", ".py", ".png", ".jpg", ".jpeg"}

# Maximum file size (50MB)
DATA_FILE_MAX_SIZE = 50 * 1024 * 1024

# Threshold for inline base64 vs Files API (500KB)
# Files smaller than this are sent inline as base64
# Files larger than this are uploaded to Claude Files API
INLINE_FILE_THRESHOLD = 500 * 1024

# MIME type mapping
MIME_TYPES = {
    ".csv": "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".json": "application/json",
    ".txt": "text/plain",
    ".py": "text/x-python",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}

# File types that should skip Claude Files API (images, PDFs use different mechanisms)
SKIP_CLAUDE_UPLOAD_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"}


class DataFileResponse(BaseModel):
    """Response model for data file."""

    id: str
    filename: str
    fileType: str
    fileSize: int
    mimeType: str | None
    status: str
    previewData: list | None = None
    columnNames: list | None = None
    rowCount: int = 0
    # Claude Files API status
    claudeUploadStatus: str = "pending"  # pending, uploading, ready, error, skipped
    claudeFileId: str | None = None


class DataFileListResponse(BaseModel):
    """Response model for listing data files."""

    files: list[DataFileResponse]


async def upload_to_claude_background(file_id: str, content: bytes, filename: str, mime_type: str):
    """Background task to upload file to Claude Files API.

    This runs asynchronously after the API response is sent, so the user
    doesn't have to wait for the Claude upload to complete.
    """
    async with async_session() as db:
        try:
            # Get the data file record
            result = await db.execute(
                select(ConversationDataFile).where(ConversationDataFile.id == file_id)
            )
            data_file = result.scalar_one_or_none()

            if not data_file:
                logger.error(f"Data file {file_id} not found for Claude upload")
                return

            # Update status to uploading
            data_file.claude_upload_status = "uploading"
            await db.commit()

            # Upload to Claude Files API
            files_service = get_anthropic_files_service()
            claude_file_id = await files_service.upload_file(
                content=content, filename=filename, mime_type=mime_type
            )

            if claude_file_id:
                data_file.claude_file_id = claude_file_id
                data_file.claude_upload_status = "ready"
                logger.info(f"Successfully uploaded {filename} to Claude: {claude_file_id}")
            else:
                data_file.claude_upload_status = "error"
                data_file.claude_upload_error = "Failed to upload to Claude Files API"
                logger.error(f"Failed to upload {filename} to Claude")

            await db.commit()

        except Exception as e:
            logger.error(f"Error uploading {filename} to Claude: {e}")
            # Update status to error
            try:
                result = await db.execute(
                    select(ConversationDataFile).where(ConversationDataFile.id == file_id)
                )
                data_file = result.scalar_one_or_none()
                if data_file:
                    data_file.claude_upload_status = "error"
                    data_file.claude_upload_error = str(e)
                    await db.commit()
            except Exception as db_error:
                logger.error(f"Failed to update error status: {db_error}")


@router.post("/{conversation_id}/files", response_model=DataFileResponse)
async def upload_data_file(
    conversation_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload a data file for code execution analysis.

    Accepts: CSV, XLSX, XLS, JSON, TXT, PY, PNG, JPG files up to 50MB.

    Upload strategy:
    - Small files (<500KB): stored locally, will be sent inline as base64
    - Large files: uploaded to Claude Files API asynchronously in background
    - Images/PDFs: skip Claude Files API (use native multimodal support)
    """
    # Validate file extension
    filename = file.filename or "unknown"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in DATA_FILE_EXTENSIONS:
        raise UnsupportedFileTypeError(file_type=ext, allowed_types=list(DATA_FILE_EXTENSIONS))

    # Read file content
    content = await file.read()
    file_size = len(content)

    # Validate file size
    if file_size > DATA_FILE_MAX_SIZE:
        raise FileTooLargeError(max_size=DATA_FILE_MAX_SIZE, actual_size=file_size)

    # Verify conversation exists (supports both conversation.id and file_id)
    conversation = await get_conversation_by_file_id(conversation_id, db, create_if_missing=True)
    if not conversation:
        raise ConversationNotFoundError(conversation_id=conversation_id)

    # Get MIME type
    mime_type = MIME_TYPES.get(ext, file.content_type)

    # Calculate content hash for deduplication
    content_hash = hashlib.sha256(content).hexdigest()

    # Parse file for preview (if applicable)
    parser = get_data_parser_service()
    parse_result = await parser.parse_file(content, filename, mime_type)

    # Save file to temporary storage
    file_id = str(uuid.uuid4())
    temp_dir = os.path.join(tempfile.gettempdir(), "doxmind_data_files")
    os.makedirs(temp_dir, exist_ok=True)
    storage_path = os.path.join(temp_dir, f"{file_id}{ext}")

    with open(storage_path, "wb") as f:
        f.write(content)

    # Determine Claude upload strategy
    # Skip for: images, PDFs (use native multimodal), small files (use base64 inline)
    should_skip_claude = mime_type in SKIP_CLAUDE_UPLOAD_TYPES or file_size < INLINE_FILE_THRESHOLD

    claude_upload_status = "skipped" if should_skip_claude else "pending"

    # Create database record
    data_file = ConversationDataFile(
        id=file_id,
        conversation_id=conversation.id,
        original_filename=filename,
        file_type=ext.lstrip("."),
        file_size=file_size,
        mime_type=mime_type,
        storage_path=storage_path,
        preview_data=parse_result.get("preview_data"),
        column_names=parse_result.get("column_names"),
        row_count=parse_result.get("row_count", 0),
        status="ready",
        content_hash=content_hash,
        claude_upload_status=claude_upload_status,
    )

    db.add(data_file)
    await db.commit()
    await db.refresh(data_file)

    # Start background upload to Claude if needed
    if not should_skip_claude:
        # Use asyncio.create_task for true async background execution
        # BackgroundTasks in FastAPI doesn't work well with async functions
        # IMPORTANT: Store task reference to prevent garbage collection
        task = asyncio.create_task(
            upload_to_claude_background(file_id, content, filename, mime_type)
        )
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
        logger.info(f"Started background upload to Claude for {filename} ({file_size} bytes)")

    return DataFileResponse(
        id=data_file.id,
        filename=data_file.original_filename,
        fileType=data_file.file_type,
        fileSize=data_file.file_size,
        mimeType=data_file.mime_type,
        status=data_file.status,
        previewData=data_file.preview_data,
        columnNames=data_file.column_names,
        rowCount=data_file.row_count,
        claudeUploadStatus=data_file.claude_upload_status,
        claudeFileId=data_file.claude_file_id,
    )


@router.get("/{conversation_id}/files", response_model=DataFileListResponse)
async def list_data_files(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
):
    """List all data files for a conversation."""
    # Verify conversation exists (supports both conversation.id and file_id)
    conversation = await get_conversation_by_file_id(conversation_id, db, create_if_missing=True)
    if not conversation:
        raise ConversationNotFoundError(conversation_id=conversation_id)

    # Get data files
    result = await db.execute(
        select(ConversationDataFile)
        .where(ConversationDataFile.conversation_id == conversation.id)
        .order_by(ConversationDataFile.created_at.desc())
    )
    files = result.scalars().all()

    return DataFileListResponse(
        files=[
            DataFileResponse(
                id=f.id,
                filename=f.original_filename,
                fileType=f.file_type,
                fileSize=f.file_size,
                mimeType=f.mime_type,
                status=f.status,
                previewData=f.preview_data,
                columnNames=f.column_names,
                rowCount=f.row_count,
                claudeUploadStatus=f.claude_upload_status or "pending",
                claudeFileId=f.claude_file_id,
            )
            for f in files
        ]
    )


@router.get("/{conversation_id}/files/{file_id}", response_model=DataFileResponse)
async def get_data_file(
    conversation_id: str,
    file_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a specific data file."""
    # Resolve conversation (supports both conversation.id and file_id)
    conversation = await get_conversation_by_file_id(conversation_id, db)
    if not conversation:
        raise ConversationNotFoundError(conversation_id=conversation_id)

    result = await db.execute(
        select(ConversationDataFile)
        .where(ConversationDataFile.id == file_id)
        .where(ConversationDataFile.conversation_id == conversation.id)
    )
    data_file = result.scalar_one_or_none()

    if not data_file:
        raise NotFoundError(resource="Data file", resource_id=file_id)

    return DataFileResponse(
        id=data_file.id,
        filename=data_file.original_filename,
        fileType=data_file.file_type,
        fileSize=data_file.file_size,
        mimeType=data_file.mime_type,
        status=data_file.status,
        previewData=data_file.preview_data,
        columnNames=data_file.column_names,
        rowCount=data_file.row_count,
        claudeUploadStatus=data_file.claude_upload_status or "pending",
        claudeFileId=data_file.claude_file_id,
    )


@router.delete("/{conversation_id}/files/{file_id}")
async def delete_data_file(
    conversation_id: str,
    file_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a data file."""
    # Resolve conversation (supports both conversation.id and file_id)
    conversation = await get_conversation_by_file_id(conversation_id, db)
    if not conversation:
        raise ConversationNotFoundError(conversation_id=conversation_id)

    result = await db.execute(
        select(ConversationDataFile)
        .where(ConversationDataFile.id == file_id)
        .where(ConversationDataFile.conversation_id == conversation.id)
    )
    data_file = result.scalar_one_or_none()

    if not data_file:
        raise NotFoundError(resource="Data file", resource_id=file_id)

    # Delete the physical file
    if data_file.storage_path and os.path.exists(data_file.storage_path):
        try:
            os.remove(data_file.storage_path)
        except Exception as e:
            logger.warning(f"Failed to delete file {data_file.storage_path}: {e}")

    # Delete database record
    await db.delete(data_file)
    await db.commit()

    return {"success": True}


async def get_data_file_content(
    db: AsyncSession, file_id: str
) -> tuple[bytes, str, str, str | None, str] | None:
    """Get the content of a data file.

    Returns:
        Tuple of (content_bytes, filename, mime_type, claude_file_id, claude_upload_status)
        or None if not found.
    """
    result = await db.execute(
        select(ConversationDataFile).where(ConversationDataFile.id == file_id)
    )
    data_file = result.scalar_one_or_none()

    if not data_file or not data_file.storage_path:
        return None

    if not os.path.exists(data_file.storage_path):
        return None

    with open(data_file.storage_path, "rb") as f:
        content = f.read()

    return (
        content,
        data_file.original_filename,
        data_file.mime_type or "application/octet-stream",
        data_file.claude_file_id,
        data_file.claude_upload_status or "pending",
    )
