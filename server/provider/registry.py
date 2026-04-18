"""Runtime resolution of active provider + role → (api_key, model, client).

The "active provider" is whichever one the user has picked in Settings and
has a saved API key for. Features call `resolve_role("chat")` and get back
an AsyncOpenAI client plus the model ID to pass to the OpenAI SDK.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx
from openai import AsyncOpenAI

from provider.catalog import CATALOG, PROVIDER_IDS, ROLES, ProviderDef

logger = logging.getLogger(__name__)


@dataclass
class ResolvedRole:
    provider_id: str
    provider: ProviderDef
    api_key: str
    model: str

    def build_client(self) -> AsyncOpenAI:
        return build_client(self.api_key, self.provider_id)


def _load_config() -> dict:
    """Load local_config lazily to avoid import cycles."""
    from services import local_config

    return local_config.load()


def active_provider_id() -> str | None:
    """Which provider is currently active?

    Order of preference:
      1. `active_provider` field from local_config (if it has a key configured)
      2. The first catalog provider that has an API key
      3. None — nothing configured yet
    """
    cfg = _load_config()
    providers = cfg.get("providers") or {}

    active = cfg.get("active_provider")
    if active in CATALOG and (providers.get(active, {}) or {}).get("api_key"):
        return active

    for pid in PROVIDER_IDS:
        if (providers.get(pid, {}) or {}).get("api_key"):
            return pid

    return None


def provider_api_key(provider_id: str) -> str:
    cfg = _load_config()
    providers = cfg.get("providers") or {}
    entry = providers.get(provider_id) or {}
    return (entry.get("api_key") or "").strip()


def active_api_key() -> str:
    pid = active_provider_id()
    return provider_api_key(pid) if pid else ""


def role_model(role: str, provider_id: str | None = None) -> str | None:
    """Resolve the model configured (or defaulted) for a role on a provider.

    If the stored override isn't present in the provider's catalog, we fall
    back to the provider default — this keeps things sane if the user
    switches provider but leaves stale model IDs in `model_roles`.
    Returns None only when the provider has no default for that role.
    """
    if role not in ROLES:
        raise ValueError(f"Unknown role: {role!r}")

    if provider_id is None:
        provider_id = active_provider_id()
    if provider_id is None or provider_id not in CATALOG:
        return None

    pdef = CATALOG[provider_id]
    cfg = _load_config()
    overrides = (cfg.get("model_roles") or {}).get(provider_id) or {}
    override = overrides.get(role)
    if override and pdef.model_by_id(override):
        return override
    return pdef.role_defaults.get(role)


def build_client(api_key: str, provider_id: str) -> AsyncOpenAI:
    """Build an AsyncOpenAI client pointed at a specific provider."""
    if provider_id not in CATALOG:
        raise ValueError(f"Unknown provider: {provider_id!r}")
    pdef = CATALOG[provider_id]
    return AsyncOpenAI(
        api_key=api_key or "missing-key",
        base_url=pdef.base_url,
        default_headers=pdef.default_headers or None,
        timeout=httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=30.0),
    )


class ProviderUnconfiguredError(RuntimeError):
    """Raised when no provider is configured and a feature tries to call an LLM."""


def resolve_role(
    role: str,
    *,
    api_key: str | None = None,
    provider_id: str | None = None,
) -> ResolvedRole:
    """Resolve a role to a concrete (provider, api_key, model) tuple.

    - `provider_id` override: force a specific provider (rarely used).
    - `api_key` override: use this key instead of the stored one (per-call BYOK).
    """
    pid = provider_id or active_provider_id()
    if pid is None:
        raise ProviderUnconfiguredError(
            "No LLM provider configured. Open the Settings page and add an API key."
        )
    pdef = CATALOG[pid]
    key = (api_key or provider_api_key(pid) or "").strip()
    if not key:
        raise ProviderUnconfiguredError(
            f"Active provider '{pdef.name}' has no API key. Open Settings to paste one."
        )
    model = role_model(role, pid)
    if not model:
        raise ProviderUnconfiguredError(
            f"Provider '{pdef.name}' does not have a model configured for role '{role}'."
        )
    return ResolvedRole(provider_id=pid, provider=pdef, api_key=key, model=model)
