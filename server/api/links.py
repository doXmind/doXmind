"""Link unfurl: fetch a URL and return Open Graph / metadata for previews."""

from __future__ import annotations

import logging
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field

from exceptions import BadRequestError

logger = logging.getLogger(__name__)
router = APIRouter()


class UnfurlRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)


class UnfurlResponse(BaseModel):
    url: str
    title: str
    description: str | None = None
    favicon_url: str | None = None
    image_url: str | None = None


_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_FETCH_TIMEOUT = 8.0
_MAX_BYTES = 1_500_000  # cap pages at 1.5MB; OG tags are always near the top


def _normalise_url(raw: str) -> str:
    """Prepend https:// when the user typed a bare host like `example.com`."""
    raw = raw.strip()
    if not raw:
        raise BadRequestError(message="URL is empty")
    if "://" not in raw:
        raw = "https://" + raw
    parsed = urlparse(raw)
    if not parsed.netloc:
        raise BadRequestError(message="Invalid URL")
    return raw


class _MetaParser(HTMLParser):
    """Pulls the bits we need (title, OG meta, favicon link) without bringing
    in a heavyweight dependency. Stops collecting once </head> is reached."""

    def __init__(self) -> None:
        super().__init__()
        self.title: str | None = None
        self.og: dict[str, str] = {}
        self.favicon_href: str | None = None
        self._in_title = False
        self._in_head = True

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if not self._in_head:
            return
        if tag == "title":
            self._in_title = True
            return
        attrs_d = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            prop = (attrs_d.get("property") or attrs_d.get("name") or "").lower()
            content = attrs_d.get("content")
            if not prop or content is None:
                return
            # Open Graph + Twitter card + standard description.
            if prop in {
                "og:title",
                "og:description",
                "og:image",
                "og:site_name",
                "twitter:title",
                "twitter:description",
                "twitter:image",
                "description",
            }:
                # Only set if missing — earlier (more specific) tags win.
                self.og.setdefault(prop, content)
        elif tag == "link":
            rel = (attrs_d.get("rel") or "").lower()
            if "icon" in rel and not self.favicon_href:
                self.favicon_href = attrs_d.get("href")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "head":
            self._in_head = False

    def handle_data(self, data: str) -> None:
        if self._in_title and not self.title:
            text = data.strip()
            if text:
                self.title = text


async def _fetch_html(url: str) -> tuple[str, str]:
    """Fetch the URL and return (final_url, html_text). Truncates the body to
    the first chunk that contains the head — we only need the metadata."""
    headers = {"User-Agent": _USER_AGENT, "Accept": "text/html,*/*"}
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=_FETCH_TIMEOUT,
        headers=headers,
    ) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            content_type = (resp.headers.get("content-type") or "").lower()
            if "html" not in content_type and "xml" not in content_type:
                # Non-HTML resource — return empty body, caller falls back to
                # using the URL itself as the title.
                return str(resp.url), ""
            buf = bytearray()
            async for chunk in resp.aiter_bytes():
                buf.extend(chunk)
                if len(buf) >= _MAX_BYTES:
                    break
            # Best-effort decode: respect declared charset if present.
            encoding = resp.charset_encoding or "utf-8"
            try:
                text = buf.decode(encoding, errors="replace")
            except (LookupError, UnicodeDecodeError):
                text = buf.decode("utf-8", errors="replace")
            return str(resp.url), text


@router.post("/unfurl", response_model=UnfurlResponse)
async def unfurl(payload: UnfurlRequest) -> UnfurlResponse:
    """Fetch a URL and extract title / description / og:image / favicon."""
    url = _normalise_url(payload.url)
    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    try:
        final_url, html = await _fetch_html(url)
    except httpx.HTTPError as exc:
        logger.info("unfurl failed for %s: %s", url, exc)
        # Don't fail the request — return a degraded response so the editor
        # still has *something* to render. The user can edit the title later.
        return UnfurlResponse(
            url=url,
            title=parsed.netloc or url,
            favicon_url=urljoin(origin, "/favicon.ico"),
        )

    if not html:
        return UnfurlResponse(
            url=final_url,
            title=urlparse(final_url).netloc or final_url,
            favicon_url=urljoin(final_url, "/favicon.ico"),
        )

    parser = _MetaParser()
    try:
        parser.feed(html)
    except Exception:  # noqa: BLE001 — malformed HTML shouldn't crash the request
        logger.exception("HTML parse failed for %s", final_url)

    title = (
        parser.og.get("og:title")
        or parser.og.get("twitter:title")
        or parser.title
        or urlparse(final_url).netloc
        or final_url
    ).strip()
    description = (
        parser.og.get("og:description")
        or parser.og.get("twitter:description")
        or parser.og.get("description")
    )
    image = parser.og.get("og:image") or parser.og.get("twitter:image")
    favicon = parser.favicon_href

    return UnfurlResponse(
        url=final_url,
        title=title,
        description=(description or "").strip() or None,
        favicon_url=urljoin(final_url, favicon) if favicon else urljoin(final_url, "/favicon.ico"),
        image_url=urljoin(final_url, image) if image else None,
    )


_IMAGE_MAX_BYTES = 6_000_000  # 6MB cap; OG / favicon are normally well under
_ALLOWED_IMAGE_PREFIXES = ("image/",)


@router.get("/image")
async def image_proxy(url: str) -> Response:
    """Fetch a remote image and return its bytes inline.

    The Markdown PDF export rasterises web bookmark cards in the browser
    via html-to-image, which taints the canvas as soon as a bookmark's
    OG-thumbnail or favicon is cross-origin (almost always true). The
    webview can't bypass CORS, but the local sidecar can — so we proxy
    the image through here, deliver it same-origin to the webview, and
    the export pipeline data-URLs it for capture.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise BadRequestError(message="Invalid image URL")

    headers = {
        "User-Agent": _USER_AGENT,
        # Some CDNs return WebP for `*/*` accept; bookmark thumbnails are
        # always rendered through <img>, so any image content type works.
        "Accept": "image/*,*/*;q=0.8",
    }
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=_FETCH_TIMEOUT,
            headers=headers,
        ) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status()
                content_type = (resp.headers.get("content-type") or "").lower().split(";")[0].strip()
                if not any(content_type.startswith(p) for p in _ALLOWED_IMAGE_PREFIXES):
                    raise BadRequestError(message="Resource is not an image")
                buf = bytearray()
                async for chunk in resp.aiter_bytes():
                    buf.extend(chunk)
                    if len(buf) > _IMAGE_MAX_BYTES:
                        raise BadRequestError(message="Image too large")
                body = bytes(buf)
    except httpx.HTTPError as exc:
        logger.info("image proxy failed for %s: %s", url, exc)
        raise BadRequestError(message="Could not fetch image") from exc

    return Response(
        content=body,
        media_type=content_type or "application/octet-stream",
        # Local sidecar — short cache OK; matches the unfurl-cache cadence.
        headers={"Cache-Control": "private, max-age=300"},
    )
