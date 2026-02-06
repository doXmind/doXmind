"""Application configuration.

Centralized settings management with environment variable support.
All configurable values should be defined here.
"""

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
    openai_api_key: str = ""  # Required for pgvector embeddings
    google_api_key: str = ""  # For Gemini file conversion (PDF, DOCX, PPTX to markdown)
    courtlistener_api_key: str = ""  # For legal case search

    # =========================================================================
    # Security / JWT
    # =========================================================================
    # Generate a secure key: openssl rand -hex 32
    # IMPORTANT: This MUST be set via environment variable in production
    jwt_secret_key: str = ""
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
    # Database (PostgreSQL with pgvector)
    # =========================================================================
    # Format: postgresql+asyncpg://user:password@host:port/dbname
    # Local Docker uses port 5433 to avoid conflict with local PostgreSQL
    # Heroku provides postgres://, which is auto-converted
    database_url: str = "postgresql+asyncpg://doxmind:doxmind123@localhost:5433/doxmind"

    @property
    def async_database_url(self) -> str:
        """Get database URL with async driver.

        Handles Heroku's postgres:// format by converting to postgresql+asyncpg://
        """
        url = self.database_url

        # Heroku uses postgres:// but SQLAlchemy needs postgresql://
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://") and "+asyncpg" not in url:
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

        return url

    # =========================================================================
    # Vector Store (pgvector)
    # =========================================================================
    pgvector_enabled: bool = True  # Enable/disable vector search features

    # =========================================================================
    # Server
    # =========================================================================
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False  # IMPORTANT: Default to False for security

    # =========================================================================
    # AI Models
    # =========================================================================
    default_model: str = "claude-haiku-4-5-20251001"
    fast_model: str = "claude-haiku-4-5-20251001"

    # =========================================================================
    # User API Key Settings
    # =========================================================================
    # Encryption key for user API keys (Fernet, 32 bytes base64 encoded)
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    api_key_encryption_key: str = ""

    # Models available when user has their own API key
    available_models: list[str] = [
        "claude-sonnet-4-5-20250929",
        "claude-opus-4-6",
        "claude-haiku-4-5-20251001",
    ]

    # =========================================================================
    # Web Tools Settings (Anthropic server-side tools)
    # =========================================================================
    web_search_enabled: bool = False  # Default off, user can enable
    web_search_max_uses: int = 5  # Max searches per request
    # Web fetch is always enabled (free, only costs tokens)
    web_fetch_max_uses: int = 10  # Max fetches per request

    # =========================================================================
    # Code Execution Settings (Anthropic server-side tool)
    # =========================================================================
    code_execution_enabled: bool = False  # Default off, user can enable

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
    streaming_timeout_seconds: int = 300  # 5 minutes max for streaming responses

    # Content limits
    max_document_context_chars: int = 50000  # Max chars for document context in chat

    # Version history
    max_versions_per_file: int = 100

    # Autocomplete cache
    autocomplete_cache_size: int = 1000
    autocomplete_cache_ttl_seconds: int = 300  # 5 minutes

    # RAG settings
    # Note: OpenAI embedding API has 8192 token limit. These character limits
    # are set conservatively to account for varying token density (code/CJK text
    # can have 1 token per 1-2 chars vs ~4 chars per token for English).
    chunk_size: int = 3000  # Reduced from 4000 for token safety
    chunk_overlap: int = 0  # No overlap - cleaner search results
    sentence_min_length: int = 5

    # Advanced chunking settings
    chunking_strategy: str = "auto"  # "auto", "overlap", "semantic", "recursive_markdown"
    semantic_min_chunk_size: int = 200
    markdown_max_chunk_size: int = 1500  # Reduced from 2000 for token safety
    preserve_code_blocks: bool = True
    preserve_tables: bool = True

    # Hybrid search settings (vector + keyword with RRF fusion)
    hybrid_search_enabled: bool = True
    semantic_weight: float = 0.7  # Weight for vector similarity search
    keyword_weight: float = 0.3  # Weight for full-text keyword search
    rrf_k: int = 60  # RRF constant (standard value)

    # Embedding parallel processing settings
    embedding_batch_size: int = 100  # Texts per API call (OpenAI max is 2048)
    embedding_max_concurrent: int = 10  # Max parallel API calls (user RPM: 10,000)
    embedding_max_retries: int = 3  # Retry attempts per batch
    embedding_retry_delay: float = 1.0  # Initial retry delay in seconds
    embedding_retry_backoff: float = 2.0  # Exponential backoff multiplier

    # Reranking settings (GPT-based with structured outputs)
    reranking_enabled: bool = False  # Disabled by default (adds latency/cost)
    reranking_candidates: int = 20  # Number of candidates to fetch before reranking
    reranking_model: str = "gpt-5-nano"  # Fast & cheap model for reranking

    class Config:
        env_file = str(_BASE_DIR / ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"  # Ignore extra env vars

    # =========================================================================
    # Computed Properties
    # =========================================================================

    @property
    def max_file_size_mb(self) -> float:
        """Get max file size in megabytes."""
        return self.max_file_size / (1024 * 1024)

    @property
    def has_legal_tools(self) -> bool:
        """Check if legal tools are available (API key configured)."""
        return bool(self.courtlistener_api_key)

    @property
    def has_data_analysis_tools(self) -> bool:
        """Check if data analysis tools are available (code execution enabled)."""
        return self.code_execution_enabled


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


# ============================================================================
# CORS Configuration
# ============================================================================

CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://beta.doxmind.com",
    "https://doxmind.com",
    "https://www.doxmind.com",
    "https://doxmind-mini-frontend-2fac03803995.herokuapp.com",
]


def get_cors_headers(origin: str | None) -> dict[str, str]:
    """Get CORS headers for a given origin.

    Args:
        origin: The request origin header value

    Returns:
        Dictionary with CORS headers if origin is allowed, empty dict otherwise
    """
    if origin and origin in CORS_ORIGINS:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        }
    return {}
