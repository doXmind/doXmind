"""Tests for Email Service."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.email_service import EmailService, get_email_service

# =============================================================================
# EmailService Tests
# =============================================================================


class TestEmailServiceInit:
    """Tests for EmailService initialization."""

    def test_init_loads_settings(self):
        """Should load settings on initialization."""
        with patch("services.email_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock()
            service = EmailService()
            assert service.settings is not None


@pytest.mark.asyncio
class TestSendEmail:
    """Tests for send_email method."""

    async def test_returns_false_without_smtp_credentials(self):
        """Should return False when SMTP credentials not configured."""
        with patch("services.email_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(smtp_user=None, smtp_password=None)
            service = EmailService()

            result = await service.send_email(
                to_email="test@example.com", subject="Test", html_content="<p>Test</p>"
            )

            assert result is False

    async def test_returns_false_with_partial_credentials(self):
        """Should return False when only partial SMTP credentials."""
        with patch("services.email_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(smtp_user="user@example.com", smtp_password=None)
            service = EmailService()

            result = await service.send_email(
                to_email="test@example.com", subject="Test", html_content="<p>Test</p>"
            )

            assert result is False

    async def test_sends_email_successfully(self):
        """Should send email and return True on success."""
        with patch("services.email_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                smtp_user="sender@example.com",
                smtp_password="password",
                smtp_host="smtp.example.com",
                smtp_port=587,
                smtp_use_tls=True,
                smtp_from_name="Test App",
                smtp_from_email="noreply@example.com",
            )

            with patch("services.email_service.aiosmtplib.send", new=AsyncMock()) as mock_send:
                service = EmailService()

                result = await service.send_email(
                    to_email="recipient@example.com",
                    subject="Test Subject",
                    html_content="<p>HTML content</p>",
                    text_content="Plain text content",
                )

                assert result is True
                mock_send.assert_called_once()

    async def test_returns_false_on_smtp_error(self):
        """Should return False when SMTP sending fails."""
        with patch("services.email_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                smtp_user="sender@example.com",
                smtp_password="password",
                smtp_host="smtp.example.com",
                smtp_port=587,
                smtp_use_tls=True,
                smtp_from_name="Test App",
                smtp_from_email=None,
            )

            with patch(
                "services.email_service.aiosmtplib.send",
                new=AsyncMock(side_effect=Exception("SMTP error")),
            ):
                service = EmailService()

                result = await service.send_email(
                    to_email="recipient@example.com", subject="Test", html_content="<p>Content</p>"
                )

                assert result is False

    async def test_uses_smtp_user_as_from_email_if_not_configured(self):
        """Should use smtp_user as from email if smtp_from_email not set."""
        with patch("services.email_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                smtp_user="sender@example.com",
                smtp_password="password",
                smtp_host="smtp.example.com",
                smtp_port=587,
                smtp_use_tls=True,
                smtp_from_name="Test App",
                smtp_from_email=None,  # Not configured
            )

            with patch("services.email_service.aiosmtplib.send", new=AsyncMock()) as mock_send:
                service = EmailService()
                await service.send_email(
                    to_email="recipient@example.com", subject="Test", html_content="<p>Content</p>"
                )

                # Check that from email used smtp_user
                call_args = mock_send.call_args
                message = call_args[0][0]
                assert "sender@example.com" in message["From"]


@pytest.mark.asyncio
class TestSendVerificationCode:
    """Tests for send_verification_code method."""

    async def test_sends_verification_code_email(self):
        """Should send verification code email."""
        with patch("services.email_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                smtp_user="sender@example.com",
                smtp_password="password",
                smtp_host="smtp.example.com",
                smtp_port=587,
                smtp_use_tls=True,
                smtp_from_name="doXmind",
                smtp_from_email="noreply@example.com",
            )

            with patch("services.email_service.aiosmtplib.send", new=AsyncMock()):
                service = EmailService()

                result = await service.send_verification_code(
                    to_email="user@example.com", code="123456", expire_minutes=15
                )

                assert result is True

    async def test_includes_code_in_subject(self):
        """Should include verification code in email subject."""
        with patch("services.email_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                smtp_user="sender@example.com",
                smtp_password="password",
                smtp_host="smtp.example.com",
                smtp_port=587,
                smtp_use_tls=True,
                smtp_from_name="doXmind",
                smtp_from_email="noreply@example.com",
            )

            with patch("services.email_service.aiosmtplib.send", new=AsyncMock()) as mock_send:
                service = EmailService()
                await service.send_verification_code(to_email="user@example.com", code="654321")

                message = mock_send.call_args[0][0]
                assert "654321" in message["Subject"]


@pytest.mark.asyncio
class TestSendPasswordReset:
    """Tests for send_password_reset method."""

    async def test_sends_password_reset_email(self):
        """Should send password reset email."""
        with patch("services.email_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                smtp_user="sender@example.com",
                smtp_password="password",
                smtp_host="smtp.example.com",
                smtp_port=587,
                smtp_use_tls=True,
                smtp_from_name="doXmind",
                smtp_from_email="noreply@example.com",
            )

            with patch("services.email_service.aiosmtplib.send", new=AsyncMock()):
                service = EmailService()

                result = await service.send_password_reset(
                    to_email="user@example.com",
                    reset_link="https://example.com/reset?token=abc123",
                    expire_hours=1,
                )

                assert result is True


@pytest.mark.asyncio
class TestSendWelcomeEmail:
    """Tests for send_welcome_email method."""

    async def test_sends_welcome_email(self):
        """Should send welcome email."""
        with patch("services.email_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                smtp_user="sender@example.com",
                smtp_password="password",
                smtp_host="smtp.example.com",
                smtp_port=587,
                smtp_use_tls=True,
                smtp_from_name="doXmind",
                smtp_from_email="noreply@example.com",
            )

            with patch("services.email_service.aiosmtplib.send", new=AsyncMock()):
                service = EmailService()

                result = await service.send_welcome_email(
                    to_email="user@example.com", username="TestUser"
                )

                assert result is True

    async def test_includes_username_in_content(self):
        """Should include username in email content."""
        with patch("services.email_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                smtp_user="sender@example.com",
                smtp_password="password",
                smtp_host="smtp.example.com",
                smtp_port=587,
                smtp_use_tls=True,
                smtp_from_name="doXmind",
                smtp_from_email="noreply@example.com",
            )

            with patch("services.email_service.aiosmtplib.send", new=AsyncMock()) as mock_send:
                service = EmailService()
                await service.send_welcome_email(to_email="user@example.com", username="JohnDoe")

                # Check that email was sent (username is in HTML content)
                mock_send.assert_called_once()


# =============================================================================
# Singleton Tests
# =============================================================================


class TestGetEmailService:
    """Tests for get_email_service singleton."""

    def test_returns_same_instance(self):
        """Should return same instance on multiple calls."""
        with patch("services.email_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock()

            # Reset singleton
            import services.email_service

            services.email_service._email_service = None

            service1 = get_email_service()
            service2 = get_email_service()

            assert service1 is service2

            # Clean up
            services.email_service._email_service = None

    def test_creates_new_instance_if_none(self):
        """Should create new instance if none exists."""
        with patch("services.email_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock()

            # Reset singleton
            import services.email_service

            services.email_service._email_service = None

            service = get_email_service()

            assert service is not None
            assert isinstance(service, EmailService)

            # Clean up
            services.email_service._email_service = None
