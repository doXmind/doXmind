"""User Settings API — multi-provider edition.

Reads / writes ~/.doxmind/config.json. The GUI settings page calls these
endpoints to configure API keys per provider, pick the active provider,
and optionally override the model chosen for each feature role.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from exceptions import BadRequestError
from provider.catalog import CATALOG, PROVIDER_IDS, ROLES
from provider.registry import (
    active_provider_id,
    build_client,
    provider_api_key,
    role_model,
)
from services import local_config

router = APIRouter()
logger = logging.getLogger(__name__)


# =============================================================================
# Response schemas
# =============================================================================


class ModelInfo(BaseModel):
    id: str
    name: str
    context_length: int
    prompt_price: float | None = None
    completion_price: float | None = None
    supports_reasoning: bool = False
    supports_vision: bool = True


class ProviderInfo(BaseModel):
    id: str
    name: str
    base_url: str
    docs_url: str
    api_key_hint: str
    has_api_key: bool
    key_preview: str | None = None  # masked "sk-...abcd"
    models: list[ModelInfo]
    role_defaults: dict[str, str]
    role_overrides: dict[str, str | None]
    has_reasoning: bool


class UserSettingsResponse(BaseModel):
    active_provider: str | None
    providers: list[ProviderInfo]
    roles: tuple[str, ...] = ROLES
    web_search_enabled: bool
    code_execution_enabled: bool


# =============================================================================
# Request schemas
# =============================================================================


class ProviderKeyRequest(BaseModel):
    api_key: str

    @field_validator("api_key")
    @classmethod
    def _trim(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("API key cannot be empty")
        if len(v) < 10 or len(v) > 500:
            raise ValueError("Invalid API key length")
        return v


class ActiveProviderRequest(BaseModel):
    provider_id: str | None

    @field_validator("provider_id")
    @classmethod
    def _validate(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if v not in PROVIDER_IDS:
            raise ValueError(f"Unknown provider: {v}")
        return v


class RoleAssignmentRequest(BaseModel):
    provider_id: str
    role: str
    model: str | None  # None clears the override (fall back to default)

    @field_validator("provider_id")
    @classmethod
    def _provider(cls, v: str) -> str:
        if v not in PROVIDER_IDS:
            raise ValueError(f"Unknown provider: {v}")
        return v

    @field_validator("role")
    @classmethod
    def _role(cls, v: str) -> str:
        if v not in ROLES:
            raise ValueError(f"Unknown role: {v}")
        return v


class FeatureToggleRequest(BaseModel):
    enabled: bool


# =============================================================================
# Helpers
# =============================================================================


def _mask_key(key: str) -> str | None:
    if not key:
        return None
    if len(key) <= 11:
        return "****"
    return f"{key[:4]}…{key[-4:]}"


def _build_provider_info(pid: str) -> ProviderInfo:
    pdef = CATALOG[pid]
    cfg = local_config.load()
    stored_key = (cfg.get("providers") or {}).get(pid, {}).get("api_key") or ""
    overrides = (cfg.get("model_roles") or {}).get(pid) or {}
    return ProviderInfo(
        id=pdef.id,
        name=pdef.name,
        base_url=pdef.base_url,
        docs_url=pdef.docs_url,
        api_key_hint=pdef.api_key_hint,
        has_api_key=bool(stored_key),
        key_preview=_mask_key(stored_key),
        models=[
            ModelInfo(
                id=m.id,
                name=m.name,
                context_length=m.context_length,
                prompt_price=m.prompt_price_per_m,
                completion_price=m.completion_price_per_m,
                supports_reasoning=m.supports_reasoning,
                supports_vision=m.supports_vision,
            )
            for m in pdef.models
        ],
        role_defaults=dict(pdef.role_defaults),
        role_overrides={role: overrides.get(role) for role in ROLES},
        has_reasoning=pdef.has_reasoning_model(),
    )


# =============================================================================
# Endpoints
# =============================================================================


@router.get("/", response_model=UserSettingsResponse)
async def get_user_settings_endpoint():
    cfg = local_config.load()
    return UserSettingsResponse(
        active_provider=active_provider_id(),
        providers=[_build_provider_info(pid) for pid in PROVIDER_IDS],
        web_search_enabled=bool(cfg.get("web_search_enabled", True)),
        code_execution_enabled=bool(cfg.get("code_execution_enabled", False)),
    )


@router.post("/providers/{provider_id}/key", response_model=ProviderInfo)
async def set_provider_key(provider_id: str, body: ProviderKeyRequest):
    """Save + validate a provider's API key.

    Validation: build a client and call /v1/models. Most OpenAI-compatible
    endpoints (including Anthropic and Google's compat endpoints) expose this.
    """
    if provider_id not in CATALOG:
        raise HTTPException(404, f"Unknown provider: {provider_id}")

    client = build_client(body.api_key, provider_id)
    try:
        # Validate — for Google/Anthropic /v1/models via the OpenAI-compat route
        # may 404; fall back to a tiny chat completion probe in that case.
        try:
            await client.models.list()
        except Exception:
            # Probe with the provider's default fast model.
            probe_model = CATALOG[provider_id].role_defaults.get("fast") or next(
                iter(m.id for m in CATALOG[provider_id].models)
            )
            await client.chat.completions.create(
                model=probe_model,
                messages=[{"role": "user", "content": "hi"}],
                max_tokens=1,
            )
    except Exception as e:
        raise HTTPException(400, f"API key validation failed: {e}")

    local_config.save({"providers": {provider_id: {"api_key": body.api_key}}})
    # Promote to active provider if nothing is active yet.
    if active_provider_id() is None:
        local_config.save({"active_provider": provider_id})
    elif not provider_api_key(active_provider_id() or ""):
        # Previous active had its key cleared — switch.
        local_config.save({"active_provider": provider_id})

    return _build_provider_info(provider_id)


@router.delete("/providers/{provider_id}/key", response_model=ProviderInfo)
async def delete_provider_key(provider_id: str):
    if provider_id not in CATALOG:
        raise HTTPException(404, f"Unknown provider: {provider_id}")
    local_config.save({"providers": {provider_id: {"api_key": ""}}})
    # If the user deleted the currently-active provider's key, demote to None
    # (or to another provider that still has a key).
    if active_provider_id() != provider_id:
        # active auto-resolves via first-configured; no action needed.
        pass
    return _build_provider_info(provider_id)


@router.put("/active-provider")
async def set_active_provider(body: ActiveProviderRequest):
    if body.provider_id and not provider_api_key(body.provider_id):
        raise BadRequestError(message=f"Provider '{body.provider_id}' has no API key saved.")
    local_config.save({"active_provider": body.provider_id})
    return {"status": "ok", "active_provider": body.provider_id}


@router.put("/role-assignment")
async def set_role_assignment(body: RoleAssignmentRequest):
    pdef = CATALOG[body.provider_id]
    if body.model and not pdef.model_by_id(body.model):
        raise BadRequestError(message=f"Model '{body.model}' is not in {pdef.name}'s catalog.")
    local_config.save({"model_roles": {body.provider_id: {body.role: body.model}}})
    resolved = role_model(body.role, body.provider_id)
    return {"status": "ok", "role": body.role, "model": resolved}


@router.put("/web-search")
async def toggle_web_search(request: FeatureToggleRequest):
    local_config.save({"web_search_enabled": request.enabled})
    return {"status": "ok", "web_search_enabled": request.enabled}


@router.put("/code-execution")
async def toggle_code_execution(request: FeatureToggleRequest):
    local_config.save({"code_execution_enabled": request.enabled})
    return {"status": "ok", "code_execution_enabled": request.enabled}
