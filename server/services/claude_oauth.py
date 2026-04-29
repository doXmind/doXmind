"""Claude Code subscription OAuth (PKCE) flow.

Mirrors the claude.ai / Claude Code CLI login: starts a local HTTP callback
server on port 7823, opens the authorize page in the user's browser, and
stores the resulting access / refresh tokens in local_config under
providers.claude_code.oauth. Tokens are auto-refreshed 5 minutes before
expiry via a lock that serializes concurrent refreshes.

The same public client_id used by the Claude Code CLI is reused here; this
means the user gets the same subscription-billed access that `claude` on
the command line gives them, without pasting an API key.
"""

from __future__ import annotations

import base64
import hashlib
import http.server
import logging
import secrets
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

logger = logging.getLogger(__name__)

# Public client ID used by the Claude Code CLI. No secret.
CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize"
TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
MANUAL_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback"

CALLBACK_HOST = "127.0.0.1"
CALLBACK_PORT = 7823
REDIRECT_URI = f"http://localhost:{CALLBACK_PORT}/callback"

SCOPES = ("user:profile", "user:inference", "user:sessions:claude_code")

# Header the OAuth flow expects on every Anthropic API call.
BETA_HEADER_VALUE = "oauth-2025-04-20"

# Refresh `expires_at` this many ms before actual expiry.
REFRESH_BUFFER_MS = 5 * 60 * 1000

_refresh_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Session state for the in-progress browser-based login
# ---------------------------------------------------------------------------


@dataclass
class LoginSession:
    session_id: str
    code_verifier: str
    state: str
    auth_url: str
    status: str = "pending"  # "pending" | "success" | "error"
    error: str | None = None
    created_at: float = 0.0


_sessions: dict[str, LoginSession] = {}
_sessions_lock = threading.Lock()
_server: http.server.HTTPServer | None = None
_server_thread: threading.Thread | None = None


# ---------------------------------------------------------------------------
# PKCE + URL helpers
# ---------------------------------------------------------------------------


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _generate_code_verifier() -> str:
    return _b64url(secrets.token_bytes(32))


def _generate_code_challenge(verifier: str) -> str:
    return _b64url(hashlib.sha256(verifier.encode("ascii")).digest())


def _generate_state() -> str:
    return secrets.token_hex(16)


def _build_auth_url(code_verifier: str, state: str) -> str:
    params = {
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": " ".join(SCOPES),
        "code_challenge": _generate_code_challenge(code_verifier),
        "code_challenge_method": "S256",
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


# ---------------------------------------------------------------------------
# Token exchange + refresh
# ---------------------------------------------------------------------------


def _normalize_token_response(data: dict[str, Any]) -> dict[str, Any]:
    """Convert a raw token response into the shape we persist to config."""
    expires_in = int(data.get("expires_in") or 0)
    return {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token") or "",
        "expires_at": int(time.time() * 1000) + expires_in * 1000,
    }


def _exchange_code(code: str, verifier: str, state: str) -> dict[str, Any]:
    res = httpx.post(
        TOKEN_URL,
        json={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
            "state": state,
        },
        timeout=30.0,
    )
    if res.status_code != 200:
        raise RuntimeError(f"Claude token exchange failed: HTTP {res.status_code} — {res.text}")
    return _normalize_token_response(res.json())


def _refresh(refresh_token: str) -> dict[str, Any]:
    res = httpx.post(
        TOKEN_URL,
        json={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": CLIENT_ID,
            "scope": " ".join(SCOPES),
        },
        timeout=30.0,
    )
    if res.status_code != 200:
        raise RuntimeError(f"Claude token refresh failed: HTTP {res.status_code} — {res.text}")
    data = res.json()
    # Anthropic may omit the rotated refresh_token; reuse the old one if so.
    if not data.get("refresh_token"):
        data["refresh_token"] = refresh_token
    return _normalize_token_response(data)


# ---------------------------------------------------------------------------
# Public: read tokens / ensure validity
# ---------------------------------------------------------------------------


def get_stored_tokens() -> dict[str, Any] | None:
    """Load tokens from local_config. Returns None when not signed in."""
    from services import local_config

    cfg = local_config.load()
    entry = ((cfg.get("providers") or {}).get("claude_code") or {}).get("oauth")
    if not entry or not entry.get("access_token") or not entry.get("refresh_token"):
        return None
    return entry


def _save_tokens(tokens: dict[str, Any]) -> None:
    from services import local_config

    local_config.save({"providers": {"claude_code": {"oauth": tokens}}})


def clear_tokens() -> None:
    """Sign out: drop stored tokens from local_config."""
    from services import local_config

    local_config.save({"providers": {"claude_code": {"oauth": None}}})


def ensure_valid_access_token() -> str:
    """Return a usable access token, refreshing first if it's near expiry.

    Raises RuntimeError if the user isn't signed in.
    """
    tokens = get_stored_tokens()
    if not tokens:
        raise RuntimeError(
            "Claude Code is not signed in. Open Settings and click 'Sign in with Claude'."
        )

    now_ms = int(time.time() * 1000)
    if now_ms < int(tokens.get("expires_at", 0)) - REFRESH_BUFFER_MS:
        return tokens["access_token"]

    with _refresh_lock:
        # Re-read after acquiring the lock so a concurrent refresh isn't redone.
        tokens = get_stored_tokens()
        if not tokens:
            raise RuntimeError("Claude Code tokens disappeared mid-refresh.")
        now_ms = int(time.time() * 1000)
        if now_ms < int(tokens.get("expires_at", 0)) - REFRESH_BUFFER_MS:
            return tokens["access_token"]

        refreshed = _refresh(tokens["refresh_token"])
        _save_tokens(refreshed)
        return refreshed["access_token"]


# ---------------------------------------------------------------------------
# One-shot callback HTTP server
# ---------------------------------------------------------------------------


def _render_callback_page(
    *,
    variant: str,  # "success" | "error"
    title: str,
    subtitle: str,
    details: str | None = None,
    autoclose: bool = False,
) -> str:
    """Render the browser-facing HTML served on the OAuth callback.

    Inline CSS/JS only — this page is served by the stdlib http.server on
    127.0.0.1:7823 with no static asset pipeline available.
    """
    import html as _html

    safe_title = _html.escape(title)
    safe_subtitle = _html.escape(subtitle)
    details_block = ""
    if details:
        details_block = f'<div class="details">{_html.escape(details)}</div>'

    icon_markup = (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'
        '<polyline points="20 6 9 17 4 12"/></svg>'
        if variant == "success"
        else (
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'
            '<line x1="18" y1="6" x2="6" y2="18"/>'
            '<line x1="6" y1="6" x2="18" y2="18"/></svg>'
        )
    )

    autoclose_footer = ""
    autoclose_script = ""
    if autoclose:
        autoclose_footer = (
            '<div class="footer" id="footer">'
            'Closing in <span id="count">3</span>s…'
            "</div>"
        )
        autoclose_script = """
<script>
(function () {
  var n = 3;
  var el = document.getElementById('count');
  var footer = document.getElementById('footer');
  var timer = setInterval(function () {
    n -= 1;
    if (el) el.textContent = String(n);
    if (n <= 0) {
      clearInterval(timer);
      try { window.close(); } catch (_) {}
      setTimeout(function () {
        if (!window.closed && footer) {
          footer.textContent = 'You can close this tab manually.';
        }
      }, 200);
    }
  }, 1000);
})();
</script>
"""
    else:
        autoclose_footer = '<div class="footer">You can close this tab.</div>'

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>doXmind · {safe_title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root {{ color-scheme: dark; }}
    * {{ box-sizing: border-box; }}
    html, body {{
      margin: 0; padding: 0; min-height: 100%;
      background: radial-gradient(ellipse at top, #16161a 0%, #0a0a0b 60%);
      color: #e6e6e8;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter",
                    "Helvetica Neue", Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }}
    body {{ display: grid; place-items: center; min-height: 100vh; padding: 24px; }}
    .card {{
      width: min(420px, 100%);
      background: #131315;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 40px 32px 28px;
      text-align: center;
      box-shadow: 0 10px 40px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.02) inset;
      animation: rise .28s cubic-bezier(.2,.8,.2,1) both;
    }}
    .brand {{
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.42);
      margin-bottom: 28px;
    }}
    .icon {{
      width: 56px; height: 56px;
      border-radius: 999px;
      display: grid; place-items: center;
      margin: 0 auto 18px;
    }}
    .icon svg {{ width: 26px; height: 26px; display: block; }}
    .icon.success {{
      background: rgba(34,197,94,0.12);
      color: #22c55e;
      box-shadow: 0 0 0 1px rgba(34,197,94,0.22) inset;
    }}
    .icon.error {{
      background: rgba(239,68,68,0.12);
      color: #ef4444;
      box-shadow: 0 0 0 1px rgba(239,68,68,0.22) inset;
    }}
    h1 {{
      font-size: 19px; font-weight: 600;
      margin: 0 0 8px;
      letter-spacing: -0.01em;
      color: #f1f1f3;
    }}
    p.subtitle {{
      color: rgba(255,255,255,0.55);
      font-size: 14px; line-height: 1.55;
      margin: 0;
    }}
    .details {{
      margin-top: 18px;
      padding: 10px 12px;
      background: rgba(239,68,68,0.06);
      border: 1px solid rgba(239,68,68,0.22);
      border-radius: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
      font-size: 11.5px; line-height: 1.5;
      color: #fca5a5;
      text-align: left;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 160px;
      overflow: auto;
    }}
    .footer {{
      margin-top: 28px;
      padding-top: 18px;
      border-top: 1px solid rgba(255,255,255,0.06);
      font-size: 12px;
      color: rgba(255,255,255,0.38);
    }}
    #count {{ color: rgba(255,255,255,0.62); font-variant-numeric: tabular-nums; }}
    @keyframes rise {{
      from {{ opacity: 0; transform: translateY(6px) scale(.995); }}
      to   {{ opacity: 1; transform: translateY(0)   scale(1); }}
    }}
  </style>
</head>
<body>
  <main class="card" role="status" aria-live="polite">
    <div class="brand">doXmind</div>
    <div class="icon {variant}" aria-hidden="true">{icon_markup}</div>
    <h1>{safe_title}</h1>
    <p class="subtitle">{safe_subtitle}</p>
    {details_block}
    {autoclose_footer}
  </main>
  {autoclose_script}
</body>
</html>
"""


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        logger.debug("oauth callback: " + format, *args)

    def _render(
        self,
        status: int,
        *,
        variant: str,
        title: str,
        subtitle: str,
        details: str | None = None,
        autoclose: bool = False,
    ) -> None:
        body = _render_callback_page(
            variant=variant,
            title=title,
            subtitle=subtitle,
            details=details,
            autoclose=autoclose,
        ).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/callback":
            self._render(
                404,
                variant="error",
                title="Not found",
                subtitle="This page isn't part of the doXmind sign-in flow.",
            )
            return

        params = parse_qs(parsed.query)
        code = (params.get("code") or [""])[0]
        state = (params.get("state") or [""])[0]

        with _sessions_lock:
            session = next(
                (s for s in _sessions.values() if s.state == state and s.status == "pending"),
                None,
            )

        if not session or not code:
            self._render(
                400,
                variant="error",
                title="Invalid sign-in request",
                subtitle=(
                    "The OAuth state didn't match or the authorization code was missing. "
                    "Return to doXmind and try signing in again."
                ),
            )
            return

        try:
            tokens = _exchange_code(code, session.code_verifier, state)
            _save_tokens(tokens)
        except Exception as e:
            logger.exception("Claude OAuth exchange failed")
            with _sessions_lock:
                session.status = "error"
                session.error = str(e)
            self._render(
                500,
                variant="error",
                title="Couldn't finish sign-in",
                subtitle=(
                    "Anthropic returned an error while exchanging the authorization code. "
                    "Return to doXmind and try again."
                ),
                details=str(e),
            )
            return

        with _sessions_lock:
            session.status = "success"
        self._render(
            200,
            variant="success",
            title="Signed in with Claude",
            subtitle="Your subscription is connected. Return to doXmind to start writing.",
            autoclose=True,
        )


def _ensure_callback_server_running() -> None:
    """Start the 127.0.0.1:7823 callback server on first use (idempotent)."""
    global _server, _server_thread

    if _server is not None:
        return

    try:
        _server = http.server.ThreadingHTTPServer((CALLBACK_HOST, CALLBACK_PORT), _CallbackHandler)
    except OSError as e:
        raise RuntimeError(
            f"Could not bind OAuth callback server on {CALLBACK_HOST}:{CALLBACK_PORT}: {e}. "
            "Another process may be using this port."
        ) from e

    _server_thread = threading.Thread(
        target=_server.serve_forever,
        name="claude-oauth-callback",
        daemon=True,
    )
    _server_thread.start()
    logger.info("Claude OAuth callback server listening on %s:%s", CALLBACK_HOST, CALLBACK_PORT)


# ---------------------------------------------------------------------------
# Public: start / poll a login session
# ---------------------------------------------------------------------------


def start_login() -> LoginSession:
    """Kick off an OAuth login. Returns the auth URL + a session id to poll."""
    _ensure_callback_server_running()

    code_verifier = _generate_code_verifier()
    state = _generate_state()
    auth_url = _build_auth_url(code_verifier, state)

    session = LoginSession(
        session_id=uuid.uuid4().hex,
        code_verifier=code_verifier,
        state=state,
        auth_url=auth_url,
        created_at=time.time(),
    )
    with _sessions_lock:
        # Expire sessions older than 10 minutes to keep the map bounded.
        cutoff = time.time() - 10 * 60
        stale = [sid for sid, s in _sessions.items() if s.created_at < cutoff]
        for sid in stale:
            _sessions.pop(sid, None)
        _sessions[session.session_id] = session
    return session


def get_login_session(session_id: str) -> LoginSession | None:
    with _sessions_lock:
        return _sessions.get(session_id)
