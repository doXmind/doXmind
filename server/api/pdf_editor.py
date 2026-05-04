"""PDF editor backend endpoints.

Provides layout-aware paragraph block extraction (Phase 1 of the PDF
text-model upgrade). The frontend uses these blocks to render PDF text as
flowable paragraphs instead of single text runs.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import Response

from config import get_settings
from exceptions import (
    BadRequestError,
    FileTooLargeError,
    InternalError,
    UnsupportedFileTypeError,
)

# `services.pdf_blocks` and `services.pdf_export` import pymupdf (heavy);
# defer until first PDF API call so server boot stays cheap when the user
# only opens markdown / Excel.

logger = logging.getLogger(__name__)
router = APIRouter()


def _parse_page_indexes(raw: str | None) -> list[int] | None:
    if not raw:
        return None
    out: list[int] = []
    for piece in raw.split(","):
        piece = piece.strip()
        if not piece:
            continue
        try:
            value = int(piece)
        except ValueError as exc:
            raise BadRequestError(message=f"Invalid pageIndexes value '{piece}'") from exc
        if value < 0:
            raise BadRequestError(message=f"pageIndexes must be non-negative; got {value}")
        out.append(value)
    return out or None


@router.post("/parse-blocks")
async def parse_blocks(
    file: UploadFile = File(..., description="PDF binary"),
    page_indexes: str | None = Form(
        None,
        alias="pageIndexes",
        description="Comma-separated zero-based page indexes; omitted = all",
    ),
):
    """Extract paragraph blocks from a PDF using PyMuPDF.

    Returns the layout tree the frontend renders as flowable paragraphs.
    See ``services.pdf_blocks.parse_pdf_blocks`` for the full schema.
    """
    settings = get_settings()
    if file.content_type and file.content_type not in {
        "application/pdf",
        "application/octet-stream",
    }:
        raise UnsupportedFileTypeError(message=f"Expected application/pdf, got {file.content_type}")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise BadRequestError(message="Empty PDF body")
    if len(pdf_bytes) > settings.max_import_file_size:
        raise FileTooLargeError(
            max_size=settings.max_import_file_size,
            actual_size=len(pdf_bytes),
        )

    indexes = _parse_page_indexes(page_indexes)

    from services.pdf_blocks import parse_pdf_blocks

    try:
        result = parse_pdf_blocks(pdf_bytes, page_indexes=indexes)
    except ValueError as exc:
        raise BadRequestError(message=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("parse_pdf_blocks failed")
        raise InternalError(message="Failed to parse PDF blocks") from exc

    return result


@router.post("/export-edited")
async def export_edited(
    file: UploadFile = File(..., description="Original PDF binary"),
    edits: str = Form(..., description="JSON-encoded edit payload"),
):
    """Apply paragraph / single-run / free-text / highlight edits to a PDF.

    Returns the edited PDF binary. See ``services.pdf_export.export_edited_pdf``
    for the full edit payload schema.
    """
    settings = get_settings()
    if file.content_type and file.content_type not in {
        "application/pdf",
        "application/octet-stream",
    }:
        raise UnsupportedFileTypeError(message=f"Expected application/pdf, got {file.content_type}")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise BadRequestError(message="Empty PDF body")
    if len(pdf_bytes) > settings.max_import_file_size:
        raise FileTooLargeError(
            max_size=settings.max_import_file_size,
            actual_size=len(pdf_bytes),
        )

    try:
        payload = json.loads(edits)
    except json.JSONDecodeError as exc:
        raise BadRequestError(message="Invalid JSON in 'edits'") from exc
    if not isinstance(payload, dict):
        raise BadRequestError(message="'edits' must be a JSON object")

    from services.pdf_export import export_edited_pdf

    try:
        edited_bytes = export_edited_pdf(pdf_bytes, payload)
    except ValueError as exc:
        raise BadRequestError(message=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("export_edited_pdf failed")
        raise InternalError(message="Failed to export edited PDF") from exc

    return Response(
        content=edited_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="edited.pdf"'},
    )
