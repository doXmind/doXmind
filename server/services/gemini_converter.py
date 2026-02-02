"""Gemini-based file converter service.

Uses Google's Gemini API to convert PDF, DOCX, PPTX files to Markdown.
"""

import asyncio
import io
import logging
from functools import lru_cache

from docx import Document
from google import genai
from google.genai import types

from config import get_settings

logger = logging.getLogger(__name__)

# MIME types for formats Gemini supports natively
NATIVE_MIME_TYPES = {
    ".pdf": "application/pdf",
}

# File types that need pre-processing before Gemini
PREPROCESSED_TYPES = {".docx", ".pptx"}

# Default model for conversion
DEFAULT_MODEL = "gemini-2.5-flash-lite"

# Conversion prompt for native file uploads (PDF, images)
CONVERSION_PROMPT = """Convert this document to well-formatted Markdown.

Requirements:
- Preserve all text content accurately
- Maintain the document structure (headings, lists, tables, etc.)
- Use appropriate Markdown syntax for formatting
- For tables, use proper Markdown table syntax
- For code blocks, use fenced code blocks with language hints if identifiable
- Preserve any mathematical formulas using LaTeX syntax ($...$ for inline, $$...$$ for block)
- Do not add any commentary or explanations, just output the converted Markdown
- If the document contains images with text, include the text content

Output only the Markdown content, nothing else."""

# Conversion prompt for pre-extracted text (DOCX, PPTX)
TEXT_CONVERSION_PROMPT = """Format the following extracted document content into well-structured Markdown.

Requirements:
- Preserve all text content accurately
- Infer and apply appropriate heading levels based on context
- Use appropriate Markdown syntax for formatting (bold, italic, lists, etc.)
- For tables, use proper Markdown table syntax
- For code blocks, use fenced code blocks with language hints if identifiable
- Preserve any mathematical formulas using LaTeX syntax ($...$ for inline, $$...$$ for block)
- Do not add any commentary or explanations, just output the formatted Markdown
- Clean up any formatting artifacts from the extraction process

Document content:
"""


@lru_cache
def get_gemini_client() -> genai.Client:
    """Get cached Gemini client instance."""
    settings = get_settings()
    if not settings.google_api_key:
        raise ValueError("GOOGLE_API_KEY is not configured")
    return genai.Client(api_key=settings.google_api_key)


def extract_docx_content(content: bytes) -> str:
    """Extract text content from a DOCX file.

    Args:
        content: Raw DOCX file bytes

    Returns:
        Extracted text content with basic structure preserved
    """
    doc = Document(io.BytesIO(content))
    parts = []

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue

        # Try to preserve heading structure based on style
        style_name = para.style.name.lower() if para.style else ""
        if "heading" in style_name:
            # Extract heading level from style name (e.g., "Heading 1" -> 1)
            try:
                level = int("".join(filter(str.isdigit, style_name)) or "1")
                level = min(level, 6)  # Cap at h6
                parts.append(f"{'#' * level} {text}")
            except ValueError:
                parts.append(f"# {text}")
        elif "title" in style_name:
            parts.append(f"# {text}")
        else:
            parts.append(text)

    # Extract tables
    for table in doc.tables:
        table_rows = []
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            table_rows.append("| " + " | ".join(cells) + " |")

        if table_rows:
            # Add header separator after first row
            header_sep = "| " + " | ".join(["---"] * len(table.rows[0].cells)) + " |"
            table_rows.insert(1, header_sep)
            parts.append("\n".join(table_rows))

    return "\n\n".join(parts)


async def convert_file_to_markdown(
    content: bytes, filename: str, extension: str, model: str = DEFAULT_MODEL
) -> str:
    """Convert file content to Markdown using Gemini API.

    Args:
        content: Raw file bytes
        filename: Original filename (for logging)
        extension: File extension (e.g., '.pdf', '.docx')
        model: Gemini model to use for conversion

    Returns:
        Converted Markdown content

    Raises:
        ValueError: If file type is not supported or API key not configured
        Exception: If conversion fails
    """
    ext_lower = extension.lower()
    supported_types = set(NATIVE_MIME_TYPES.keys()) | PREPROCESSED_TYPES

    if ext_lower not in supported_types:
        raise ValueError(f"Unsupported file type: {extension}")

    # Handle DOCX files: extract text first, then format with Gemini
    if ext_lower == ".docx":
        return await _convert_docx_to_markdown(content, filename, model)

    # Handle PPTX files (not yet implemented)
    if ext_lower == ".pptx":
        raise ValueError("PPTX conversion not yet implemented. Please convert to PDF first.")

    # Handle native formats (PDF) - send directly to Gemini
    mime_type = NATIVE_MIME_TYPES[ext_lower]

    def _sync_generate() -> str:
        """Synchronous Gemini API call to run in thread pool."""
        client = get_gemini_client()
        response = client.models.generate_content(
            model=model,
            contents=[
                types.Part.from_bytes(
                    data=content,
                    mime_type=mime_type,
                ),
                CONVERSION_PROMPT,
            ],
        )
        return response.text

    try:
        markdown_content = await asyncio.to_thread(_sync_generate)

        if not markdown_content:
            raise ValueError("Gemini returned empty response")

        logger.info(f"Successfully converted {filename} to Markdown using Gemini")
        return markdown_content

    except Exception as e:
        logger.error(f"Gemini conversion failed for {filename}: {e}")
        raise


async def _convert_docx_to_markdown(
    content: bytes, filename: str, model: str = DEFAULT_MODEL
) -> str:
    """Convert DOCX file to Markdown by extracting text and formatting with Gemini.

    Args:
        content: Raw DOCX file bytes
        filename: Original filename (for logging)
        model: Gemini model to use for formatting

    Returns:
        Formatted Markdown content
    """
    # Extract text content from DOCX
    try:
        extracted_text = await asyncio.to_thread(extract_docx_content, content)
    except Exception as e:
        logger.error(f"Failed to extract text from {filename}: {e}")
        raise ValueError(f"Failed to read DOCX file: {e}")

    if not extracted_text.strip():
        raise ValueError("DOCX file appears to be empty")

    # Use Gemini to format the extracted text as proper Markdown
    def _sync_format() -> str:
        client = get_gemini_client()
        response = client.models.generate_content(
            model=model, contents=[TEXT_CONVERSION_PROMPT + extracted_text]
        )
        return response.text

    try:
        markdown_content = await asyncio.to_thread(_sync_format)

        if not markdown_content:
            raise ValueError("Gemini returned empty response")

        logger.info(f"Successfully converted {filename} to Markdown using Gemini")
        return markdown_content

    except Exception as e:
        logger.error(f"Gemini formatting failed for {filename}: {e}")
        raise


def is_gemini_configured() -> bool:
    """Check if Gemini API is properly configured."""
    settings = get_settings()
    return bool(settings.google_api_key)
