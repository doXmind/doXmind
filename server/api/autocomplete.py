"""
Autocomplete API endpoints with enhanced context and caching.

Provides AI-powered text completions for Markdown writing,
optimized for low latency and high-quality suggestions.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import logging
import time

from services.llm_service import LLMService
from services.autocomplete_cache import AutocompleteCache
from config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Initialize cache (1000 entries, 5 min TTL)
cache = AutocompleteCache(max_size=1000, ttl_seconds=300)


class AutocompleteRequest(BaseModel):
    """Enhanced autocomplete request model."""

    text_before: str
    text_after: str = ""
    file_id: str = ""
    file_name: str = ""
    cursor_position: int = 0
    max_tokens: int = 50  # Reduced for faster responses


class AutocompleteResponse(BaseModel):
    """Autocomplete response model."""

    suggestion: str
    cached: bool = False
    latency_ms: int = 0


def build_prompt(request: AutocompleteRequest) -> tuple[str, str]:
    """
    Build optimized prompt for Markdown autocomplete.

    Returns:
        Tuple of (user_prompt, system_prompt)
    """
    text_before = request.text_before
    # Use last 1500 chars for context
    context = text_before[-1500:] if len(text_before) > 1500 else text_before

    # Simple, direct prompt
    user_prompt = f"""Continue this text naturally:

{context}"""

    # Concise system prompt
    system_prompt = """You are an autocomplete assistant. Output ONLY the next few words (5-20 words) that naturally continue the text. Do not repeat existing text. Do not explain. Just output the continuation."""

    return user_prompt, system_prompt


def clean_suggestion(suggestion: str, text_before: str) -> str:
    """
    Clean and validate the suggestion.

    Args:
        suggestion: Raw suggestion from LLM
        text_before: Text before cursor for context

    Returns:
        Cleaned suggestion string
    """
    if not suggestion:
        return ""

    suggestion = suggestion.strip()

    if not suggestion:
        return ""

    # Remove leading space if text_before ends with space
    if text_before and text_before.endswith(" ") and suggestion.startswith(" "):
        suggestion = suggestion[1:]

    # Limit length (max ~50 words or 200 chars)
    if len(suggestion) > 200:
        # Try to cut at a sentence or word boundary
        cut_point = suggestion[:200].rfind(" ")
        if cut_point > 100:
            suggestion = suggestion[:cut_point]
        else:
            suggestion = suggestion[:200]

    return suggestion


@router.post("/suggest", response_model=AutocompleteResponse)
async def suggest(request: AutocompleteRequest) -> AutocompleteResponse:
    """
    Get autocomplete suggestion.

    Returns a short, contextually appropriate continuation
    of the text at the cursor position.
    """
    start_time = time.time()

    # Validate input - minimum text length
    if len(request.text_before.strip()) < 3:
        return AutocompleteResponse(suggestion="", latency_ms=0)

    # Check cache first
    cache_key = AutocompleteCache.create_cache_key(
        request.text_before, request.file_name
    )
    cached_suggestion = cache.get(cache_key)

    if cached_suggestion:
        latency = int((time.time() - start_time) * 1000)
        logger.debug(f"Cache hit for autocomplete, latency: {latency}ms")
        return AutocompleteResponse(
            suggestion=cached_suggestion, cached=True, latency_ms=latency
        )

    try:
        settings = get_settings()
        llm = LLMService(model=settings.fast_model)

        user_prompt, system_prompt = build_prompt(request)

        raw_suggestion = await llm.complete(
            prompt=user_prompt,
            system=system_prompt,
            max_tokens=request.max_tokens,
            temperature=0.5,
            stop=None,  # No stop sequences - rely on max_tokens
        )

        logger.info(f"[Autocomplete] Raw LLM response: '{raw_suggestion[:200] if raw_suggestion else '(empty)'}...'")
        logger.info(f"[Autocomplete] text_before ends with: '{request.text_before[-50:] if request.text_before else '(empty)'}'")

        # Clean the suggestion
        suggestion = clean_suggestion(raw_suggestion, request.text_before)

        # Cache valid suggestions
        if suggestion:
            cache.set(cache_key, suggestion)

        latency = int((time.time() - start_time) * 1000)
        logger.debug(f"Autocomplete generated in {latency}ms: '{suggestion[:50]}...'")

        return AutocompleteResponse(
            suggestion=suggestion, cached=False, latency_ms=latency
        )

    except Exception as e:
        logger.error(f"Autocomplete error: {e}")
        latency = int((time.time() - start_time) * 1000)
        return AutocompleteResponse(suggestion="", cached=False, latency_ms=latency)


@router.get("/stats")
async def get_cache_stats():
    """Get autocomplete cache statistics."""
    return cache.get_stats()


@router.post("/clear-cache")
async def clear_cache():
    """Clear the autocomplete cache."""
    cache.clear()
    return {"status": "ok", "message": "Cache cleared"}
