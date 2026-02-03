"""
Autocomplete API endpoints with enhanced context and caching.

Provides AI-powered text completions for Markdown writing,
optimized for low latency and high-quality suggestions.
"""

import logging
import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from config import get_settings
from prompts.domains.autocomplete import build_autocomplete_prompt
from services.auth_service import TokenData, require_auth
from services.autocomplete_cache import AutocompleteCache
from services.llm_service import LLMService

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
    max_tokens: int = 15  # Short completions: current word + at most 1 word


class AutocompleteResponse(BaseModel):
    """Autocomplete response model."""

    suggestion: str
    cached: bool = False
    latency_ms: int = 0


def build_prompt(request: AutocompleteRequest) -> tuple[str, str]:
    """
    Build optimized prompt for Markdown autocomplete.

    Returns:
        Tuple of (system_prompt, user_prompt) - using new prompts module
    """
    # Use the new structured prompt builder
    system_prompt, user_prompt = build_autocomplete_prompt(
        text_before=request.text_before, text_after=request.text_after, max_context=1500
    )
    # Return in expected order (user, system) to maintain compatibility
    return user_prompt, system_prompt


def clean_suggestion(suggestion: str, text_before: str) -> str:
    """
    Clean and validate the suggestion.

    Args:
        suggestion: Raw suggestion from LLM
        text_before: Text before cursor for context

    Returns:
        Cleaned suggestion string (max 2 words)
    """
    if not suggestion:
        return ""

    suggestion = suggestion.strip()

    if not suggestion:
        return ""

    # Remove leading space if text_before ends with space
    if text_before and text_before.endswith(" ") and suggestion.startswith(" "):
        suggestion = suggestion[1:]

    # Limit to at most 2 words for simple completion
    words = suggestion.split()
    if len(words) > 2:
        suggestion = " ".join(words[:2])

    # Also limit max chars to 50 for safety
    if len(suggestion) > 50:
        cut_point = suggestion[:50].rfind(" ")
        suggestion = suggestion[:cut_point] if cut_point > 10 else suggestion[:50]

    return suggestion


@router.post("/suggest", response_model=AutocompleteResponse)
async def suggest(
    request: AutocompleteRequest,
    token: TokenData = Depends(require_auth),
) -> AutocompleteResponse:
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
    cache_key = AutocompleteCache.create_cache_key(request.text_before, request.file_name)
    cached_suggestion = cache.get(cache_key)

    if cached_suggestion:
        latency = int((time.time() - start_time) * 1000)
        logger.debug(f"Cache hit for autocomplete, latency: {latency}ms")
        return AutocompleteResponse(suggestion=cached_suggestion, cached=True, latency_ms=latency)

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

        logger.info(
            f"[Autocomplete] Raw LLM response: '{raw_suggestion[:200] if raw_suggestion else '(empty)'}...'"
        )
        logger.info(
            f"[Autocomplete] text_before ends with: '{request.text_before[-50:] if request.text_before else '(empty)'}'"
        )

        # Clean the suggestion
        suggestion = clean_suggestion(raw_suggestion, request.text_before)

        # Cache valid suggestions
        if suggestion:
            cache.set(cache_key, suggestion)

        latency = int((time.time() - start_time) * 1000)
        logger.debug(f"Autocomplete generated in {latency}ms: '{suggestion[:50]}...'")

        return AutocompleteResponse(suggestion=suggestion, cached=False, latency_ms=latency)

    except Exception as e:
        logger.error(f"Autocomplete error: {e}")
        latency = int((time.time() - start_time) * 1000)
        return AutocompleteResponse(suggestion="", cached=False, latency_ms=latency)


@router.get("/stats")
async def get_cache_stats(token: TokenData = Depends(require_auth)):
    """Get autocomplete cache statistics."""
    return cache.get_stats()


@router.post("/clear-cache")
async def clear_cache(token: TokenData = Depends(require_auth)):
    """Clear the autocomplete cache."""
    cache.clear()
    return {"status": "ok", "message": "Cache cleared"}
