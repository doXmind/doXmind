"""API key service — compatibility shim over the multi-provider layer.

Existing routers call ``APIKeyService(db).get_user_settings(...)`` and
``get_decrypted_key(...)``. Under the new scheme, the "settings" are just
the active provider's key + its chat-role model.
"""

from dataclasses import dataclass
from typing import Any

from provider.registry import active_api_key, active_provider_id, role_model
from services import local_config


@dataclass
class _UserAPISettings:
    api_key: str = ""
    provider_id: str | None = None
    preferred_model: str = ""


class APIKeyService:
    def __init__(self, db: Any = None):  # noqa: ARG002
        pass

    async def get_user_settings(self, user_id: str | None = None) -> _UserAPISettings:  # noqa: ARG002
        pid = active_provider_id()
        return _UserAPISettings(
            api_key=active_api_key(),
            provider_id=pid,
            preferred_model=(role_model("chat", pid) if pid else "") or "",
        )

    def has_api_key(self, settings: _UserAPISettings) -> bool:
        return bool(settings.api_key)

    async def get_decrypted_key(
        self,
        user_id: str | None = None,  # noqa: ARG002
        settings: _UserAPISettings | None = None,
    ) -> str:
        s = settings or await self.get_user_settings()
        return s.api_key or ""

    async def set_api_key(
        self,
        user_id: str | None,  # noqa: ARG002
        api_key: str,
        provider_id: str | None = None,
    ) -> None:
        pid = provider_id or active_provider_id() or "openai"
        local_config.save({"providers": {pid: {"api_key": api_key}}})
        # Also promote to active if none set yet.
        if active_provider_id() is None:
            local_config.save({"active_provider": pid})

    async def remove_api_key(self, user_id: str | None = None) -> None:  # noqa: ARG002
        pid = active_provider_id()
        if pid:
            local_config.save({"providers": {pid: {"api_key": ""}}})

    async def set_preferred_model(
        self,
        user_id: str | None,  # noqa: ARG002
        model: str,
    ) -> None:
        pid = active_provider_id()
        if pid:
            local_config.save({"model_roles": {pid: {"chat": model}}})
