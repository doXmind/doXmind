"""Local-first application configuration for doXmind.

Desktop edition: no auth, no cloud services, single-user SQLite on disk.
"""

import logging
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)

_BASE_DIR = Path(__file__).resolve().parent
_DEFAULT_DATA_DIR = Path.home() / ".doxmind"


class Settings(BaseSettings):
    """Local desktop settings."""

    # =========================================================================
    # Local data directory
    # =========================================================================
    data_dir: Path = _DEFAULT_DATA_DIR

    @property
    def database_path(self) -> Path:
        return self.data_dir / "doxmind.db"

    @property
    def local_storage_path(self) -> Path:
        return self.data_dir / "uploads"

    # =========================================================================
    # Database (SQLite)
    # =========================================================================
    database_url: str = ""  # computed in async_database_url if empty

    @property
    def async_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite+aiosqlite:///{self.database_path}"

    # =========================================================================
    # Server
    # =========================================================================
    host: str = "127.0.0.1"
    port: int = 8000
    debug: bool = True

    # =========================================================================
    # Limits
    # =========================================================================
    max_file_size: int = 50 * 1024 * 1024
    max_import_file_size: int = 10 * 1024 * 1024
    max_versions_per_file: int = 100

    class Config:
        env_file = str(_BASE_DIR / ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"

    @property
    def max_file_size_mb(self) -> float:
        return self.max_file_size / (1024 * 1024)

    def ensure_data_dir(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.local_storage_path.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_data_dir()
    return settings


# CORS — desktop app talks only to localhost.
#
# The server binds to 127.0.0.1, but localhost binding does not isolate from
# browser-origin JS: any tab the user opens can reach 127.0.0.1:8000. With
# auth removed, an explicit allowlist is the only defense against arbitrary
# websites reading/writing the user's documents. Allowed origins:
#   - Tauri WebView macOS:   tauri://localhost
#   - Tauri WebView Windows: http://tauri.localhost
#   - Local Next.js dev:     http://localhost:3000, http://127.0.0.1:3000
CORS_ORIGINS = [
    "tauri://localhost",
    "http://tauri.localhost",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


def get_cors_headers(origin: str | None) -> dict[str, str]:
    """Return CORS headers only when the request origin is on the allowlist."""
    if not origin or origin not in CORS_ORIGINS:
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
    }
