"""Anthropic Files API Service.

This module provides file upload functionality for Claude's code execution feature.
Files must be uploaded via the Files API before they can be used in code execution.

Usage:
    service = AnthropicFilesService()
    file_id = await service.upload_file(content, filename, mime_type)
    # Use file_id in message: {"type": "container_upload", "file_id": file_id}
"""

import base64
import logging

from anthropic import AsyncAnthropic

from config import get_settings

logger = logging.getLogger(__name__)


class AnthropicFilesService:
    """Service for uploading files to Anthropic's Files API for code execution."""

    def __init__(self, client: AsyncAnthropic = None):
        """Initialize the service.

        Args:
            client: Existing AsyncAnthropic client, or creates a new one
        """
        if client:
            self.client = client
        else:
            settings = get_settings()
            self.client = AsyncAnthropic(api_key=settings.anthropic_api_key)

        # Cache to avoid re-uploading same files
        # Key: content hash, Value: file_id
        self._file_cache: dict[str, str] = {}

    async def upload_file(
        self, content: bytes | str, filename: str, mime_type: str = "application/octet-stream"
    ) -> str | None:
        """Upload a file to Anthropic's Files API for code execution.

        Args:
            content: File content as bytes or base64 string
            filename: Original filename
            mime_type: MIME type of the file

        Returns:
            file_id from Anthropic API, or None if upload fails
        """
        try:
            # Convert base64 to bytes if needed
            if isinstance(content, str):
                file_bytes = base64.b64decode(content)
            else:
                file_bytes = content

            # Check cache using content hash
            import hashlib

            content_hash = hashlib.sha256(file_bytes).hexdigest()
            if content_hash in self._file_cache:
                logger.debug(f"Using cached file_id for {filename}")
                return self._file_cache[content_hash]

            # Upload to Anthropic Files API
            # The files.create method expects a tuple of (filename, content, mime_type)
            # Requires beta header for Files API
            file_response = await self.client.beta.files.upload(
                file=(filename, file_bytes, mime_type),
            )

            file_id = file_response.id
            self._file_cache[content_hash] = file_id
            logger.info(f"Uploaded file {filename} to Anthropic, got file_id: {file_id}")

            return file_id

        except Exception as e:
            logger.error(f"Failed to upload file {filename} to Anthropic: {e}")
            return None

    async def upload_multiple_files(self, files: list[dict]) -> dict[str, str]:
        """Upload multiple files to Anthropic's Files API.

        Args:
            files: List of dicts with keys: content, filename, mime_type

        Returns:
            Dict mapping filename to file_id
        """
        results = {}
        for file_data in files:
            file_id = await self.upload_file(
                content=file_data.get("content"),
                filename=file_data.get("filename", "data"),
                mime_type=file_data.get("mime_type", "application/octet-stream"),
            )
            if file_id:
                results[file_data.get("filename", "data")] = file_id
        return results

    def clear_cache(self):
        """Clear the file cache."""
        self._file_cache.clear()


# Singleton instance
_service_instance: AnthropicFilesService | None = None


def get_anthropic_files_service(client: AsyncAnthropic = None) -> AnthropicFilesService:
    """Get the singleton instance of the Anthropic Files Service.

    Args:
        client: Optional AsyncAnthropic client to use

    Returns:
        AnthropicFilesService instance
    """
    global _service_instance
    if _service_instance is None or client is not None:
        _service_instance = AnthropicFilesService(client)
    return _service_instance
