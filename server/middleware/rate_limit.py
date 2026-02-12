"""Rate Limiting Middleware.

Implements request rate limiting to prevent API abuse.
Uses slowapi for efficient in-memory rate limiting with Redis support.
Supports per-user rate limiting via JWT tokens with IP fallback.
"""

import logging
import ssl

from fastapi import Request
from fastapi.responses import JSONResponse
from jose import jwt
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from config import get_settings

logger = logging.getLogger(__name__)

# User IDs that should fall back to IP-based rate limiting
_SKIP_USER_IDS = {"dev-user", "api-key-user", "anonymous"}


def get_client_ip(request: Request) -> str:
    """Get client IP address from request.

    Handles X-Forwarded-For header for proxied requests.
    """
    # Check for forwarded header (when behind proxy/load balancer)
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # Take the first IP in the chain (original client)
        return forwarded.split(",")[0].strip()

    # Check for real IP header (nginx)
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip

    # Fall back to direct client IP
    return get_remote_address(request)


def get_rate_limit_key(request: Request) -> str:
    """Get rate limiting key from request.

    Tries to extract user_id from a JWT token in the Authorization header
    for per-user rate limiting. Falls back to client IP address if:
    - No Authorization header is present
    - The token is invalid or expired
    - The user is a special user (dev-user, api-key-user, anonymous)
    """
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:]  # Strip "Bearer " prefix
        try:
            settings = get_settings()
            payload = jwt.decode(
                token,
                settings.jwt_secret_key,
                algorithms=[settings.jwt_algorithm],
            )
            user_id = payload.get("sub")
            if user_id and user_id not in _SKIP_USER_IDS:
                return f"user:{user_id}"
        except Exception:
            # Any JWT error (expired, invalid, malformed) — fall back to IP
            pass

    return get_client_ip(request)


# Create limiter instance
settings = get_settings()

# Heroku Redis uses self-signed certificates; skip verification for rediss:// URIs
_storage_options = {}
if settings.rate_limit_storage_uri.startswith("rediss://"):
    _storage_options["ssl_cert_reqs"] = ssl.CERT_NONE

limiter = Limiter(
    key_func=get_rate_limit_key,
    default_limits=[f"{settings.rate_limit_per_minute}/minute"],
    storage_uri=settings.rate_limit_storage_uri,
    storage_options=_storage_options,
    strategy="fixed-window",
)


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """Custom handler for rate limit exceeded errors."""
    return JSONResponse(
        status_code=429,
        content={
            "error": {
                "code": "RATE_LIMIT_EXCEEDED",
                "message": "Too many requests. Please slow down.",
                "details": {"retry_after": exc.detail},
            }
        },
        headers={
            "Retry-After": str(60),  # Suggest retry after 60 seconds
            "X-RateLimit-Limit": str(settings.rate_limit_per_minute),
        },
    )


# Rate limit decorators for different endpoint types
def limit_standard(func):
    """Standard rate limit for most endpoints."""
    return limiter.limit(f"{settings.rate_limit_per_minute}/minute")(func)


def limit_ai(func):
    """Stricter rate limit for AI/LLM endpoints (expensive operations)."""
    # AI endpoints get 1/3 of the standard rate
    ai_limit = max(settings.rate_limit_per_minute // 3, 10)
    return limiter.limit(f"{ai_limit}/minute")(func)


def limit_auth(func):
    """Rate limit for authentication endpoints (prevent brute force)."""
    return limiter.limit("10/minute")(func)


def limit_upload(func):
    """Rate limit for file upload endpoints."""
    return limiter.limit("20/minute")(func)


def limit_burst(func):
    """Allow burst traffic for certain endpoints."""
    burst_limit = settings.rate_limit_per_minute * 2
    return limiter.limit(f"{burst_limit}/minute")(func)
