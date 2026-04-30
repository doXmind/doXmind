"""File import API endpoint - converts local files to Markdown."""

import logging
import os
import re

import markdown
from fastapi import APIRouter, File, UploadFile

from config import get_settings
from exceptions import (
    AppException,
    FileTooLargeError,
    InternalError,
    UnsupportedFileTypeError,
)

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".pptx", ".md", ".markdown"}
MAX_FILE_SIZE = get_settings().max_import_file_size


def get_file_extension(filename: str) -> str:
    """Get lowercase file extension."""
    return os.path.splitext(filename)[1].lower()


def markdown_to_html(md_content: str) -> str:
    """Convert markdown to HTML for TipTap editor.

    Note: We don't use 'codehilite' extension because it wraps code blocks
    in <div class="codehilite"> with extra <span> tags, which TipTap cannot
    parse correctly. TipTap expects simple <pre><code class="language-xxx">
    format. Frontend uses lowlight for syntax highlighting instead.
    """
    return markdown.markdown(md_content, extensions=["tables", "fenced_code"])


def strip_code_fences(md_content: str) -> str:
    """Strip wrapping Markdown code fences.

    Only removes the outermost fence when the entire content is wrapped in a single
    code fence block (e.g. ```markdown\\n...\\n```). Internal code fences are preserved.
    """
    stripped = md_content.strip()
    match = re.match(r"^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$", stripped)
    if match:
        return match.group(1)
    return md_content


async def upload_to_markdown(file: UploadFile) -> tuple[str, str, str]:
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
            md_content = await convert_with_markitdown(content, ext)
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Conversion failed: {e}")
        raise InternalError(message=f"Failed to convert file: {str(e)}")

    md_content = strip_code_fences(md_content)
    html_content = markdown_to_html(md_content)
    base_name = os.path.splitext(file.filename or "Imported")[0]
    return f"{base_name}.md", md_content, html_content


async def convert_with_markitdown(content: bytes, ext: str) -> str:
    """Convert supported office/PDF formats locally with MarkItDown."""
    import asyncio
    import tempfile

    from markitdown import MarkItDown

    def _convert_sync() -> str:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=True) as tmp:
            tmp.write(content)
            tmp.flush()
            result = MarkItDown().convert(tmp.name)
            return result.text_content or ""

    return await asyncio.to_thread(_convert_sync)


@router.post("/convert")
async def convert_file(file: UploadFile = File(...)):
    """Convert an upload to markdown/html without writing to the SQLite library."""
    name, md_content, html_content = await upload_to_markdown(file)
    return {
        "name": name,
        "content": html_content,
        "content_markdown": md_content,
    }

