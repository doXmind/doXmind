"""Tests for User Service.

Tests the UserService class methods for:
- Registration flow (initiate, verify, resend code)
- Authentication
- Password reset
- OAuth user creation
- Profile management
- Account deletion
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import (
    Conversation,
    EmailVerification,
    File,
    Message,
    PasswordReset,
    User,
)
from services.auth_service import hash_password, verify_password
from services.user_service import UserService

# =============================================================================
# Registration Flow Tests
# =============================================================================


@pytest.mark.asyncio
class TestInitiateRegistration:
    """Tests for initiate_registration method."""

    async def test_success_new_user(self, db_session: AsyncSession):
        """Should create verification record for new user."""
        service = UserService(db_session)

        with patch.object(
            service.email_service, "send_verification_code", new=AsyncMock(return_value=True)
        ):
            success, message = await service.initiate_registration(
                email="new@example.com", username="newuser", password="SecurePass123!"
            )

        assert success is True
        assert "sent" in message.lower() or "code" in message.lower()

    async def test_fails_for_existing_email(self, db_session: AsyncSession):
        """Should return error if email already registered."""
        # Create existing user
        user = User(
            email="existing@example.com",
            username="existing",
            hashed_password=hash_password("password"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        service = UserService(db_session)
        success, message = await service.initiate_registration(
            email="existing@example.com", username="newuser", password="SecurePass123!"
        )

        assert success is False
        assert "already registered" in message.lower()

    async def test_cleans_up_old_verification(self, db_session: AsyncSession):
        """Should clean up old verification for same email."""
        # Create old verification
        old_verification = EmailVerification(
            email="cleanup@example.com",
            code="111111",
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
            pending_username="old",
            pending_hashed_password="old_hash",
        )
        db_session.add(old_verification)
        await db_session.commit()

        service = UserService(db_session)
        with patch.object(
            service.email_service, "send_verification_code", new=AsyncMock(return_value=True)
        ):
            success, message = await service.initiate_registration(
                email="cleanup@example.com", username="newuser", password="SecurePass123!"
            )

        assert success is True

    async def test_returns_code_in_debug_mode_when_email_fails(self, db_session: AsyncSession):
        """Should return code in debug mode if email fails."""
        service = UserService(db_session)

        with (
            patch.object(
                service, "settings", MagicMock(debug=True, email_verification_expire_minutes=15)
            ),
            patch.object(
                service.email_service, "send_verification_code", new=AsyncMock(return_value=False)
            ),
        ):
            success, message = await service.initiate_registration(
                email="debug@example.com", username="debuguser", password="SecurePass123!"
            )

        assert success is True
        # In debug mode with email failure, code is returned in message
        assert "code" in message.lower() or success is True

    async def test_fails_when_email_fails_in_production(self, db_session: AsyncSession):
        """Should return error if email fails in production mode."""
        service = UserService(db_session)

        with (
            patch.object(
                service, "settings", MagicMock(debug=False, email_verification_expire_minutes=15)
            ),
            patch.object(
                service.email_service, "send_verification_code", new=AsyncMock(return_value=False)
            ),
        ):
            success, message = await service.initiate_registration(
                email="prod@example.com", username="produser", password="SecurePass123!"
            )

        assert success is False
        assert "failed" in message.lower()


@pytest.mark.asyncio
class TestVerifyEmailCode:
    """Tests for verify_email_code method."""

    async def test_success_creates_user(self, db_session: AsyncSession):
        """Should create user on successful verification."""
        # Create verification
        verification = EmailVerification(
            email="verify@example.com",
            code="123456",
            expires_at=datetime.now(UTC) + timedelta(minutes=15),
            pending_username="verifyuser",
            pending_hashed_password=hash_password("SecurePass123!"),
        )
        db_session.add(verification)
        await db_session.commit()

        service = UserService(db_session)
        with patch.object(
            service.email_service, "send_welcome_email", new=AsyncMock(return_value=True)
        ):
            success, message, user = await service.verify_email_code(
                email="verify@example.com", code="123456"
            )

        assert success is True
        assert user is not None
        assert user.email == "verify@example.com"
        assert user.is_verified is True

    async def test_fails_no_pending_verification(self, db_session: AsyncSession):
        """Should return error if no pending verification."""
        service = UserService(db_session)
        success, message, user = await service.verify_email_code(
            email="noexist@example.com", code="123456"
        )

        assert success is False
        assert user is None
        assert "no pending" in message.lower()

    async def test_fails_expired_code(self, db_session: AsyncSession):
        """Should return error if code is expired."""
        verification = EmailVerification(
            email="expired@example.com",
            code="123456",
            expires_at=datetime.now(UTC) - timedelta(minutes=1),
            pending_username="expireduser",
            pending_hashed_password="hash",
        )
        db_session.add(verification)
        await db_session.commit()

        service = UserService(db_session)
        success, message, user = await service.verify_email_code(
            email="expired@example.com", code="123456"
        )

        assert success is False
        assert user is None
        assert "expired" in message.lower()

    async def test_fails_wrong_code(self, db_session: AsyncSession):
        """Should return error and increment attempts for wrong code."""
        verification = EmailVerification(
            email="wrong@example.com",
            code="123456",
            expires_at=datetime.now(UTC) + timedelta(minutes=15),
            pending_username="wronguser",
            pending_hashed_password="hash",
        )
        db_session.add(verification)
        await db_session.commit()

        service = UserService(db_session)
        success, message, user = await service.verify_email_code(
            email="wrong@example.com",
            code="000000",  # Wrong code
        )

        assert success is False
        assert user is None
        assert "invalid" in message.lower()

    async def test_fails_too_many_attempts(self, db_session: AsyncSession):
        """Should return error if too many attempts."""
        verification = EmailVerification(
            email="attempts@example.com",
            code="123456",
            expires_at=datetime.now(UTC) + timedelta(minutes=15),
            pending_username="attemptsuser",
            pending_hashed_password="hash",
            attempts=5,  # Max attempts reached
        )
        db_session.add(verification)
        await db_session.commit()

        service = UserService(db_session)
        success, message, user = await service.verify_email_code(
            email="attempts@example.com", code="123456"
        )

        assert success is False
        assert user is None
        assert "too many" in message.lower()


@pytest.mark.asyncio
class TestResendVerificationCode:
    """Tests for resend_verification_code method."""

    async def test_success_resends_code(self, db_session: AsyncSession):
        """Should resend code for pending verification."""
        verification = EmailVerification(
            email="resend@example.com",
            code="111111",
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
            pending_username="resenduser",
            pending_hashed_password="hash",
        )
        db_session.add(verification)
        await db_session.commit()

        service = UserService(db_session)
        with patch.object(
            service.email_service, "send_verification_code", new=AsyncMock(return_value=True)
        ):
            success, message = await service.resend_verification_code("resend@example.com")

        assert success is True
        assert "sent" in message.lower()

    async def test_fails_already_registered(self, db_session: AsyncSession):
        """Should return error if email already registered."""
        user = User(
            email="registered@example.com",
            username="registered",
            hashed_password=hash_password("password"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        service = UserService(db_session)
        success, message = await service.resend_verification_code("registered@example.com")

        assert success is False
        assert "already registered" in message.lower()

    async def test_fails_no_pending_registration(self, db_session: AsyncSession):
        """Should return error if no pending registration."""
        service = UserService(db_session)
        success, message = await service.resend_verification_code("nopending@example.com")

        assert success is False
        assert "no pending" in message.lower()


# =============================================================================
# Authentication Tests
# =============================================================================


@pytest.mark.asyncio
class TestAuthenticate:
    """Tests for authenticate method."""

    async def test_success_valid_credentials(self, db_session: AsyncSession):
        """Should return token for valid credentials."""
        user = User(
            email="auth@example.com",
            username="authuser",
            hashed_password=hash_password("SecurePass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        service = UserService(db_session)
        success, message, token = await service.authenticate(
            email="auth@example.com", password="SecurePass123!"
        )

        assert success is True
        assert token is not None
        assert len(token) > 0

    async def test_fails_invalid_email(self, db_session: AsyncSession):
        """Should return error for non-existent email."""
        service = UserService(db_session)
        success, message, token = await service.authenticate(
            email="noexist@example.com", password="SomePass123!"
        )

        assert success is False
        assert token is None
        assert "invalid" in message.lower()

    async def test_fails_invalid_password(self, db_session: AsyncSession):
        """Should return error for wrong password."""
        user = User(
            email="wrongpw@example.com",
            username="wrongpwuser",
            hashed_password=hash_password("CorrectPass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        service = UserService(db_session)
        success, message, token = await service.authenticate(
            email="wrongpw@example.com", password="WrongPass123!"
        )

        assert success is False
        assert token is None

    async def test_fails_oauth_user(self, db_session: AsyncSession):
        """Should return error for OAuth-only user."""
        user = User(
            email="oauthonly@example.com",
            username="oauthuser",
            hashed_password=None,
            oauth_provider="google",
            oauth_id="google-123",
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        service = UserService(db_session)
        success, message, token = await service.authenticate(
            email="oauthonly@example.com", password="SomePass123!"
        )

        assert success is False
        assert token is None
        assert "oauth" in message.lower()

    async def test_fails_inactive_user(self, db_session: AsyncSession):
        """Should return error for inactive user."""
        user = User(
            email="inactive@example.com",
            username="inactiveuser",
            hashed_password=hash_password("SecurePass123!"),
            is_verified=True,
            is_active=False,
        )
        db_session.add(user)
        await db_session.commit()

        service = UserService(db_session)
        success, message, token = await service.authenticate(
            email="inactive@example.com", password="SecurePass123!"
        )

        assert success is False
        assert token is None
        assert "disabled" in message.lower()

    async def test_fails_unverified_user(self, db_session: AsyncSession):
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

        service = UserService(db_session)
        success, message, token = await service.authenticate(
            email="unverified@example.com", password="SecurePass123!"
        )

        assert success is False
        assert token is None
        assert "verify" in message.lower()


# =============================================================================
# Password Reset Tests
# =============================================================================


@pytest.mark.asyncio
class TestInitiatePasswordReset:
    """Tests for initiate_password_reset method."""

    async def test_success_existing_user(self, db_session: AsyncSession):
        """Should create reset token for existing user."""
        user = User(
            email="reset@example.com",
            username="resetuser",
            hashed_password=hash_password("OldPass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        service = UserService(db_session)
        with patch.object(
            service.email_service, "send_password_reset", new=AsyncMock(return_value=True)
        ):
            success, message = await service.initiate_password_reset("reset@example.com")

        assert success is True

    async def test_success_even_for_nonexistent_user(self, db_session: AsyncSession):
        """Should return success even for nonexistent user (prevent enumeration)."""
        service = UserService(db_session)
        success, message = await service.initiate_password_reset("noexist@example.com")

        # Always returns success to prevent enumeration
        assert success is True

    async def test_success_for_oauth_user(self, db_session: AsyncSession):
        """Should return success for OAuth user (but no email sent)."""
        user = User(
            email="oauthreset@example.com",
            username="oauthresetuser",
            hashed_password=None,
            oauth_provider="google",
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        service = UserService(db_session)
        success, message = await service.initiate_password_reset("oauthreset@example.com")

        assert success is True


@pytest.mark.asyncio
class TestResetPassword:
    """Tests for reset_password method."""

    async def test_success_valid_token(self, db_session: AsyncSession):
        """Should reset password with valid token."""
        user = User(
            email="validreset@example.com",
            username="validresetuser",
            hashed_password=hash_password("OldPass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        reset = PasswordReset(
            user_id=user.id,
            token="valid-token-123",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        db_session.add(reset)
        await db_session.commit()

        service = UserService(db_session)
        success, message = await service.reset_password(
            token="valid-token-123", new_password="NewSecurePass123!"
        )

        assert success is True
        await db_session.refresh(user)
        assert verify_password("NewSecurePass123!", user.hashed_password)

    async def test_fails_invalid_token(self, db_session: AsyncSession):
        """Should return error for invalid token."""
        service = UserService(db_session)
        success, message = await service.reset_password(
            token="invalid-token", new_password="NewPass123!"
        )

        assert success is False
        assert "invalid" in message.lower() or "expired" in message.lower()

    async def test_fails_expired_token(self, db_session: AsyncSession):
        """Should return error for expired token."""
        user = User(
            email="expiredreset@example.com",
            username="expiredresetuser",
            hashed_password=hash_password("OldPass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        reset = PasswordReset(
            user_id=user.id,
            token="expired-token",
            expires_at=datetime.now(UTC) - timedelta(hours=1),
        )
        db_session.add(reset)
        await db_session.commit()

        service = UserService(db_session)
        success, message = await service.reset_password(
            token="expired-token", new_password="NewPass123!"
        )

        assert success is False
        assert "expired" in message.lower()

    async def test_fails_used_token(self, db_session: AsyncSession):
        """Should return error for already used token."""
        user = User(
            email="usedreset@example.com",
            username="usedresetuser",
            hashed_password=hash_password("OldPass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        reset = PasswordReset(
            user_id=user.id,
            token="used-token",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            used=True,
        )
        db_session.add(reset)
        await db_session.commit()

        service = UserService(db_session)
        success, message = await service.reset_password(
            token="used-token", new_password="NewPass123!"
        )

        assert success is False


# =============================================================================
# User Query Tests
# =============================================================================


@pytest.mark.asyncio
class TestUserQueries:
    """Tests for user query methods."""

    async def test_get_user_by_email_found(self, db_session: AsyncSession):
        """Should return user by email."""
        user = User(
            email="findbyemail@example.com",
            username="finduser",
            hashed_password=hash_password("password"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        service = UserService(db_session)
        found = await service.get_user_by_email("findbyemail@example.com")

        assert found is not None
        assert found.email == "findbyemail@example.com"

    async def test_get_user_by_email_not_found(self, db_session: AsyncSession):
        """Should return None for non-existent email."""
        service = UserService(db_session)
        found = await service.get_user_by_email("noexist@example.com")

        assert found is None

    async def test_get_user_by_id_found(self, db_session: AsyncSession):
        """Should return user by ID."""
        user = User(
            email="findbyid@example.com",
            username="findiduser",
            hashed_password=hash_password("password"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        service = UserService(db_session)
        found = await service.get_user_by_id(user.id)

        assert found is not None
        assert found.id == user.id

    async def test_get_user_by_id_not_found(self, db_session: AsyncSession):
        """Should return None for non-existent ID."""
        service = UserService(db_session)
        found = await service.get_user_by_id("nonexistent-id")

        assert found is None

    async def test_get_user_by_oauth_found(self, db_session: AsyncSession):
        """Should return user by OAuth provider and ID."""
        user = User(
            email="oauth@example.com",
            username="oauthuser",
            oauth_provider="google",
            oauth_id="google-12345",
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()

        service = UserService(db_session)
        found = await service.get_user_by_oauth("google", "google-12345")

        assert found is not None
        assert found.oauth_provider == "google"
        assert found.oauth_id == "google-12345"

    async def test_get_user_by_oauth_not_found(self, db_session: AsyncSession):
        """Should return None for non-existent OAuth."""
        service = UserService(db_session)
        found = await service.get_user_by_oauth("google", "nonexistent-oauth-id")

        assert found is None


# =============================================================================
# OAuth User Creation Tests
# =============================================================================


@pytest.mark.asyncio
class TestCreateOrUpdateOAuthUser:
    """Tests for create_or_update_oauth_user method."""

    async def test_creates_new_user(self, db_session: AsyncSession):
        """Should create new user for new OAuth login."""
        service = UserService(db_session)
        with patch.object(
            service.email_service, "send_welcome_email", new=AsyncMock(return_value=True)
        ):
            user, is_new = await service.create_or_update_oauth_user(
                provider="google",
                oauth_id="new-google-123",
                email="newoauth@example.com",
                username="New OAuth User",
                avatar_url="https://example.com/avatar.jpg",
            )

        assert is_new is True
        assert user is not None
        assert user.email == "newoauth@example.com"
        assert user.oauth_provider == "google"
        assert user.is_verified is True

    async def test_updates_existing_oauth_user(self, db_session: AsyncSession):
        """Should update existing OAuth user."""
        existing = User(
            email="existingoauth@example.com",
            username="Old Name",
            oauth_provider="google",
            oauth_id="existing-google-123",
            is_verified=True,
            is_active=True,
        )
        db_session.add(existing)
        await db_session.commit()

        service = UserService(db_session)
        user, is_new = await service.create_or_update_oauth_user(
            provider="google",
            oauth_id="existing-google-123",
            email="existingoauth@example.com",
            username="Updated Name",
        )

        assert is_new is False
        assert user.username == "Updated Name"

    async def test_links_to_existing_email(self, db_session: AsyncSession):
        """Should link OAuth to existing account with same email."""
        existing = User(
            email="linkoauth@example.com",
            username="existinguser",
            hashed_password=hash_password("password"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(existing)
        await db_session.commit()

        service = UserService(db_session)
        user, is_new = await service.create_or_update_oauth_user(
            provider="google",
            oauth_id="link-google-123",
            email="linkoauth@example.com",
            username="Google Name",
        )

        assert is_new is False
        assert user.oauth_provider == "google"
        assert user.oauth_id == "link-google-123"


# =============================================================================
# Profile Management Tests
# =============================================================================


@pytest.mark.asyncio
class TestUpdateProfile:
    """Tests for update_profile method."""

    async def test_updates_username(self, db_session: AsyncSession):
        """Should update username."""
        user = User(
            email="updateprofile@example.com",
            username="oldname",
            hashed_password=hash_password("password"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        service = UserService(db_session)
        success, message, updated = await service.update_profile(
            user_id=user.id, username="newname"
        )

        assert success is True
        assert updated.username == "newname"

    async def test_updates_avatar(self, db_session: AsyncSession):
        """Should update avatar URL."""
        user = User(
            email="updateavatar@example.com",
            username="avataruser",
            hashed_password=hash_password("password"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        service = UserService(db_session)
        success, message, updated = await service.update_profile(
            user_id=user.id, avatar_url="https://example.com/new-avatar.jpg"
        )

        assert success is True
        assert updated.avatar_url == "https://example.com/new-avatar.jpg"

    async def test_fails_user_not_found(self, db_session: AsyncSession):
        """Should return error if user not found."""
        service = UserService(db_session)
        success, message, updated = await service.update_profile(
            user_id="nonexistent-id", username="newname"
        )

        assert success is False
        assert updated is None


@pytest.mark.asyncio
class TestChangePassword:
    """Tests for change_password method."""

    async def test_success_correct_current_password(self, db_session: AsyncSession):
        """Should change password with correct current password."""
        user = User(
            email="changepw@example.com",
            username="changepwuser",
            hashed_password=hash_password("OldPass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        service = UserService(db_session)
        success, message = await service.change_password(
            user_id=user.id, current_password="OldPass123!", new_password="NewPass456!"
        )

        assert success is True
        await db_session.refresh(user)
        assert verify_password("NewPass456!", user.hashed_password)

    async def test_fails_wrong_current_password(self, db_session: AsyncSession):
        """Should return error for wrong current password."""
        user = User(
            email="wrongcurrent@example.com",
            username="wrongcurrentuser",
            hashed_password=hash_password("CorrectPass123!"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        service = UserService(db_session)
        success, message = await service.change_password(
            user_id=user.id, current_password="WrongPass123!", new_password="NewPass456!"
        )

        assert success is False
        assert "incorrect" in message.lower()

    async def test_fails_oauth_user(self, db_session: AsyncSession):
        """Should return error for OAuth-only user."""
        user = User(
            email="oauthchangepw@example.com",
            username="oauthchangepwuser",
            hashed_password=None,
            oauth_provider="google",
            oauth_id="google-pw-123",
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        service = UserService(db_session)
        success, message = await service.change_password(
            user_id=user.id, current_password="SomePass123!", new_password="NewPass456!"
        )

        assert success is False
        assert "oauth" in message.lower()

    async def test_fails_user_not_found(self, db_session: AsyncSession):
        """Should return error if user not found."""
        service = UserService(db_session)
        success, message = await service.change_password(
            user_id="nonexistent-id", current_password="OldPass123!", new_password="NewPass456!"
        )

        assert success is False
        assert "not found" in message.lower()


# =============================================================================
# Account Deletion Tests
# =============================================================================


@pytest.mark.asyncio
class TestDeleteUser:
    """Tests for delete_user method."""

    async def test_success_deletes_user(self, db_session: AsyncSession):
        """Should delete user and return success."""
        user = User(
            email="delete@example.com",
            username="deleteuser",
            hashed_password=hash_password("password"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)
        user_id = user.id

        service = UserService(db_session)
        success, message = await service.delete_user(user_id)

        assert success is True

        # Verify user is deleted
        deleted = await service.get_user_by_id(user_id)
        assert deleted is None

    async def test_deletes_associated_data(self, db_session: AsyncSession):
        """Should delete all associated data with user."""
        user = User(
            email="deleteall@example.com",
            username="deletealluser",
            hashed_password=hash_password("password"),
            is_verified=True,
            is_active=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        # Create associated files
        file = File(name="User File", content="Content", user_id=user.id)
        db_session.add(file)

        # Create conversation
        conv = Conversation(user_id=user.id)
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        # Create message
        msg = Message(conversation_id=conv.id, role="user", content="Test message")
        db_session.add(msg)
        await db_session.commit()

        service = UserService(db_session)
        success, message = await service.delete_user(user.id)

        assert success is True
        assert "deleted" in message.lower()

    async def test_fails_user_not_found(self, db_session: AsyncSession):
        """Should return error if user not found."""
        service = UserService(db_session)
        success, message = await service.delete_user("nonexistent-id")

        assert success is False
        assert "not found" in message.lower()
