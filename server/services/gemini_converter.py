"""File converter service via OpenRouter (OpenAI-compatible API).

Converts PDF, DOCX, PPTX files to Markdown using multimodal LLM models.
"""

import asyncio
import base64
import io
import logging
from functools import lru_cache

from openai import AsyncOpenAI

from config import get_settings

logger = logging.getLogger(__name__)

# MIME types for formats supported natively via multimodal input
NATIVE_MIME_TYPES = {
    ".pdf": "application/pdf",
}

# File types that need pre-processing before LLM formatting
PREPROCESSED_TYPES = {".docx", ".pptx"}

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
def _get_client() -> AsyncOpenAI:
    """Get cached OpenRouter client instance."""
    settings = get_settings()
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured")
    return AsyncOpenAI(
        api_key=settings.openrouter_api_key,
        base_url=settings.openrouter_base_url,
    )


def extract_docx_content(content: bytes) -> str:
    """Extract text content from a DOCX file.

    Args:
        content: Raw DOCX file bytes

    Returns:
        Extracted text content with basic structure preserved
    """
    from docx import Document

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
    content: bytes, filename: str, extension: str, model: str | None = None
) -> str:
    """Convert file content to Markdown via OpenRouter API.

    Args:
        content: Raw file bytes
        filename: Original filename (for logging)
        extension: File extension (e.g., '.pdf', '.docx')
        model: Model to use for conversion (defaults to settings.file_conversion_model)

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

    settings = get_settings()
    effective_model = model or settings.file_conversion_model

    # Handle DOCX files: extract text first, then format with LLM
    if ext_lower == ".docx":
        return await _convert_docx_to_markdown(content, filename, effective_model)

    # Handle PPTX files (not yet implemented)
    if ext_lower == ".pptx":
        raise ValueError("PPTX conversion not yet implemented. Please convert to PDF first.")

    # Handle native formats (PDF) - send as base64 via multimodal message
    mime_type = NATIVE_MIME_TYPES[ext_lower]

    try:
        client = _get_client()
        b64_data = base64.b64encode(content).decode("utf-8")
        data_url = f"data:{mime_type};base64,{b64_data}"

        response = await client.chat.completions.create(
            model=effective_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        },
                        {
                            "type": "text",
                            "text": CONVERSION_PROMPT,
                        },
                    ],
                }
            ],
            max_tokens=16384,
        )
        markdown_content = response.choices[0].message.content

        if not markdown_content:
            raise ValueError("LLM returned empty response")

        logger.info(f"Successfully converted {filename} to Markdown")
        return markdown_content

    except Exception as e:
        logger.error(f"File conversion failed for {filename}: {e}")
        raise


async def _convert_docx_to_markdown(content: bytes, filename: str, model: str) -> str:
    """Convert DOCX file to Markdown by extracting text and formatting with LLM.

    Args:
        content: Raw DOCX file bytes
        filename: Original filename (for logging)
        model: Model to use for formatting

    Returns:
        Formatted Markdown content
    """
    # Extract text content from DOCX (sync I/O, run in thread)
    try:
        extracted_text = await asyncio.to_thread(extract_docx_content, content)
    except Exception as e:
        logger.error(f"Failed to extract text from {filename}: {e}")
        raise ValueError(f"Failed to read DOCX file: {e}")

    if not extracted_text.strip():
        raise ValueError("DOCX file appears to be empty")

    # Use LLM to format the extracted text as proper Markdown
    try:
        client = _get_client()
        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": TEXT_CONVERSION_PROMPT + extracted_text}],
            max_tokens=16384,
        )
        markdown_content = response.choices[0].message.content

        if not markdown_content:
            raise ValueError("LLM returned empty response")

        logger.info(f"Successfully converted {filename} to Markdown")
        return markdown_content

    except Exception as e:
        logger.error(f"File conversion formatting failed for {filename}: {e}")
        raise


def is_converter_configured() -> bool:
    """Check if file conversion API is properly configured."""
    settings = get_settings()
    return bool(settings.openrouter_api_key)
