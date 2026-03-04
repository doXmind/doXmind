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
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

# Get database URL from environment or use a SEPARATE test database
# IMPORTANT: Uses 'doxmind_test' database to avoid wiping dev data during test cleanup
# Local Docker uses port 5433, CI uses port 5432
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    os.environ.get(
        "DATABASE_URL", "postgresql+asyncpg://doxmind:doxmind123@localhost:5433/doxmind_test"
    ),
)

# Set test environment variables before importing app modules
os.environ["DEBUG"] = "true"
os.environ["TESTING"] = "true"  # Disable rate limiting during tests
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-testing-only")
os.environ.setdefault("OPENROUTER_API_KEY", "test-api-key")
os.environ.setdefault(
    "API_KEY_ENCRYPTION_KEY", "N7rUzNKqpRGSOGKpcErTa4dn1jsdNsM8F0BO5ch2RJE="
)  # Fernet key for encrypting user API keys

from db.database import Base, get_db
from dependencies import get_db as deps_get_db
from main import app
from services.auth_service import create_access_token


def _ensure_test_database():
    """Create doxmind_test database if it doesn't exist.

    Uses synchronous psycopg2 to create the database before async engine is used.
    Only needed when TEST_DATABASE_URL points to a separate test database.
    """
    import re

    match = re.match(
        r"postgresql\+asyncpg://([^:]+):([^@]+)@([^:/]+):?(\d+)?/(.+)", TEST_DATABASE_URL
    )
    if not match:
        return

    user, password, host, port, dbname = match.groups()
    port = port or "5432"

    # Only auto-create if using a separate test database
    if dbname == "doxmind":
        return

    try:
        import asyncpg

        async def _create():
            conn = await asyncpg.connect(
                user=user, password=password, host=host, port=int(port), database="doxmind"
            )
            try:
                exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", dbname)
                if not exists:
                    await conn.execute(f'CREATE DATABASE "{dbname}" OWNER "{user}"')
            finally:
                await conn.close()

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_create())
        finally:
            loop.close()
    except Exception as e:
        import warnings

        warnings.warn(f"Could not auto-create test database '{dbname}': {e}", stacklevel=2)


_ensure_test_database()

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


def _setup_schema():
    """Drop and recreate all tables to ensure schema matches current models.

    Called once at import time. Uses drop_all + create_all because
    create_all alone won't add new columns to existing tables.
    """

    async def _run():
        async with test_engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

            # Create safe_substr function used by list_files query
            await conn.execute(
                text("""
                CREATE OR REPLACE FUNCTION safe_substr(t text, start_pos int, len int)
                RETURNS text AS $$
                DECLARE
                    old_timeout text;
                    result text;
                BEGIN
                    old_timeout := current_setting('statement_timeout');
                    PERFORM set_config('statement_timeout', '2000', true);
                    BEGIN
                        result := substr(t, start_pos, len);
                        PERFORM set_config('statement_timeout', old_timeout, true);
                        RETURN result;
                    EXCEPTION WHEN OTHERS THEN
                        PERFORM set_config('statement_timeout', old_timeout, true);
                        RETURN '';
                    END;
                END;
                $$ LANGUAGE plpgsql;
            """)
            )

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_run())
    finally:
        loop.close()


_setup_schema()


def pytest_sessionfinish(session, exitstatus):
    """Dispose the test database engine to properly close asyncpg connections."""
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(test_engine.dispose())
    finally:
        loop.close()


@pytest.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Create a database session for each test.

    Tables are created once at import time (see _setup_schema above).
    Uses transaction rollback instead of TRUNCATE for fast cleanup:
    - A top-level transaction wraps each test
    - session.commit() creates SAVEPOINTs (nested transactions) instead of real commits
    - After the test, the outer transaction is rolled back, undoing all changes instantly
    """
    connection = await test_engine.connect()
    transaction = await connection.begin()

    session = AsyncSession(bind=connection, expire_on_commit=False)

    # Use nested transactions so session.commit() doesn't actually commit
    await connection.begin_nested()

    @event.listens_for(session.sync_session, "after_transaction_end")
    def restart_savepoint(sync_session, sync_transaction):
        if sync_transaction.nested and not sync_transaction._parent.nested:
            connection.sync_connection.begin_nested()

    yield session

    await session.close()
    await transaction.rollback()
    await connection.close()


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


# =============================================================================
# AI Service Mock Fixtures (OpenAI SDK via OpenRouter)
# =============================================================================


class MockOpenAIChoice:
    """Mock OpenAI Choice object."""

    def __init__(self, text: str = "Hello from AI"):
        self.message = MagicMock(content=text)
        self.finish_reason = "stop"


class MockOpenAIChatCompletion:
    """Mock OpenAI ChatCompletion response."""

    def __init__(self, text: str = "Hello from AI"):
        self.choices = [MockOpenAIChoice(text)]
        self.model = "minimax/minimax-m2.5"
        self.usage = MagicMock(prompt_tokens=100, completion_tokens=50)


class MockOpenAIStreamChunk:
    """Mock OpenAI streaming chunk."""

    def __init__(self, content: str | None = None, finish_reason: str | None = None):
        delta = MagicMock()
        delta.content = content
        delta.tool_calls = None
        choice = MagicMock()
        choice.delta = delta
        choice.finish_reason = finish_reason
        self.choices = [choice]
        self.usage = None


class MockOpenAIAsyncStream:
    """Mock async iterator for OpenAI streaming."""

    def __init__(self, chunks: list):
        self.chunks = chunks

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.chunks:
            raise StopAsyncIteration
        return self.chunks.pop(0)


@pytest.fixture
def mock_openai_client():
    """Mock OpenAI AsyncOpenAI client."""
    mock = MagicMock()

    # Mock chat.completions.create for non-streaming
    mock.chat.completions.create = AsyncMock(
        return_value=MockOpenAIChatCompletion("Test AI response")
    )

    return mock


@pytest.fixture
def mock_stream_events():
    """Sample SSE events for testing streaming responses."""
    return [
        {"type": "text", "content": "Hello "},
        {"type": "text", "content": "World!"},
        {"type": "tool_use", "tool_name": "get_file", "tool_input": {"path": "file.txt"}},
        {"type": "summary", "content": "Hello World!"},
    ]


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
