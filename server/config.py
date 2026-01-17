"""Application configuration.

Centralized settings management with environment variable support.
All configurable values should be defined here.
"""

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings

# Get the directory where config.py is located (server/)
_BASE_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    """Application settings.

    All values can be overridden via environment variables.
    """

    # =========================================================================
    # API Keys
    # =========================================================================
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    google_api_key: str = ""  # For Gemini file conversion (PDF, DOCX, PPTX to markdown)

    # =========================================================================
    # Security / JWT
    # =========================================================================
    # Generate a secure key: openssl rand -hex 32
    jwt_secret_key: str = "your-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    # API Key for simple authentication (optional, for external integrations)
    api_key: str = ""

    # Rate limiting
    rate_limit_per_minute: int = 60
    rate_limit_burst: int = 10

    # =========================================================================
    # Email Service (SMTP)
    # =========================================================================
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_name: str = "doXmind"
    smtp_from_email: str = ""
    smtp_use_tls: bool = True

    # =========================================================================
    # Google OAuth
    # =========================================================================
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/auth/google/callback"

    # =========================================================================
    # Frontend URL (for OAuth redirects)
    # =========================================================================
    frontend_url: str = "http://localhost:3000"

    # =========================================================================
    # Verification Settings
    # =========================================================================
    email_verification_expire_minutes: int = 15
    password_reset_expire_hours: int = 1
    max_verification_attempts: int = 5

    # =========================================================================
    # Database
    # =========================================================================
    # For PostgreSQL: postgresql+asyncpg://user:password@host:port/dbname
    # For SQLite: sqlite+aiosqlite:///./data/app.db
    database_url: str = "sqlite+aiosqlite:///./data/app.db"

    # =========================================================================
    # Vector Store (Chroma)
    # =========================================================================
    chroma_host: str = ""  # Empty = use local persistent storage
    chroma_port: int = 8000
    chroma_persist_dir: str = "./data/chroma"

    # =========================================================================
    # Server
    # =========================================================================
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True

    # =========================================================================
    # AI Models
    # =========================================================================
    default_model: str = "claude-haiku-4-5-20251001"
    fast_model: str = "claude-3-5-haiku-20241022"

    # =========================================================================
    # Web Tools Settings (Anthropic server-side tools)
    # =========================================================================
    web_search_enabled: bool = False  # Default off, user can enable
    web_search_max_uses: int = 5  # Max searches per request
    # Web fetch is always enabled (free, only costs tokens)
    web_fetch_max_uses: int = 10  # Max fetches per request

    # =========================================================================
    # Limits - Centralized configuration values
    # =========================================================================
    # Token limits
    max_context_tokens: int = 100000
    max_output_tokens: int = 8192

    # File size limits (in bytes)
    max_file_size: int = 50 * 1024 * 1024  # 50MB for KB attachments
    max_import_file_size: int = 10 * 1024 * 1024  # 10MB for file imports

    # Agent limits
    max_agent_iterations: int = 10  # Maximum tool use iterations

    # Content limits
    max_document_context_chars: int = 50000  # Max chars for document context in chat

    # Version history
    max_versions_per_file: int = 100

    # Autocomplete cache
    autocomplete_cache_size: int = 1000
    autocomplete_cache_ttl_seconds: int = 300  # 5 minutes

    # RAG settings
    chunk_size: int = 1000
    chunk_overlap: int = 200
    sentence_min_length: int = 5

    class Config:
        env_file = str(_BASE_DIR / ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"  # Ignore extra env vars

    # =========================================================================
    # Computed Properties
    # =========================================================================

    @property
    def is_postgres(self) -> bool:
        """Check if using PostgreSQL."""
        return "postgresql" in self.database_url

    @property
    def use_chroma_server(self) -> bool:
        """Check if using Chroma server mode."""
        return bool(self.chroma_host)

    @property
    def max_file_size_mb(self) -> float:
        """Get max file size in megabytes."""
        return self.max_file_size / (1024 * 1024)


@lru_cache
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
