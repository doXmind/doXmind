"""
Pytest configuration and fixtures for the test suite.
"""
import asyncio
import os
from typing import AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

# Set test environment variables before importing app modules
os.environ["DEBUG"] = "true"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-testing-only"
os.environ["ANTHROPIC_API_KEY"] = "test-api-key"

from main import app
from db.database import Base, get_db
from services.auth_service import create_access_token


# Create test database engine
test_engine = create_async_engine(
    "sqlite+aiosqlite:///:memory:",
    echo=False,
)

TestingSessionLocal = async_sessionmaker(
    test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create an event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Create a fresh database session for each test."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with TestingSessionLocal() as session:
        yield session
        await session.rollback()

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client with database override."""

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
def sync_client(db_session: AsyncSession) -> Generator[TestClient, None, None]:
    """Create a sync test client for simple tests."""

    def override_get_db():
        return db_session

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


@pytest.fixture
def auth_headers() -> dict:
    """Generate authentication headers for protected endpoints."""
    token = create_access_token(subject="test-user-id")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def mock_llm_service():
    """Mock the LLM service for tests that don't need real API calls."""
    mock = AsyncMock()
    mock.chat.return_value = {
        "content": "Test response from AI",
        "model": "claude-3-haiku",
        "input_tokens": 10,
        "output_tokens": 20,
    }
    return mock


@pytest.fixture
def mock_rag_service():
    """Mock the RAG service for tests."""
    mock = MagicMock()
    mock.search.return_value = []
    mock.add_document.return_value = True
    return mock


# Sample test data fixtures
@pytest.fixture
def sample_user_data() -> dict:
    """Sample user registration data."""
    return {
        "email": "test@example.com",
        "username": "testuser",
        "password": "SecurePass123!",
    }


@pytest.fixture
def sample_file_data() -> dict:
    """Sample file creation data."""
    return {
        "name": "Test Document",
        "content": "# Hello World\n\nThis is a test document.",
    }


@pytest.fixture
def sample_chat_message() -> dict:
    """Sample chat message data."""
    return {
        "message": "Hello, can you help me?",
        "mode": "chat",
    }
