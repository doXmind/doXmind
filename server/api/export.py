"""Document export endpoints."""

from __future__ import annotations

import logging
from urllib.parse import quote

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field

from config import get_settings
from exceptions import FileTooLargeError, InternalError
from services.html_pdf_export import HtmlPdfExportError, export_html_pdf

logger = logging.getLogger(__name__)
router = APIRouter()


class HtmlPdfRequest(BaseModel):
    html: str = Field(min_length=1)
    title: str | None = None


@router.post("/html-pdf")
async def html_pdf(request: HtmlPdfRequest) -> Response:
    """Render editor HTML to PDF bytes with PyMuPDF."""

    settings = get_settings()
    html_bytes = request.html.encode("utf-8")
    if len(html_bytes) > settings.max_import_file_size:
        raise FileTooLargeError(
            max_size=settings.max_import_file_size,
            actual_size=len(html_bytes),
        )

    try:
        pdf = export_html_pdf(request.html)
    except HtmlPdfExportError as exc:
        logger.exception("HTML PDF export failed")
        raise InternalError(message="Failed to export PDF") from exc

    filename = (request.title or "document").strip() or "document"
    if not filename.lower().endswith(".pdf"):
        filename = f"{filename}.pdf"
    encoded = quote(filename)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"},
    )
