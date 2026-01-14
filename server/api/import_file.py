"""File import API endpoint - converts PDF, DOCX, MD to Markdown."""

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
import tempfile
import os
import logging

from markitdown import MarkItDown
import markdown

from db.database import get_db, File as FileModel
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
    """Convert markdown to HTML for TipTap editor."""
    return markdown.markdown(
        md_content,
        extensions=['tables', 'fenced_code', 'codehilite']
    )


@router.post("/")
async def import_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Import a file (PDF, DOCX, or Markdown) and convert it to a new document.

    - Accepts: PDF, DOCX, MD, MARKDOWN files
    - Max size: 10MB
    - Returns: Created file object
    """
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
            # Use MarkItDown for PDF and DOCX
            md_content = await convert_with_markitdown(content, file.filename, ext)
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
        new_file = FileModel(name=new_name, content=html_content)
        db.add(new_file)
        await db.commit()
        await db.refresh(new_file)

        # Index in vector store
        try:
            rag = RAGService()
            await rag.index_file(
                file_id=new_file.id,
                content=html_content,
                metadata={"name": new_name}
            )
            await rag.index_file_sentences(
                file_id=new_file.id,
                content=html_content,
                metadata={"name": new_name}
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


async def convert_with_markitdown(content: bytes, filename: str, ext: str) -> str:
    """Convert file content to markdown using MarkItDown."""
    # MarkItDown requires a file path, so we need to use a temp file
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        md = MarkItDown()
        result = md.convert(tmp_path)
        return result.text_content
    finally:
        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
