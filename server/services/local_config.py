"""Local user configuration — stored as plain JSON in the data directory.

Multi-provider desktop edition: the GUI settings page saves the user's
API keys (one per provider) and the active provider choice here. LLM code
reads this at request time.
"""

import json
import logging
from threading import RLock

from config import get_settings

logger = logging.getLogger(__name__)

_lock = RLock()


_PROVIDER_IDS: tuple[str, ...] = ("openai", "anthropic", "google")
_ROLE_IDS: tuple[str, ...] = ("chat", "thinking", "fast", "review", "file_conversion")


def _empty_providers() -> dict:
    return {pid: {"api_key": ""} for pid in _PROVIDER_IDS}


def _empty_role_overrides() -> dict:
    # model_roles is per-provider because each provider's model IDs don't overlap.
    return {pid: dict.fromkeys(_ROLE_IDS) for pid in _PROVIDER_IDS}


_DEFAULTS: dict = {
    # Multi-provider config
    "active_provider": None,  # "openai" | "anthropic" | "google" | None
    "providers": _empty_providers(),
    # Per-provider role overrides: roles fall back to the catalog defaults
    # when set to None.
    "model_roles": _empty_role_overrides(),
    # Other toggles
    "serper_api_key": "",
    "web_search_enabled": True,
    "code_execution_enabled": False,
}


def _merge_defaults(data: dict | None) -> dict:
    """Merge persisted data on top of defaults, filling any missing keys."""
    out = json.loads(json.dumps(_DEFAULTS))  # deep copy
    if not data:
        return out

    if isinstance(data.get("active_provider"), str):
        out["active_provider"] = data["active_provider"]

    persisted_providers = data.get("providers") or {}
    if isinstance(persisted_providers, dict):
        for pid in _PROVIDER_IDS:
            entry = persisted_providers.get(pid) or {}
            if isinstance(entry, dict) and isinstance(entry.get("api_key"), str):
                out["providers"][pid]["api_key"] = entry["api_key"]

    persisted_roles = data.get("model_roles") or {}
    if isinstance(persisted_roles, dict):
        for pid in _PROVIDER_IDS:
            entry = persisted_roles.get(pid) or {}
            if not isinstance(entry, dict):
                continue
            for role in _ROLE_IDS:
                v = entry.get(role)
                if isinstance(v, str) and v.strip():
                    out["model_roles"][pid][role] = v.strip()

    for key in ("serper_api_key",):
        v = data.get(key)
        if isinstance(v, str):
            out[key] = v
    for key in ("web_search_enabled", "code_execution_enabled"):
        v = data.get(key)
        if isinstance(v, bool):
            out[key] = v

    return out


def _migrate_legacy(raw: dict) -> dict:
    """Pull values from the old flat schema into the new nested one.

    The previous config had:
        { "openrouter_api_key": "...", "anthropic_api_key": "...",
          "preferred_model": "google/...", "web_search_enabled": ..., ... }

    We keep only the bits that still make sense (anthropic key, serper key,
    toggles). The old OpenRouter / preferred_model fields are dropped since
    a single OpenRouter-aggregated model ID can't be re-keyed to a
    provider-specific model without guessing.
    """
    migrated: dict = {}
    if isinstance(raw.get("anthropic_api_key"), str) and raw["anthropic_api_key"]:
        migrated.setdefault("providers", {})["anthropic"] = {"api_key": raw["anthropic_api_key"]}
        migrated.setdefault("active_provider", "anthropic")
    for key in ("serper_api_key",):
        if isinstance(raw.get(key), str):
            migrated[key] = raw[key]
    for key in ("web_search_enabled", "code_execution_enabled"):
        if isinstance(raw.get(key), bool):
            migrated[key] = raw[key]
    return migrated


def load() -> dict:
    settings = get_settings()
    path = settings.local_config_file
    if not path.is_file():
        return _merge_defaults(None)
    try:
        with _lock, path.open("r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            return _merge_defaults(None)
        # If the file is from the old schema (no "providers" key), migrate.
        if "providers" not in raw and (
            raw.get("openrouter_api_key") or raw.get("anthropic_api_key")
        ):
            return _merge_defaults(_migrate_legacy(raw))
        return _merge_defaults(raw)
    except Exception as e:
        logger.warning(f"Failed to read local config at {path}: {e}")
        return _merge_defaults(None)


def save(updates: dict) -> dict:
    """Merge ``updates`` into the persisted config and return the new state.

    ``updates`` may be:
      - top-level: {"active_provider": "openai", "serper_api_key": "..."}
      - providers: {"providers": {"openai": {"api_key": "..."}}}
      - roles:     {"model_roles": {"openai": {"chat": "gpt-5.1"}}}
    """
    settings = get_settings()
    settings.ensure_data_dir()
    current = load()

    if isinstance(updates.get("active_provider"), (str, type(None))):
        v = updates.get("active_provider")
        if v is None or v in _PROVIDER_IDS:
            current["active_provider"] = v

    provs = updates.get("providers")
    if isinstance(provs, dict):
        for pid, entry in provs.items():
            if pid not in _PROVIDER_IDS or not isinstance(entry, dict):
                continue
            if "api_key" in entry and isinstance(entry["api_key"], str):
                current["providers"][pid]["api_key"] = entry["api_key"].strip()

    roles = updates.get("model_roles")
    if isinstance(roles, dict):
        for pid, role_map in roles.items():
            if pid not in _PROVIDER_IDS or not isinstance(role_map, dict):
                continue
            for role, model in role_map.items():
                if role not in _ROLE_IDS:
                    continue
                if model is None:
                    current["model_roles"][pid][role] = None
                elif isinstance(model, str):
                    current["model_roles"][pid][role] = model.strip() or None

    for key in ("serper_api_key",):
        if key in updates and isinstance(updates[key], str):
            current[key] = updates[key]
    for key in ("web_search_enabled", "code_execution_enabled"):
        if key in updates and isinstance(updates[key], bool):
            current[key] = updates[key]

    with _lock, settings.local_config_file.open("w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    return current


def get_serper_key() -> str:
    settings = get_settings()
    if settings.serper_api_key:
        return settings.serper_api_key
    return load().get("serper_api_key", "") or ""
