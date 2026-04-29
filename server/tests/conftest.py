"""Pytest fixtures — local desktop edition.

Tests run against an in-memory SQLite database. Auth is stubbed so all
fixtures use a single fixed `local` user.
"""

import asyncio
import os
import tempfile
import uuid
from collections.abc import AsyncGenerator, Generator
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

# Use an in-memory SQLite db so tests never touch the user's ~/.doxmind data.
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

# Sandbox the data dir so local_config / settings tests don't read the real
# ~/.doxmind/config.json sitting in the developer's home folder.
_TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="doxmind-test-"))
os.environ["HOME"] = str(_TEST_DATA_DIR)
os.environ["DEBUG"] = "true"
os.environ["OPENROUTER_API_KEY"] = "test-api-key"

import db.database as db_database  # noqa: E402
from db.database import Base, File, get_db  # noqa: E402
from dependencies import get_db as deps_get_db  # noqa: E402
from main import app  # noqa: E402

# In-memory SQLite + StaticPool so all sessions share one connection.
test_engine = create_async_engine(
    TEST_DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

db_database.engine = test_engine
db_database.async_session = TestingSessionLocal


# =============================================================================
# Event loop & schema lifecycle
# =============================================================================


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _create_schema() -> AsyncGenerator[None, None]:
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await test_engine.dispose()


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    # Reset all tables between tests so the in-memory SQLite db is fresh.
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    async with TestingSessionLocal() as session:
        yield session
        await session.rollback()


# =============================================================================
# Test clients
# =============================================================================


@pytest_asyncio.fixture
async def async_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[deps_get_db] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Alias for async_client kept for legacy test names."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[deps_get_db] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
def sync_client() -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_headers() -> dict:
    """No-op headers — local desktop edition has no auth."""
    return {}


# =============================================================================
# Fake user / file fixtures (single-user local mode)
# =============================================================================


LOCAL_USER_ID = "local"


async def create_test_user(
    db_session: AsyncSession,  # noqa: ARG001
    user_id: str | None = None,
    email: str | None = None,
    username: str | None = None,
) -> SimpleNamespace:
    """Legacy helper — local desktop edition has no User table."""
    user_id = user_id or LOCAL_USER_ID
    return SimpleNamespace(
        id=user_id,
        email=email or f"{user_id}@example.com",
        username=username or user_id,
        is_verified=True,
        is_active=True,
    )


@pytest.fixture
def test_user() -> SimpleNamespace:
    """Return a fake user that mimics the old SQLAlchemy User model surface."""
    return SimpleNamespace(
        id=LOCAL_USER_ID,
        email="local@doxmind.local",
        username="local",
        is_verified=True,
        is_active=True,
    )


@pytest_asyncio.fixture
async def test_file(db_session: AsyncSession, test_user: SimpleNamespace) -> File:
    file = File(
        id=str(uuid.uuid4()),
        user_id=test_user.id,
        name="Test Document",
        content="# Test Content\n\nThis is test content.",
    )
    db_session.add(file)
    await db_session.commit()
    await db_session.refresh(file)
    return file


@pytest.fixture
def sample_file_data() -> dict:
    return {
        "name": "Test Document",
        "content": "# Hello World\n\nThis is a test document.",
    }
