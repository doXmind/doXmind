"""Tests for the /api/links/image proxy used by the PDF bookmark exporter."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest


class _FakeStreamResponse:
    """Stand-in for httpx's streaming response inside `AsyncClient.stream`."""

    def __init__(self, *, status_code: int, headers: dict[str, str], chunks: list[bytes]) -> None:
        self.status_code = status_code
        self.headers = headers
        self._chunks = chunks
        self.url = "https://example.invalid/og.png"

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"status {self.status_code}",
                request=httpx.Request("GET", self.url),
                response=httpx.Response(self.status_code),
            )

    async def aiter_bytes(self) -> AsyncIterator[bytes]:
        for chunk in self._chunks:
            yield chunk


class _FakeAsyncClient:
    """Replace httpx.AsyncClient so the proxy doesn't actually hit the network."""

    response: _FakeStreamResponse | None = None

    def __init__(self, *_args: Any, **_kwargs: Any) -> None: ...

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, *_exc_info: Any) -> None:
        return None

    def stream(self, _method: str, _url: str) -> _FakeStreamContext:
        assert self.response is not None, "test forgot to set _FakeAsyncClient.response"
        return _FakeStreamContext(self.response)


class _FakeStreamContext:
    def __init__(self, response: _FakeStreamResponse) -> None:
        self._response = response

    async def __aenter__(self) -> _FakeStreamResponse:
        return self._response

    async def __aexit__(self, *_exc_info: Any) -> None:
        return None


@pytest.fixture(autouse=True)
def _patch_httpx(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("api.links.httpx.AsyncClient", _FakeAsyncClient)


@pytest.mark.asyncio
async def test_image_proxy_returns_bytes_with_content_type(client) -> None:  # type: ignore[no-untyped-def]
    """Happy path: image bytes flow through with the upstream content-type
    intact so the webview's data-URL conversion picks the right MIME."""
    payload = b"\x89PNG\r\n\x1a\nfakepng"
    _FakeAsyncClient.response = _FakeStreamResponse(
        status_code=200,
        headers={"content-type": "image/png"},
        chunks=[payload],
    )

    resp = await client.get("/api/links/image", params={"url": "https://example.invalid/og.png"})

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content == payload


@pytest.mark.asyncio
async def test_image_proxy_rejects_non_image_content_type(client) -> None:  # type: ignore[no-untyped-def]
    """A site returning HTML (e.g. an unfurled page accidentally pointed at
    the proxy) must be refused — we don't want to ferry arbitrary bodies."""
    _FakeAsyncClient.response = _FakeStreamResponse(
        status_code=200,
        headers={"content-type": "text/html"},
        chunks=[b"<html>not an image</html>"],
    )

    resp = await client.get("/api/links/image", params={"url": "https://example.invalid/og.png"})

    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_image_proxy_rejects_invalid_scheme(client) -> None:  # type: ignore[no-untyped-def]
    """`file://`, `javascript:`, etc. must be rejected so the proxy can't be
    abused to read local files via the local sidecar."""
    resp = await client.get("/api/links/image", params={"url": "file:///etc/hosts"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_image_proxy_caps_download_size(client) -> None:  # type: ignore[no-untyped-def]
    """A malicious / pathological image must hit the size cap, not stream
    the whole body into memory."""
    huge = b"x" * (1024 * 1024)  # 1 MB chunks
    _FakeAsyncClient.response = _FakeStreamResponse(
        status_code=200,
        headers={"content-type": "image/png"},
        chunks=[huge for _ in range(20)],  # 20 MB total
    )

    resp = await client.get("/api/links/image", params={"url": "https://example.invalid/og.png"})

    assert resp.status_code == 400
