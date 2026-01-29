"""Authentication API endpoints.

Provides user registration, login, OAuth, and token management.
"""

import base64
import hashlib
import hmac
import json
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import User, get_db
from middleware.rate_limit import limiter
from services.auth_service import TokenData, create_access_token, optional_auth, require_auth
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
    is_verified: bool
    oauth_provider: str | None
    created_at: str


class AuthStatusResponse(BaseModel):
    """Response model for auth status check."""
    authenticated: bool
    auth_type: str | None = None
    user: UserResponse | None = None
    debug_mode: bool


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
        is_verified=user.is_verified,
        oauth_provider=user.oauth_provider,
        created_at=user.created_at.isoformat() if user.created_at else ""
    )


def user_to_dict(user: User) -> dict:
    """Convert User model to dict for token response."""
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "avatar_url": user.avatar_url,
        "is_verified": user.is_verified,
        "oauth_provider": user.oauth_provider
    }


# =============================================================================
# Registration Endpoints
# =============================================================================

@router.post("/register", response_model=MessageResponse)
@limiter.limit("5/minute")
async def register(
    request: Request,
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db)
):
    """Start user registration by sending verification code.

    Sends a 6-digit verification code to the provided email.
    The code expires in 15 minutes.
    """
    user_service = UserService(db)

    success, message = await user_service.initiate_registration(
        email=body.email,
        username=body.username,
        password=body.password
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

    return MessageResponse(success=True, message=message)


@router.post("/verify-email", response_model=TokenResponse)
@limiter.limit("10/minute")
async def verify_email(
    request: Request,
    body: VerifyEmailRequest,
    db: AsyncSession = Depends(get_db)
):
    """Verify email with code and complete registration.

    On success, returns access token and user information.
    """
    settings = get_settings()
    user_service = UserService(db)

    success, message, user = await user_service.verify_email_code(
        email=body.email,
        code=body.code
    )

    if not success or not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

    # Generate token
    access_token = create_access_token(subject=user.id)

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.jwt_access_token_expire_minutes * 60,
        user=user_to_dict(user)
    )


@router.post("/resend-code", response_model=MessageResponse)
@limiter.limit("3/minute")
async def resend_code(
    request: Request,
    body: ResendCodeRequest,
    db: AsyncSession = Depends(get_db)
):
    """Resend verification code for pending registration."""
    user_service = UserService(db)

    success, message = await user_service.resend_verification_code(body.email)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

    return MessageResponse(success=True, message=message)


# =============================================================================
# Login Endpoints
# =============================================================================

@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(
    request: Request,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db)
):
    """Login with email and password."""
    settings = get_settings()
    user_service = UserService(db)

    success, message, token = await user_service.authenticate(
        email=body.email,
        password=body.password
    )

    if not success or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=message,
            headers={"WWW-Authenticate": "Bearer"}
        )

    # Get user info for response
    user = await user_service.get_user_by_email(body.email)

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=settings.jwt_access_token_expire_minutes * 60,
        user=user_to_dict(user) if user else None
    )


# =============================================================================
# Password Reset Endpoints
# =============================================================================

@router.post("/forgot-password", response_model=MessageResponse)
@limiter.limit("3/minute")
async def forgot_password(
    request: Request,
    body: PasswordResetRequest,
    db: AsyncSession = Depends(get_db)
):
    """Request password reset email."""
    user_service = UserService(db)

    success, message = await user_service.initiate_password_reset(body.email)

    # Always return success to prevent email enumeration
    return MessageResponse(success=True, message=message)


@router.post("/reset-password", response_model=MessageResponse)
@limiter.limit("5/minute")
async def reset_password(
    request: Request,
    body: PasswordResetConfirm,
    db: AsyncSession = Depends(get_db)
):
    """Reset password with token from email."""
    user_service = UserService(db)

    success, message = await user_service.reset_password(
        token=body.token,
        new_password=body.new_password
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

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
        settings.jwt_secret_key.encode(),
        payload_b64.encode(),
        hashlib.sha256
    ).digest()
    signature_b64 = base64.urlsafe_b64encode(signature).decode()
    state = base64.urlsafe_b64encode(f"{payload_b64}.{signature_b64}".encode()).decode()
    return state


def _verify_oauth_state(state: str, max_age_seconds: int = 600) -> dict[str, str | int | None] | None:
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
            settings.jwt_secret_key.encode(),
            payload_b64.encode(),
            hashlib.sha256
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
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Google OAuth is not configured"
        )

    # Generate signed state for CSRF protection (stateless approach)
    state = _create_oauth_state(redirect_uri=redirect_uri)

    auth_url = oauth_service.get_authorization_url(state=state)

    return {"authorization_url": auth_url}


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Handle Google OAuth callback."""
    settings = get_settings()

    # Verify signed state token
    state_payload = _verify_oauth_state(state)
    if not state_payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired state parameter"
        )

    oauth_service = get_google_oauth_service()

    try:
        # Get user info from Google
        google_user = await oauth_service.authenticate(code)

        if not google_user.get("email"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to get email from Google"
            )

        # Create or update user
        user_service = UserService(db)
        user, is_new = await user_service.create_or_update_oauth_user(
            provider="google",
            oauth_id=google_user["sub"],
            email=google_user["email"],
            username=google_user.get("name"),
            avatar_url=google_user.get("picture")
        )

        # Generate token
        access_token = create_access_token(subject=user.id)

        # Redirect to frontend with token
        redirect_uri = state_payload.get("redirect_uri") if state_payload else None
        base_redirect = redirect_uri or settings.frontend_url
        redirect_url = f"{base_redirect}/auth/callback?token={access_token}"

        return RedirectResponse(url=redirect_url)

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# =============================================================================
# Token Management Endpoints
# =============================================================================

@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("10/minute")
async def refresh_token(
    request: Request,
    token_data: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db)
):
    """Refresh an existing token."""
    settings = get_settings()

    # Get user info
    user_service = UserService(db)
    user = await user_service.get_user_by_id(token_data.sub)

    access_token = create_access_token(subject=token_data.sub)

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.jwt_access_token_expire_minutes * 60,
        user=user_to_dict(user) if user else None
    )


@router.get("/status", response_model=AuthStatusResponse)
async def auth_status(
    request: Request,
    token_data: TokenData | None = Depends(optional_auth),
    db: AsyncSession = Depends(get_db)
):
    """Check current authentication status."""
    settings = get_settings()

    if settings.debug and token_data and token_data.sub == "dev-user":
        return AuthStatusResponse(
            authenticated=True,
            auth_type="dev",
            user=None,
            debug_mode=True
        )

    if token_data is None:
        return AuthStatusResponse(
            authenticated=False,
            debug_mode=settings.debug
        )

    # Get user info
    user_service = UserService(db)
    user = await user_service.get_user_by_id(token_data.sub)

    return AuthStatusResponse(
        authenticated=True,
        auth_type=token_data.token_type,
        user=user_to_response(user) if user else None,
        debug_mode=settings.debug
    )


# =============================================================================
# User Profile Endpoints
# =============================================================================

@router.get("/me", response_model=UserResponse)
async def get_current_user(
    token_data: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db)
):
    """Get current user information."""
    user_service = UserService(db)
    user = await user_service.get_user_by_id(token_data.sub)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    return user_to_response(user)


@router.patch("/me", response_model=UserResponse)
async def update_profile(
    body: UpdateProfileRequest,
    token_data: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db)
):
    """Update current user profile."""
    user_service = UserService(db)

    success, message, user = await user_service.update_profile(
        user_id=token_data.sub,
        username=body.username,
        avatar_url=body.avatar_url
    )

    if not success or not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

    return user_to_response(user)


@router.post("/change-password", response_model=MessageResponse)
@limiter.limit("5/minute")
async def change_password(
    request: Request,
    body: ChangePasswordRequest,
    token_data: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db)
):
    """Change current user password."""
    user_service = UserService(db)

    success, message = await user_service.change_password(
        user_id=token_data.sub,
        current_password=body.current_password,
        new_password=body.new_password
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

    return MessageResponse(success=True, message=message)


@router.delete("/me", response_model=MessageResponse)
async def delete_account(
    token_data: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db)
):
    """Delete current user account and all associated data.

    This action is irreversible. All user data including files,
    conversations, and messages will be permanently deleted.
    """
    user_service = UserService(db)

    success, message = await user_service.delete_user(token_data.sub)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

    return MessageResponse(success=True, message=message)
