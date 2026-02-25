"""API Key service for managing user OpenRouter API keys and model preferences."""

import logging

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import UserAPISettings
from services.encryption_service import get_encryption_service

logger = logging.getLogger(__name__)
audit_logger = logging.getLogger("audit.api_key")


class APIKeyService:
    """Service for managing user API keys and model preferences."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.encryption = get_encryption_service()

    async def get_user_settings(self, user_id: str) -> UserAPISettings | None:
        """Get user's API settings."""
        result = await self.db.execute(
            select(UserAPISettings).where(UserAPISettings.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def save_api_key(self, user_id: str, api_key: str) -> None:
        """Save encrypted API key for user."""
        if not self.encryption:
            raise ValueError("Encryption is not configured")

        settings = await self.get_user_settings(user_id)
        encrypted = self.encryption.encrypt(api_key)

        if settings:
            settings.encrypted_anthropic_key = encrypted
        else:
            settings = UserAPISettings(
                user_id=user_id,
                encrypted_anthropic_key=encrypted,
            )
            self.db.add(settings)

        await self.db.commit()
        audit_logger.info(
            "api_key_saved",
            extra={"user_id": user_id, "action": "save", "is_update": settings is not None},
        )

    async def delete_api_key(self, user_id: str) -> None:
        """Delete user's API key and reset model preference to default.

        When a user removes their API key, they should use the server's default model.
        """
        from config import get_settings

        settings = await self.get_user_settings(user_id)
        if settings:
            settings.encrypted_anthropic_key = None
            # Reset to server default model when removing API key
            settings.preferred_model = get_settings().default_model
            await self.db.commit()
            audit_logger.info("api_key_deleted", extra={"user_id": user_id, "action": "delete"})

    async def get_decrypted_key(
        self, user_id: str, settings: "UserAPISettings | None" = None
    ) -> str | None:
        """Get decrypted API key for user.

        Args:
            user_id: User ID to look up
            settings: Pre-fetched UserAPISettings to avoid duplicate DB query.
                If None, will be fetched from the database.

        Returns None if user has no API key configured or encryption is not available.
        """
        if not self.encryption:
            logger.warning(f"Cannot decrypt API key for user {user_id}: encryption not configured")
            return None

        if settings is None:
            settings = await self.get_user_settings(user_id)
        if settings and settings.encrypted_anthropic_key:
            try:
                key = self.encryption.decrypt(settings.encrypted_anthropic_key)
                audit_logger.info("api_key_used", extra={"user_id": user_id, "action": "decrypt"})
                return key
            except ValueError:
                audit_logger.error(
                    "api_key_decrypt_failed",
                    extra={"user_id": user_id, "action": "decrypt_failed"},
                )
                logger.error(
                    f"Failed to decrypt API key for user {user_id}. "
                    "Key may be corrupted or encryption key may have changed. "
                    "User should re-save their API key."
                )
                return None
        return None

    async def update_preferred_model(self, user_id: str, model: str) -> None:
        """Update user's preferred model."""
        settings = await self.get_user_settings(user_id)
        if settings:
            settings.preferred_model = model
        else:
            settings = UserAPISettings(user_id=user_id, preferred_model=model)
            self.db.add(settings)
        await self.db.commit()
        audit_logger.info(
            "model_preference_updated",
            extra={"user_id": user_id, "action": "model_change", "model": model},
        )

    async def validate_api_key(self, api_key: str) -> tuple[bool, str | None]:
        """Validate an OpenRouter API key using the /auth/key endpoint.

        Returns:
            Tuple of (is_valid, error_message).
            If valid, error_message is None.
        """
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    "https://openrouter.ai/api/v1/auth/key",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                if response.status_code == 200:
                    return True, None
                elif response.status_code == 401:
                    return False, "Invalid API key"
                else:
                    return False, f"Validation failed (HTTP {response.status_code})"
        except Exception as e:
            logger.warning(f"API key validation failed: {e}")
            return False, "Failed to validate API key"

    def has_api_key(self, settings: UserAPISettings | None) -> bool:
        """Check if user has configured an API key."""
        return settings is not None and settings.encrypted_anthropic_key is not None


def get_api_key_service(db: AsyncSession) -> APIKeyService:
    """Get API key service instance."""
    return APIKeyService(db)
