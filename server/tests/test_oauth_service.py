"""Tests for OAuth Service."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.oauth_service import GoogleOAuthService, get_google_oauth_service

# =============================================================================
# GoogleOAuthService Tests
# =============================================================================


class TestGoogleOAuthServiceInit:
    """Tests for GoogleOAuthService initialization."""

    def test_init_loads_settings(self):
        """Should load settings on initialization."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock()
            service = GoogleOAuthService()
            assert service.settings is not None


class TestIsConfigured:
    """Tests for is_configured method."""

    def test_returns_true_when_configured(self):
        """Should return True when OAuth is fully configured."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id="client-id-123",
                google_client_secret="client-secret-456"
            )
            service = GoogleOAuthService()

            assert service.is_configured() is True

    def test_returns_false_when_missing_client_id(self):
        """Should return False when client ID is missing."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id=None,
                google_client_secret="client-secret-456"
            )
            service = GoogleOAuthService()

            assert service.is_configured() is False

    def test_returns_false_when_missing_client_secret(self):
        """Should return False when client secret is missing."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id="client-id-123",
                google_client_secret=None
            )
            service = GoogleOAuthService()

            assert service.is_configured() is False

    def test_returns_false_when_both_missing(self):
        """Should return False when both are missing."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id=None,
                google_client_secret=None
            )
            service = GoogleOAuthService()

            assert service.is_configured() is False

    def test_returns_false_for_empty_strings(self):
        """Should return False for empty string credentials."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id="",
                google_client_secret=""
            )
            service = GoogleOAuthService()

            assert service.is_configured() is False


class TestGetAuthorizationUrl:
    """Tests for get_authorization_url method."""

    def test_raises_when_not_configured(self):
        """Should raise ValueError when not configured."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id=None,
                google_client_secret=None
            )
            service = GoogleOAuthService()

            with pytest.raises(ValueError, match="not configured"):
                service.get_authorization_url()

    def test_returns_authorization_url_when_configured(self):
        """Should return authorization URL when configured."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id="client-id-123",
                google_client_secret="client-secret-456",
                google_redirect_uri="https://example.com/callback"
            )
            service = GoogleOAuthService()

            url = service.get_authorization_url(state="test-state")

            assert "accounts.google.com" in url
            assert "client_id=client-id-123" in url

    def test_includes_state_parameter(self):
        """Should include state parameter in URL."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id="client-id-123",
                google_client_secret="client-secret-456",
                google_redirect_uri="https://example.com/callback"
            )
            service = GoogleOAuthService()

            url = service.get_authorization_url(state="my-state-value")

            assert "state=my-state-value" in url

    def test_includes_required_scopes(self):
        """Should include required OAuth scopes."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id="client-id-123",
                google_client_secret="client-secret-456",
                google_redirect_uri="https://example.com/callback"
            )
            service = GoogleOAuthService()

            url = service.get_authorization_url()

            assert "openid" in url or "scope" in url


@pytest.mark.asyncio
class TestGetTokens:
    """Tests for get_tokens method."""

    async def test_raises_when_not_configured(self):
        """Should raise ValueError when not configured."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id=None,
                google_client_secret=None
            )
            service = GoogleOAuthService()

            with pytest.raises(ValueError, match="not configured"):
                await service.get_tokens("auth-code")

    async def test_exchanges_code_for_tokens(self):
        """Should exchange authorization code for tokens."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id="client-id-123",
                google_client_secret="client-secret-456",
                google_redirect_uri="https://example.com/callback"
            )

            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "access_token": "access-token-123",
                "refresh_token": "refresh-token-456",
                "id_token": "id-token-789"
            }

            with patch("services.oauth_service.httpx.AsyncClient") as mock_client_class:
                mock_client = MagicMock()
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock()
                mock_client.post = AsyncMock(return_value=mock_response)
                mock_client_class.return_value = mock_client

                service = GoogleOAuthService()
                tokens = await service.get_tokens("auth-code-xyz")

                assert tokens["access_token"] == "access-token-123"
                assert tokens["refresh_token"] == "refresh-token-456"

    async def test_raises_on_token_error(self):
        """Should raise ValueError when token exchange fails."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id="client-id-123",
                google_client_secret="client-secret-456",
                google_redirect_uri="https://example.com/callback"
            )

            mock_response = MagicMock()
            mock_response.status_code = 400
            mock_response.text = "Invalid code"

            # Use patch on httpx module directly
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.post = AsyncMock(return_value=mock_response)
                mock_client_class.return_value.__aenter__.return_value = mock_client
                mock_client_class.return_value.__aexit__.return_value = None

                service = GoogleOAuthService()

                with pytest.raises(ValueError, match="Failed to exchange"):
                    await service.get_tokens("invalid-code")


@pytest.mark.asyncio
class TestGetUserInfo:
    """Tests for get_user_info method."""

    async def test_returns_user_info(self):
        """Should return user info from Google."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock()

            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "sub": "google-user-123",
                "email": "user@gmail.com",
                "name": "Test User",
                "picture": "https://example.com/avatar.jpg"
            }

            with patch("services.oauth_service.httpx.AsyncClient") as mock_client_class:
                mock_client = MagicMock()
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock()
                mock_client.get = AsyncMock(return_value=mock_response)
                mock_client_class.return_value = mock_client

                service = GoogleOAuthService()
                user_info = await service.get_user_info("access-token-123")

                assert user_info["sub"] == "google-user-123"
                assert user_info["email"] == "user@gmail.com"

    async def test_raises_on_user_info_error(self):
        """Should raise ValueError when user info request fails."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock()

            mock_response = MagicMock()
            mock_response.status_code = 401
            mock_response.text = "Invalid token"

            # Use patch on httpx module directly
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=mock_response)
                mock_client_class.return_value.__aenter__.return_value = mock_client
                mock_client_class.return_value.__aexit__.return_value = None

                service = GoogleOAuthService()

                with pytest.raises(ValueError, match="Failed to get user info"):
                    await service.get_user_info("invalid-token")


@pytest.mark.asyncio
class TestAuthenticate:
    """Tests for authenticate method."""

    async def test_completes_oauth_flow(self):
        """Should complete full OAuth flow and return user info."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id="client-id-123",
                google_client_secret="client-secret-456",
                google_redirect_uri="https://example.com/callback"
            )

            # Mock token response
            mock_token_response = MagicMock()
            mock_token_response.status_code = 200
            mock_token_response.json.return_value = {
                "access_token": "access-token-123"
            }

            # Mock user info response
            mock_user_response = MagicMock()
            mock_user_response.status_code = 200
            mock_user_response.json.return_value = {
                "sub": "google-123",
                "email": "user@gmail.com",
                "name": "Test User",
                "picture": "https://example.com/pic.jpg",
                "email_verified": True
            }

            with patch("services.oauth_service.httpx.AsyncClient") as mock_client_class:
                mock_client = MagicMock()
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock()
                # First call is post (tokens), second is get (user info)
                mock_client.post = AsyncMock(return_value=mock_token_response)
                mock_client.get = AsyncMock(return_value=mock_user_response)
                mock_client_class.return_value = mock_client

                service = GoogleOAuthService()
                result = await service.authenticate("auth-code-xyz")

                assert result["sub"] == "google-123"
                assert result["email"] == "user@gmail.com"
                assert result["name"] == "Test User"
                assert result["picture"] == "https://example.com/pic.jpg"
                assert result["email_verified"] is True

    async def test_handles_missing_email_verified(self):
        """Should default email_verified to False if not provided."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                google_client_id="client-id-123",
                google_client_secret="client-secret-456",
                google_redirect_uri="https://example.com/callback"
            )

            mock_token_response = MagicMock()
            mock_token_response.status_code = 200
            mock_token_response.json.return_value = {"access_token": "token"}

            mock_user_response = MagicMock()
            mock_user_response.status_code = 200
            mock_user_response.json.return_value = {
                "sub": "google-123",
                "email": "user@gmail.com"
                # No email_verified field
            }

            with patch("services.oauth_service.httpx.AsyncClient") as mock_client_class:
                mock_client = MagicMock()
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock()
                mock_client.post = AsyncMock(return_value=mock_token_response)
                mock_client.get = AsyncMock(return_value=mock_user_response)
                mock_client_class.return_value = mock_client

                service = GoogleOAuthService()
                result = await service.authenticate("code")

                assert result["email_verified"] is False


# =============================================================================
# Singleton Tests
# =============================================================================


class TestGetGoogleOAuthService:
    """Tests for get_google_oauth_service singleton."""

    def test_returns_same_instance(self):
        """Should return same instance on multiple calls."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock()

            # Reset singleton
            import services.oauth_service
            services.oauth_service._google_oauth_service = None

            service1 = get_google_oauth_service()
            service2 = get_google_oauth_service()

            assert service1 is service2

            # Clean up
            services.oauth_service._google_oauth_service = None

    def test_creates_new_instance_if_none(self):
        """Should create new instance if none exists."""
        with patch("services.oauth_service.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock()

            # Reset singleton
            import services.oauth_service
            services.oauth_service._google_oauth_service = None

            service = get_google_oauth_service()

            assert service is not None
            assert isinstance(service, GoogleOAuthService)

            # Clean up
            services.oauth_service._google_oauth_service = None
