"""Export API endpoints for downloading files in various formats."""

import io
import logging
import urllib.parse
from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.files import get_user_id
from config import get_cors_headers
from db.database import File, get_db
from exceptions import AppException, BadRequestError, DocumentNotFoundError, InternalError
from services.auth_service import TokenData, require_auth
from services.export_service import get_export_service

logger = logging.getLogger(__name__)
router = APIRouter()

ExportFormat = Literal["markdown", "pdf", "docx"]


@router.get("/{file_id}/{format}")
async def export_file(
    file_id: str,
    format: ExportFormat,
    request: Request,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Export a file in the specified format.

    Args:
        file_id: The ID of the file to export
        format: The export format (markdown, pdf, or docx)
        db: Database session
        token: Auth token for user isolation

    Returns:
        StreamingResponse with the exported file
    """
    user_id = get_user_id(token)

    # Get the file from database (with user isolation, exclude trash)
    query = select(File).where(File.id == file_id, File.deleted_at.is_(None))
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))
    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise DocumentNotFoundError(file_id=file_id)

    # Get filename without extension
    base_filename = file.name
    if base_filename.endswith(".md"):
        base_filename = base_filename[:-3]

    # Local desktop edition — no author lookup.
    author_name = None

    # Build metadata for title page rendering
    metadata = {
        "title": base_filename,
        "icon": file.icon,
        "author": author_name,
        "cover_image_url": file.cover_image_url,
        "cover_position": file.cover_position or 0.5,
        "created_at": file.created_at,
        "updated_at": file.updated_at,
    }

    try:
        svc = get_export_service()
        if format == "markdown":
            content = svc.export_markdown(file.content, base_filename)
            media_type = "text/markdown"
            extension = "md"
        elif format == "pdf":
            content = svc.export_pdf(file.content, base_filename, metadata=metadata)
            media_type = "application/pdf"
            extension = "pdf"
        elif format == "docx":
            content = svc.export_docx(file.content, base_filename, metadata=metadata)
            media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            extension = "docx"
        else:
            raise BadRequestError(message=f"Unsupported format: {format}")

        # Create filename for download
        download_filename = f"{base_filename}.{extension}"
        # URL encode the filename for Content-Disposition header
        encoded_filename = urllib.parse.quote(download_filename)

        return StreamingResponse(
            io.BytesIO(content),
            media_type=media_type,
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
                **get_cors_headers(request.headers.get("origin")),
            },
        )

    except AppException:
        raise
    except Exception as e:
        logger.error(f"Export error: {e}", exc_info=True)
        raise InternalError(message=f"Export failed: {str(e)}")
