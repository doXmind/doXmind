"""Tests for FastAPI Dependencies module.

Tests dependency injection functions and helpers.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies import (
    _rag_service,
    get_conversation_by_file_id,
    get_db,
    get_rag_service,
    normalize_file_id,
)


# ============================================================================
# normalize_file_id Tests
# ============================================================================


class TestNormalizeFileId:
    """Tests for normalize_file_id function."""

    def test_returns_none_for_none(self):
        """Should return None for None input."""
        assert normalize_file_id(None) is None

    def test_returns_none_for_empty_string(self):
        """Should return None for empty string."""
        assert normalize_file_id("") is None

    def test_returns_value_for_valid_string(self):
        """Should return original value for non-empty string."""
        assert normalize_file_id("file-123") == "file-123"

    def test_returns_value_for_uuid(self):
        """Should return UUID strings unchanged."""
        test_uuid = str(uuid.uuid4())
        assert normalize_file_id(test_uuid) == test_uuid


# ============================================================================
# get_db Tests
# ============================================================================


class TestGetDb:
    """Tests for get_db dependency."""

    @pytest.mark.asyncio
    async def test_yields_session(self):
        """Should yield a database session."""
        with patch("dependencies.async_session") as mock_session_maker:
            mock_session = AsyncMock(spec=AsyncSession)
            mock_context = MagicMock()
            mock_context.__aenter__ = AsyncMock(return_value=mock_session)
            mock_context.__aexit__ = AsyncMock()
            mock_session_maker.return_value = mock_context

            sessions = []
            async for session in get_db():
                sessions.append(session)

            assert len(sessions) == 1
            assert sessions[0] == mock_session

    @pytest.mark.asyncio
    async def test_closes_session_after_use(self):
        """Should close session after generator exits."""
        with patch("dependencies.async_session") as mock_session_maker:
            mock_session = AsyncMock(spec=AsyncSession)
            mock_context = MagicMock()
            mock_context.__aenter__ = AsyncMock(return_value=mock_session)
            mock_context.__aexit__ = AsyncMock()
            mock_session_maker.return_value = mock_context

            async for _session in get_db():
                pass

            # Context manager should have been exited
            mock_context.__aexit__.assert_called_once()


# ============================================================================
# get_rag_service Tests
# ============================================================================


class TestGetRagService:
    """Tests for get_rag_service dependency."""

    def test_creates_singleton(self):
        """Should create RAGService singleton."""
        import dependencies

        # Reset singleton
        dependencies._rag_service = None

        with patch("dependencies.RAGService") as mock_rag_class:
            mock_instance = MagicMock()
            mock_rag_class.return_value = mock_instance

            # First call
            result1 = get_rag_service()
            # Second call
            result2 = get_rag_service()

            # Should be same instance
            assert result1 is result2
            # Should only create once
            mock_rag_class.assert_called_once()

        # Clean up
        dependencies._rag_service = None

    def test_returns_existing_instance(self):
        """Should return existing instance if already created."""
        import dependencies

        mock_instance = MagicMock()
        dependencies._rag_service = mock_instance

        result = get_rag_service()

        assert result is mock_instance

        # Clean up
        dependencies._rag_service = None


# ============================================================================
# get_conversation_by_file_id Tests
# ============================================================================


class TestGetConversationByFileId:
    """Tests for get_conversation_by_file_id function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.mark.asyncio
    async def test_returns_conversation_by_id(self, mock_db):
        """Should return conversation when found by ID."""
        mock_conv = MagicMock()
        mock_conv.id = "conv-123"
        mock_db.get = AsyncMock(return_value=mock_conv)

        result = await get_conversation_by_file_id("conv-123", mock_db)

        assert result == mock_conv

    @pytest.mark.asyncio
    async def test_returns_conversation_by_file_id(self, mock_db):
        """Should return conversation when found by file_id."""
        mock_conv = MagicMock()
        mock_conv.id = "conv-123"
        mock_conv.file_id = "file-456"

        # First get returns None (not found by ID)
        mock_db.get = AsyncMock(return_value=None)

        # Execute returns conversation
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_conv
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await get_conversation_by_file_id("file-456", mock_db)

        assert result == mock_conv

    @pytest.mark.asyncio
    async def test_returns_none_when_not_found(self, mock_db):
        """Should return None when conversation not found."""
        mock_db.get = AsyncMock(return_value=None)

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await get_conversation_by_file_id("nonexistent", mock_db)

        assert result is None

    @pytest.mark.asyncio
    async def test_creates_conversation_when_missing(self, mock_db):
        """Should create conversation when create_if_missing is True."""
        mock_db.get = AsyncMock(return_value=None)

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()

        created_conv = MagicMock()
        created_conv.file_id = "file-123"

        async def mock_refresh(conv):
            conv.id = "new-conv-id"

        mock_db.refresh = AsyncMock(side_effect=mock_refresh)

        result = await get_conversation_by_file_id(
            "file-123", mock_db, create_if_missing=True
        )

        assert result is not None
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_handles_none_file_id(self, mock_db):
        """Should handle None file_id (global conversations)."""
        mock_conv = MagicMock()
        mock_conv.file_id = None

        mock_db.get = AsyncMock(return_value=None)

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_conv
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await get_conversation_by_file_id("", mock_db)

        assert result == mock_conv

    @pytest.mark.asyncio
    async def test_handles_empty_string_file_id(self, mock_db):
        """Should treat empty string as None file_id."""
        mock_db.get = AsyncMock(return_value=None)

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await get_conversation_by_file_id("", mock_db)

        # Should have executed query for NULL file_id
        mock_db.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_creates_with_normalized_file_id(self, mock_db):
        """Should normalize file_id when creating."""
        mock_db.get = AsyncMock(return_value=None)

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock()

        await get_conversation_by_file_id("", mock_db, create_if_missing=True)

        # The added conversation should have file_id=None (normalized from "")
        call_args = mock_db.add.call_args
        added_conv = call_args[0][0]
        assert added_conv.file_id is None


# ============================================================================
# Integration Tests
# ============================================================================


class TestDependencyIntegration:
    """Integration tests for dependencies."""

    def test_dependency_module_structure(self):
        """Should have expected module structure."""
        import dependencies

        # Check functions exist
        assert callable(dependencies.get_db)
        assert callable(dependencies.get_rag_service)
        assert callable(dependencies.normalize_file_id)
        assert callable(dependencies.get_conversation_by_file_id)

        # Check private state
        assert hasattr(dependencies, "_rag_service")

    @pytest.mark.asyncio
    async def test_get_db_is_async_generator(self):
        """Should be an async generator."""
        import inspect

        assert inspect.isasyncgenfunction(get_db)

    def test_get_rag_service_is_function(self):
        """Should be a regular function."""
        import inspect

        assert inspect.isfunction(get_rag_service)
        assert not inspect.iscoroutinefunction(get_rag_service)
