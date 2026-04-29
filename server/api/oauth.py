"""OAuth login endpoints (Claude Code subscription).

Flow from the frontend's perspective:
  1. POST /api/oauth/claude/login  → { session_id, auth_url }
  2. Open auth_url in a new tab; user logs in via claude.ai
  3. Poll GET /api/oauth/claude/status?session_id=... until status != "pending"
  4. On "success" the tokens are already persisted; refresh the settings view.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import claude_oauth

logger = logging.getLogger(__name__)
router = APIRouter()


class StartLoginResponse(BaseModel):
    session_id: str
    auth_url: str


class LoginStatusResponse(BaseModel):
    status: str  # "pending" | "success" | "error" | "unknown"
    error: str | None = None
    authenticated: bool = False
    expires_at: int | None = None


class ClaudeStatusResponse(BaseModel):
    authenticated: bool
    expires_at: int | None = None


@router.post("/claude/login", response_model=StartLoginResponse)
async def start_claude_login():
    """Start a new OAuth PKCE flow. Opens a local callback server on 7823."""
    try:
        session = claude_oauth.start_login()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return StartLoginResponse(session_id=session.session_id, auth_url=session.auth_url)


@router.get("/claude/status", response_model=LoginStatusResponse)
async def get_login_status(session_id: str | None = None):
    """Poll either a specific login session or overall sign-in state.

    - When session_id is provided: reports that session's pending/success/error.
    - Without session_id: reports whether the user is currently signed in.
    """
    tokens = claude_oauth.get_stored_tokens()
    authenticated = bool(tokens)
    expires_at = int(tokens["expires_at"]) if tokens else None

    if not session_id:
        return LoginStatusResponse(
            status="success" if authenticated else "unknown",
            authenticated=authenticated,
            expires_at=expires_at,
        )

    session = claude_oauth.get_login_session(session_id)
    if not session:
        return LoginStatusResponse(
            status="unknown",
            authenticated=authenticated,
            expires_at=expires_at,
        )
    return LoginStatusResponse(
        status=session.status,
        error=session.error,
        authenticated=authenticated,
        expires_at=expires_at,
    )


@router.post("/claude/logout", response_model=ClaudeStatusResponse)
async def claude_logout():
    """Clear stored Claude tokens (local only — does not revoke upstream)."""
    claude_oauth.clear_tokens()
    return ClaudeStatusResponse(authenticated=False, expires_at=None)
