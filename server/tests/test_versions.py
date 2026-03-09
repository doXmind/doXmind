"""Tests for Version History API.

Tests version creation, listing, retrieval, and restoration.
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.versions import (
    CreateVersionRequest,
    VersionResponse,
    _cleanup_old_versions,
    router,
)
from exceptions import AppException

# ============================================================================
# Model Tests
# ============================================================================


class TestVersionResponse:
    """Tests for VersionResponse model."""

    def test_creates_with_required_fields(self):
        """Should create response with required fields."""
        resp = VersionResponse(
            id="ver-123",
            file_id="file-456",
            content="<p>Hello</p>",
            edit_type="manual",
            summary=None,
            created_at="2024-01-01T00:00:00",
        )

        assert resp.id == "ver-123"
        assert resp.file_id == "file-456"
        assert resp.content == "<p>Hello</p>"
        assert resp.edit_type == "manual"

    def test_creates_with_all_fields(self):
        """Should create response with all fields."""
        resp = VersionResponse(
            id="ver-123",
            file_id="file-456",
            content="<p>Hello</p>",
            edit_type="ai_edit",
            summary="Fixed typo",
            created_at="2024-01-01T00:00:00",
        )

        assert resp.summary == "Fixed typo"


class TestCreateVersionRequest:
    """Tests for CreateVersionRequest model."""

    def test_creates_with_required_fields(self):
        """Should create request with required fields."""
        req = CreateVersionRequest(file_id="file-123", content="<p>Content</p>")

        assert req.file_id == "file-123"
        assert req.content == "<p>Content</p>"
        assert req.edit_type == "manual"  # Default
        assert req.summary is None

    def test_creates_with_all_fields(self):
        """Should create request with all fields."""
        req = CreateVersionRequest(
            file_id="file-123",
            content="<p>Content</p>",
            edit_type="ai_edit",
            summary="AI improvements",
        )

        assert req.edit_type == "ai_edit"
        assert req.summary == "AI improvements"


# ============================================================================
# List Versions Endpoint Tests
# ============================================================================


class TestListVersionsEndpoint:
    """Tests for list_versions endpoint."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.mark.asyncio
    async def test_returns_empty_list(self, mock_db):
        """Should return empty list when no versions."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.versions import list_versions

        result = await list_versions("file-123", limit=50, db=mock_db)

        assert result == []

    @pytest.mark.asyncio
    async def test_returns_versions(self, mock_db):
        """Should return list of versions."""
        mock_version = MagicMock()
        mock_version.id = "ver-1"
        mock_version.file_id = "file-123"
        mock_version.content = "<p>Test</p>"
        mock_version.edit_type = "manual"
        mock_version.summary = None
        mock_version.created_at = datetime(2024, 1, 1, 0, 0, 0)

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [mock_version]
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.versions import list_versions

        result = await list_versions("file-123", limit=50, db=mock_db)

        assert len(result) == 1
        assert result[0].id == "ver-1"

    @pytest.mark.asyncio
    async def test_respects_limit(self, mock_db):
        """Should pass limit to query."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.versions import list_versions

        await list_versions("file-123", limit=10, db=mock_db)

        # Verify execute was called (we can't easily verify the SQL limit)
        mock_db.execute.assert_called_once()


# ============================================================================
# Create Version Endpoint Tests
# ============================================================================


class TestCreateVersionEndpoint:
    """Tests for create_version endpoint."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.mark.asyncio
    async def test_raises_404_when_file_not_found(self, mock_db):
        """Should raise 404 when file doesn't exist."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.versions import create_version

        request = CreateVersionRequest(file_id="nonexistent", content="<p>Test</p>")

        with pytest.raises(AppException) as exc_info:
            await create_version(request, mock_db)

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_creates_version(self, mock_db):
        """Should create version when file exists."""
        # Mock file exists
        mock_file = MagicMock()
        mock_file.id = "file-123"

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_file
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()

        async def mock_refresh(obj):
            obj.id = "ver-1"
            obj.created_at = datetime(2024, 1, 1, 0, 0, 0)

        mock_db.refresh = AsyncMock(side_effect=mock_refresh)

        from api.versions import create_version

        with patch("api.versions._cleanup_old_versions", new=AsyncMock()):
            request = CreateVersionRequest(file_id="file-123", content="<p>New content</p>")
            result = await create_version(request, mock_db)

        assert result.id == "ver-1"
        mock_db.add.assert_called_once()

    @pytest.mark.asyncio
    async def test_creates_version_with_edit_type(self, mock_db):
        """Should create version with custom edit_type and summary."""
        mock_file = MagicMock()
        mock_file.id = "file-123"

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_file
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()

        async def mock_refresh(obj):
            obj.id = "ver-2"
            obj.created_at = datetime(2024, 1, 2, 0, 0, 0)

        mock_db.refresh = AsyncMock(side_effect=mock_refresh)

        from api.versions import create_version

        with patch("api.versions._cleanup_old_versions", new=AsyncMock()):
            request = CreateVersionRequest(
                file_id="file-123", content="New content", edit_type="ai_edit", summary="AI changes"
            )
            result = await create_version(request, mock_db)

        assert result.id == "ver-2"
        mock_db.add.assert_called_once()


# ============================================================================
# Get Version Endpoint Tests
# ============================================================================


class TestGetVersionEndpoint:
    """Tests for get_version endpoint."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.mark.asyncio
    async def test_raises_404_when_not_found(self, mock_db):
        """Should raise 404 when version not found."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.versions import get_version

        with pytest.raises(AppException) as exc_info:
            await get_version("file-123", "ver-456", mock_db)

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_version(self, mock_db):
        """Should return version when found."""
        mock_version = MagicMock()
        mock_version.id = "ver-123"
        mock_version.file_id = "file-456"
        mock_version.content = "<p>Content</p>"
        mock_version.edit_type = "manual"
        mock_version.summary = None
        mock_version.created_at = datetime(2024, 1, 1, 0, 0, 0)

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_version
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.versions import get_version

        result = await get_version("file-456", "ver-123", mock_db)

        assert result.id == "ver-123"
        assert result.content == "<p>Content</p>"


# ============================================================================
# Restore Version Endpoint Tests
# ============================================================================


class TestRestoreVersionEndpoint:
    """Tests for restore_version endpoint."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.mark.asyncio
    async def test_raises_404_when_version_not_found(self, mock_db):
        """Should raise 404 when version not found."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.versions import restore_version

        with pytest.raises(AppException) as exc_info:
            await restore_version("file-123", "ver-456", mock_db)

        assert exc_info.value.status_code == 404
        assert "Version" in exc_info.value.message and "not found" in exc_info.value.message

    @pytest.mark.asyncio
    async def test_raises_404_when_file_not_found(self, mock_db):
        """Should raise 404 when file not found."""
        mock_version = MagicMock()
        mock_version.content = "<p>Old content</p>"
        mock_version.created_at = datetime(2024, 1, 1)

        call_count = [0]

        def mock_execute(query):
            result = MagicMock()
            if call_count[0] == 0:
                result.scalar_one_or_none.return_value = mock_version
            else:
                result.scalar_one_or_none.return_value = None
            call_count[0] += 1
            return result

        mock_db.execute = AsyncMock(side_effect=mock_execute)

        from api.versions import restore_version

        with pytest.raises(AppException) as exc_info:
            await restore_version("file-123", "ver-456", mock_db)

        assert exc_info.value.status_code == 404
        assert "File" in exc_info.value.message and "not found" in exc_info.value.message

    @pytest.mark.asyncio
    async def test_restores_version(self, mock_db):
        """Should restore file to specified version."""
        mock_version = MagicMock()
        mock_version.id = "ver-old"
        mock_version.content = "<p>Old content</p>"
        mock_version.created_at = datetime(2024, 1, 1)

        mock_file = MagicMock()
        mock_file.id = "file-123"
        mock_file.content = "<p>Current content</p>"

        call_count = [0]

        def mock_execute(query):
            result = MagicMock()
            if call_count[0] == 0:
                result.scalar_one_or_none.return_value = mock_version
            else:
                result.scalar_one_or_none.return_value = mock_file
            call_count[0] += 1
            return result

        mock_db.execute = AsyncMock(side_effect=mock_execute)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()

        from api.versions import restore_version

        result = await restore_version("file-123", "ver-old", mock_db)

        assert result["status"] == "restored"
        assert result["version_id"] == "ver-old"
        assert mock_file.content == "<p>Old content</p>"


# ============================================================================
# Cleanup Old Versions Tests
# ============================================================================


class TestCleanupOldVersions:
    """Tests for _cleanup_old_versions function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.mark.asyncio
    async def test_no_cleanup_when_under_limit(self, mock_db):
        """Should not delete when under limit."""
        # Only 50 versions
        mock_result = MagicMock()
        mock_result.all.return_value = [("ver-" + str(i),) for i in range(50)]
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.delete = AsyncMock()
        mock_db.commit = AsyncMock()

        await _cleanup_old_versions(mock_db, "file-123", keep=100)

        # Should not delete any
        mock_db.delete.assert_not_called()

    @pytest.mark.asyncio
    async def test_cleanup_when_over_limit(self, mock_db):
        """Should delete versions beyond limit."""
        # 105 versions, should delete 5
        version_ids = [("ver-" + str(i),) for i in range(105)]

        # First call returns all version IDs
        mock_list_result = MagicMock()
        mock_list_result.all.return_value = version_ids

        # Subsequent calls return version objects for deletion
        mock_version = MagicMock()

        call_count = [0]

        def mock_execute(query):
            if call_count[0] == 0:
                call_count[0] += 1
                return mock_list_result
            else:
                result = MagicMock()
                result.scalar_one_or_none.return_value = mock_version
                call_count[0] += 1
                return result

        mock_db.execute = AsyncMock(side_effect=mock_execute)
        mock_db.delete = AsyncMock()
        mock_db.commit = AsyncMock()

        await _cleanup_old_versions(mock_db, "file-123", keep=100)

        # Should delete 5 versions
        assert mock_db.delete.call_count == 5

    @pytest.mark.asyncio
    async def test_handles_missing_versions(self, mock_db):
        """Should handle versions that no longer exist."""
        version_ids = [("ver-1",), ("ver-2",)]

        mock_list_result = MagicMock()
        mock_list_result.all.return_value = version_ids

        call_count = [0]

        def mock_execute(query):
            if call_count[0] == 0:
                call_count[0] += 1
                return mock_list_result
            else:
                result = MagicMock()
                result.scalar_one_or_none.return_value = None  # Version doesn't exist
                call_count[0] += 1
                return result

        mock_db.execute = AsyncMock(side_effect=mock_execute)
        mock_db.delete = AsyncMock()
        mock_db.commit = AsyncMock()

        # Should not raise even if version is missing
        await _cleanup_old_versions(mock_db, "file-123", keep=0)


# ============================================================================
# Router Structure Tests
# ============================================================================


class TestRouterStructure:
    """Tests for router structure."""

    def test_router_has_list_route(self):
        """Should have list versions route."""
        routes = [r.path for r in router.routes]
        assert "/{file_id}" in routes

    def test_router_has_create_route(self):
        """Should have create version route."""
        routes = [r.path for r in router.routes]
        assert "/" in routes

    def test_router_has_get_route(self):
        """Should have get version route."""
        routes = [r.path for r in router.routes]
        assert "/{file_id}/{version_id}" in routes

    def test_router_has_restore_route(self):
        """Should have restore version route."""
        routes = [r.path for r in router.routes]
        assert "/{file_id}/{version_id}/restore" in routes


# ============================================================================
# Edge Cases
# ============================================================================


class TestEdgeCases:
    """Tests for edge cases."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.mark.asyncio
    async def test_creates_version_with_identical_content(self, mock_db):
        """Should create version even with identical content."""
        mock_file = MagicMock()
        mock_file.id = "file-123"

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_file
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()

        async def mock_refresh(obj):
            obj.id = "ver-new"
            obj.created_at = datetime(2024, 1, 2)

        mock_db.refresh = AsyncMock(side_effect=mock_refresh)

        from api.versions import create_version

        with patch("api.versions._cleanup_old_versions", new=AsyncMock()):
            request = CreateVersionRequest(file_id="file-123", content="Same content")
            result = await create_version(request, mock_db)

        assert result is not None

    @pytest.mark.asyncio
    async def test_handles_empty_content(self, mock_db):
        """Should handle empty content."""
        mock_file = MagicMock()
        mock_file.id = "file-123"

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_file
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()

        async def mock_refresh(obj):
            obj.id = "ver-new"
            obj.created_at = datetime(2024, 1, 1)

        mock_db.refresh = AsyncMock(side_effect=mock_refresh)

        from api.versions import create_version

        with patch("api.versions._cleanup_old_versions", new=AsyncMock()):
            request = CreateVersionRequest(file_id="file-123", content="")
            result = await create_version(request, mock_db)

        assert result is not None

    def test_version_response_from_attributes(self):
        """Should support from_attributes config."""
        # The Config class should have from_attributes = True
        assert VersionResponse.model_config.get("from_attributes", False) is True
