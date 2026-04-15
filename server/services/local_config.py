"""Local user configuration — stored as plain JSON in the data directory.

Single-user desktop edition: the GUI settings page writes the user's API keys
and model preferences here. Agent/LLM code reads from here at request time.
"""

import json
import logging
from threading import RLock

from config import get_settings

logger = logging.getLogger(__name__)

_lock = RLock()

_DEFAULTS: dict = {
    "openrouter_api_key": "",
    "anthropic_api_key": "",
    "serper_api_key": "",
    "preferred_model": "google/gemini-3.1-flash-lite-preview",
    "web_search_enabled": True,
    "code_execution_enabled": False,
}


def load() -> dict:
    settings = get_settings()
    path = settings.local_config_file
    if not path.is_file():
        return dict(_DEFAULTS)
    try:
        with _lock, path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        merged = dict(_DEFAULTS)
        merged.update(data or {})
        return merged
    except Exception as e:
        logger.warning(f"Failed to read local config at {path}: {e}")
        return dict(_DEFAULTS)


def save(updates: dict) -> dict:
    settings = get_settings()
    settings.ensure_data_dir()
    current = load()
    current.update({k: v for k, v in updates.items() if k in _DEFAULTS})
    with _lock, settings.local_config_file.open("w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    return current


def get_openrouter_key() -> str:
    """Resolve the OpenRouter key: env override first, then local config."""
    settings = get_settings()
    if settings.openrouter_api_key:
        return settings.openrouter_api_key
    return load().get("openrouter_api_key", "") or ""


def get_serper_key() -> str:
    settings = get_settings()
    if settings.serper_api_key:
        return settings.serper_api_key
    return load().get("serper_api_key", "") or ""
