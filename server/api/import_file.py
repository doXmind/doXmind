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
from fastapi import APIRouter, File, Form, UploadFile

from config import get_settings
from exceptions import (
    AppException,
    FileTooLargeError,
    InternalError,
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


async def upload_to_markdown(
    file: UploadFile,
    *,
    mode: str = "auto",
) -> tuple[str, str, str]:
    """Read and convert an upload to (name, markdown, html) without storing it."""
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
            md_content = await convert_to_markdown(content, ext, force_ocr=mode == "ocr")
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Conversion failed: {e}")
        raise InternalError(message=f"Failed to convert file: {str(e)}")

    md_content = strip_code_fences(md_content)
    html_content = markdown_to_html(md_content)
    base_name = os.path.splitext(file.filename or "Imported")[0]
    return f"{base_name}.md", md_content, html_content


@router.post("/convert")
async def convert_file(file: UploadFile = File(...), mode: str = Form("auto")):
    """Convert an upload to markdown/html without writing to the document workspace."""
    name, md_content, html_content = await upload_to_markdown(file, mode=mode)
    return {
        "name": name,
        "content": html_content,
        "content_markdown": md_content,
    }
