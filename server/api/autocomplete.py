"""
Autocomplete API endpoints with enhanced context and caching.

Provides AI-powered text completions for Markdown writing,
optimized for low latency and high-quality suggestions.

Supports two modes:
- Short mode: Fast 1-line completions with multi-file RAG context
- Long mode: Multi-line intelligent completions with extensive RAG search
"""

import logging
import time
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import get_db
from dependencies import resolve_user_api_key
from prompts.domains.autocomplete import build_autocomplete_prompt
from services.auth_service import TokenData, require_auth
from services.autocomplete_cache import AutocompleteCache
from services.autocomplete_context import (
    AutocompleteContextService,
    LongContextParams,
    ShortContextParams,
)
from services.llm_service import LLMService

logger = logging.getLogger(__name__)
router = APIRouter()

# Initialize cache (1000 entries, 5 min TTL)
cache = AutocompleteCache(max_size=1000, ttl_seconds=300)


class AutocompleteRequest(BaseModel):
    """Enhanced autocomplete request model with mode and RAG support."""

    text_before: str
    text_after: str = ""
    file_id: str = ""
    file_name: str = ""
    cursor_position: int = 0
    max_tokens: int = 60  # Default for short mode
    mode: Literal["short", "long"] = "short"  # NEW: autocomplete mode
    open_file_ids: list[str] = []  # NEW: for multi-file context
    include_rag: bool = True  # NEW: can disable for testing


class AutocompleteResponse(BaseModel):
    """Autocomplete response model."""

    suggestion: str
    cached: bool = False
    latency_ms: int = 0


def build_prompt(context: str, mode: str) -> tuple[str, str]:
    """
    Build optimized prompt for Markdown autocomplete.

    Args:
        context: Assembled context from AutocompleteContextService
        mode: "short" or "long"

    Returns:
        Tuple of (user_prompt, system_prompt)
    """
    # Use the new structured prompt builder with mode parameter
    system_prompt, user_prompt = build_autocomplete_prompt(
        context=context,
        mode=mode,
    )
    # Return in expected order (user, system) to maintain compatibility
    return user_prompt, system_prompt


def clean_suggestion_short(suggestion: str, text_before: str) -> str:
    """
    Clean and validate the suggestion for short mode.

    Args:
        suggestion: Raw suggestion from LLM
        text_before: Text before cursor for context

    Returns:
        Cleaned suggestion string (max 1 line or 200 chars)
    """
    if not suggestion:
        return ""

    suggestion = suggestion.strip()

    if not suggestion:
        return ""

    # Remove leading space if text_before ends with space
    if text_before and text_before.endswith(" ") and suggestion.startswith(" "):
        suggestion = suggestion[1:]

    # Limit to 1 line (take only first line if multi-line)
    lines = suggestion.split("\n")
    suggestion = lines[0].strip()

    # Also limit max chars to 200 for safety
    if len(suggestion) > 200:
        # Try to cut at sentence boundary first, then word boundary
        cut_point = suggestion[:200].rfind("。")
        if cut_point < 40:
            cut_point = suggestion[:200].rfind(".")
        if cut_point < 40:
            cut_point = suggestion[:200].rfind(" ")
        suggestion = suggestion[: cut_point + 1] if cut_point > 40 else suggestion[:200]

    return suggestion


def clean_suggestion_long(suggestion: str, text_before: str) -> str:
    """
    Clean and validate the suggestion for long mode.

    Args:
        suggestion: Raw suggestion from LLM
        text_before: Text before cursor for context

    Returns:
        Cleaned suggestion string (max 10 lines or 800 chars)
    """
    if not suggestion:
        return ""

    suggestion = suggestion.strip()

    if not suggestion:
        return ""

    # Remove leading space if text_before ends with space
    if text_before and text_before.endswith(" ") and suggestion.startswith(" "):
        suggestion = suggestion[1:]

    # Limit to 10 lines maximum
    lines = suggestion.split("\n")
    if len(lines) > 10:
        suggestion = "\n".join(lines[:10])

    # Also limit max chars to 800 for safety
    if len(suggestion) > 800:
        # Try to cut at sentence or line boundary
        cut_point = suggestion[:800].rfind(".")
        if cut_point < 400:  # If no sentence boundary, try line boundary
            cut_point = suggestion[:800].rfind("\n")
        if cut_point < 200:  # If still no good boundary, just cut
            cut_point = 800

        suggestion = suggestion[:cut_point].strip()

    return suggestion


@router.post("/suggest", response_model=AutocompleteResponse)
async def suggest(
    request: AutocompleteRequest,
    token: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> AutocompleteResponse:
    """
    Get autocomplete suggestion.

    Returns a contextually appropriate continuation of the text at the cursor position.
    Supports two modes:
    - Short mode: Fast 1-line completions with multi-file context
    - Long mode: Multi-line intelligent completions with extensive RAG search
    """
    start_time = time.time()

    # Validate input - minimum text length
    if len(request.text_before.strip()) < 3:
        logger.warning(
            f"[Autocomplete] Text too short: {len(request.text_before.strip())} chars "
            f"(min 3 required)"
        )
        return AutocompleteResponse(suggestion="", latency_ms=0)

    # Build cache key including mode and open files for proper invalidation
    open_files_hash = ",".join(sorted(request.open_file_ids[:5]))  # Limit to first 5 for cache key
    cache_key = AutocompleteCache.create_cache_key(
        request.text_before,
        request.file_name,
        extra=f"{request.mode}:{open_files_hash}",
    )

    # Check cache first
    cached_suggestion = cache.get(cache_key)
    if cached_suggestion:
        latency = int((time.time() - start_time) * 1000)
        logger.debug(f"Cache hit for autocomplete ({request.mode} mode), latency: {latency}ms")
        return AutocompleteResponse(suggestion=cached_suggestion, cached=True, latency_ms=latency)

    try:
        settings = get_settings()
        user_api_key = await resolve_user_api_key(token.sub, db)
        context_service = AutocompleteContextService(db)

        # Assemble context based on mode
        if request.include_rag and request.mode == "short":
            params = ShortContextParams(
                current_text_before=request.text_before,
                current_text_after=request.text_after,
                file_id=request.file_id,
                open_file_ids=request.open_file_ids,
                max_tokens=4000,
            )
            context = await context_service.assemble_short_context(
                params=params,
                user_id=token.sub,
            )
            max_output_tokens = 60  # ~1-2 sentences
            model = settings.fast_model
            temperature = 0.5

        elif request.include_rag and request.mode == "long":
            params = LongContextParams(
                current_text_before=request.text_before,
                current_text_after=request.text_after,
                file_id=request.file_id,
                open_file_ids=request.open_file_ids,
                user_id=token.sub,
                max_tokens=20000,
            )
            context = await context_service.assemble_long_context(
                params=params,
                user_id=token.sub,
            )
            max_output_tokens = 200  # Multi-line paragraphs
            model = settings.fast_model
            temperature = 0.6  # Slightly higher for more creative multi-line suggestions

        else:
            # Fallback: no RAG, just current context
            context = request.text_before[-1500:]
            if request.text_after:
                context += f"\n[... cursor position ...]\n{request.text_after[:200]}"
            max_output_tokens = request.max_tokens
            model = settings.fast_model
            temperature = 0.5

        # Build prompt with context
        user_prompt, system_prompt = build_prompt(context, request.mode)

        logger.info(
            f"[Autocomplete] Context length: {len(context)} chars, "
            f"User prompt: {len(user_prompt)} chars"
        )

        # Get LLM completion (disable reasoning for speed — autocomplete doesn't need it)
        llm = LLMService(model=model)
        raw_suggestion = await llm.complete(
            prompt=user_prompt,
            system=system_prompt,
            max_tokens=max_output_tokens,
            temperature=temperature,
            stop=None,
            extra_body={"reasoning": {"enabled": False}},
        )

        # Track usage
        if llm.last_usage:
            import asyncio

            from services.usage_tracker import track_usage

            asyncio.create_task(
                track_usage(
                    service="autocomplete",
                    model=llm.model,
                    user_id=token.sub,
                    is_byok=bool(user_api_key),
                    **llm.last_usage,
                )
            )

        logger.info(
            f"[Autocomplete] {request.mode} mode | Raw LLM response: "
            f"'{raw_suggestion[:100] if raw_suggestion else '(empty)'}...'"
        )
        logger.info(
            f"[Autocomplete] Raw suggestion length: {len(raw_suggestion) if raw_suggestion else 0} chars"
        )

        # Clean the suggestion based on mode
        if request.mode == "short":
            suggestion = clean_suggestion_short(raw_suggestion, request.text_before)
        else:  # long mode
            suggestion = clean_suggestion_long(raw_suggestion, request.text_before)

        logger.info(
            f"[Autocomplete] After cleaning: {len(suggestion) if suggestion else 0} chars - '{suggestion[:50] if suggestion else '(empty)'}'..."
        )

        # Cache valid suggestions
        if suggestion:
            cache.set(cache_key, suggestion)

        latency = int((time.time() - start_time) * 1000)
        logger.debug(
            f"Autocomplete ({request.mode} mode) generated in {latency}ms: '{suggestion[:50]}...'"
        )

        return AutocompleteResponse(suggestion=suggestion, cached=False, latency_ms=latency)

    except Exception as e:
        logger.error(f"Autocomplete error ({request.mode} mode): {e}")
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
