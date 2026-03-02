"""Authentication and Authorization Service.

Provides JWT token generation/validation and API key authentication.
Supports both stateless JWT auth and simple API key auth for flexibility.
"""

import hmac
import logging
from datetime import UTC, datetime, timedelta

from fastapi import Depends, Request
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import RefreshToken, User, get_db
from exceptions import UnauthorizedError

logger = logging.getLogger(__name__)

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

    def __init__(
        self,
        sub: str,
        exp: datetime,
        token_type: str = "access",
        email: str | None = None,
        username: str | None = None,
        avatar_url: str | None = None,
        oauth_provider: str | None = None,
        oauth_id: str | None = None,
    ):
        self.sub = sub  # Subject (user identifier or "anonymous")
        self.exp = exp  # Expiration time
        self.token_type = token_type
        # OAuth user info for auto-recreation if user record is lost
        self.email = email
        self.username = username
        self.avatar_url = avatar_url
        self.oauth_provider = oauth_provider
        self.oauth_id = oauth_id


# =============================================================================
# Token Functions
# =============================================================================


def create_access_token(
    subject: str = "anonymous",
    expires_delta: timedelta | None = None,
    email: str | None = None,
    username: str | None = None,
    avatar_url: str | None = None,
    oauth_provider: str | None = None,
    oauth_id: str | None = None,
) -> str:
    """Create a new JWT access token.

    Args:
        subject: The subject of the token (user ID or identifier)
        expires_delta: Custom expiration time, or use default from settings
        email: User email (stored in JWT for auto-recreation if DB record lost)
        username: User display name
        avatar_url: User avatar URL
        oauth_provider: OAuth provider name (e.g., 'google')
        oauth_id: User ID from OAuth provider

    Returns:
        Encoded JWT token string
    """
    settings = get_settings()

    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(minutes=settings.jwt_access_token_expire_minutes)

    to_encode: dict = {
        "sub": subject,
        "exp": expire,
        "type": "access",
        "iat": datetime.now(UTC),
        "iss": "doxmind",
    }

    # Include OAuth user info for auto-recreation
    if email:
        to_encode["email"] = email
    if username:
        to_encode["username"] = username
    if avatar_url:
        to_encode["avatar_url"] = avatar_url
    if oauth_provider:
        to_encode["oauth_provider"] = oauth_provider
    if oauth_id:
        to_encode["oauth_id"] = oauth_id

    encoded_jwt = jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

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
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])

        sub: str = payload.get("sub")
        exp: int = payload.get("exp")
        token_type: str = payload.get("type", "access")
        issuer: str | None = payload.get("iss")

        if sub is None or exp is None:
            return None

        # Validate issuer if present (backward compat with old tokens)
        if issuer is not None and issuer != "doxmind":
            return None

        return TokenData(
            sub=sub,
            exp=datetime.fromtimestamp(exp, tz=UTC),
            token_type=token_type,
            email=payload.get("email"),
            username=payload.get("username"),
            avatar_url=payload.get("avatar_url"),
            oauth_provider=payload.get("oauth_provider"),
            oauth_id=payload.get("oauth_id"),
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
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> TokenData | None:
    """Extract and validate JWT token from Authorization header.

    This is a soft dependency - returns None if no token provided.
    Use require_auth for strict authentication.
    """
    if credentials is None:
        return None

    token_data = verify_token(credentials.credentials)
    return token_data


async def get_api_key(api_key: str | None = Depends(api_key_header)) -> str | None:
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
    api_key: str | None = Depends(get_api_key),
    db: AsyncSession = Depends(get_db),
) -> TokenData:
    """Require authentication via JWT token OR API key.

    Use this dependency on protected endpoints.
    Auto-creates user record if JWT is valid but user doesn't exist in DB.

    Raises:
        UnauthorizedError: 401 if no valid authentication provided
    """
    settings = get_settings()

    # Check JWT token first
    if token is not None:
        # For real user tokens, ensure the user exists in DB
        if token.sub not in ("dev-user", "api-key-user", "anonymous"):
            result = await db.execute(select(User.id).where(User.id == token.sub))
            if result.scalar_one_or_none() is None:
                # Auto-create user from JWT claims if we have enough info
                if token.email:
                    logger.info(
                        "Auto-creating user %s (%s) from JWT claims", token.sub, token.email
                    )
                    user = User(
                        id=token.sub,
                        email=token.email,
                        username=token.username,
                        avatar_url=token.avatar_url,
                        oauth_provider=token.oauth_provider,
                        oauth_id=token.oauth_id,
                        is_verified=True,
                        is_active=True,
                    )
                    db.add(user)
                    await db.commit()
                else:
                    # No email in JWT (old token format) — force re-login
                    logger.warning(
                        "JWT for user %s has no email claim, cannot auto-create", token.sub
                    )
                    raise UnauthorizedError(message="Session expired. Please log in again.")

            # ===================================================================
            # MIGRATION: Auto-issue refresh token for users with old long-lived access tokens
            # ===================================================================
            # Check if this is an old long-lived token (>24 hours remaining)
            # and user doesn't have a refresh token yet
            time_until_expiry = (token.exp - datetime.now(UTC)).total_seconds()
            if time_until_expiry > 86400:  # More than 24 hours (old 7-day token)
                # Check if user already has a refresh token
                from db.database import RefreshToken

                result = await db.execute(
                    select(RefreshToken.id)
                    .where(RefreshToken.user_id == token.sub)
                    .where(~RefreshToken.is_revoked)
                    .limit(1)
                )
                if not result.scalar_one_or_none():
                    # User has old token but no refresh token - auto-issue one
                    logger.info(
                        "MIGRATION: Auto-issuing refresh token for user %s (old token detected)",
                        token.sub,
                    )
                    try:
                        # Generate refresh token
                        new_refresh_token = create_refresh_token()
                        # Create record (without setting cookie - will be set on next /refresh call)
                        await create_refresh_token_record(
                            user_id=token.sub,
                            refresh_token=new_refresh_token,
                            request=request,
                            db=db,
                        )
                        logger.info(
                            "MIGRATION: Successfully created refresh token for user %s", token.sub
                        )
                    except Exception as e:
                        # Don't block the request if migration fails
                        logger.error(
                            "MIGRATION: Failed to create refresh token for user %s: %s",
                            token.sub,
                            str(e),
                        )

        return token

    # If a Bearer token was sent but failed validation, return 401.
    # Don't silently fall back to dev-user — the frontend needs to know
    # its token is invalid so it can clear it and re-authenticate.
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        raise UnauthorizedError(message="Invalid or expired token. Please log in again.")

    # Check API key
    if api_key is not None:
        return TokenData(
            sub="api-key-user", exp=datetime.now(UTC) + timedelta(days=1), token_type="api_key"
        )

    # In debug mode, allow unauthenticated access for development
    if settings.debug:
        logger.warning(
            "DEBUG AUTH BYPASS: Returning dev-user token for unauthenticated request. "
            "This MUST NOT be active in production."
        )
        return TokenData(
            sub="dev-user", exp=datetime.now(UTC) + timedelta(days=1), token_type="dev"
        )

    # No valid authentication
    raise UnauthorizedError(
        message="Authentication required. Provide a valid JWT token or API key."
    )


async def optional_auth(
    token: TokenData | None = Depends(get_current_token), api_key: str | None = Depends(get_api_key)
) -> TokenData | None:
    """Optional authentication - returns None if not authenticated.

    Use this for endpoints that work both authenticated and anonymously.
    """
    if token is not None:
        return token

    if api_key is not None:
        return TokenData(
            sub="api-key-user", exp=datetime.now(UTC) + timedelta(days=1), token_type="api_key"
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


# =============================================================================
# Dual-Token Authentication (Access + Refresh Tokens)
# =============================================================================


def create_refresh_token() -> str:
    """Generate a cryptographically secure refresh token.

    Uses secrets.token_urlsafe for high entropy (~256 bits).

    Returns:
        URL-safe random token string (43 characters)
    """
    import secrets

    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Hash a token using SHA-256.

    Used for storing refresh tokens securely in database.
    Never store plain tokens - always hash first.

    Args:
        token: Plain token string

    Returns:
        Hexadecimal SHA-256 hash (64 characters)
    """
    import hashlib

    return hashlib.sha256(token.encode()).hexdigest()


def create_device_fingerprint(ip: str, user_agent: str) -> str:
    """Create device fingerprint from IP and User-Agent.

    Note: This is a best-effort identifier, not foolproof.
    VPNs, proxies, and browser updates can change the fingerprint.

    Args:
        ip: Client IP address
        user_agent: Client User-Agent header

    Returns:
        SHA-256 hash of combined IP + User-Agent
    """
    import hashlib

    combined = f"{ip}|{user_agent}"
    return hashlib.sha256(combined.encode()).hexdigest()


def parse_device_name(user_agent: str) -> str:
    """Parse User-Agent to extract human-readable device name.

    Simple parsing logic - can be enhanced with user-agents library.

    Args:
        user_agent: User-Agent header string

    Returns:
        Simplified device name (e.g., "Chrome on Windows")
    """
    ua_lower = user_agent.lower()

    # Detect browser
    browser = "Unknown Browser"
    if "chrome" in ua_lower and "edg" not in ua_lower:
        browser = "Chrome"
    elif "firefox" in ua_lower:
        browser = "Firefox"
    elif "safari" in ua_lower and "chrome" not in ua_lower:
        browser = "Safari"
    elif "edg" in ua_lower:
        browser = "Edge"

    # Detect OS
    os_name = "Unknown OS"
    if "windows" in ua_lower:
        os_name = "Windows"
    elif "mac" in ua_lower or "darwin" in ua_lower:
        os_name = "macOS"
    elif "linux" in ua_lower:
        os_name = "Linux"
    elif "android" in ua_lower:
        os_name = "Android"
    elif "iphone" in ua_lower or "ipad" in ua_lower:
        os_name = "iOS"

    return f"{browser} on {os_name}"


async def create_refresh_token_record(
    user_id: str, refresh_token: str, request: Request, db: AsyncSession
) -> RefreshToken:
    """Create and save a refresh token record in database.

    Implements device deduplication: if a session already exists for this device,
    the old session is revoked before creating a new one to prevent session proliferation.

    Args:
        user_id: User ID to associate token with
        refresh_token: Plain refresh token (will be hashed before storage)
        request: FastAPI request object (for extracting device info)
        db: Database session

    Returns:
        Created RefreshToken record
    """
    from db.database import RefreshToken

    settings = get_settings()

    # Extract device information
    ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "")
    device_fingerprint = create_device_fingerprint(ip, user_agent)

    # Check for existing session from this device
    result = await db.execute(
        select(RefreshToken)
        .where(RefreshToken.user_id == user_id)
        .where(RefreshToken.device_fingerprint == device_fingerprint)
        .where(~RefreshToken.is_revoked)
        .where(RefreshToken.expires_at > datetime.now(UTC))
    )
    existing_session = result.scalar_one_or_none()

    # Revoke existing session if found (device re-login or token rotation)
    if existing_session:
        await revoke_refresh_token(existing_session, db)

    # Create token record
    token_record = RefreshToken(
        user_id=user_id,
        token_hash=hash_token(refresh_token),
        device_fingerprint=device_fingerprint,
        ip_address=ip,
        user_agent=user_agent,
        device_name=parse_device_name(user_agent),
        expires_at=datetime.now(UTC) + timedelta(days=settings.jwt_refresh_token_expire_days),
    )

    db.add(token_record)
    await db.commit()
    await db.refresh(token_record)

    return token_record


async def verify_refresh_token(
    refresh_token: str, db: AsyncSession
) -> tuple[RefreshToken | None, str | None]:
    """Verify a refresh token and return its database record.

    Args:
        refresh_token: Plain refresh token from cookie
        db: Database session

    Returns:
        Tuple of (token_record, error_message)
        - token_record is None if invalid
        - error_message explains why validation failed
    """
    from db.database import RefreshToken

    token_hash_value = hash_token(refresh_token)

    # Find token in database
    result = await db.execute(
        select(RefreshToken)
        .where(RefreshToken.token_hash == token_hash_value)
        .where(RefreshToken.is_revoked == False)  # noqa: E712
    )
    token_record = result.scalar_one_or_none()

    if not token_record:
        return None, "Invalid refresh token"

    # Check expiration
    if token_record.expires_at < datetime.now(UTC):
        return None, "Refresh token expired"

    return token_record, None


async def revoke_refresh_token(token_record: RefreshToken, db: AsyncSession) -> None:
    """Revoke a refresh token (mark as revoked).

    Args:
        token_record: RefreshToken record to revoke
        db: Database session
    """
    token_record.is_revoked = True
    token_record.revoked_at = datetime.now(UTC)
    await db.commit()
