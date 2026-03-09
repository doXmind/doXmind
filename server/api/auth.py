"""Authentication API endpoints.

Provides user registration, login, OAuth, and token management.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Cookie, Depends, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import Settings, get_settings
from db.database import RefreshToken, User, get_db
from exceptions import BadRequestError, NotFoundError, UnauthorizedError
from middleware.rate_limit import limiter
from services.auth_service import (
    TokenData,
    create_access_token,
    create_device_fingerprint,
    create_refresh_token,
    create_refresh_token_record,
    optional_auth,
    require_auth,
    revoke_refresh_token,
    verify_refresh_token,
)
from services.oauth_service import get_google_oauth_service
from services.user_service import UserService

router = APIRouter()


# =============================================================================
# Request/Response Models
# =============================================================================


class RegisterRequest(BaseModel):
    """Request model for user registration."""

    email: EmailStr
    username: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=8, max_length=128)


class VerifyEmailRequest(BaseModel):
    """Request model for email verification."""

    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class ResendCodeRequest(BaseModel):
    """Request model for resending verification code."""

    email: EmailStr


class LoginRequest(BaseModel):
    """Request model for login."""

    email: EmailStr
    password: str


class PasswordResetRequest(BaseModel):
    """Request model for initiating password reset."""

    email: EmailStr


class PasswordResetConfirm(BaseModel):
    """Request model for confirming password reset."""

    token: str
    new_password: str = Field(min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    """Request model for changing password."""

    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class UpdateProfileRequest(BaseModel):
    """Request model for updating profile."""

    username: str | None = Field(None, min_length=2, max_length=100)
    avatar_url: str | None = None
    avatar_frame: str | None = None
    bio: str | None = Field(None, max_length=500)
    website: str | None = Field(None, max_length=500)
    social_links: dict[str, str] | None = None


class TokenResponse(BaseModel):
    """Response model for authentication."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds
    user: dict | None = None


class MessageResponse(BaseModel):
    """Simple message response."""

    success: bool
    message: str


class UserResponse(BaseModel):
    """User information response."""

    id: str
    email: str
    username: str | None
    avatar_url: str | None
    avatar_frame: str | None = None
    bio: str | None = None
    website: str | None = None
    social_links: dict[str, str] | None = None
    is_verified: bool
    oauth_provider: str | None
    created_at: str


class AuthStatusResponse(BaseModel):
    """Response model for auth status check."""

    authenticated: bool
    auth_type: str | None = None
    user: UserResponse | None = None
    debug_mode: bool


class SessionResponse(BaseModel):
    """Response model for active session information."""

    id: str
    device_name: str
    ip_address: str | None
    created_at: str
    last_used_at: str
    is_current: bool


# =============================================================================
# Helper Functions
# =============================================================================


def user_to_response(user: User) -> UserResponse:
    """Convert User model to response."""
    return UserResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        avatar_url=user.avatar_url,
        avatar_frame=user.avatar_frame,
        bio=user.bio,
        website=user.website,
        social_links=user.social_links,
        is_verified=user.is_verified,
        oauth_provider=user.oauth_provider,
        created_at=user.created_at.isoformat() if user.created_at else "",
    )


def user_to_dict(user: User) -> dict:
    """Convert User model to dict for token response."""
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "avatar_url": user.avatar_url,
        "avatar_frame": user.avatar_frame,
        "is_verified": user.is_verified,
        "oauth_provider": user.oauth_provider,
    }


def set_refresh_token_cookie(response: Response, token: str, settings: Settings) -> None:
    """Set HttpOnly refresh token cookie for dual-token authentication.

    Args:
        response: FastAPI Response object to set cookie on
        token: The refresh token value (plain text, will be sent to browser)
        settings: Application settings for cookie configuration
    """
    response.set_cookie(
        key="doxmind_refresh_token",
        value=token,
        max_age=settings.jwt_refresh_token_expire_days * 86400,  # days to seconds
        httponly=True,  # Prevent JavaScript access (XSS protection)
        secure=settings.cookie_secure,  # HTTPS only in production
        samesite=settings.cookie_samesite,  # CSRF protection
        domain=settings.cookie_domain,  # None for localhost, .doxmind.com for production
        path="/",  # Available site-wide (needed for cookie to work across redirects)
    )


def clear_refresh_token_cookie(response: Response, settings: Settings) -> None:
    """Clear refresh token cookie (for logout).

    Args:
        response: FastAPI Response object
        settings: Application settings for cookie configuration
    """
    response.set_cookie(
        key="doxmind_refresh_token",
        value="",
        max_age=0,  # Expire immediately
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
    )


# =============================================================================
# Registration Endpoints
# =============================================================================


@router.post("/register", response_model=MessageResponse)
@limiter.limit("5/minute")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Start user registration by sending verification code.

    Sends a 6-digit verification code to the provided email.
    The code expires in 15 minutes.
    """
    user_service = UserService(db)

    success, message = await user_service.initiate_registration(
        email=body.email, username=body.username, password=body.password
    )

    if not success:
        raise BadRequestError(message=message)

    return MessageResponse(success=True, message=message)


@router.post("/verify-email", response_model=TokenResponse)
@limiter.limit("10/minute")
async def verify_email(
    request: Request,
    response: Response,
    body: VerifyEmailRequest,
    db: AsyncSession = Depends(get_db),
):
    """Verify email with code and complete registration (dual-token authentication).

    On success, returns access token and sets refresh token cookie.
    """
    settings = get_settings()
    user_service = UserService(db)

    success, message, user = await user_service.verify_email_code(email=body.email, code=body.code)

    if not success or not user:
        raise BadRequestError(message=message)

    # Generate token with user info for auto-recreation
    access_token = create_access_token(
        subject=user.id,
        email=user.email,
        username=user.username,
        avatar_url=user.avatar_url,
        oauth_provider=user.oauth_provider,
        oauth_id=user.oauth_id,
    )

    # Create refresh token for dual-token authentication
    refresh_token_value = create_refresh_token()
    await create_refresh_token_record(user.id, refresh_token_value, request, db)

    # Set refresh token as HttpOnly cookie
    set_refresh_token_cookie(response, refresh_token_value, settings)

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.jwt_access_token_expire_minutes * 60,
        user=user_to_dict(user),
    )


@router.post("/resend-code", response_model=MessageResponse)
@limiter.limit("3/minute")
async def resend_code(
    request: Request, body: ResendCodeRequest, db: AsyncSession = Depends(get_db)
):
    """Resend verification code for pending registration."""
    user_service = UserService(db)

    success, message = await user_service.resend_verification_code(body.email)

    if not success:
        raise BadRequestError(message=message)

    return MessageResponse(success=True, message=message)


# =============================================================================
# Login Endpoints
# =============================================================================


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")  # Reduced from 10 to 5 (prevent brute force)
async def login(
    request: Request,
    response: Response,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Login with email and password (dual-token authentication).

    Returns:
        - access_token: Short-lived JWT (15 minutes) for API requests
        - Sets HttpOnly cookie: Refresh token (30 days) for token renewal
    """
    settings = get_settings()
    user_service = UserService(db)

    success, message, token = await user_service.authenticate(
        email=body.email, password=body.password
    )

    if not success or not token:
        raise UnauthorizedError(message=message)

    # Get user info for response
    user = await user_service.get_user_by_email(body.email)

    # Create refresh token for dual-token authentication
    refresh_token_value = create_refresh_token()
    await create_refresh_token_record(user.id, refresh_token_value, request, db)

    # Set refresh token as HttpOnly cookie
    set_refresh_token_cookie(response, refresh_token_value, settings)

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=settings.jwt_access_token_expire_minutes * 60,
        user=user_to_dict(user) if user else None,
    )


# =============================================================================
# Password Reset Endpoints
# =============================================================================


@router.post("/forgot-password", response_model=MessageResponse)
@limiter.limit("3/minute")
async def forgot_password(
    request: Request, body: PasswordResetRequest, db: AsyncSession = Depends(get_db)
):
    """Request password reset email."""
    user_service = UserService(db)

    success, message = await user_service.initiate_password_reset(body.email)

    # Always return success to prevent email enumeration
    return MessageResponse(success=True, message=message)


@router.post("/reset-password", response_model=MessageResponse)
@limiter.limit("5/minute")
async def reset_password(
    request: Request, body: PasswordResetConfirm, db: AsyncSession = Depends(get_db)
):
    """Reset password with token from email."""
    user_service = UserService(db)

    success, message = await user_service.reset_password(
        token=body.token, new_password=body.new_password
    )

    if not success:
        raise BadRequestError(message=message)

    return MessageResponse(success=True, message=message)


# =============================================================================
# Google OAuth Endpoints
# =============================================================================


def _create_oauth_state(redirect_uri: str | None = None) -> str:
    """Create a signed OAuth state token (stateless approach).

    Uses HMAC to sign a timestamp, allowing verification without shared storage.
    This works across multiple workers without needing Redis/database.
    """
    settings = get_settings()
    payload = {
        "ts": int(time.time()),
        "redirect_uri": redirect_uri,
    }
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    signature = hmac.new(
        settings.jwt_secret_key.encode(), payload_b64.encode(), hashlib.sha256
    ).digest()
    signature_b64 = base64.urlsafe_b64encode(signature).decode()
    state = base64.urlsafe_b64encode(f"{payload_b64}.{signature_b64}".encode()).decode()
    return state


def _verify_oauth_state(
    state: str, max_age_seconds: int = 600
) -> dict[str, str | int | None] | None:
    """Verify a signed OAuth state token.

    Args:
        state: The state token to verify
        max_age_seconds: Maximum age of the token (default 10 minutes)

    Returns:
        True if valid, False otherwise
    """
    settings = get_settings()
    try:
        decoded = base64.urlsafe_b64decode(state.encode()).decode()
        payload_b64, signature_b64 = decoded.split(".", 1)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64.encode()).decode())
        timestamp = int(payload.get("ts", 0))

        # Check if expired
        if time.time() - timestamp > max_age_seconds:
            return None

        # Verify signature
        expected_signature = hmac.new(
            settings.jwt_secret_key.encode(), payload_b64.encode(), hashlib.sha256
        ).digest()
        provided_signature = base64.urlsafe_b64decode(signature_b64.encode())

        if not hmac.compare_digest(expected_signature, provided_signature):
            return None

        return payload
    except Exception:
        return None


@router.get("/google")
async def google_auth(request: Request, redirect_uri: str | None = None):
    """Redirect to Google OAuth authorization page."""
    oauth_service = get_google_oauth_service()

    if not oauth_service.is_configured():
        raise BadRequestError(message="Google OAuth is not configured")

    # Generate signed state for CSRF protection (stateless approach)
    state = _create_oauth_state(redirect_uri=redirect_uri)

    auth_url = oauth_service.get_authorization_url(state=state)

    return {"authorization_url": auth_url}


@router.get("/google/callback")
async def google_callback(
    request: Request,
    response: Response,
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Handle Google OAuth callback (dual-token authentication).

    Creates both access token and refresh token for OAuth users.
    """
    settings = get_settings()

    # Verify signed state token
    state_payload = _verify_oauth_state(state)
    if not state_payload:
        raise BadRequestError(message="Invalid or expired state parameter")

    oauth_service = get_google_oauth_service()

    try:
        # Get user info from Google
        google_user = await oauth_service.authenticate(code)

        if not google_user.get("email"):
            raise BadRequestError(message="Failed to get email from Google")

        # Create or update user
        user_service = UserService(db)
        user, is_new = await user_service.create_or_update_oauth_user(
            provider="google",
            oauth_id=google_user["sub"],
            email=google_user["email"],
            username=google_user.get("name"),
            avatar_url=google_user.get("picture"),
        )

        # Generate token with user info for auto-recreation
        access_token = create_access_token(
            subject=user.id,
            email=user.email,
            username=user.username,
            avatar_url=user.avatar_url,
            oauth_provider=user.oauth_provider,
            oauth_id=user.oauth_id,
        )

        # Create refresh token for dual-token authentication
        refresh_token_value = create_refresh_token()
        await create_refresh_token_record(user.id, refresh_token_value, request, db)

        # Set refresh token cookie on the injected response parameter
        # IMPORTANT: Must set cookie BEFORE modifying response for redirect!
        response.set_cookie(
            key="doxmind_refresh_token",
            value=refresh_token_value,
            max_age=settings.jwt_refresh_token_expire_days * 86400,
            httponly=True,
            secure=settings.cookie_secure,
            samesite=settings.cookie_samesite,
            domain=settings.cookie_domain,
            path="/",
        )

        # Build redirect URL
        redirect_uri = state_payload.get("redirect_uri") if state_payload else None
        base_redirect = redirect_uri or settings.frontend_url
        redirect_url = f"{base_redirect}/auth/callback?token={access_token}"

        # Modify the response to perform redirect (instead of returning RedirectResponse)
        # This ensures cookies set above are preserved in the redirect
        response.status_code = 307
        response.headers["Location"] = redirect_url

        return response

    except ValueError as e:
        raise BadRequestError(message=str(e))


# =============================================================================
# Token Management Endpoints
# =============================================================================


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("20/minute")  # Increased from 10 - auto-refresh happens more frequently
async def refresh_token(
    request: Request,
    response: Response,
    refresh_token: str | None = Cookie(None, alias="doxmind_refresh_token"),
    db: AsyncSession = Depends(get_db),
):
    """Refresh access token using refresh token (implements token rotation).

    Dual-Token Authentication:
    1. Read refresh token from HttpOnly cookie
    2. Verify refresh token from database (not expired, not revoked)
    3. Revoke old refresh token (token rotation for security)
    4. Generate new refresh token and store in database
    5. Set new refresh token as HttpOnly cookie
    6. Generate new access token (short-lived, 15 minutes)
    7. Return new access token to client

    Token Rotation: Each refresh invalidates the old token, preventing replay attacks.
    """
    settings = get_settings()

    # Validate refresh token presence
    if not refresh_token:
        raise UnauthorizedError(message="No refresh token provided")

    # Verify refresh token from database
    token_record, error = await verify_refresh_token(refresh_token, db)
    if not token_record:
        raise UnauthorizedError(message=error or "Invalid refresh token")

    # Get user (verify user still exists and is active)
    user_service = UserService(db)
    user = await user_service.get_user_by_id(token_record.user_id)
    if not user or not user.is_active:
        raise UnauthorizedError(message="User not found or inactive")

    # TOKEN ROTATION: Revoke old refresh token (security best practice)
    await revoke_refresh_token(token_record, db)

    # Generate new refresh token
    new_refresh_token = create_refresh_token()
    await create_refresh_token_record(user.id, new_refresh_token, request, db)

    # Generate new access token
    access_token = create_access_token(
        subject=user.id,
        email=user.email,
        username=user.username,
        avatar_url=user.avatar_url,
        oauth_provider=user.oauth_provider,
        oauth_id=user.oauth_id,
    )

    # Set new refresh token as HttpOnly cookie
    set_refresh_token_cookie(response, new_refresh_token, settings)

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.jwt_access_token_expire_minutes * 60,
        user=user_to_dict(user),
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(
    request: Request,
    response: Response,
    refresh_token: str | None = Cookie(None, alias="doxmind_refresh_token"),
    token_data: TokenData | None = Depends(optional_auth),
    db: AsyncSession = Depends(get_db),
):
    """Logout and revoke refresh token.

    Dual-Token Authentication:
    1. Revoke refresh token in database (if present)
    2. Clear refresh token cookie
    3. Client should also clear access token from localStorage

    Note: Access tokens remain valid until expiry (but are short-lived).
    """
    settings = get_settings()

    # Revoke refresh token if present
    if refresh_token:
        token_record, _ = await verify_refresh_token(refresh_token, db)
        if token_record:
            await revoke_refresh_token(token_record, db)

    # Clear refresh token cookie
    clear_refresh_token_cookie(response, settings)

    return MessageResponse(success=True, message="Logged out successfully")


@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(
    request: Request,
    token_data: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """List all active sessions for the current user.

    Returns all non-revoked, non-expired refresh tokens with device information.
    Marks the current device based on IP + User-Agent fingerprint.
    """
    # Query all active refresh tokens for user
    result = await db.execute(
        select(RefreshToken)
        .where(RefreshToken.user_id == token_data.sub)
        .where(~RefreshToken.is_revoked)
        .where(RefreshToken.expires_at > datetime.now(UTC))
        .order_by(RefreshToken.last_used_at.desc())
    )
    tokens = result.scalars().all()

    # Identify current device
    current_ip = request.client.host if request.client else "unknown"
    current_user_agent = request.headers.get("user-agent", "")
    current_fingerprint = create_device_fingerprint(current_ip, current_user_agent)

    return [
        SessionResponse(
            id=token.id,
            device_name=token.device_name or "Unknown Device",
            ip_address=token.ip_address,
            created_at=token.created_at.isoformat(),
            last_used_at=token.last_used_at.isoformat(),
            is_current=token.device_fingerprint == current_fingerprint,
        )
        for token in tokens
    ]


@router.delete("/sessions/{session_id}", response_model=MessageResponse)
async def revoke_session(
    session_id: str,
    token_data: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a specific session (logout from another device).

    Args:
        session_id: The refresh token ID to revoke

    Returns:
        Success message if session was revoked

    Raises:
        NotFoundError: If session doesn't exist or doesn't belong to user
    """
    # Get the refresh token (verify it belongs to current user)
    result = await db.execute(
        select(RefreshToken)
        .where(RefreshToken.id == session_id)
        .where(RefreshToken.user_id == token_data.sub)
    )
    token = result.scalar_one_or_none()

    if not token:
        raise NotFoundError(resource="Session", resource_id=session_id)

    # Revoke the session
    await revoke_refresh_token(token, db)

    return MessageResponse(success=True, message="Session revoked successfully")


@router.get("/status", response_model=AuthStatusResponse)
async def auth_status(
    request: Request,
    token_data: TokenData | None = Depends(optional_auth),
    db: AsyncSession = Depends(get_db),
):
    """Check current authentication status."""
    settings = get_settings()

    if settings.debug and token_data and token_data.sub == "dev-user":
        return AuthStatusResponse(authenticated=True, auth_type="dev", user=None, debug_mode=True)

    if token_data is None:
        return AuthStatusResponse(authenticated=False, debug_mode=settings.debug)

    # Get user info
    user_service = UserService(db)
    user = await user_service.get_user_by_id(token_data.sub)

    return AuthStatusResponse(
        authenticated=True,
        auth_type=token_data.token_type,
        user=user_to_response(user) if user else None,
        debug_mode=settings.debug,
    )


# =============================================================================
# User Profile Endpoints
# =============================================================================


@router.get("/me", response_model=UserResponse)
async def get_current_user(
    token_data: TokenData = Depends(require_auth), db: AsyncSession = Depends(get_db)
):
    """Get current user information."""
    user_service = UserService(db)
    user = await user_service.get_user_by_id(token_data.sub)

    if not user:
        raise NotFoundError(resource="User", resource_id=token_data.sub)

    return user_to_response(user)


@router.patch("/me", response_model=UserResponse)
async def update_profile(
    body: UpdateProfileRequest,
    token_data: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Update current user profile."""
    user_service = UserService(db)

    success, message, user = await user_service.update_profile(
        user_id=token_data.sub,
        username=body.username,
        avatar_url=body.avatar_url,
        avatar_frame=body.avatar_frame,
        bio=body.bio,
        website=body.website,
        social_links=body.social_links,
    )

    if not success or not user:
        raise BadRequestError(message=message)

    return user_to_response(user)


# =============================================================================
# Avatar Upload
# =============================================================================

_AVATAR_ALLOWED_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
_AVATAR_ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
_AVATAR_MAX_SIZE = 2 * 1024 * 1024  # 2MB
_avatar_logger = logging.getLogger(__name__)


@router.post("/avatar", response_model=UserResponse)
async def upload_avatar(
    file: UploadFile,
    token_data: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Upload a user avatar image.

    Dedicated endpoint that does NOT count against user storage quota.
    Automatically deletes the previous avatar from S3 when a new one is uploaded.
    Max file size: 2MB.
    """
    from services.storage_service import get_storage_service

    user_id = token_data.sub

    # Validate content type
    if file.content_type not in _AVATAR_ALLOWED_TYPES:
        raise BadRequestError(
            message=f"Invalid file type: {file.content_type}. "
            f"Allowed: PNG, JPG, GIF, WebP"
        )

    # Validate extension
    if file.filename:
        ext = Path(file.filename).suffix.lower()
        if ext not in _AVATAR_ALLOWED_EXTENSIONS:
            raise BadRequestError(
                message=f"Invalid file extension: {ext}. Allowed: PNG, JPG, GIF, WebP"
            )
    else:
        ext_map = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/gif": ".gif",
            "image/webp": ".webp",
        }
        ext = ext_map.get(file.content_type, ".png")

    # Read and validate size
    content = await file.read()
    if len(content) > _AVATAR_MAX_SIZE:
        raise BadRequestError(
            message=f"File too large. Maximum avatar size: {_AVATAR_MAX_SIZE // (1024 * 1024)}MB"
        )

    # Get current user to find old avatar
    user = await db.get(User, user_id)
    if not user:
        raise NotFoundError(resource="User", resource_id=user_id)

    old_avatar_url = user.avatar_url

    # Upload new avatar to S3
    filename = f"avatar_{uuid.uuid4().hex}{ext}"
    s3_key = f"avatars/{user_id}/{filename}"
    content_type = file.content_type or "application/octet-stream"

    storage = get_storage_service()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, storage.upload, s3_key, content, content_type)

    # Update user avatar_url
    new_avatar_url = f"/api/images/avatars/{user_id}/{filename}"
    user.avatar_url = new_avatar_url
    user.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(user)

    # Delete old avatar from S3 (best-effort, don't fail if it errors)
    if old_avatar_url and old_avatar_url.startswith("/api/images/avatars/"):
        try:
            # Extract S3 key from URL: /api/images/avatars/{user_id}/{filename} → avatars/{user_id}/{filename}
            old_s3_key = old_avatar_url.removeprefix("/api/images/")
            await loop.run_in_executor(None, storage.delete, old_s3_key)
            _avatar_logger.info(f"Deleted old avatar: {old_s3_key}")
        except Exception:
            _avatar_logger.warning(f"Failed to delete old avatar: {old_avatar_url}", exc_info=True)

    _avatar_logger.info(f"Avatar uploaded for user {user_id}: {new_avatar_url} ({len(content)} bytes)")

    return user_to_response(user)


@router.post("/change-password", response_model=MessageResponse)
@limiter.limit("5/minute")
async def change_password(
    request: Request,
    body: ChangePasswordRequest,
    token_data: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Change current user password."""
    user_service = UserService(db)

    success, message = await user_service.change_password(
        user_id=token_data.sub,
        current_password=body.current_password,
        new_password=body.new_password,
    )

    if not success:
        raise BadRequestError(message=message)

    return MessageResponse(success=True, message=message)


@router.delete("/me", response_model=MessageResponse)
async def delete_account(
    token_data: TokenData = Depends(require_auth), db: AsyncSession = Depends(get_db)
):
    """Delete current user account and all associated data.

    This action is irreversible. All user data including files,
    conversations, and messages will be permanently deleted.
    """
    user_service = UserService(db)

    success, message = await user_service.delete_user(token_data.sub)

    if not success:
        raise BadRequestError(message=message)

    return MessageResponse(success=True, message=message)
