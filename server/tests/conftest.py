"""
Pytest configuration and fixtures for the test suite.

Uses PostgreSQL for testing to match production environment.
- Local: docker-compose up postgres (port 5433)
- CI: GitHub Actions PostgreSQL service (port 5432)
"""

import asyncio
import os
import uuid
from collections.abc import AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

# Get database URL from environment or use default for local development
# Local Docker uses port 5433, CI uses port 5432
TEST_DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+asyncpg://doxmind:doxmind123@localhost:5433/doxmind"
)

# Set test environment variables before importing app modules
os.environ["DEBUG"] = "true"
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-testing-only")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-api-key")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("PGVECTOR_ENABLED", "false")  # Disable vector operations in tests

from db.database import Base, get_db
from dependencies import get_db as deps_get_db
from main import app
from services.auth_service import create_access_token

# Create test database engine with NullPool to avoid connection issues in tests
test_engine = create_async_engine(
    TEST_DATABASE_URL,
    echo=False,
    poolclass=NullPool,  # Avoid pool issues in tests
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
    """Create a database session for each test.

    Creates all tables, runs the test, then truncates tables to clean up.
    """
    # Ensure tables exist (idempotent)
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Create vectors table if it doesn't exist (normally created by init_pgvector)
        await conn.execute(
            text("""
            CREATE TABLE IF NOT EXISTS vectors (
                id VARCHAR(255) PRIMARY KEY,
                content TEXT NOT NULL,
                embedding TEXT,
                chunk_type VARCHAR(50) NOT NULL,
                file_id VARCHAR(36),
                conversation_id VARCHAR(36),
                attachment_id VARCHAR(36),
                filename VARCHAR(255),
                chunk_index INTEGER,
                total_chunks INTEGER,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        )

    async with TestingSessionLocal() as session:
        yield session

    # Clean up test data by truncating tables
    async with test_engine.begin() as conn:
        # Truncate all tables (PostgreSQL specific)
        await conn.execute(
            text("""
            TRUNCATE TABLE messages, conversation_attachments, conversations,
                          file_versions, files, password_resets,
                          email_verifications, users, vectors
            RESTART IDENTITY CASCADE
        """)
        )


@pytest.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client with database override."""

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    # Override both get_db sources (db.database and dependencies)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[deps_get_db] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
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
    """Generate authentication headers for protected endpoints.

    Uses 'dev-user' subject which returns None for user_id (shared data mode),
    avoiding foreign key constraint issues when creating conversations.
    """
    token = create_access_token(subject="dev-user")
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
        for item in self.texts:
            yield item


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


# =============================================================================
# Database Entity Fixtures
# =============================================================================

from db.database import Conversation, File, User


async def create_test_user(
    db_session: AsyncSession,
    user_id: str = None,
    email: str = None,
    username: str = None,
) -> User:
    """Helper function to create a test user in the database.

    Use this when tests need to create users with specific IDs.
    """
    user_id = user_id or str(uuid.uuid4())
    email = email or f"{user_id}@example.com"
    username = username or user_id

    user = User(
        id=user_id,
        email=email,
        username=username,
        hashed_password="$2b$12$test_hashed_password",
        is_verified=True,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user in the database."""
    user = User(
        id="test-user-id",
        email="testuser@example.com",
        username="testuser",
        hashed_password="$2b$12$test_hashed_password",
        is_verified=True,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_file(db_session: AsyncSession, test_user: User) -> File:
    """Create a test file in the database."""
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
async def test_conversation(db_session: AsyncSession, test_file: File) -> Conversation:
    """Create a test conversation in the database."""
    conv = Conversation(
        id=str(uuid.uuid4()),
        file_id=test_file.id,
        user_id=test_file.user_id,
    )
    db_session.add(conv)
    await db_session.commit()
    await db_session.refresh(conv)
    return conv


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
