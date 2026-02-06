"""Encryption service for sensitive data.

Provides Fernet symmetric encryption for user API keys and other sensitive data.
"""

import logging

from cryptography.fernet import Fernet, InvalidToken

from config import get_settings

logger = logging.getLogger(__name__)


class EncryptionService:
    """Service for encrypting/decrypting sensitive data using Fernet."""

    def __init__(self):
        settings = get_settings()
        if not settings.api_key_encryption_key:
            raise ValueError(
                "API_KEY_ENCRYPTION_KEY is not configured. "
                'Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )
        self.fernet = Fernet(settings.api_key_encryption_key.encode())

    def encrypt(self, plaintext: str) -> str:
        """Encrypt a string and return base64-encoded ciphertext."""
        return self.fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        """Decrypt base64-encoded ciphertext and return plaintext.

        Raises:
            ValueError: If the ciphertext is invalid or corrupted.
        """
        try:
            return self.fernet.decrypt(ciphertext.encode()).decode()
        except InvalidToken:
            raise ValueError("Invalid or corrupted encrypted data")


def get_encryption_service() -> EncryptionService | None:
    """Get encryption service instance.

    Returns None if encryption key is not configured (for dev environments).
    """
    settings = get_settings()
    if not settings.api_key_encryption_key:
        logger.debug("Encryption service unavailable: API_KEY_ENCRYPTION_KEY not configured")
        return None
    return EncryptionService()
