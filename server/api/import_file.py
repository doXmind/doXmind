"""File import API endpoint - converts PDF, DOCX, MD to Markdown."""

import logging
import os

import markdown
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from api.files import get_user_id
from db.database import File as FileModel
from db.database import get_db
from services.auth_service import TokenData, require_auth
from services.gemini_converter import convert_file_to_markdown, is_gemini_configured
from services.rag_service import RAGService

logger = logging.getLogger(__name__)
router = APIRouter()

# Configuration
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_EXTENSIONS = {'.pdf', '.docx', '.md', '.markdown'}


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
    return markdown.markdown(
        md_content,
        extensions=['tables', 'fenced_code']
    )


@router.post("/")
async def import_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth)
):
    """
    Import a file (PDF, DOCX, or Markdown) and convert it to a new document.

    - Accepts: PDF, DOCX, MD, MARKDOWN files
    - Max size: 10MB
    - Returns: Created file object
    """
    user_id = get_user_id(token)
    # Validate file extension
    ext = get_file_extension(file.filename or "")
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Read file content
    content = await file.read()

    # Validate file size
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024 * 1024)}MB"
        )

    # Convert to markdown
    try:
        if ext in {'.md', '.markdown'}:
            # Already markdown, just decode
            md_content = content.decode('utf-8')
        else:
            # Check if Gemini is configured
            if not is_gemini_configured():
                raise HTTPException(
                    status_code=500,
                    detail="File conversion requires GEMINI_API_KEY to be configured"
                )
            # Use Gemini API for PDF and DOCX conversion
            md_content = await convert_file_to_markdown(content, file.filename, ext)
    except Exception as e:
        logger.error(f"Conversion failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to convert file: {str(e)}"
        )

    # Convert markdown to HTML for TipTap editor
    html_content = markdown_to_html(md_content)

    # Generate file name (remove extension, add .md)
    base_name = os.path.splitext(file.filename or "Imported")[0]
    new_name = f"{base_name}.md"

    # Create new file in database
    try:
        new_file = FileModel(name=new_name, content=html_content, user_id=user_id)
        db.add(new_file)
        await db.commit()
        await db.refresh(new_file)

        # Index in vector store
        try:
            rag = RAGService(db)
            await rag.index_file(
                file_id=new_file.id,
                content=html_content,
                metadata={"name": new_name, "user_id": user_id}
            )
            await rag.index_file_sentences(
                file_id=new_file.id,
                content=html_content,
                metadata={"name": new_name, "user_id": user_id}
            )
        except Exception as e:
            logger.warning(f"Failed to index imported file: {e}")

        return {
            "id": new_file.id,
            "name": new_file.name,
            "content": new_file.content,
            "created_at": new_file.created_at.isoformat(),
            "updated_at": new_file.updated_at.isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to create file: {e}")
        raise HTTPException(status_code=500, detail=str(e))
