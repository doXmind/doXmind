"""Email service for sending verification codes and notifications."""

import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import logging

from config import get_settings

logger = logging.getLogger(__name__)


class EmailService:
    """Service for sending emails via SMTP."""

    def __init__(self):
        self.settings = get_settings()

    async def send_email(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        text_content: str | None = None
    ) -> bool:
        """Send an email.

        Args:
            to_email: Recipient email address
            subject: Email subject
            html_content: HTML body content
            text_content: Plain text body (optional, will be derived from HTML if not provided)

        Returns:
            True if sent successfully, False otherwise
        """
        if not self.settings.smtp_user or not self.settings.smtp_password:
            logger.warning("SMTP credentials not configured, skipping email send")
            return False

        try:
            message = MIMEMultipart("alternative")
            message["Subject"] = subject
            message["From"] = f"{self.settings.smtp_from_name} <{self.settings.smtp_from_email or self.settings.smtp_user}>"
            message["To"] = to_email

            # Add plain text part
            if text_content:
                message.attach(MIMEText(text_content, "plain"))

            # Add HTML part
            message.attach(MIMEText(html_content, "html"))

            # Send email
            await aiosmtplib.send(
                message,
                hostname=self.settings.smtp_host,
                port=self.settings.smtp_port,
                username=self.settings.smtp_user,
                password=self.settings.smtp_password,
                start_tls=self.settings.smtp_use_tls,
            )

            logger.info(f"Email sent successfully to {to_email}")
            return True

        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            return False

    async def send_verification_code(self, to_email: str, code: str, expire_minutes: int = 15) -> bool:
        """Send a verification code email.

        Args:
            to_email: Recipient email address
            code: 6-digit verification code
            expire_minutes: How long the code is valid

        Returns:
            True if sent successfully, False otherwise
        """
        subject = f"Your doXmind Verification Code: {code}"

        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .code {{ font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #2563eb; background: #f3f4f6; padding: 16px 24px; border-radius: 8px; display: inline-block; margin: 20px 0; }}
                .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 14px; color: #6b7280; }}
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Verify Your Email</h2>
                <p>Thank you for signing up for doXmind! Please use the following verification code to complete your registration:</p>
                <div class="code">{code}</div>
                <p>This code will expire in <strong>{expire_minutes} minutes</strong>.</p>
                <p>If you didn't request this code, you can safely ignore this email.</p>
                <div class="footer">
                    <p>This email was sent by doXmind. Please do not reply to this email.</p>
                </div>
            </div>
        </body>
        </html>
        """

        text_content = f"""
Verify Your Email

Thank you for signing up for doXmind! Please use the following verification code to complete your registration:

{code}

This code will expire in {expire_minutes} minutes.

If you didn't request this code, you can safely ignore this email.

---
This email was sent by doXmind. Please do not reply to this email.
        """

        return await self.send_email(to_email, subject, html_content, text_content)

    async def send_password_reset(self, to_email: str, reset_link: str, expire_hours: int = 1) -> bool:
        """Send a password reset email.

        Args:
            to_email: Recipient email address
            reset_link: Password reset URL
            expire_hours: How long the link is valid

        Returns:
            True if sent successfully, False otherwise
        """
        subject = "Reset Your doXmind Password"

        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .button {{ display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; margin: 20px 0; }}
                .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 14px; color: #6b7280; }}
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Reset Your Password</h2>
                <p>We received a request to reset your doXmind password. Click the button below to create a new password:</p>
                <a href="{reset_link}" class="button">Reset Password</a>
                <p>This link will expire in <strong>{expire_hours} hour(s)</strong>.</p>
                <p>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
                <div class="footer">
                    <p>If the button doesn't work, copy and paste this link into your browser:</p>
                    <p style="word-break: break-all;">{reset_link}</p>
                </div>
            </div>
        </body>
        </html>
        """

        text_content = f"""
Reset Your Password

We received a request to reset your doXmind password. Visit the link below to create a new password:

{reset_link}

This link will expire in {expire_hours} hour(s).

If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.

---
This email was sent by doXmind. Please do not reply to this email.
        """

        return await self.send_email(to_email, subject, html_content, text_content)

    async def send_welcome_email(self, to_email: str, username: str) -> bool:
        """Send a welcome email after successful registration.

        Args:
            to_email: Recipient email address
            username: User's display name

        Returns:
            True if sent successfully, False otherwise
        """
        subject = "Welcome to doXmind!"

        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 14px; color: #6b7280; }}
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Welcome to doXmind, {username}!</h2>
                <p>Your account has been successfully created. You can now start using doXmind to organize your thoughts and boost your productivity.</p>
                <p>Here are some things you can do:</p>
                <ul>
                    <li>Create and organize your notes</li>
                    <li>Use AI to help you write and edit</li>
                    <li>Build your knowledge base</li>
                </ul>
                <p>We're excited to have you on board!</p>
                <div class="footer">
                    <p>This email was sent by doXmind. Please do not reply to this email.</p>
                </div>
            </div>
        </body>
        </html>
        """

        text_content = f"""
Welcome to doXmind, {username}!

Your account has been successfully created. You can now start using doXmind to organize your thoughts and boost your productivity.

Here are some things you can do:
- Create and organize your notes
- Use AI to help you write and edit
- Build your knowledge base

We're excited to have you on board!

---
This email was sent by doXmind. Please do not reply to this email.
        """

        return await self.send_email(to_email, subject, html_content, text_content)


# Singleton instance
_email_service: EmailService | None = None


def get_email_service() -> EmailService:
    """Get the email service singleton."""
    global _email_service
    if _email_service is None:
        _email_service = EmailService()
    return _email_service
