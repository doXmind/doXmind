"""Autocomplete API endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging

from services.llm_service import LLMService
from config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter()


class AutocompleteRequest(BaseModel):
    """Autocomplete request model."""
    text_before: str
    text_after: str = ""
    file_name: str = ""
    max_tokens: int = 100


@router.post("/suggest")
async def suggest(request: AutocompleteRequest):
    """Get autocomplete suggestion."""

    # Don't suggest if text is too short
    if len(request.text_before.strip()) < 10:
        return {"suggestion": ""}

    try:
        settings = get_settings()
        llm = LLMService(model=settings.fast_model)

        # Build prompt
        context = request.text_before[-2000:]  # Last 2000 chars
        after_context = request.text_after[:500] if request.text_after else ""

        prompt = f"""Continue writing the following text naturally. Only output the continuation, do not repeat any existing text.

{f'File: {request.file_name}' if request.file_name else ''}

Text so far:
{context}

[Continue from here]

{f'Text after cursor: {after_context}' if after_context else ''}"""

        system = """You are an AI writing assistant providing text completions.
Output ONLY the natural continuation of the text.
- Do not repeat any existing text
- Keep the same writing style and tone
- Write 1-3 sentences maximum
- Do not add explanations or meta-commentary"""

        suggestion = await llm.complete(
            prompt=prompt,
            system=system,
            max_tokens=request.max_tokens,
            temperature=0.7,
            stop=["\n\n", "```"]  # Stop at paragraph breaks or code blocks
        )

        # Clean up suggestion
        suggestion = suggestion.strip()

        # Remove any leading punctuation that would be redundant
        if suggestion and request.text_before:
            last_char = request.text_before[-1]
            if last_char in ".!?" and suggestion[0] in ".!?":
                suggestion = suggestion[1:].strip()

        return {"suggestion": suggestion}

    except Exception as e:
        logger.error(f"Autocomplete error: {e}")
        return {"suggestion": ""}
