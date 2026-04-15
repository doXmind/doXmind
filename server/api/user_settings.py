"""User Settings API — local desktop edition.

Reads / writes ~/.doxmind/config.json. The GUI settings page calls these
endpoints to let the user supply their own API key and pick a model.
"""

import logging
import time

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, field_validator

from config import get_settings
from exceptions import BadRequestError
from services import local_config

router = APIRouter()
logger = logging.getLogger(__name__)


# =============================================================================
# OpenRouter Models Cache
# =============================================================================

_models_cache: dict = {"models": None, "fetched_at": 0.0}
_CACHE_TTL = 6 * 3600  # 6 hours


# =============================================================================
# Request / Response Models
# =============================================================================


class APIKeyRequest(BaseModel):
    api_key: str

    @field_validator("api_key")
    @classmethod
    def validate_format(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("API key cannot be empty")
        if len(v) < 10 or len(v) > 300:
            raise ValueError("Invalid API key length")
        return v


class ModelPreferenceRequest(BaseModel):
    model: str


class UserSettingsResponse(BaseModel):
    has_api_key: bool
    preferred_model: str
    available_models: list[str]
    web_search_enabled: bool
    code_execution_enabled: bool


class ModelInfo(BaseModel):
    id: str
    name: str
    context_length: int
    prompt_price: float
    completion_price: float


class AvailableModelsResponse(BaseModel):
    models: list[ModelInfo]
    cached: bool = False


class FeatureToggleRequest(BaseModel):
    enabled: bool


# =============================================================================
# Curated Model List
# =============================================================================

_CURATED_MODELS: list[tuple[str, str]] = [
    ("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6"),
    ("anthropic/claude-opus-4.6", "Claude Opus 4.6"),
    ("anthropic/claude-haiku-4.5", "Claude Haiku 4.5"),
    ("google/gemini-3.1-pro-preview", "Gemini 3.1 Pro"),
    ("google/gemini-3.1-flash-lite-preview", "Gemini 3.1 Flash Lite"),
    ("openai/gpt-5.1", "GPT-5.1"),
    ("openai/gpt-5.3-chat", "GPT-5.3"),
    ("deepseek/deepseek-v3.2", "DeepSeek V3.2"),
    ("z-ai/glm-5", "GLM 5"),
    ("minimax/minimax-m2.5", "MiniMax M2.5"),
]
_CURATED_IDS: set[str] = {model_id for model_id, _ in _CURATED_MODELS}


async def _fetch_openrouter_models() -> list[ModelInfo]:
    now = time.time()
    if _models_cache["models"] and (now - _models_cache["fetched_at"]) < _CACHE_TTL:
        return _models_cache["models"]

    api_lookup: dict[str, dict] = {}
    settings = get_settings()
    api_key = local_config.get_openrouter_key() or settings.openrouter_api_key
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={
                    "Authorization": f"Bearer {api_key}" if api_key else "",
                    **settings.openrouter_headers,
                },
            )
        if response.status_code == 200:
            for m in response.json().get("data", []):
                api_lookup[m.get("id", "")] = m
    except Exception as e:
        logger.debug(f"Could not fetch OpenRouter models: {e}")

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
    return result


# =============================================================================
# Endpoints
# =============================================================================


@router.get("/", response_model=UserSettingsResponse)
async def get_user_settings_endpoint():
    cfg = local_config.load()
    has_key = bool(cfg.get("openrouter_api_key") or cfg.get("anthropic_api_key"))
    return UserSettingsResponse(
        has_api_key=has_key,
        preferred_model=cfg.get("preferred_model") or get_settings().default_model,
        available_models=[m for m, _ in _CURATED_MODELS],
        web_search_enabled=bool(cfg.get("web_search_enabled", True)),
        code_execution_enabled=bool(cfg.get("code_execution_enabled", False)),
    )


@router.get("/models", response_model=AvailableModelsResponse)
async def get_available_models():
    models = await _fetch_openrouter_models()
    cached = (
        _models_cache["models"] is not None
        and (time.time() - _models_cache["fetched_at"]) < _CACHE_TTL
    )
    return AvailableModelsResponse(models=models, cached=cached)


@router.post("/api-key")
async def save_api_key(body: APIKeyRequest):
    local_config.save({"openrouter_api_key": body.api_key})
    return {"status": "ok", "message": "API key saved"}


@router.delete("/api-key")
async def delete_api_key():
    local_config.save({"openrouter_api_key": "", "anthropic_api_key": ""})
    return {"status": "ok", "message": "API key cleared"}


@router.put("/model")
async def update_model_preference(request: ModelPreferenceRequest):
    if request.model not in _CURATED_IDS:
        raise BadRequestError(message="Model not in available models list")
    local_config.save({"preferred_model": request.model})
    return {"status": "ok", "preferred_model": request.model}


@router.put("/web-search")
async def toggle_web_search(request: FeatureToggleRequest):
    local_config.save({"web_search_enabled": request.enabled})
    return {"status": "ok", "web_search_enabled": request.enabled}


@router.put("/code-execution")
async def toggle_code_execution(request: FeatureToggleRequest):
    local_config.save({"code_execution_enabled": request.enabled})
    return {"status": "ok", "code_execution_enabled": request.enabled}
