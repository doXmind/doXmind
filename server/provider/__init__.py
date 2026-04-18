"""Multi-provider LLM layer.

Each LLM provider (OpenAI / Anthropic / Google) owns its own API key and
its own set of models. Features (chat, autocomplete, review, thinking,
file conversion) map to a *role*, and the role resolves to a model on the
currently active provider. Switching provider replaces all role models
atomically with that provider's defaults.
"""

from provider.catalog import CATALOG, ROLES, ModelSpec, ProviderDef
from provider.registry import (
    active_api_key,
    active_provider_id,
    build_client,
    provider_api_key,
    resolve_role,
    role_model,
)

__all__ = [
    "CATALOG",
    "ROLES",
    "ModelSpec",
    "ProviderDef",
    "active_api_key",
    "active_provider_id",
    "build_client",
    "provider_api_key",
    "resolve_role",
    "role_model",
]
