"""Auth stub — local desktop edition has no auth.

The codebase still threads `current_user` through routes for legacy reasons.
We expose a fixed local TokenData and a `require_auth` dependency that always
returns it. This lets every route keep its existing signature unchanged.
"""

from dataclasses import dataclass

LOCAL_USER_ID = "local"


@dataclass
class TokenData:
    sub: str = LOCAL_USER_ID  # JWT subject — kept for legacy call sites
    user_id: str = LOCAL_USER_ID
    email: str = "local@doxmind.local"
    username: str = "local"
    is_admin: bool = True
    # Legacy attributes retained so old test fixtures that pass `exp`, `iat`, etc.
    # still construct successfully. They have no behavior in local mode.
    exp: object | None = None
    iat: object | None = None
    type: str | None = None


_LOCAL_TOKEN = TokenData()


def require_auth() -> TokenData:
    return _LOCAL_TOKEN


def optional_auth() -> TokenData:
    return _LOCAL_TOKEN


def get_current_token() -> TokenData:
    return _LOCAL_TOKEN
