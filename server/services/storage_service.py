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
        self._resolved_base = self.base_path.resolve()
        logger.info(f"Local storage initialized at {self.base_path}")

    def _resolve(self, key: str) -> Path:
        # Resolve and verify the path stays under the storage root so that
        # caller-supplied keys (extracted from document HTML) cannot escape
        # via "..", absolute paths, or symlinks.
        candidate = (self.base_path / key).resolve()
        try:
            candidate.relative_to(self._resolved_base)
        except ValueError as exc:
            raise ValueError(f"Storage key escapes base path: {key!r}") from exc
        return candidate

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
        try:
            path = self._resolve(key)
        except ValueError:
            logger.warning(f"Refusing to delete out-of-bounds key: {key!r}")
            return
        if path.is_file():
            path.unlink()

    def delete_many(self, keys: list[str]) -> None:
        for key in keys:
            self.delete(key)


@lru_cache
def get_storage_service() -> LocalStorageService:
    return LocalStorageService()
