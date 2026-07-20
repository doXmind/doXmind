"""Excel editor backend endpoints.

Mirrors ``api/pdf_editor.py``:

* ``POST /api/excel/parse-workbook`` extracts a JSON cell model from an
  uploaded ``.xlsx`` or ``.csv`` so the frontend can render its custom grid without
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

# `services.excel_workbook` imports openpyxl (~80ms+ cold); defer until first
# Excel API call so server boot stays cheap when the user only opens markdown.

logger = logging.getLogger(__name__)
router = APIRouter()

XLSX_CONTENT_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "application/octet-stream",
}
CSV_CONTENT_TYPES = {"text/csv", "application/csv", "text/plain"}
SPREADSHEET_CONTENT_TYPES = XLSX_CONTENT_TYPES | CSV_CONTENT_TYPES


@router.post("/parse-workbook")
async def parse_workbook_route(
    file: UploadFile = File(..., description="XLSX/XLSM binary or CSV text"),
):
    """Parse an uploaded workbook into the JSON cell model.

    See :func:`services.excel_workbook.parse_workbook` for the schema.
    """
    settings = get_settings()
    if file.content_type and file.content_type not in SPREADSHEET_CONTENT_TYPES:
        raise UnsupportedFileTypeError(
            message=f"Expected XLSX or CSV content type, got {file.content_type}"
        )

    spreadsheet_bytes = await file.read()
    if not spreadsheet_bytes:
        raise BadRequestError(message="Empty workbook body")
    if len(spreadsheet_bytes) > settings.max_import_file_size:
        raise FileTooLargeError(
            max_size=settings.max_import_file_size,
            actual_size=len(spreadsheet_bytes),
        )

    from services.excel_workbook import parse_csv_workbook_json_bytes, parse_workbook_json_bytes

    try:
        filename = file.filename or ""
        is_csv = filename.lower().endswith(".csv") or file.content_type in CSV_CONTENT_TYPES
        return Response(
            content=(
                parse_csv_workbook_json_bytes(spreadsheet_bytes)
                if is_csv
                else parse_workbook_json_bytes(spreadsheet_bytes)
            ),
            media_type="application/json",
        )
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
    if file.content_type and file.content_type not in SPREADSHEET_CONTENT_TYPES:
        raise UnsupportedFileTypeError(
            message=f"Expected XLSX or CSV content type, got {file.content_type}"
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

    from services.excel_workbook import csv_to_xlsx_bytes, export_edited_workbook

    try:
        filename = file.filename or ""
        is_csv = filename.lower().endswith(".csv") or file.content_type in CSV_CONTENT_TYPES
        source_bytes = csv_to_xlsx_bytes(xlsx_bytes) if is_csv else xlsx_bytes
        edited = export_edited_workbook(source_bytes, payload)
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
