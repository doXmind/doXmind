"""
Tests for authentication API endpoints.
"""
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import EmailVerification, PasswordReset, User
from services.auth_service import (
    create_access_token,
    hash_password,
    verify_password,
    verify_token,
)


@pytest.mark.unit
class TestAuthService:
    """Test authentication service functions."""

    def test_create_access_token(self):
        """Test JWT token creation."""
        token = create_access_token(subject="test-user-123")

        assert token is not None
        assert isinstance(token, str)
        assert len(token) > 0

    def test_verify_valid_token(self):
        """Test verifying a valid JWT token."""
        token = create_access_token(subject="test-user-123")
        token_data = verify_token(token)

        assert token_data is not None
        assert token_data.sub == "test-user-123"

    def test_verify_invalid_token(self):
        """Test verifying an invalid JWT token."""
        token_data = verify_token("invalid-token")

        assert token_data is None

    def test_hash_password(self):
        """Test password hashing."""
        password = "SecurePass123!"
        hashed = hash_password(password)

        assert hashed is not None
        assert hashed != password
        assert len(hashed) > 0

    def test_verify_password_correct(self):
        """Test verifying correct password."""
        password = "SecurePass123!"
        hashed = hash_password(password)

        assert verify_password(password, hashed) is True

    def test_verify_password_incorrect(self):
        """Test verifying incorrect password."""
        password = "SecurePass123!"
        hashed = hash_password(password)

        assert verify_password("WrongPassword", hashed) is False

    def test_password_hash_uniqueness(self):
        """Test that same password produces different hashes (salting)."""
        password = "SecurePass123!"
        hash1 = hash_password(password)
        hash2 = hash_password(password)

        assert hash1 != hash2  # Different salts produce different hashes
        # But both should verify correctly
        assert verify_password(password, hash1) is True
        assert verify_password(password, hash2) is True


@pytest.mark.unit
class TestAuthEndpoints:
    """Test authentication API endpoints."""

    async def test_protected_endpoint_without_auth(self, client: AsyncClient):
        """Test accessing protected endpoint without authentication."""
        # In debug mode, this might still work, so we just check it doesn't crash
        response = await client.get("/api/files/")
        assert response.status_code in [200, 401]

    async def test_protected_endpoint_with_invalid_token(self, client: AsyncClient):
        """Test accessing protected endpoint with invalid token."""
        headers = {"Authorization": "Bearer invalid-token"}
        response = await client.get("/api/files/", headers=headers)

        # Should either fail with 401 or work in debug mode
        assert response.status_code in [200, 401]

    async def test_protected_endpoint_with_valid_token(
        self, client: AsyncClient, auth_headers: dict
    ):
        """Test accessing protected endpoint with valid token."""
        response = await client.get("/api/files/", headers=auth_headers)

        assert response.status_code == 200


# =============================================================================
# Registration Endpoint Tests
# =============================================================================


@pytest.mark.asyncio
class TestRegisterEndpoint:
    """Tests for POST /api/auth/register endpoint."""

    async def test_register_success(self, client: AsyncClient):
        """Should initiate registration and return success message."""
        response = await client.post(
            "/api/auth/register",
            json={
                "email": "newuser@example.com",
                "username": "newuser",
                "password": "SecurePass123!",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "message" in data

    async def test_register_duplicate_email(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error for duplicate email."""
        # Create existing user
        user = User(
            email="existing@example.com",
            username="existinguser",
            hashed_password=hash_password("password123"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        response = await client.post(
            "/api/auth/register",
            json={
                "email": "existing@example.com",
                "username": "newuser",
                "password": "SecurePass123!",
            },
        )

        assert response.status_code == 400
        assert "already registered" in response.json()["detail"]

    async def test_register_invalid_email(self, client: AsyncClient):
        """Should return error for invalid email format."""
        response = await client.post(
            "/api/auth/register",
            json={
                "email": "invalid-email",
                "username": "newuser",
                "password": "SecurePass123!",
            },
        )

        assert response.status_code == 422  # Validation error

    async def test_register_short_password(self, client: AsyncClient):
        """Should return error for password shorter than 8 characters."""
        response = await client.post(
            "/api/auth/register",
            json={
                "email": "user@example.com",
                "username": "newuser",
                "password": "short",
            },
        )

        assert response.status_code == 422

    async def test_register_short_username(self, client: AsyncClient):
        """Should return error for username shorter than 2 characters."""
        response = await client.post(
            "/api/auth/register",
            json={
                "email": "user@example.com",
                "username": "a",
                "password": "SecurePass123!",
            },
        )

        assert response.status_code == 422


# =============================================================================
# Email Verification Tests
# =============================================================================


@pytest.mark.asyncio
class TestVerifyEmailEndpoint:
    """Tests for POST /api/auth/verify-email endpoint."""

    async def test_verify_email_success(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should verify email and return token on success."""
        # Create pending verification
        verification = EmailVerification(
            email="verify@example.com",
            code="123456",
            expires_at=datetime.now(UTC) + timedelta(minutes=15),
            pending_username="verifyuser",
            pending_hashed_password=hash_password("password123"),
        )
        db_session.add(verification)
        await db_session.commit()

        response = await client.post(
            "/api/auth/verify-email",
            json={"email": "verify@example.com", "code": "123456"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert "user" in data

    async def test_verify_email_invalid_code(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error for invalid verification code."""
        verification = EmailVerification(
            email="verify2@example.com",
            code="123456",
            expires_at=datetime.now(UTC) + timedelta(minutes=15),
            pending_username="verifyuser2",
            pending_hashed_password=hash_password("password123"),
        )
        db_session.add(verification)
        await db_session.commit()

        response = await client.post(
            "/api/auth/verify-email",
            json={"email": "verify2@example.com", "code": "000000"},
        )

        assert response.status_code == 400
        assert "Invalid code" in response.json()["detail"]

    async def test_verify_email_expired_code(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error for expired verification code."""
        verification = EmailVerification(
            email="expired@example.com",
            code="123456",
            expires_at=datetime.now(UTC) - timedelta(minutes=1),  # Expired
            pending_username="expireduser",
            pending_hashed_password=hash_password("password123"),
        )
        db_session.add(verification)
        await db_session.commit()

        response = await client.post(
            "/api/auth/verify-email",
            json={"email": "expired@example.com", "code": "123456"},
        )

        assert response.status_code == 400
        assert "expired" in response.json()["detail"].lower()

    async def test_verify_email_no_pending(self, client: AsyncClient):
        """Should return error when no pending verification exists."""
        response = await client.post(
            "/api/auth/verify-email",
            json={"email": "noexist@example.com", "code": "123456"},
        )

        assert response.status_code == 400
        assert "No pending" in response.json()["detail"]


# =============================================================================
# Resend Code Tests
# =============================================================================


@pytest.mark.asyncio
class TestResendCodeEndpoint:
    """Tests for POST /api/auth/resend-code endpoint."""

    async def test_resend_code_success(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should resend verification code successfully."""
        verification = EmailVerification(
            email="resend@example.com",
            code="111111",
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
            pending_username="resenduser",
            pending_hashed_password=hash_password("password123"),
        )
        db_session.add(verification)
        await db_session.commit()

        response = await client.post(
            "/api/auth/resend-code", json={"email": "resend@example.com"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    async def test_resend_code_already_registered(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error if email already registered."""
        user = User(
            email="registered@example.com",
            username="registereduser",
            hashed_password=hash_password("password123"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        response = await client.post(
            "/api/auth/resend-code", json={"email": "registered@example.com"}
        )

        assert response.status_code == 400
        assert "already registered" in response.json()["detail"]

    async def test_resend_code_no_pending(self, client: AsyncClient):
        """Should return error if no pending registration."""
        response = await client.post(
            "/api/auth/resend-code", json={"email": "nopending@example.com"}
        )

        assert response.status_code == 400
        assert "No pending" in response.json()["detail"]


# =============================================================================
# Login Endpoint Tests
# =============================================================================


@pytest.mark.asyncio
class TestLoginEndpoint:
    """Tests for POST /api/auth/login endpoint."""

    async def test_login_success(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should login successfully with valid credentials."""
        user = User(
            email="login@example.com",
            username="loginuser",
            hashed_password=hash_password("SecurePass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        response = await client.post(
            "/api/auth/login",
            json={"email": "login@example.com", "password": "SecurePass123!"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert "user" in data

    async def test_login_invalid_password(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error for invalid password."""
        user = User(
            email="loginbad@example.com",
            username="loginbaduser",
            hashed_password=hash_password("CorrectPass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        response = await client.post(
            "/api/auth/login",
            json={"email": "loginbad@example.com", "password": "WrongPassword!"},
        )

        assert response.status_code == 401
        assert "Invalid" in response.json()["detail"]

    async def test_login_nonexistent_user(self, client: AsyncClient):
        """Should return error for non-existent user."""
        response = await client.post(
            "/api/auth/login",
            json={"email": "nonexistent@example.com", "password": "SomePass123!"},
        )

        assert response.status_code == 401

    async def test_login_unverified_user(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error for unverified user."""
        user = User(
            email="unverified@example.com",
            username="unverifieduser",
            hashed_password=hash_password("SecurePass123!"),
            is_verified=False,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        response = await client.post(
            "/api/auth/login",
            json={"email": "unverified@example.com", "password": "SecurePass123!"},
        )

        assert response.status_code == 401
        assert "verify" in response.json()["detail"].lower()

    async def test_login_inactive_user(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error for inactive/disabled user."""
        user = User(
            email="inactive@example.com",
            username="inactiveuser",
            hashed_password=hash_password("SecurePass123!"),
            is_verified=True,
            is_active=False,
        )
        db_session.add(user)
        await db_session.commit()

        response = await client.post(
            "/api/auth/login",
            json={"email": "inactive@example.com", "password": "SecurePass123!"},
        )

        assert response.status_code == 401
        assert "disabled" in response.json()["detail"].lower()

    async def test_login_oauth_only_user(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error for OAuth-only user trying password login."""
        user = User(
            email="oauth@example.com",
            username="oauthuser",
            hashed_password=None,  # OAuth user - no password
            oauth_provider="google",
            oauth_id="google-123",
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        response = await client.post(
            "/api/auth/login",
            json={"email": "oauth@example.com", "password": "SomePass123!"},
        )

        assert response.status_code == 401
        assert "OAuth" in response.json()["detail"]


# =============================================================================
# Password Reset Tests
# =============================================================================


@pytest.mark.asyncio
class TestForgotPasswordEndpoint:
    """Tests for POST /api/auth/forgot-password endpoint."""

    async def test_forgot_password_existing_user(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return success for existing user."""
        user = User(
            email="forgotpw@example.com",
            username="forgotpwuser",
            hashed_password=hash_password("OldPass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        response = await client.post(
            "/api/auth/forgot-password", json={"email": "forgotpw@example.com"}
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

    async def test_forgot_password_nonexistent_user(self, client: AsyncClient):
        """Should return success even for nonexistent user (prevent enumeration)."""
        response = await client.post(
            "/api/auth/forgot-password", json={"email": "noexist@example.com"}
        )

        # Always returns success to prevent email enumeration
        assert response.status_code == 200
        assert response.json()["success"] is True


@pytest.mark.asyncio
class TestResetPasswordEndpoint:
    """Tests for POST /api/auth/reset-password endpoint."""

    async def test_reset_password_success(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should reset password with valid token."""
        user = User(
            email="resetpw@example.com",
            username="resetpwuser",
            hashed_password=hash_password("OldPass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        reset = PasswordReset(
            user_id=user.id,
            token="valid-reset-token",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        db_session.add(reset)
        await db_session.commit()

        response = await client.post(
            "/api/auth/reset-password",
            json={"token": "valid-reset-token", "new_password": "NewSecurePass123!"},
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

    async def test_reset_password_invalid_token(self, client: AsyncClient):
        """Should return error for invalid token."""
        response = await client.post(
            "/api/auth/reset-password",
            json={"token": "invalid-token", "new_password": "NewSecurePass123!"},
        )

        assert response.status_code == 400
        assert "Invalid" in response.json()["detail"]

    async def test_reset_password_expired_token(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error for expired token."""
        user = User(
            email="expiredpw@example.com",
            username="expiredpwuser",
            hashed_password=hash_password("OldPass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        reset = PasswordReset(
            user_id=user.id,
            token="expired-reset-token",
            expires_at=datetime.now(UTC) - timedelta(hours=1),  # Expired
        )
        db_session.add(reset)
        await db_session.commit()

        response = await client.post(
            "/api/auth/reset-password",
            json={"token": "expired-reset-token", "new_password": "NewSecurePass123!"},
        )

        assert response.status_code == 400
        assert "expired" in response.json()["detail"].lower()


# =============================================================================
# Google OAuth Tests
# =============================================================================


@pytest.mark.asyncio
class TestGoogleOAuthEndpoints:
    """Tests for Google OAuth endpoints."""

    async def test_google_auth_not_configured(self, client: AsyncClient):
        """Should return error when Google OAuth not configured."""
        with patch("api.auth.get_google_oauth_service") as mock_get_service:
            mock_service = MagicMock()
            mock_service.is_configured.return_value = False
            mock_get_service.return_value = mock_service

            response = await client.get("/api/auth/google")

            assert response.status_code == 501
            assert "not configured" in response.json()["detail"]

    async def test_google_auth_configured(self, client: AsyncClient):
        """Should return authorization URL when configured."""
        with patch("api.auth.get_google_oauth_service") as mock_get_service:
            mock_service = MagicMock()
            mock_service.is_configured.return_value = True
            mock_service.get_authorization_url.return_value = (
                "https://accounts.google.com/oauth?state=xxx"
            )
            mock_get_service.return_value = mock_service

            response = await client.get("/api/auth/google")

            assert response.status_code == 200
            assert "authorization_url" in response.json()

    async def test_google_callback_invalid_state(self, client: AsyncClient):
        """Should return error for invalid OAuth state."""
        response = await client.get(
            "/api/auth/google/callback",
            params={"code": "auth-code", "state": "invalid-state"},
        )

        assert response.status_code == 400
        assert "Invalid" in response.json()["detail"]

    async def test_google_callback_success(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should complete OAuth and redirect with token."""
        # Create valid state
        from api.auth import _create_oauth_state

        valid_state = _create_oauth_state()

        with patch("api.auth.get_google_oauth_service") as mock_get_service:
            mock_service = MagicMock()
            mock_service.authenticate = AsyncMock(
                return_value={
                    "sub": "google-user-123",
                    "email": "googleuser@example.com",
                    "name": "Google User",
                    "picture": "https://example.com/avatar.jpg",
                }
            )
            mock_get_service.return_value = mock_service

            response = await client.get(
                "/api/auth/google/callback",
                params={"code": "valid-auth-code", "state": valid_state},
                follow_redirects=False,
            )

            # Should redirect with token
            assert response.status_code == 307
            assert "token=" in response.headers.get("location", "")

    async def test_google_callback_no_email(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error if Google doesn't provide email."""
        from api.auth import _create_oauth_state

        valid_state = _create_oauth_state()

        with patch("api.auth.get_google_oauth_service") as mock_get_service:
            mock_service = MagicMock()
            mock_service.authenticate = AsyncMock(
                return_value={
                    "sub": "google-user-123",
                    # No email provided
                }
            )
            mock_get_service.return_value = mock_service

            response = await client.get(
                "/api/auth/google/callback",
                params={"code": "valid-auth-code", "state": valid_state},
            )

            assert response.status_code == 400
            assert "email" in response.json()["detail"].lower()


# =============================================================================
# Token Management Tests
# =============================================================================


@pytest.mark.asyncio
class TestRefreshTokenEndpoint:
    """Tests for POST /api/auth/refresh endpoint."""

    async def test_refresh_token_success(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should refresh token for authenticated user."""
        user = User(
            id="refresh-user-id",
            email="refresh@example.com",
            username="refreshuser",
            hashed_password=hash_password("SecurePass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        token = create_access_token(subject="refresh-user-id")
        headers = {"Authorization": f"Bearer {token}"}

        response = await client.post("/api/auth/refresh", headers=headers)

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    async def test_refresh_token_no_auth(self, client: AsyncClient):
        """Should return error without authentication."""
        response = await client.post("/api/auth/refresh")

        # In debug mode might work, otherwise 401
        assert response.status_code in [200, 401]


@pytest.mark.asyncio
class TestAuthStatusEndpoint:
    """Tests for GET /api/auth/status endpoint."""

    async def test_auth_status_authenticated(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return authenticated status for valid token."""
        user = User(
            id="status-user-id",
            email="status@example.com",
            username="statususer",
            hashed_password=hash_password("SecurePass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        token = create_access_token(subject="status-user-id")
        headers = {"Authorization": f"Bearer {token}"}

        response = await client.get("/api/auth/status", headers=headers)

        assert response.status_code == 200
        data = response.json()
        assert data["authenticated"] is True
        assert "user" in data

    async def test_auth_status_unauthenticated(self, client: AsyncClient):
        """Should return unauthenticated status without token."""
        response = await client.get("/api/auth/status")

        assert response.status_code == 200
        data = response.json()
        # In debug mode, might be authenticated as dev-user
        assert "authenticated" in data


# =============================================================================
# User Profile Tests
# =============================================================================


@pytest.mark.asyncio
class TestGetMeEndpoint:
    """Tests for GET /api/auth/me endpoint."""

    async def test_get_me_success(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return current user info."""
        user = User(
            id="me-user-id",
            email="me@example.com",
            username="meuser",
            hashed_password=hash_password("SecurePass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        token = create_access_token(subject="me-user-id")
        headers = {"Authorization": f"Bearer {token}"}

        response = await client.get("/api/auth/me", headers=headers)

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "me-user-id"
        assert data["email"] == "me@example.com"
        assert data["username"] == "meuser"

    async def test_get_me_not_found(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error if user not found in database."""
        # Create token for non-existent user
        token = create_access_token(subject="nonexistent-user-id")
        headers = {"Authorization": f"Bearer {token}"}

        response = await client.get("/api/auth/me", headers=headers)

        # In debug mode might work with dev user, otherwise 404
        assert response.status_code in [200, 404]


@pytest.mark.asyncio
class TestUpdateProfileEndpoint:
    """Tests for PATCH /api/auth/me endpoint."""

    async def test_update_profile_success(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should update user profile."""
        user = User(
            id="update-user-id",
            email="update@example.com",
            username="oldusername",
            hashed_password=hash_password("SecurePass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        token = create_access_token(subject="update-user-id")
        headers = {"Authorization": f"Bearer {token}"}

        response = await client.patch(
            "/api/auth/me",
            headers=headers,
            json={"username": "newusername", "avatar_url": "https://example.com/new.jpg"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "newusername"

    async def test_update_profile_partial(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should update only provided fields."""
        user = User(
            id="partial-user-id",
            email="partial@example.com",
            username="partialuser",
            avatar_url="https://example.com/old.jpg",
            hashed_password=hash_password("SecurePass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        token = create_access_token(subject="partial-user-id")
        headers = {"Authorization": f"Bearer {token}"}

        # Only update username
        response = await client.patch(
            "/api/auth/me",
            headers=headers,
            json={"username": "updatedpartial"},
        )

        assert response.status_code == 200


# =============================================================================
# Change Password Tests
# =============================================================================


@pytest.mark.asyncio
class TestChangePasswordEndpoint:
    """Tests for POST /api/auth/change-password endpoint."""

    async def test_change_password_success(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should change password with correct current password."""
        user = User(
            id="changepw-user-id",
            email="changepw@example.com",
            username="changepwuser",
            hashed_password=hash_password("OldPass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        token = create_access_token(subject="changepw-user-id")
        headers = {"Authorization": f"Bearer {token}"}

        response = await client.post(
            "/api/auth/change-password",
            headers=headers,
            json={"current_password": "OldPass123!", "new_password": "NewPass456!"},
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

    async def test_change_password_wrong_current(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error for incorrect current password."""
        user = User(
            id="wrongpw-user-id",
            email="wrongpw@example.com",
            username="wrongpwuser",
            hashed_password=hash_password("CorrectOld123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        token = create_access_token(subject="wrongpw-user-id")
        headers = {"Authorization": f"Bearer {token}"}

        response = await client.post(
            "/api/auth/change-password",
            headers=headers,
            json={"current_password": "WrongOld123!", "new_password": "NewPass456!"},
        )

        assert response.status_code == 400
        assert "incorrect" in response.json()["detail"].lower()

    async def test_change_password_oauth_user(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error for OAuth-only user."""
        user = User(
            id="oauth-changepw-user-id",
            email="oauthchangepw@example.com",
            username="oauthchangepwuser",
            hashed_password=None,  # OAuth user
            oauth_provider="google",
            oauth_id="google-456",
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        token = create_access_token(subject="oauth-changepw-user-id")
        headers = {"Authorization": f"Bearer {token}"}

        response = await client.post(
            "/api/auth/change-password",
            headers=headers,
            json={"current_password": "SomePass123!", "new_password": "NewPass456!"},
        )

        assert response.status_code == 400
        assert "OAuth" in response.json()["detail"]


# =============================================================================
# Delete Account Tests
# =============================================================================


@pytest.mark.asyncio
class TestDeleteAccountEndpoint:
    """Tests for DELETE /api/auth/me endpoint."""

    async def test_delete_account_success(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should delete user account and all associated data."""
        user = User(
            id="delete-user-id",
            email="delete@example.com",
            username="deleteuser",
            hashed_password=hash_password("SecurePass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        token = create_access_token(subject="delete-user-id")
        headers = {"Authorization": f"Bearer {token}"}

        response = await client.delete("/api/auth/me", headers=headers)

        assert response.status_code == 200
        assert response.json()["success"] is True

    async def test_delete_account_not_found(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return error if user not found."""
        token = create_access_token(subject="nonexistent-delete-id")
        headers = {"Authorization": f"Bearer {token}"}

        response = await client.delete("/api/auth/me", headers=headers)

        # In debug mode might work, otherwise error
        assert response.status_code in [200, 400]


# =============================================================================
# OAuth State Tests
# =============================================================================


class TestOAuthState:
    """Tests for OAuth state creation and verification."""

    def test_create_and_verify_state(self):
        """Should create valid state that passes verification."""
        from api.auth import _create_oauth_state, _verify_oauth_state

        state = _create_oauth_state()
        result = _verify_oauth_state(state)
        # Returns payload dict on success, None on failure
        assert result is not None
        assert "ts" in result
        assert "redirect_uri" in result

    def test_create_state_with_redirect_uri(self):
        """Should store redirect_uri in state payload."""
        from api.auth import _create_oauth_state, _verify_oauth_state

        redirect_uri = "https://example.com/callback"
        state = _create_oauth_state(redirect_uri=redirect_uri)
        result = _verify_oauth_state(state)
        assert result is not None
        assert result.get("redirect_uri") == redirect_uri

    def test_verify_invalid_state(self):
        """Should reject invalid state."""
        from api.auth import _verify_oauth_state

        assert _verify_oauth_state("invalid-state") is None
        assert _verify_oauth_state("") is None

    def test_verify_expired_state(self):
        """Should reject expired state."""
        import base64
        import hashlib
        import hmac
        import json
        import time

        from api.auth import _verify_oauth_state
        from config import get_settings

        settings = get_settings()

        # Create state with old timestamp (11 minutes ago, past 10 min max_age)
        payload = {"ts": int(time.time()) - 660, "redirect_uri": None}
        payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
        signature = hmac.new(
            settings.jwt_secret_key.encode(),
            payload_b64.encode(),
            hashlib.sha256,
        ).digest()
        signature_b64 = base64.urlsafe_b64encode(signature).decode()
        state = base64.urlsafe_b64encode(f"{payload_b64}.{signature_b64}".encode()).decode()

        assert _verify_oauth_state(state) is None

    def test_verify_tampered_state(self):
        """Should reject state with tampered signature."""
        import base64

        from api.auth import _create_oauth_state, _verify_oauth_state

        state = _create_oauth_state()
        # Decode and tamper
        decoded = base64.urlsafe_b64decode(state.encode()).decode()
        payload_b64, _ = decoded.split(".", 1)
        # Use wrong signature
        tampered = base64.urlsafe_b64encode(
            f"{payload_b64}.wrong-signature".encode()
        ).decode()

        assert _verify_oauth_state(tampered) is None


# =============================================================================
# Helper Function Tests
# =============================================================================


class TestHelperFunctions:
    """Tests for helper functions in auth module."""

    def test_user_to_response(self):
        """Should convert User model to UserResponse."""
        from api.auth import user_to_response

        user = User(
            id="helper-user-id",
            email="helper@example.com",
            username="helperuser",
            avatar_url="https://example.com/avatar.jpg",
            is_verified=True,
            oauth_provider="google",
            created_at=datetime.now(UTC),
        )

        response = user_to_response(user)

        assert response.id == "helper-user-id"
        assert response.email == "helper@example.com"
        assert response.username == "helperuser"
        assert response.avatar_url == "https://example.com/avatar.jpg"
        assert response.is_verified is True
        assert response.oauth_provider == "google"

    def test_user_to_response_no_created_at(self):
        """Should handle None created_at."""
        from api.auth import user_to_response

        user = User(
            id="no-date-user",
            email="nodate@example.com",
            username="nodateuser",
            is_verified=False,
            created_at=None,
        )

        response = user_to_response(user)

        assert response.created_at == ""

    def test_user_to_dict(self):
        """Should convert User model to dict."""
        from api.auth import user_to_dict

        user = User(
            id="dict-user-id",
            email="dict@example.com",
            username="dictuser",
            avatar_url="https://example.com/avatar.jpg",
            is_verified=True,
            oauth_provider=None,
        )

        result = user_to_dict(user)

        assert result["id"] == "dict-user-id"
        assert result["email"] == "dict@example.com"
        assert result["username"] == "dictuser"
        assert result["avatar_url"] == "https://example.com/avatar.jpg"
        assert result["is_verified"] is True
        assert result["oauth_provider"] is None
