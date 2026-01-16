"""Export API endpoints for downloading files in various formats."""

import io
import logging
import urllib.parse
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import File, get_db
from services.export_service import export_service

logger = logging.getLogger(__name__)
router = APIRouter()

ExportFormat = Literal["markdown", "pdf", "docx"]


@router.get("/{file_id}/{format}")
async def export_file(
    file_id: str,
    format: ExportFormat,
    db: AsyncSession = Depends(get_db)
):
    """Export a file in the specified format.

    Args:
        file_id: The ID of the file to export
        format: The export format (markdown, pdf, or docx)
        db: Database session

    Returns:
        StreamingResponse with the exported file
    """
    # Get the file from database
    result = await db.execute(select(File).where(File.id == file_id))
    file = result.scalar_one_or_none()

    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    # Get filename without extension
    base_filename = file.name
    if base_filename.endswith('.md'):
        base_filename = base_filename[:-3]

    try:
        if format == "markdown":
            content = export_service.export_markdown(file.content, base_filename)
            media_type = "text/markdown"
            extension = "md"
        elif format == "pdf":
            content = export_service.export_pdf(file.content, base_filename)
            media_type = "application/pdf"
            extension = "pdf"
        elif format == "docx":
            content = export_service.export_docx(file.content, base_filename)
            media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            extension = "docx"
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported format: {format}")

        # Create filename for download
        download_filename = f"{base_filename}.{extension}"
        # URL encode the filename for Content-Disposition header
        encoded_filename = urllib.parse.quote(download_filename)

        return StreamingResponse(
            io.BytesIO(content),
            media_type=media_type,
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
            }
        )

    except Exception as e:
        logger.error(f"Export error: {e}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")
