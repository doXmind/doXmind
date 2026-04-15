"""Storage tracker stub — local desktop edition has no quota."""

from typing import Any


class StorageTracker:
    def __init__(self, db: Any = None):  # noqa: ARG002
        pass

    async def get_used_bytes(self, *args: Any, **kwargs: Any) -> int:  # noqa: ARG002
        return 0

    async def get_limit_bytes(self, *args: Any, **kwargs: Any) -> int:  # noqa: ARG002
        return 1024 * 1024 * 1024 * 1024  # effectively unlimited

    async def has_capacity(self, *args: Any, **kwargs: Any) -> bool:  # noqa: ARG002
        return True

    async def add_bytes(self, *args: Any, **kwargs: Any) -> None:  # noqa: ARG002
        return None

    async def remove_bytes(self, *args: Any, **kwargs: Any) -> None:  # noqa: ARG002
        return None

    async def check_storage_quota(self, *args: Any, **kwargs: Any) -> bool:  # noqa: ARG002
        return True

    async def check_storage_limit(self, *args: Any, **kwargs: Any) -> bool:  # noqa: ARG002
        return True

    async def get_user_storage(self, *args: Any, **kwargs: Any) -> dict:  # noqa: ARG002
        return {"used": 0, "limit": 1024 * 1024 * 1024 * 1024}

    async def add_usage(self, *args: Any, **kwargs: Any) -> None:  # noqa: ARG002
        return None

    async def remove_usage(self, *args: Any, **kwargs: Any) -> None:  # noqa: ARG002
        return None

    async def track_upload(self, *args: Any, **kwargs: Any) -> None:  # noqa: ARG002
        return None

    async def check_and_add_usage(self, *args: Any, **kwargs: Any) -> bool:  # noqa: ARG002
        return True
