"""OAuth service for Google authentication."""

import logging
from typing import Any

import httpx
from authlib.integrations.httpx_client import AsyncOAuth2Client

from config import get_settings

logger = logging.getLogger(__name__)


class GoogleOAuthService:
    """Service for Google OAuth authentication."""

    GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration"
    GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
    GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
    GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

    def __init__(self):
        self.settings = get_settings()

    def is_configured(self) -> bool:
        """Check if Google OAuth is configured."""
        return bool(self.settings.google_client_id and self.settings.google_client_secret)

    def get_authorization_url(self, state: str | None = None) -> str:
        """Get the Google OAuth authorization URL.

        Args:
            state: Optional state parameter for CSRF protection

        Returns:
            Authorization URL to redirect user to
        """
        if not self.is_configured():
            raise ValueError("Google OAuth is not configured")

        client = AsyncOAuth2Client(
            client_id=self.settings.google_client_id,
            client_secret=self.settings.google_client_secret,
            redirect_uri=self.settings.google_redirect_uri
        )

        url, _ = client.create_authorization_url(
            self.GOOGLE_AUTH_URL,
            scope="openid email profile",
            state=state,
            access_type="offline",
            prompt="select_account"
        )

        return url

    async def get_tokens(self, code: str) -> dict[str, Any]:
        """Exchange authorization code for tokens.

        Args:
            code: Authorization code from Google callback

        Returns:
            Token response including access_token, id_token, etc.
        """
        if not self.is_configured():
            raise ValueError("Google OAuth is not configured")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.GOOGLE_TOKEN_URL,
                data={
                    "client_id": self.settings.google_client_id,
                    "client_secret": self.settings.google_client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": self.settings.google_redirect_uri
                }
            )

            if response.status_code != 200:
                logger.error(f"Token exchange failed: {response.text}")
                raise ValueError("Failed to exchange authorization code")

            return response.json()

    async def get_user_info(self, access_token: str) -> dict[str, Any]:
        """Get user information from Google.

        Args:
            access_token: Google access token

        Returns:
            User info including email, name, picture, etc.
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"}
            )

            if response.status_code != 200:
                logger.error(f"User info request failed: {response.text}")
                raise ValueError("Failed to get user info")

            return response.json()

    async def authenticate(self, code: str) -> dict[str, Any]:
        """Complete OAuth flow and get user info.

        Args:
            code: Authorization code from callback

        Returns:
            User info dictionary with:
                - sub: Google user ID
                - email: User's email
                - name: User's display name
                - picture: Profile picture URL
                - email_verified: Whether email is verified
        """
        # Exchange code for tokens
        tokens = await self.get_tokens(code)

        # Get user info
        user_info = await self.get_user_info(tokens["access_token"])

        return {
            "sub": user_info.get("sub"),
            "email": user_info.get("email"),
            "name": user_info.get("name"),
            "picture": user_info.get("picture"),
            "email_verified": user_info.get("email_verified", False)
        }


# Singleton instance
_google_oauth_service: GoogleOAuthService | None = None


def get_google_oauth_service() -> GoogleOAuthService:
    """Get the Google OAuth service singleton."""
    global _google_oauth_service
    if _google_oauth_service is None:
        _google_oauth_service = GoogleOAuthService()
    return _google_oauth_service
