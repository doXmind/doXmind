"""API key service — local desktop edition.

Wraps `local_config.json` so existing routers/agents that call
`APIKeyService(db).get_user_settings(...)` etc. keep working.
"""

from dataclasses import dataclass
from typing import Any

from services import local_config


@dataclass
class _UserAPISettings:
    openrouter_api_key: str = ""
    anthropic_api_key: str = ""
    preferred_model: str = "google/gemini-3.1-flash-lite-preview"


class APIKeyService:
    def __init__(self, db: Any = None):  # noqa: ARG002
        self._cfg = local_config.load()

    async def get_user_settings(self, user_id: str | None = None) -> _UserAPISettings:  # noqa: ARG002
        cfg = local_config.load()
        return _UserAPISettings(
            openrouter_api_key=cfg.get("openrouter_api_key", "") or "",
            anthropic_api_key=cfg.get("anthropic_api_key", "") or "",
            preferred_model=cfg.get("preferred_model", "google/gemini-3.1-flash-lite-preview"),
        )

    def has_api_key(self, settings: _UserAPISettings) -> bool:
        return bool(settings.openrouter_api_key or settings.anthropic_api_key)

    async def get_decrypted_key(
        self,
        user_id: str | None = None,  # noqa: ARG002
        settings: _UserAPISettings | None = None,
    ) -> str:
        s = settings or await self.get_user_settings()
        return s.openrouter_api_key or s.anthropic_api_key or ""

    async def set_api_key(self, user_id: str | None, api_key: str) -> None:  # noqa: ARG002
        local_config.save({"openrouter_api_key": api_key})

    async def remove_api_key(self, user_id: str | None = None) -> None:  # noqa: ARG002
        local_config.save({"openrouter_api_key": "", "anthropic_api_key": ""})

    async def set_preferred_model(self, user_id: str | None, model: str) -> None:  # noqa: ARG002
        local_config.save({"preferred_model": model})
