"""Locality guards for the optional unauthenticated FastAPI tooling service."""

import pytest
import uvicorn
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from typer.testing import CliRunner

from cli.__main__ import app as cli_app
from config import Settings, get_cors_headers, validate_loopback_host
from main import app


@pytest.mark.parametrize("host", ["127.0.0.1", "127.42.0.9", "::1", "localhost"])
def test_loopback_hosts_are_accepted(host: str) -> None:
    assert validate_loopback_host(host) == host
    assert Settings(host=host).host == host


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.0.2.10", "example.com", ""])
def test_non_loopback_hosts_are_rejected(host: str) -> None:
    with pytest.raises(ValueError, match="loopback"):
        validate_loopback_host(host)
    with pytest.raises(ValidationError, match="loopback"):
        Settings(host=host)


def test_cli_serve_refuses_non_loopback_bind() -> None:
    result = CliRunner().invoke(cli_app, ["serve", "--host", "0.0.0.0"])

    assert result.exit_code != 0
    assert "loopback" in result.output


def test_cli_serve_keeps_loopback_standalone_service_available(monkeypatch) -> None:
    called: dict[str, object] = {}

    def fake_run(local_app, **kwargs) -> None:
        called.update(app=local_app, **kwargs)

    monkeypatch.setattr(uvicorn, "run", fake_run)
    result = CliRunner().invoke(cli_app, ["serve", "--host", "::1", "--port", "8765"])

    assert result.exit_code == 0
    assert called == {
        "app": app,
        "host": "::1",
        "port": 8765,
        "log_level": "info",
        "access_log": False,
    }


def test_cors_allows_ipv4_and_ipv6_loopback_but_not_remote_origins() -> None:
    assert get_cors_headers("http://127.0.0.1:3000")["Access-Control-Allow-Origin"] == (
        "http://127.0.0.1:3000"
    )
    assert get_cors_headers("http://[::1]:3000")["Access-Control-Allow-Origin"] == (
        "http://[::1]:3000"
    )
    assert get_cors_headers("https://attacker.example") == {}
    assert get_cors_headers("tauri://localhost") == {}
    assert get_cors_headers("http://tauri.localhost") == {}


@pytest.mark.asyncio
async def test_http_app_rejects_non_loopback_clients() -> None:
    transport = ASGITransport(app=app, client=("192.0.2.10", 49152))
    async with AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
        response = await client.get("/health")

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_http_app_rejects_non_loopback_host_header() -> None:
    transport = ASGITransport(app=app, client=("127.0.0.1", 49152))
    async with AsyncClient(transport=transport, base_url="http://attacker.example") as client:
        response = await client.get("/health")

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_http_app_accepts_loopback_ipv6_host_header() -> None:
    transport = ASGITransport(app=app, client=("::1", 49152))
    async with AsyncClient(transport=transport, base_url="http://[::1]") as client:
        response = await client.get("/health")

    assert response.status_code == 200
