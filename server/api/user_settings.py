"""User Settings API endpoints.

Manages user API keys and model preferences.
Allows users to use their own OpenRouter API key for custom model selection.
"""

import logging
import time

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import get_db
from exceptions import BadRequestError, InternalError
from middleware.rate_limit import limiter
from services.api_key_service import APIKeyService
from services.auth_service import TokenData, require_auth

router = APIRouter()
logger = logging.getLogger(__name__)

# =============================================================================
# OpenRouter Models Cache
# =============================================================================

_models_cache: dict = {"models": None, "fetched_at": 0.0}
_CACHE_TTL = 6 * 3600  # 6 hours


# =============================================================================
# Request/Response Models
# =============================================================================


class APIKeyRequest(BaseModel):
    """Request to save an API key."""

    api_key: str

    @field_validator("api_key")
    @classmethod
    def validate_format(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith("sk-or-"):
            raise ValueError("Invalid API key format. Key should start with 'sk-or-'")
        if len(v) < 20 or len(v) > 300:
            raise ValueError("Invalid API key length")
        return v


class ModelPreferenceRequest(BaseModel):
    """Request to update model preference."""

    model: str


class UserSettingsResponse(BaseModel):
    """User's API settings (without exposing the actual key)."""

    has_api_key: bool
    preferred_model: str
    available_models: list[str]


class ModelInfo(BaseModel):
    """Model info returned to the frontend."""

    id: str
    name: str
    context_length: int
    prompt_price: float  # per 1M tokens
    completion_price: float  # per 1M tokens


class AvailableModelsResponse(BaseModel):
    """List of available models from OpenRouter."""

    models: list[ModelInfo]
    cached: bool = False


# =============================================================================
# Curated Model List (based on OpenRouter LLM Leaderboard)
# =============================================================================

# Ordered by popularity on OpenRouter. Update periodically from:
# https://openrouter.ai/rankings
_CURATED_MODELS: list[tuple[str, str]] = [
    ("minimax/minimax-m2.5", "MiniMax M2.5"),
    ("moonshotai/kimi-k2.5", "Kimi K2.5"),
    ("z-ai/glm-5", "GLM 5"),
    ("google/gemini-3.1-flash-lite-preview", "Gemini 3.1 Flash Lite"),
    ("google/gemini-3-flash-preview", "Gemini 3 Flash"),
    ("deepseek/deepseek-v3.2", "DeepSeek V3.2"),
    ("x-ai/grok-4.1-fast", "Grok 4.1 Fast"),
    ("anthropic/claude-opus-4.6", "Claude Opus 4.6"),
    ("openai/gpt-5.1", "GPT-5.1"),
    ("openai/gpt-oss-120b", "gpt-oss-120b"),
    ("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6"),
    ("openai/gpt-5.3-chat", "GPT-5.3"),
    ("google/gemini-3.1-pro-preview", "Gemini 3.1 Pro"),
    ("anthropic/claude-haiku-4.5", "Claude Haiku 4.5"),
    ("arcee-ai/trinity-large-preview:free", "trinity-large")
]

_CURATED_IDS: set[str] = {model_id for model_id, _ in _CURATED_MODELS}


async def _fetch_openrouter_models() -> list[ModelInfo]:
    """Get curated models with live pricing from OpenRouter API, with caching."""
    now = time.time()
    if _models_cache["models"] and (now - _models_cache["fetched_at"]) < _CACHE_TTL:
        return _models_cache["models"]

    # Fetch live data from OpenRouter for pricing / context length
    api_lookup: dict[str, dict] = {}
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    **settings.openrouter_headers,
                },
            )
        if response.status_code == 200:
            for m in response.json().get("data", []):
                api_lookup[m.get("id", "")] = m
    except Exception as e:
        logger.warning(f"Failed to fetch OpenRouter models for pricing: {e}")

    # Build result in curated order, enriching with live data when available
    result: list[ModelInfo] = []
    for model_id, fallback_name in _CURATED_MODELS:
        api_data = api_lookup.get(model_id)
        if api_data:
            pricing = api_data.get("pricing", {})
            try:
                prompt_price = float(pricing.get("prompt", "0")) * 1_000_000
                completion_price = float(pricing.get("completion", "0")) * 1_000_000
            except (ValueError, TypeError):
                prompt_price = 0.0
                completion_price = 0.0
            result.append(
                ModelInfo(
                    id=model_id,
                    name=api_data.get("name", fallback_name),
                    context_length=api_data.get("context_length", 0),
                    prompt_price=round(prompt_price, 2),
                    completion_price=round(completion_price, 2),
                )
            )
        else:
            # API unavailable or model ID not found — include with fallback name
            result.append(
                ModelInfo(
                    id=model_id,
                    name=fallback_name,
                    context_length=0,
                    prompt_price=0.0,
                    completion_price=0.0,
                )
            )

    _models_cache["models"] = result
    _models_cache["fetched_at"] = now

    matched = sum(1 for mid, _ in _CURATED_MODELS if mid in api_lookup)
    logger.info(
        f"Cached {len(result)} curated models ({matched}/{len(_CURATED_MODELS)} matched API)"
    )
    return result


# =============================================================================
# Endpoints
# =============================================================================


@router.get("/", response_model=UserSettingsResponse)
async def get_user_settings(
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Get user's API settings.

    Returns whether the user has an API key configured (not the key itself),
    their preferred model, and the list of available models.
    """
    settings = get_settings()
    service = APIKeyService(db)
    user_settings = await service.get_user_settings(auth.sub)

    # Fetch dynamic model list from OpenRouter
    openrouter_models = await _fetch_openrouter_models()
    model_ids = (
        [m.id for m in openrouter_models] if openrouter_models else settings.available_models
    )

    return UserSettingsResponse(
        has_api_key=service.has_api_key(user_settings),
        preferred_model=(
            user_settings.preferred_model if user_settings else settings.default_model
        ),
        available_models=model_ids,
    )


@router.get("/models", response_model=AvailableModelsResponse)
async def get_available_models(
    auth: TokenData = Depends(require_auth),
):
    """Get top 20 models from OpenRouter with pricing info."""
    models = await _fetch_openrouter_models()
    cached = (
        _models_cache["models"] is not None
        and (time.time() - _models_cache["fetched_at"]) < _CACHE_TTL
    )
    return AvailableModelsResponse(models=models, cached=cached)


@router.post("/api-key")
@limiter.limit("5/minute")
async def save_api_key(
    request: Request,
    body: APIKeyRequest,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Save user's OpenRouter API key (encrypted).

    The API key is validated before saving.
    """
    service = APIKeyService(db)

    # Validate the API key first
    is_valid, error_msg = await service.validate_api_key(body.api_key)
    if not is_valid:
        raise BadRequestError(message=error_msg or "Invalid API key")

    try:
        await service.save_api_key(auth.sub, body.api_key)
        return {"status": "ok", "message": "API key saved successfully"}
    except ValueError as e:
        logger.error(f"Failed to save API key: {e}")
        raise InternalError(message="Failed to save API key. Encryption may not be configured.")


@router.delete("/api-key")
async def delete_api_key(
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Delete user's API key."""
    service = APIKeyService(db)
    await service.delete_api_key(auth.sub)
    return {"status": "ok", "message": "API key deleted"}


@router.put("/model")
async def update_model_preference(
    request: ModelPreferenceRequest,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Update user's preferred model.

    Requires the user to have their own API key configured.
    Accepts any model available on OpenRouter (validated against cached list).
    """
    # Validate model is in our curated list
    if request.model not in _CURATED_IDS:
        raise BadRequestError(message="Model not in available models list")

    service = APIKeyService(db)

    # Only allow model selection if user has their own API key
    user_settings = await service.get_user_settings(auth.sub)
    if not service.has_api_key(user_settings):
        raise BadRequestError(message="Model selection requires your own API key")

    await service.update_preferred_model(auth.sub, request.model)
    return {"status": "ok", "preferred_model": request.model}
