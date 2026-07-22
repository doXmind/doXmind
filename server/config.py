"""Local-first application configuration for doXmind.

Desktop edition: no auth, no cloud services, and no application database.
"""

import logging
import re
from functools import lru_cache
from ipaddress import ip_address
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

_BASE_DIR = Path(__file__).resolve().parent
_DEFAULT_DATA_DIR = Path.home() / ".doxmind"


def validate_loopback_host(host: str) -> str:
    """Return a loopback bind host or reject network-exposed addresses."""
    value = host.strip()
    if value.casefold() == "localhost":
        return "localhost"
    try:
        address = ip_address(value)
    except ValueError as err:
        raise ValueError("host must be a loopback address or localhost") from err
    if not address.is_loopback:
        raise ValueError("host must be a loopback address or localhost")
    return value


class Settings(BaseSettings):
    """Local desktop settings."""

    model_config = SettingsConfigDict(
        env_file=str(_BASE_DIR / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    # Local recovery/index data only. Page knowledge stays in workspace files.
    data_dir: Path = _DEFAULT_DATA_DIR

    host: str = "127.0.0.1"
    port: int = 8000
    debug: bool = True

    @field_validator("host")
    @classmethod
    def host_must_be_loopback(cls, value: str) -> str:
        return validate_loopback_host(value)


@lru_cache
def get_settings() -> Settings:
    return Settings()


# CORS — the optional browser-development frontend talks only to localhost.
#
# The server binds to 127.0.0.1, but localhost binding does not isolate from
# browser-origin JS: any tab the user opens can reach 127.0.0.1:8000. With
# auth removed, an explicit allowlist is the only defense against arbitrary
# websites reading/writing the user's documents. Local Next.js development may
# use any localhost / 127.0.0.1 / [::1] port because Next falls back to
# 3001/3002/... when 3000 is busy. Packaged Electron does not use this service.
CORS_ORIGINS: list[str] = []

CORS_ORIGIN_REGEX = r"^https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$"

_CORS_ORIGIN_PATTERN = re.compile(CORS_ORIGIN_REGEX)


def get_cors_headers(origin: str | None) -> dict[str, str]:
    """Return CORS headers only when the request origin is on the allowlist."""
    if not origin:
        return {}
    if not _CORS_ORIGIN_PATTERN.match(origin):
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
    }
