"""Data files API for code execution analysis.

Handles upload, listing, and deletion of data files (CSV, Excel, JSON, etc.)
that are passed to the code execution tool.

Unlike KB files, data files are NOT vectorized. They are stored locally
and passed directly to the API as inline content.
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

from api.files import get_user_id
from config import get_settings
from db.database import ConversationDataFile, get_db
from dependencies import get_conversation_by_file_id
from exceptions import (
    ConversationNotFoundError,
    FileTooLargeError,
    NotFoundError,
    UnsupportedFileTypeError,
)
from services.auth_service import TokenData, require_auth
from services.data_parser_service import get_data_parser_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data-files", tags=["data-files"])

settings = get_settings()

# Allowed file extensions for data files
DATA_FILE_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json", ".txt", ".py", ".png", ".jpg", ".jpeg"}

# Maximum file size (50MB)
DATA_FILE_MAX_SIZE = 50 * 1024 * 1024

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


class DataFileListResponse(BaseModel):
    """Response model for listing data files."""

    files: list[DataFileResponse]


@router.post("/{conversation_id}/files", response_model=DataFileResponse)
async def upload_data_file(
    conversation_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Upload a data file for code execution analysis.

    Accepts: CSV, XLSX, XLS, JSON, TXT, PY, PNG, JPG files up to 50MB.
    Files are stored locally and passed inline to the AI model.
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
    conversation = await get_conversation_by_file_id(
        conversation_id,
        db,
        create_if_missing=True,
        user_id=get_user_id(auth),
    )
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

    def _write_file_sync(path: str, data: bytes) -> None:
        with open(path, "wb") as f:
            f.write(data)

    await asyncio.to_thread(_write_file_sync, storage_path, content)

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
    )

    db.add(data_file)
    await db.commit()
    await db.refresh(data_file)

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
    )


@router.get("/{conversation_id}/files", response_model=DataFileListResponse)
async def list_data_files(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """List all data files for a conversation."""
    # Verify conversation exists (supports both conversation.id and file_id)
    conversation = await get_conversation_by_file_id(
        conversation_id,
        db,
        create_if_missing=True,
        user_id=get_user_id(auth),
    )
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
            )
            for f in files
        ]
    )


@router.get("/{conversation_id}/files/{file_id}", response_model=DataFileResponse)
async def get_data_file(
    conversation_id: str,
    file_id: str,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Get a specific data file."""
    # Resolve conversation (supports both conversation.id and file_id)
    conversation = await get_conversation_by_file_id(
        conversation_id,
        db,
        user_id=get_user_id(auth),
    )
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
    )


@router.delete("/{conversation_id}/files/{file_id}")
async def delete_data_file(
    conversation_id: str,
    file_id: str,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Delete a data file."""
    # Resolve conversation (supports both conversation.id and file_id)
    conversation = await get_conversation_by_file_id(
        conversation_id,
        db,
        user_id=get_user_id(auth),
    )
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


async def get_data_file_content(db: AsyncSession, file_id: str) -> tuple[bytes, str, str] | None:
    """Get the content of a data file.

    Returns:
        Tuple of (content_bytes, filename, mime_type) or None if not found.
    """
    result = await db.execute(
        select(ConversationDataFile).where(ConversationDataFile.id == file_id)
    )
    data_file = result.scalar_one_or_none()

    if not data_file or not data_file.storage_path:
        return None

    if not os.path.exists(data_file.storage_path):
        return None

    def _read_file_sync(path: str) -> bytes:
        with open(path, "rb") as f:
            return f.read()

    content = await asyncio.to_thread(_read_file_sync, data_file.storage_path)

    return (
        content,
        data_file.original_filename,
        data_file.mime_type or "application/octet-stream",
    )
