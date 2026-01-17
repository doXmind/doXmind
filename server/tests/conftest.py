"""
Pytest configuration and fixtures for the test suite.
"""
import asyncio
import os
from collections.abc import AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Set test environment variables before importing app modules
os.environ["DEBUG"] = "true"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-testing-only"
os.environ["ANTHROPIC_API_KEY"] = "test-api-key"

from db.database import Base, get_db
from dependencies import get_db as deps_get_db
from main import app
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

    # Override both get_db sources (db.database and dependencies)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[deps_get_db] = override_get_db

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


# =============================================================================
# AI Service Mock Fixtures
# =============================================================================


class MockContentBlock:
    """Mock Anthropic ContentBlock."""

    def __init__(self, text: str = "Hello from AI"):
        self.text = text
        self.type = "text"


class MockMessage:
    """Mock Anthropic Message response."""

    def __init__(self, text: str = "Hello from AI"):
        self.content = [MockContentBlock(text)]
        self.model = "claude-3-5-sonnet-20241022"
        self.stop_reason = "end_turn"
        self.usage = MagicMock(input_tokens=100, output_tokens=50)


class MockStreamManager:
    """Mock Anthropic stream context manager."""

    def __init__(self, texts: list[str]):
        self.texts = texts

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    @property
    def text_stream(self):
        """Async generator for streaming text."""
        return self._text_stream()

    async def _text_stream(self):
        for text in self.texts:
            yield text


@pytest.fixture
def mock_anthropic_client():
    """Mock Anthropic AsyncAnthropic client."""
    mock = MagicMock()

    # Mock messages.create for non-streaming
    mock.messages.create = AsyncMock(return_value=MockMessage("Test AI response"))

    # Mock messages.stream for streaming
    def create_stream(*args, **kwargs):
        return MockStreamManager(["Hello ", "from ", "AI!"])

    mock.messages.stream = create_stream

    # Mock beta.messages.create for JSON mode
    mock.beta.messages.create = AsyncMock(
        return_value=MockMessage('{"result": "structured response"}')
    )

    return mock


@pytest.fixture
def mock_anthropic_stream_events():
    """Sample SSE events for testing streaming responses."""
    return [
        {"type": "text", "content": "Hello "},
        {"type": "text", "content": "World!"},
        {"type": "tool_use", "tool_name": "get_file", "tool_input": {"path": "file.txt"}},
        {"type": "summary", "content": "Hello World!"},
    ]


@pytest.fixture
def mock_chroma_collection():
    """Mock Chroma vector store collection."""

    class MockCollection:
        def __init__(self):
            self.data = {}
            self._id_counter = 0

        def upsert(self, ids: list[str], documents: list[str], metadatas: list[dict]):
            for i, id in enumerate(ids):
                self.data[id] = {
                    "id": id,
                    "document": documents[i],
                    "metadata": metadatas[i] if metadatas else {},
                }

        def query(
            self,
            query_texts: list[str],
            n_results: int = 5,
            where: dict | None = None,
        ):
            results = list(self.data.values())[:n_results]
            return {
                "ids": [[r["id"] for r in results]],
                "documents": [[r["document"] for r in results]],
                "metadatas": [[r["metadata"] for r in results]],
                "distances": [[0.1] * len(results)],
            }

        def get(self, where: dict | None = None):
            return {"ids": list(self.data.keys())}

        def delete(self, ids: list[str] | None = None, where: dict | None = None):
            if ids:
                for id in ids:
                    self.data.pop(id, None)

    return MockCollection()


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
