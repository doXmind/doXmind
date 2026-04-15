"""Credit service stub — local desktop edition has no billing/credits."""

from typing import Any


class CreditService:
    def __init__(self, db: Any = None):  # noqa: ARG002
        pass

    async def check_balance(self, *args: Any, **kwargs: Any) -> dict:  # noqa: ARG002
        return {"sufficient": True, "remaining": 999_999_999}

    async def get_balance(self, *args: Any, **kwargs: Any) -> int:  # noqa: ARG002
        return 999_999_999

    async def has_credits(self, *args: Any, **kwargs: Any) -> bool:  # noqa: ARG002
        return True

    async def check_credits(self, *args: Any, **kwargs: Any) -> bool:  # noqa: ARG002
        return True

    async def get_user_credits(self, *args: Any, **kwargs: Any) -> dict:  # noqa: ARG002
        return {"remaining": 999_999_999, "limit": 999_999_999}

    async def deduct(self, *args: Any, **kwargs: Any) -> None:  # noqa: ARG002
        return None

    async def grant(self, *args: Any, **kwargs: Any) -> None:  # noqa: ARG002
        return None


async def deduct_credits_for_usage(*args: Any, **kwargs: Any) -> None:  # noqa: ARG001
    return None


async def check_user_has_credits(*args: Any, **kwargs: Any) -> bool:  # noqa: ARG001
    return True
