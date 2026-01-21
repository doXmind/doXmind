"""Authentication and Authorization Service.

Provides JWT token generation/validation and API key authentication.
Supports both stateless JWT auth and simple API key auth for flexibility.
"""

import hmac
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from config import get_settings

# Password hashing context (for future user management)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Security schemes
bearer_scheme = HTTPBearer(auto_error=False)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


# =============================================================================
# Token Models
# =============================================================================

class TokenData:
    """Data extracted from JWT token."""

    def __init__(self, sub: str, exp: datetime, token_type: str = "access"):
        self.sub = sub  # Subject (user identifier or "anonymous")
        self.exp = exp  # Expiration time
        self.token_type = token_type


# =============================================================================
# Token Functions
# =============================================================================

def create_access_token(
    subject: str = "anonymous",
    expires_delta: timedelta | None = None
) -> str:
    """Create a new JWT access token.

    Args:
        subject: The subject of the token (user ID or identifier)
        expires_delta: Custom expiration time, or use default from settings

    Returns:
        Encoded JWT token string
    """
    settings = get_settings()

    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(
            minutes=settings.jwt_access_token_expire_minutes
        )

    to_encode = {
        "sub": subject,
        "exp": expire,
        "type": "access",
        "iat": datetime.now(UTC)
    }

    encoded_jwt = jwt.encode(
        to_encode,
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm
    )

    return encoded_jwt


def verify_token(token: str) -> TokenData | None:
    """Verify and decode a JWT token.

    Args:
        token: The JWT token string to verify

    Returns:
        TokenData if valid, None otherwise
    """
    settings = get_settings()

    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm]
        )

        sub: str = payload.get("sub")
        exp: int = payload.get("exp")
        token_type: str = payload.get("type", "access")

        if sub is None or exp is None:
            return None

        return TokenData(
            sub=sub,
            exp=datetime.fromtimestamp(exp, tz=UTC),
            token_type=token_type
        )

    except JWTError:
        return None


def verify_api_key(api_key: str) -> bool:
    """Verify an API key using constant-time comparison.

    Uses hmac.compare_digest to prevent timing attacks.

    Args:
        api_key: The API key to verify

    Returns:
        True if valid, False otherwise
    """
    settings = get_settings()

    # If no API key is configured, reject all API key auth attempts
    if not settings.api_key:
        return False

    # Use constant-time comparison to prevent timing attacks
    return hmac.compare_digest(api_key.encode("utf-8"), settings.api_key.encode("utf-8"))


# =============================================================================
# FastAPI Dependencies
# =============================================================================

async def get_current_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)
) -> TokenData | None:
    """Extract and validate JWT token from Authorization header.

    This is a soft dependency - returns None if no token provided.
    Use require_auth for strict authentication.
    """
    if credentials is None:
        return None

    token_data = verify_token(credentials.credentials)
    return token_data


async def get_api_key(
    api_key: str | None = Depends(api_key_header)
) -> str | None:
    """Extract API key from X-API-Key header.

    Returns the API key if valid, None otherwise.
    """
    if api_key is None:
        return None

    if verify_api_key(api_key):
        return api_key

    return None


async def require_auth(
    request: Request,
    token: TokenData | None = Depends(get_current_token),
    api_key: str | None = Depends(get_api_key)
) -> TokenData:
    """Require authentication via JWT token OR API key.

    Use this dependency on protected endpoints.

    Raises:
        HTTPException: 401 if no valid authentication provided
    """
    settings = get_settings()

    # Check JWT token first
    if token is not None:
        return token

    # Check API key
    if api_key is not None:
        return TokenData(
            sub="api-key-user",
            exp=datetime.now(UTC) + timedelta(days=1),
            token_type="api_key"
        )

    # In debug mode, allow unauthenticated access for development
    if settings.debug:
        # Return a dummy token for development only when no real auth provided
        return TokenData(
            sub="dev-user",
            exp=datetime.now(UTC) + timedelta(days=1),
            token_type="dev"
        )

    # No valid authentication
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required. Provide a valid JWT token or API key.",
        headers={"WWW-Authenticate": "Bearer"}
    )


async def optional_auth(
    token: TokenData | None = Depends(get_current_token),
    api_key: str | None = Depends(get_api_key)
) -> TokenData | None:
    """Optional authentication - returns None if not authenticated.

    Use this for endpoints that work both authenticated and anonymously.
    """
    if token is not None:
        return token

    if api_key is not None:
        return TokenData(
            sub="api-key-user",
            exp=datetime.now(UTC) + timedelta(days=1),
            token_type="api_key"
        )

    return None


# =============================================================================
# Password Utilities (for future user management)
# =============================================================================

def _truncate_password(password: str) -> str:
    """Truncate password to bcrypt's 72-byte limit.

    bcrypt silently truncates passwords longer than 72 bytes.
    We explicitly handle this to ensure consistent behavior.
    """
    return password.encode("utf-8")[:72].decode("utf-8", errors="ignore")


def hash_password(password: str) -> str:
    """Hash a password using bcrypt.

    Note: bcrypt has a 72-byte limit. Passwords longer than this are truncated.
    """
    return pwd_context.hash(_truncate_password(password))


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return pwd_context.verify(_truncate_password(plain_password), hashed_password)
