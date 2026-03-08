"""File storage service for image uploads.

Supports two backends:
- S3: AWS S3 or S3-compatible services (Alibaba OSS, Cloudflare R2)
- Local: Server filesystem (for development or lightweight deployments)
"""

import logging
import mimetypes
from functools import lru_cache
from pathlib import Path

from config import get_settings

logger = logging.getLogger(__name__)


class StorageService:
    """Service for S3 file storage operations."""

    def __init__(self):
        import boto3

        settings = get_settings()
        self.bucket = settings.aws_s3_bucket
        self.region = settings.aws_s3_region
        self.client = boto3.client(
            "s3",
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            region_name=self.region,
        )

    def upload(self, key: str, data: bytes, content_type: str) -> None:
        """Upload bytes to S3."""
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
        logger.info(f"Uploaded to S3: s3://{self.bucket}/{key} ({len(data)} bytes)")

    def download(self, key: str) -> tuple[bytes, str]:
        """Download a file from S3.

        Returns:
            Tuple of (file_bytes, content_type)

        Raises:
            FileNotFoundError: If the key does not exist
        """
        from botocore.exceptions import ClientError

        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
            data = response["Body"].read()
            content_type = response.get("ContentType", "application/octet-stream")
            return data, content_type
        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                raise FileNotFoundError(f"S3 key not found: {key}")
            raise

    def get_size(self, key: str) -> int | None:
        """Get the size of an object in bytes. Returns None if not found."""
        from botocore.exceptions import ClientError

        try:
            response = self.client.head_object(Bucket=self.bucket, Key=key)
            return response["ContentLength"]
        except ClientError:
            return None

    def delete(self, key: str) -> None:
        """Delete a single object from S3. No-op if key doesn't exist."""
        self.client.delete_object(Bucket=self.bucket, Key=key)
        logger.info(f"Deleted from S3: s3://{self.bucket}/{key}")

    def delete_many(self, keys: list[str]) -> None:
        """Delete multiple objects from S3 in a single batch request.

        S3 DeleteObjects supports up to 1000 keys per call.
        """
        if not keys:
            return

        for i in range(0, len(keys), 1000):
            batch = keys[i : i + 1000]
            self.client.delete_objects(
                Bucket=self.bucket,
                Delete={
                    "Objects": [{"Key": k} for k in batch],
                    "Quiet": True,
                },
            )
        logger.info(f"Batch deleted {len(keys)} objects from S3")


class LocalStorageService:
    """Service for local filesystem storage operations."""

    def __init__(self):
        settings = get_settings()
        self.base_path = Path(settings.local_storage_path)
        self.base_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Local storage initialized at {self.base_path}")

    def _resolve(self, key: str) -> Path:
        """Resolve a storage key to an absolute file path."""
        return self.base_path / key

    def upload(self, key: str, data: bytes, content_type: str) -> None:  # noqa: ARG002
        """Upload bytes to local filesystem."""
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        logger.info(f"Saved locally: {path} ({len(data)} bytes)")

    def download(self, key: str) -> tuple[bytes, str]:
        """Download a file from local filesystem.

        Returns:
            Tuple of (file_bytes, content_type)

        Raises:
            FileNotFoundError: If the key does not exist
        """
        path = self._resolve(key)
        if not path.is_file():
            raise FileNotFoundError(f"Local file not found: {key}")

        data = path.read_bytes()
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        return data, content_type

    def get_size(self, key: str) -> int | None:
        """Get the size of a file in bytes. Returns None if not found."""
        path = self._resolve(key)
        if not path.is_file():
            return None
        return path.stat().st_size

    def delete(self, key: str) -> None:
        """Delete a single file. No-op if file doesn't exist."""
        path = self._resolve(key)
        if path.is_file():
            path.unlink()
            logger.info(f"Deleted locally: {path}")

    def delete_many(self, keys: list[str]) -> None:
        """Delete multiple files."""
        if not keys:
            return

        deleted = 0
        for key in keys:
            path = self._resolve(key)
            if path.is_file():
                path.unlink()
                deleted += 1
        logger.info(f"Batch deleted {deleted}/{len(keys)} local files")


@lru_cache
def get_storage_service() -> StorageService | LocalStorageService:
    """Get cached storage service instance based on configuration."""
    settings = get_settings()
    if settings.storage_backend == "local":
        return LocalStorageService()
    return StorageService()
