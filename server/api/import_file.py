"""File import API endpoint - converts PDF, DOCX, MD to Markdown."""

import logging
import os

import markdown
from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.files import get_user_id
from db.database import File as FileModel
from db.database import get_db
from dependencies import resolve_user_api_key
from exceptions import (
    AppException,
    BadRequestError,
    FileTooLargeError,
    InternalError,
    NotFoundError,
    UnsupportedFileTypeError,
)
from services.auth_service import TokenData, require_auth
from services.gemini_converter import (
    convert_file_to_markdown,
    is_converter_configured,
    markitdown_convert,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Configuration
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".pptx", ".md", ".markdown"}


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


def _normalize_conversion_result(result: tuple[str, dict | None] | str) -> tuple[str, dict | None]:
    """Normalize conversion result for backwards compatibility in tests/mocks."""
    if isinstance(result, tuple):
        return result
    return result, None


@router.post("/")
async def import_file(
    file: UploadFile = File(...),
    parent_id: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """
    Import a file (PDF, DOCX, or Markdown) and convert it to a new document.

    - Accepts: PDF, DOCX, MD, MARKDOWN files
    - Max size: 10MB
    - parent_id: Optional folder ID to import into
    - Returns: Created file object
    """
    user_id = get_user_id(token)

    # Resolve user's API key for file conversion and indexing
    user_api_key = await resolve_user_api_key(user_id, db) if user_id else None

    # Validate parent folder if provided
    if parent_id:
        result = await db.execute(
            select(FileModel).where(
                FileModel.id == parent_id,
                FileModel.user_id == user_id,
                FileModel.is_folder.is_(True),
            )
        )
        parent_folder = result.scalar_one_or_none()
        if not parent_folder:
            raise NotFoundError(resource="Parent folder", resource_id=parent_id)

        # Check that parent folder is at root (single-level hierarchy)
        if parent_folder.parent_id is not None:
            raise BadRequestError(
                message="Cannot import into nested folders. Only single-level folders are supported."
            )
    # Validate file extension
    ext = get_file_extension(file.filename or "")
    if ext not in ALLOWED_EXTENSIONS:
        raise UnsupportedFileTypeError(file_type=ext, allowed_types=list(ALLOWED_EXTENSIONS))

    # Read file content
    content = await file.read()

    # Validate file size
    if len(content) > MAX_FILE_SIZE:
        raise FileTooLargeError(max_size=MAX_FILE_SIZE, actual_size=len(content))

    # Convert to markdown
    try:
        if ext in {".md", ".markdown"}:
            # Already markdown, just decode
            md_content = content.decode("utf-8")
        else:
            # Determine if we can use LLM conversion or must fallback
            use_markitdown = False

            if not user_api_key and user_id:
                from services.credit_service import CreditService

                credit_svc = CreditService(db)
                has_credits = await credit_svc.check_credits(user_id)
                if not has_credits:
                    use_markitdown = True

            if not use_markitdown and not is_converter_configured():
                use_markitdown = True

            if use_markitdown:
                # No credits or no LLM configured: use markitdown (zero cost)
                md_content = await markitdown_convert(
                    content, file.filename or "unknown", ext
                )
                conversion_usage = None
            else:
                # Use LLM API for PDF/DOCX/PPTX conversion
                conversion_result = await convert_file_to_markdown(
                    content, file.filename or "unknown", ext, api_key=user_api_key
                )
                md_content, conversion_usage = _normalize_conversion_result(
                    conversion_result
                )

            # Track file conversion usage
            import asyncio

            from services.usage_tracker import track_usage

            if conversion_usage:
                asyncio.create_task(
                    track_usage(
                        service="file_conversion",
                        model=conversion_usage.get("model"),
                        input_tokens=conversion_usage.get("input_tokens"),
                        output_tokens=conversion_usage.get("output_tokens"),
                        cost=conversion_usage.get("cost"),
                        user_id=user_id,
                        is_byok=conversion_usage.get("is_byok", False),
                    )
                )

                from services.credit_service import deduct_credits_for_usage

                asyncio.create_task(
                    deduct_credits_for_usage(
                        user_id=user_id,
                        cost=conversion_usage.get("cost"),
                        service="file_conversion",
                        is_byok=conversion_usage.get("is_byok", False),
                    )
                )
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Conversion failed: {e}")
        raise InternalError(message=f"Failed to convert file: {str(e)}")

    # Convert markdown to HTML for TipTap editor
    html_content = markdown_to_html(md_content)

    # Generate file name (remove extension, add .md)
    base_name = os.path.splitext(file.filename or "Imported")[0]
    new_name = f"{base_name}.md"

    # Create new file in database
    try:
        new_file = FileModel(
            name=new_name,
            content=html_content,
            user_id=user_id,
            parent_id=parent_id,
        )
        db.add(new_file)
        await db.commit()
        await db.refresh(new_file)

        return {
            "id": new_file.id,
            "name": new_file.name,
            "content": new_file.content,
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
