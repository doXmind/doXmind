from pydantic_settings import BaseSettings
from functools import lru_cache
import os
from pathlib import Path

# Get the directory where config.py is located (server/)
_BASE_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    """Application settings."""

    # API Keys
    anthropic_api_key: str = ""
    openai_api_key: str = ""

    # Database - supports both SQLite and PostgreSQL
    # For PostgreSQL: postgresql+asyncpg://user:password@host:port/dbname
    # For SQLite: sqlite+aiosqlite:///./data/app.db
    database_url: str = "sqlite+aiosqlite:///./data/app.db"

    # Vector Store - Chroma
    chroma_host: str = ""  # Empty = use local persistent storage
    chroma_port: int = 8000
    chroma_persist_dir: str = "./data/chroma"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True

    # AI Models
    default_model: str = "claude-haiku-4-5-20251001"
    fast_model: str = "claude-haiku-4-5-20251001"

    # Limits
    max_context_tokens: int = 100000
    max_output_tokens: int = 8192

    class Config:
        env_file = str(_BASE_DIR / ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"  # Ignore extra env vars

    @property
    def is_postgres(self) -> bool:
        """Check if using PostgreSQL."""
        return "postgresql" in self.database_url

    @property
    def use_chroma_server(self) -> bool:
        """Check if using Chroma server mode."""
        return bool(self.chroma_host)


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


def ensure_directories():
    """Ensure required directories exist."""
    settings = get_settings()

    # Only create directories for local storage
    if not settings.is_postgres:
        db_path = settings.database_url.replace("sqlite+aiosqlite:///", "").replace("sqlite:///", "")
        if db_path.startswith("./"):
            os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)

    if not settings.use_chroma_server:
        os.makedirs(settings.chroma_persist_dir, exist_ok=True)
