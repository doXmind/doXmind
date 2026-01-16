"""User service for registration, verification, and authentication."""

import random
import secrets
import string
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import (
    Conversation,
    ConversationAttachment,
    EmailVerification,
    File,
    Message,
    PasswordReset,
    User,
)
from services.auth_service import create_access_token, hash_password, verify_password
from services.email_service import get_email_service


class UserService:
    """Service for user management operations."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.settings = get_settings()
        self.email_service = get_email_service()

    # =========================================================================
    # Registration Flow
    # =========================================================================

    async def initiate_registration(
        self,
        email: str,
        username: str,
        password: str
    ) -> tuple[bool, str]:
        """Start the registration process by sending a verification code.

        Args:
            email: User's email address
            username: Desired username
            password: User's password (will be hashed)

        Returns:
            Tuple of (success, message)
        """
        # Check if email already registered
        existing_user = await self.get_user_by_email(email)
        if existing_user:
            return False, "Email already registered"

        # Clean up any existing verification for this email
        await self.db.execute(
            delete(EmailVerification).where(EmailVerification.email == email)
        )

        # Generate 6-digit code
        code = ''.join(random.choices(string.digits, k=6))

        # Create verification record
        verification = EmailVerification(
            email=email,
            code=code,
            expires_at=datetime.now(UTC) + timedelta(
                minutes=self.settings.email_verification_expire_minutes
            ),
            pending_username=username,
            pending_hashed_password=hash_password(password)
        )

        self.db.add(verification)
        await self.db.commit()

        # Send verification email
        sent = await self.email_service.send_verification_code(
            email, code, self.settings.email_verification_expire_minutes
        )

        if not sent:
            # In development, still allow registration but log warning
            if self.settings.debug:
                return True, f"Verification code (dev): {code}"
            return False, "Failed to send verification email"

        return True, "Verification code sent to your email"

    async def verify_email_code(
        self,
        email: str,
        code: str
    ) -> tuple[bool, str, User | None]:
        """Verify the email code and complete registration.

        Args:
            email: User's email address
            code: The verification code entered by user

        Returns:
            Tuple of (success, message, user if created)
        """
        # Find verification record
        result = await self.db.execute(
            select(EmailVerification).where(
                EmailVerification.email == email,
                EmailVerification.verified.is_(False)
            ).order_by(EmailVerification.created_at.desc())
        )
        verification = result.scalar_one_or_none()

        if not verification:
            return False, "No pending verification found", None

        # Check expiration
        if verification.expires_at < datetime.now(UTC):
            return False, "Verification code expired", None

        # Check attempts (brute force protection)
        if verification.attempts >= self.settings.max_verification_attempts:
            return False, "Too many attempts. Please request a new code", None

        # Verify code
        if verification.code != code:
            verification.attempts += 1
            await self.db.commit()
            remaining = self.settings.max_verification_attempts - verification.attempts
            return False, f"Invalid code. {remaining} attempts remaining", None

        # Code is valid - create user
        user = User(
            email=email,
            username=verification.pending_username,
            hashed_password=verification.pending_hashed_password,
            is_verified=True,
            is_active=True
        )

        self.db.add(user)

        # Mark verification as complete
        verification.verified = True
        await self.db.commit()
        await self.db.refresh(user)

        # Send welcome email (fire and forget)
        await self.email_service.send_welcome_email(email, user.username or email)

        return True, "Email verified successfully", user

    async def resend_verification_code(self, email: str) -> tuple[bool, str]:
        """Resend verification code for pending registration.

        Args:
            email: User's email address

        Returns:
            Tuple of (success, message)
        """
        # Check if already registered
        existing_user = await self.get_user_by_email(email)
        if existing_user:
            return False, "Email already registered"

        # Find existing verification
        result = await self.db.execute(
            select(EmailVerification).where(
                EmailVerification.email == email,
                EmailVerification.verified.is_(False)
            ).order_by(EmailVerification.created_at.desc())
        )
        verification = result.scalar_one_or_none()

        if not verification:
            return False, "No pending registration found"

        # Generate new code
        code = ''.join(random.choices(string.digits, k=6))
        verification.code = code
        verification.expires_at = datetime.now(UTC) + timedelta(
            minutes=self.settings.email_verification_expire_minutes
        )
        verification.attempts = 0

        await self.db.commit()

        # Send verification email
        sent = await self.email_service.send_verification_code(
            email, code, self.settings.email_verification_expire_minutes
        )

        if not sent:
            if self.settings.debug:
                return True, f"Verification code (dev): {code}"
            return False, "Failed to send verification email"

        return True, "New verification code sent"

    # =========================================================================
    # Authentication
    # =========================================================================

    async def authenticate(
        self,
        email: str,
        password: str
    ) -> tuple[bool, str, str | None]:
        """Authenticate user with email and password.

        Args:
            email: User's email
            password: User's password

        Returns:
            Tuple of (success, message, token if success)
        """
        user = await self.get_user_by_email(email)

        if not user:
            return False, "Invalid email or password", None

        if not user.hashed_password:
            return False, "Please use OAuth to login", None

        if not user.is_active:
            return False, "Account is disabled", None

        if not user.is_verified:
            return False, "Please verify your email first", None

        if not verify_password(password, user.hashed_password):
            return False, "Invalid email or password", None

        # Update last login
        user.last_login_at = datetime.now(UTC)
        await self.db.commit()

        # Generate token
        token = create_access_token(subject=user.id)

        return True, "Login successful", token

    # =========================================================================
    # Password Reset
    # =========================================================================

    async def initiate_password_reset(self, email: str) -> tuple[bool, str]:
        """Start password reset flow.

        Args:
            email: User's email

        Returns:
            Tuple of (success, message)
        """
        user = await self.get_user_by_email(email)

        # Always return success to prevent email enumeration
        if not user or not user.hashed_password:
            return True, "If an account exists, a reset link will be sent"

        # Clean up old reset tokens
        await self.db.execute(
            delete(PasswordReset).where(PasswordReset.user_id == user.id)
        )

        # Generate reset token
        token = secrets.token_urlsafe(32)

        reset = PasswordReset(
            user_id=user.id,
            token=token,
            expires_at=datetime.now(UTC) + timedelta(
                hours=self.settings.password_reset_expire_hours
            )
        )

        self.db.add(reset)
        await self.db.commit()

        # Build reset link
        reset_link = f"{self.settings.frontend_url}/reset-password?token={token}"

        # Send email
        sent = await self.email_service.send_password_reset(
            email, reset_link, self.settings.password_reset_expire_hours
        )

        if not sent and self.settings.debug:
            return True, f"Reset link (dev): {reset_link}"

        return True, "If an account exists, a reset link will be sent"

    async def reset_password(
        self,
        token: str,
        new_password: str
    ) -> tuple[bool, str]:
        """Reset password using reset token.

        Args:
            token: Reset token from email
            new_password: New password

        Returns:
            Tuple of (success, message)
        """
        result = await self.db.execute(
            select(PasswordReset).where(
                PasswordReset.token == token,
                PasswordReset.used.is_(False)
            )
        )
        reset = result.scalar_one_or_none()

        if not reset:
            return False, "Invalid or expired reset link"

        if reset.expires_at < datetime.now(UTC):
            return False, "Reset link has expired"

        # Get user
        user = await self.get_user_by_id(reset.user_id)
        if not user:
            return False, "User not found"

        # Update password
        user.hashed_password = hash_password(new_password)
        reset.used = True

        await self.db.commit()

        return True, "Password reset successfully"

    # =========================================================================
    # User Queries
    # =========================================================================

    async def get_user_by_email(self, email: str) -> User | None:
        """Get user by email."""
        result = await self.db.execute(
            select(User).where(User.email == email)
        )
        return result.scalar_one_or_none()

    async def get_user_by_id(self, user_id: str) -> User | None:
        """Get user by ID."""
        result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_user_by_oauth(
        self,
        provider: str,
        oauth_id: str
    ) -> User | None:
        """Get user by OAuth provider and ID."""
        result = await self.db.execute(
            select(User).where(
                User.oauth_provider == provider,
                User.oauth_id == oauth_id
            )
        )
        return result.scalar_one_or_none()

    # =========================================================================
    # OAuth User Creation
    # =========================================================================

    async def create_or_update_oauth_user(
        self,
        provider: str,
        oauth_id: str,
        email: str,
        username: str | None = None,
        avatar_url: str | None = None
    ) -> tuple[User, bool]:
        """Create or update user from OAuth login.

        Args:
            provider: OAuth provider name (e.g., 'google')
            oauth_id: User ID from provider
            email: User's email
            username: User's display name
            avatar_url: Profile picture URL

        Returns:
            Tuple of (user, is_new_user)
        """
        # First check by OAuth ID
        user = await self.get_user_by_oauth(provider, oauth_id)

        if user:
            # Update user info
            user.username = username or user.username
            user.avatar_url = avatar_url or user.avatar_url
            user.last_login_at = datetime.now(UTC)
            await self.db.commit()
            return user, False

        # Check if email exists (link accounts)
        user = await self.get_user_by_email(email)

        if user:
            # Link OAuth to existing account
            user.oauth_provider = provider
            user.oauth_id = oauth_id
            user.avatar_url = avatar_url or user.avatar_url
            user.is_verified = True  # OAuth verifies email
            user.last_login_at = datetime.now(UTC)
            await self.db.commit()
            return user, False

        # Create new user
        user = User(
            email=email,
            username=username,
            oauth_provider=provider,
            oauth_id=oauth_id,
            avatar_url=avatar_url,
            is_verified=True,  # OAuth verifies email
            is_active=True
        )

        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)

        # Send welcome email
        await self.email_service.send_welcome_email(email, username or email)

        return user, True

    # =========================================================================
    # Profile Management
    # =========================================================================

    async def update_profile(
        self,
        user_id: str,
        username: str | None = None,
        avatar_url: str | None = None
    ) -> tuple[bool, str, User | None]:
        """Update user profile.

        Args:
            user_id: User's ID
            username: New username (optional)
            avatar_url: New avatar URL (optional)

        Returns:
            Tuple of (success, message, updated user)
        """
        user = await self.get_user_by_id(user_id)

        if not user:
            return False, "User not found", None

        if username is not None:
            user.username = username

        if avatar_url is not None:
            user.avatar_url = avatar_url

        user.updated_at = datetime.now(UTC)
        await self.db.commit()
        await self.db.refresh(user)

        return True, "Profile updated", user

    async def change_password(
        self,
        user_id: str,
        current_password: str,
        new_password: str
    ) -> tuple[bool, str]:
        """Change user password.

        Args:
            user_id: User's ID
            current_password: Current password for verification
            new_password: New password

        Returns:
            Tuple of (success, message)
        """
        user = await self.get_user_by_id(user_id)

        if not user:
            return False, "User not found"

        if not user.hashed_password:
            return False, "Cannot change password for OAuth-only account"

        if not verify_password(current_password, user.hashed_password):
            return False, "Current password is incorrect"

        user.hashed_password = hash_password(new_password)
        user.updated_at = datetime.now(UTC)
        await self.db.commit()

        return True, "Password changed successfully"

    # =========================================================================
    # Account Deletion
    # =========================================================================

    async def delete_user(self, user_id: str) -> tuple[bool, str]:
        """Delete user account and all associated data.

        This permanently deletes:
        - User account
        - All files owned by the user
        - All conversations and messages
        - All conversation attachments
        - Email verifications and password resets

        Args:
            user_id: User's ID

        Returns:
            Tuple of (success, message)
        """
        user = await self.get_user_by_id(user_id)

        if not user:
            return False, "User not found"

        try:
            # Get all conversations for this user
            conv_result = await self.db.execute(
                select(Conversation.id).where(Conversation.user_id == user_id)
            )
            conversation_ids = [row[0] for row in conv_result.fetchall()]

            # Delete messages in user's conversations
            if conversation_ids:
                await self.db.execute(
                    delete(Message).where(Message.conversation_id.in_(conversation_ids))
                )

                # Delete conversation attachments
                await self.db.execute(
                    delete(ConversationAttachment).where(
                        ConversationAttachment.conversation_id.in_(conversation_ids)
                    )
                )

            # Delete conversations
            await self.db.execute(
                delete(Conversation).where(Conversation.user_id == user_id)
            )

            # Delete files
            await self.db.execute(
                delete(File).where(File.user_id == user_id)
            )

            # Delete email verifications
            await self.db.execute(
                delete(EmailVerification).where(EmailVerification.email == user.email)
            )

            # Delete password resets
            await self.db.execute(
                delete(PasswordReset).where(PasswordReset.user_id == user_id)
            )

            # Delete user
            await self.db.delete(user)
            await self.db.commit()

            return True, "Account deleted successfully"

        except Exception as e:
            await self.db.rollback()
            return False, f"Failed to delete account: {str(e)}"
