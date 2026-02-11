"""User Settings API endpoints.

Manages user API keys and model preferences.
Allows users to use their own Anthropic API key for custom model selection.
"""

import logging

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
# Request/Response Models
# =============================================================================


class APIKeyRequest(BaseModel):
    """Request to save an API key."""

    api_key: str

    @field_validator("api_key")
    @classmethod
    def validate_format(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith("sk-ant-"):
            raise ValueError("Invalid API key format. Key should start with 'sk-ant-'")
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

    return UserSettingsResponse(
        has_api_key=service.has_api_key(user_settings),
        preferred_model=(
            user_settings.preferred_model if user_settings else settings.default_model
        ),
        available_models=settings.available_models,
    )


@router.post("/api-key")
@limiter.limit("5/minute")
async def save_api_key(
    request: Request,
    body: APIKeyRequest,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Save user's Anthropic API key (encrypted).

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
    """
    settings = get_settings()

    # Validate model is in allowed list
    if request.model not in settings.available_models:
        raise BadRequestError(
            message=f"Invalid model. Available models: {', '.join(settings.available_models)}"
        )

    service = APIKeyService(db)

    # Only allow model selection if user has their own API key
    user_settings = await service.get_user_settings(auth.sub)
    if not service.has_api_key(user_settings):
        raise BadRequestError(message="Model selection requires your own API key")

    await service.update_preferred_model(auth.sub, request.model)
    return {"status": "ok", "preferred_model": request.model}
