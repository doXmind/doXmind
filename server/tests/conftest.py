"""Pytest fixtures for the optional localhost tooling service."""

import os
import tempfile
from collections.abc import AsyncGenerator, Generator
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

# Sandbox the data dir so settings tests don't touch the real ~/.doxmind
# directory sitting in the developer's home folder. `Path.home()` honors
# `HOME` on POSIX and `USERPROFILE` on Windows, so we override both.
_TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="doxmind-test-"))
os.environ["HOME"] = str(_TEST_DATA_DIR)
os.environ["USERPROFILE"] = str(_TEST_DATA_DIR)
os.environ["DATA_DIR"] = str(_TEST_DATA_DIR / ".doxmind")
os.environ["DEBUG"] = "true"
os.environ["HOST"] = "127.0.0.1"

from main import app  # noqa: E402


@pytest_asyncio.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://127.0.0.1") as ac:
        yield ac


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Alias for async_client kept for legacy test names."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://127.0.0.1") as ac:
        yield ac


@pytest.fixture
def sync_client() -> Generator[TestClient, None, None]:
    with TestClient(app, base_url="http://127.0.0.1") as c:
        yield c
