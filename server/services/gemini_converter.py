"""Gemini-based file converter service.

Uses Google's Gemini API to convert PDF, DOCX, PPTX files to Markdown.
"""

import asyncio
import logging
from functools import lru_cache

from google import genai
from google.genai import types

from config import get_settings

logger = logging.getLogger(__name__)

# MIME types for supported file formats
MIME_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

# Default model for conversion
DEFAULT_MODEL = "gemini-2.5-flash-lite"

# Conversion prompt
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


@lru_cache
def get_gemini_client() -> genai.Client:
    """Get cached Gemini client instance."""
    settings = get_settings()
    if not settings.google_api_key:
        raise ValueError("GOOGLE_API_KEY is not configured")
    return genai.Client(api_key=settings.google_api_key)


async def convert_file_to_markdown(
    content: bytes,
    filename: str,
    extension: str,
    model: str = DEFAULT_MODEL
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

    if ext_lower not in MIME_TYPES:
        raise ValueError(f"Unsupported file type: {extension}")

    mime_type = MIME_TYPES[ext_lower]

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
                CONVERSION_PROMPT
            ]
        )
        return response.text

    try:
        # Run blocking Gemini call in thread pool to avoid blocking event loop
        markdown_content = await asyncio.to_thread(_sync_generate)

        if not markdown_content:
            raise ValueError("Gemini returned empty response")

        logger.info(f"Successfully converted {filename} to Markdown using Gemini")
        return markdown_content

    except Exception as e:
        logger.error(f"Gemini conversion failed for {filename}: {e}")
        raise


def is_gemini_configured() -> bool:
    """Check if Gemini API is properly configured."""
    settings = get_settings()
    return bool(settings.google_api_key)
