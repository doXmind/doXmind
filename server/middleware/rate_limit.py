"""Rate limit stub — local desktop edition has no rate limiting.

The `limiter` exposes a `.limit(...)` decorator that is a no-op so existing
route definitions (`@limiter.limit("60/minute")`) keep parsing.
"""

from collections.abc import Callable
from typing import Any


class _NoopLimiter:
    def limit(self, *args: Any, **kwargs: Any) -> Callable:  # noqa: ARG002
        def decorator(func: Callable) -> Callable:
            return func

        return decorator

    def shared_limit(self, *args: Any, **kwargs: Any) -> Callable:  # noqa: ARG002
        def decorator(func: Callable) -> Callable:
            return func

        return decorator


limiter = _NoopLimiter()
