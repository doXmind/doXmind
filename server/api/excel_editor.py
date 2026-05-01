"""Excel editor backend endpoints.

Mirrors ``api/pdf_editor.py``:

* ``POST /api/excel/parse-workbook`` extracts a JSON cell model from an
  uploaded ``.xlsx`` so the frontend can render its custom grid without
  shipping openpyxl to the browser.
* ``POST /api/excel/export-edited`` applies the sidecar edit payload onto the
  original workbook and returns the modified ``.xlsx`` bytes for download.
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
from services.excel_workbook import export_edited_workbook, parse_workbook

logger = logging.getLogger(__name__)
router = APIRouter()

XLSX_CONTENT_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "application/octet-stream",
}


@router.post("/parse-workbook")
async def parse_workbook_route(
    file: UploadFile = File(..., description="XLSX/XLSM binary"),
):
    """Parse an uploaded workbook into the JSON cell model.

    See :func:`services.excel_workbook.parse_workbook` for the schema.
    """
    settings = get_settings()
    if file.content_type and file.content_type not in XLSX_CONTENT_TYPES:
        raise UnsupportedFileTypeError(
            message=f"Expected XLSX content type, got {file.content_type}"
        )

    xlsx_bytes = await file.read()
    if not xlsx_bytes:
        raise BadRequestError(message="Empty workbook body")
    if len(xlsx_bytes) > settings.max_import_file_size:
        raise FileTooLargeError(
            max_size=settings.max_import_file_size,
            actual_size=len(xlsx_bytes),
        )

    try:
        return parse_workbook(xlsx_bytes)
    except ValueError as exc:
        raise BadRequestError(message=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("parse_workbook failed")
        raise InternalError(message="Failed to parse workbook") from exc


@router.post("/export-edited")
async def export_edited_route(
    file: UploadFile = File(..., description="Original XLSX/XLSM binary"),
    edits: str = Form(..., description="JSON-encoded ExcelEditorState payload"),
):
    """Apply edits onto the original workbook and stream back the result."""
    settings = get_settings()
    if file.content_type and file.content_type not in XLSX_CONTENT_TYPES:
        raise UnsupportedFileTypeError(
            message=f"Expected XLSX content type, got {file.content_type}"
        )

    xlsx_bytes = await file.read()
    if not xlsx_bytes:
        raise BadRequestError(message="Empty workbook body")
    if len(xlsx_bytes) > settings.max_import_file_size:
        raise FileTooLargeError(
            max_size=settings.max_import_file_size,
            actual_size=len(xlsx_bytes),
        )

    try:
        payload = json.loads(edits)
    except json.JSONDecodeError as exc:
        raise BadRequestError(message="Invalid JSON in 'edits'") from exc
    if not isinstance(payload, dict):
        raise BadRequestError(message="'edits' must be a JSON object")

    try:
        edited = export_edited_workbook(xlsx_bytes, payload)
    except ValueError as exc:
        raise BadRequestError(message=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("export_edited_workbook failed")
        raise InternalError(message="Failed to export workbook") from exc

    return Response(
        content=edited,
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers={"Content-Disposition": 'attachment; filename="edited.xlsx"'},
    )
