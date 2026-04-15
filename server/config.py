"""Local-first application configuration for doXmind Mini.

This is the desktop edition: no auth, no cloud, single-user, SQLite on disk.
User-supplied API keys live in {DATA_DIR}/config.json (managed via the GUI
settings page) — env vars still work as an override for power users.
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
    def local_config_file(self) -> Path:
        return self.data_dir / "config.json"

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
    # API keys (env-var fallback; primary source is local_config.json)
    # =========================================================================
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_provider_sort: str = "throughput"
    openrouter_app_url: str = "https://doxmind.local"
    openrouter_app_name: str = "doXmind"

    @property
    def openrouter_headers(self) -> dict[str, str]:
        return {
            "HTTP-Referer": self.openrouter_app_url,
            "X-Title": self.openrouter_app_name,
        }

    serper_api_key: str = ""

    # =========================================================================
    # Server
    # =========================================================================
    host: str = "127.0.0.1"
    port: int = 8000
    debug: bool = True

    # =========================================================================
    # AI Models (OpenRouter format)
    # =========================================================================
    default_model: str = "google/gemini-3.1-flash-lite-preview"
    thinking_model: str = "minimax/minimax-m2.5"
    fast_model: str = "google/gemini-2.5-flash-lite"
    review_model: str = "google/gemini-3.1-flash-lite-preview"
    file_conversion_model: str = "google/gemini-2.5-flash-lite"
    file_conversion_max_tokens: int = 65536

    available_models: list[str] = [
        "google/gemini-3.1-flash-lite-preview",
        "z-ai/glm-5",
        "z-ai/glm-4.7-flash",
    ]

    # =========================================================================
    # Web tools
    # =========================================================================
    web_search_enabled: bool = True
    web_fetch_enabled: bool = True

    # =========================================================================
    # Code execution
    # =========================================================================
    code_execution_enabled: bool = False
    code_execution_timeout: int = 30
    code_execution_max_output: int = 51200

    # =========================================================================
    # Limits
    # =========================================================================
    max_context_tokens: int = 100000
    max_output_tokens: int = 8192
    max_file_size: int = 50 * 1024 * 1024
    max_import_file_size: int = 10 * 1024 * 1024
    max_agent_iterations: int = 10
    streaming_timeout_seconds: int = 600
    streaming_heartbeat_interval: int = 25
    max_document_context_chars: int = 50000
    max_versions_per_file: int = 100
    autocomplete_cache_size: int = 1000
    autocomplete_cache_ttl_seconds: int = 300

    class Config:
        env_file = str(_BASE_DIR / ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"

    @property
    def max_file_size_mb(self) -> float:
        return self.max_file_size / (1024 * 1024)

    @property
    def has_data_analysis_tools(self) -> bool:
        return self.code_execution_enabled

    def ensure_data_dir(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.local_storage_path.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_data_dir()
    return settings


# CORS — desktop app talks only to localhost
CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


def get_cors_headers(origin: str | None) -> dict[str, str]:
    if origin and origin in CORS_ORIGINS:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        }
    return {}
