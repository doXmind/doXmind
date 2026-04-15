"""Local file storage for image uploads (cover images, inline images)."""

import logging
import mimetypes
from functools import lru_cache
from pathlib import Path

from config import get_settings

logger = logging.getLogger(__name__)


class LocalStorageService:
    """Service for local filesystem storage operations."""

    def __init__(self):
        settings = get_settings()
        self.base_path = Path(settings.local_storage_path).expanduser()
        self.base_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Local storage initialized at {self.base_path}")

    def _resolve(self, key: str) -> Path:
        return self.base_path / key

    def upload(self, key: str, data: bytes, content_type: str) -> None:  # noqa: ARG002
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        logger.info(f"Saved locally: {path} ({len(data)} bytes)")

    def download(self, key: str) -> tuple[bytes, str]:
        path = self._resolve(key)
        if not path.is_file():
            raise FileNotFoundError(f"Local file not found: {key}")
        data = path.read_bytes()
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        return data, content_type

    def get_size(self, key: str) -> int | None:
        path = self._resolve(key)
        if not path.is_file():
            return None
        return path.stat().st_size

    def delete(self, key: str) -> None:
        path = self._resolve(key)
        if path.is_file():
            path.unlink()

    def delete_many(self, keys: list[str]) -> None:
        for key in keys:
            self.delete(key)


@lru_cache
def get_storage_service() -> LocalStorageService:
    return LocalStorageService()
