"""File import API endpoint - converts local files to Markdown.

Routes by file type to the document_converter service. See
``services/document_converter.py`` for the per-format strategy
(PyMuPDF4LLM fast path, Marker fallback for scans, mammoth for docx,
python-pptx for pptx).
"""

import logging
import os
import re

import markdown
from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import File as FileModel
from db.database import get_db
from exceptions import (
    AppException,
    BadRequestError,
    FileTooLargeError,
    InternalError,
    NotFoundError,
    UnsupportedFileTypeError,
)
from services.document_converter import convert_to_markdown

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".pptx", ".md", ".markdown"}
MAX_FILE_SIZE = get_settings().max_import_file_size


def get_file_extension(filename: str) -> str:
    return os.path.splitext(filename)[1].lower()


def markdown_to_html(md_content: str) -> str:
    """Convert markdown to HTML for TipTap editor.

    No 'codehilite' extension — it wraps blocks in extra spans that TipTap
    can't parse. Frontend uses lowlight for syntax highlighting instead.
    """
    return markdown.markdown(md_content, extensions=["tables", "fenced_code"])


def strip_code_fences(md_content: str) -> str:
    """Strip a single outer ```markdown fence if the whole doc is wrapped in one."""
    stripped = md_content.strip()
    match = re.match(r"^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$", stripped)
    if match:
        return match.group(1)
    return md_content


@router.post("/")
async def import_file(
    file: UploadFile = File(...),
    parent_id: str | None = Form(None),
    mode: str = Form("auto"),
    db: AsyncSession = Depends(get_db),
):
    """Import a file (PDF / DOCX / PPTX / Markdown) and create a new document.

    ``mode`` controls the PDF converter routing:
        * ``auto`` (default) — fast PyMuPDF4LLM path, fall back to Marker
          when the doc looks scanned (very low text yield).
        * ``ocr`` — skip the probe and use Marker for the full pipeline.
          This is the "Import with OCR" menu item; the user has explicitly
          asked for the high-quality (slower) path.

    Other formats ignore ``mode`` — there is no OCR to apply to a DOCX.

    If Marker is needed but its models aren't installed yet the response
    is 409 with ``code: MARKER_MODELS_REQUIRED`` — the frontend prompts
    to download and retries with the same ``mode``.
    """
    force_ocr = mode == "ocr"

    if parent_id:
        result = await db.execute(
            select(FileModel).where(
                FileModel.id == parent_id,
                FileModel.is_folder.is_(True),
            )
        )
        parent_folder = result.scalar_one_or_none()
        if not parent_folder:
            raise NotFoundError(resource="Parent folder", resource_id=parent_id)
        if parent_folder.parent_id is not None:
            raise BadRequestError(
                message="Cannot import into nested folders. Only single-level folders are supported."
            )

    ext = get_file_extension(file.filename or "")
    if ext not in ALLOWED_EXTENSIONS:
        raise UnsupportedFileTypeError(file_type=ext, allowed_types=list(ALLOWED_EXTENSIONS))

    content = await file.read()

    if len(content) > MAX_FILE_SIZE:
        raise FileTooLargeError(max_size=MAX_FILE_SIZE, actual_size=len(content))

    try:
        if ext in {".md", ".markdown"}:
            md_content = content.decode("utf-8")
        else:
            md_content = await convert_to_markdown(content, ext, force_ocr=force_ocr)
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Conversion failed: {e}")
        raise InternalError(message=f"Failed to convert file: {str(e)}")

    md_content = strip_code_fences(md_content)
    html_content = markdown_to_html(md_content)

    base_name = os.path.splitext(file.filename or "Imported")[0]
    new_name = f"{base_name}.md"

    try:
        new_file = FileModel(
            name=new_name,
            content=html_content,
            content_markdown=md_content,
            parent_id=parent_id,
        )
        db.add(new_file)
        await db.commit()
        await db.refresh(new_file)

        return {
            "id": new_file.id,
            "name": new_file.name,
            "content": new_file.content,
            "content_markdown": md_content,
            "parent_id": new_file.parent_id,
            "is_folder": new_file.is_folder,
            "position": new_file.position,
            "created_at": new_file.created_at.isoformat(),
            "updated_at": new_file.updated_at.isoformat(),
        }
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Failed to create file: {e}")
        raise InternalError(message=str(e))
