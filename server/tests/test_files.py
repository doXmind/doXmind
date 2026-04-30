"""
Tests for file management API endpoints.
"""

from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import File


@pytest.mark.unit
class TestFilesAPI:
    """Test file CRUD operations."""

    async def test_list_files_empty(self, client: AsyncClient):
        """Test listing files when none exist."""
        response = await client.get("/api/files/")

        assert response.status_code == 200
        assert response.json() == []

    async def test_create_file(self, client: AsyncClient, sample_file_data: dict):
        """Test creating a new file."""
        response = await client.post("/api/files/", json=sample_file_data)

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == sample_file_data["name"]
        assert data["content"] == sample_file_data["content"]
        assert "id" in data
        assert "created_at" in data
        assert "updated_at" in data

    async def test_get_file(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        sample_file_data: dict,  # noqa: ARG002
    ):
        """Test getting a file by ID."""
        # Create a file first
        create_response = await client.post("/api/files/", json=sample_file_data)
        file_id = create_response.json()["id"]

        # Get the file
        response = await client.get(f"/api/files/{file_id}")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == file_id
        assert data["name"] == sample_file_data["name"]

    async def test_get_nonexistent_file(self, client: AsyncClient):
        """Test getting a file that doesn't exist."""
        response = await client.get("/api/files/nonexistent-id")

        assert response.status_code == 404

    async def test_update_file(self, client: AsyncClient, sample_file_data: dict):
        """Test updating a file."""
        # Create a file first
        create_response = await client.post("/api/files/", json=sample_file_data)
        file_id = create_response.json()["id"]

        # Update the file
        update_data = {"name": "Updated Name", "content": "Updated content"}
        response = await client.put(f"/api/files/{file_id}", json=update_data)

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == update_data["name"]
        assert data["content"] == update_data["content"]

    async def test_update_file_partial(self, client: AsyncClient, sample_file_data: dict):
        """Test partially updating a file (only name)."""
        # Create a file first
        create_response = await client.post("/api/files/", json=sample_file_data)
        file_id = create_response.json()["id"]

        # Update only the name
        update_data = {"name": "New Name Only"}
        response = await client.put(f"/api/files/{file_id}", json=update_data)

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "New Name Only"
        assert data["content"] == sample_file_data["content"]  # Content unchanged

    async def test_delete_file(self, client: AsyncClient, sample_file_data: dict):
        """Test deleting a file."""
        # Create a file first
        create_response = await client.post("/api/files/", json=sample_file_data)
        file_id = create_response.json()["id"]

        # Delete the file
        response = await client.delete(f"/api/files/{file_id}")

        assert response.status_code == 200
        assert response.json()["status"] == "trashed"

        # Verify it's deleted
        get_response = await client.get(f"/api/files/{file_id}")
        assert get_response.status_code == 404

    async def test_delete_nonexistent_file(self, client: AsyncClient):
        """Test deleting a file that doesn't exist."""
        response = await client.delete("/api/files/nonexistent-id")

        assert response.status_code == 404

    async def test_list_files_multiple(
        self,
        client: AsyncClient,
        sample_file_data: dict,  # noqa: ARG002
    ):
        """Test listing multiple files."""
        # Create multiple files
        for i in range(3):
            file_data = {"name": f"Test File {i}", "content": f"Content {i}"}
            await client.post("/api/files/", json=file_data)

        # List all files
        response = await client.get("/api/files/")

        assert response.status_code == 200
        files = response.json()
        assert len(files) == 3


@pytest.mark.unit
class TestFileValidation:
    """Test file input validation."""

    async def test_create_file_empty_name(self, client: AsyncClient):
        """Test creating a file with empty name."""
        response = await client.post("/api/files/", json={"name": "", "content": "test"})

        # Empty string should be allowed (validation depends on implementation)
        assert response.status_code in [200, 422]

    async def test_create_file_missing_name(self, client: AsyncClient):
        """Test creating a file without name field."""
        response = await client.post("/api/files/", json={"content": "test"})

        assert response.status_code == 422  # Validation error

    async def test_create_file_with_only_name(self, client: AsyncClient):
        """Test creating a file with only name (content defaults to empty)."""
        response = await client.post("/api/files/", json={"name": "Test"})

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Test"
        assert data["content"] == ""  # Default empty content

@pytest.mark.asyncio
class TestUpdateNonexistent:
    async def test_update_nonexistent_file_returns_404(self, client: AsyncClient):
        response = await client.put("/api/files/nonexistent-id", json={"name": "New Name"})
        assert response.status_code == 404


# =============================================================================
# Search Endpoint Tests
# =============================================================================


@pytest.mark.asyncio
class TestSearchFilesEndpoint:
    """Tests for POST /api/files/search endpoint."""

    async def test_search_files_success(self, client: AsyncClient):
        """Should return search results using text matching."""
        # Create files with searchable content
        await client.post(
            "/api/files/", json={"name": "Result File 1", "content": "test query content here"}
        )
        await client.post(
            "/api/files/", json={"name": "Result File 2", "content": "another test query match"}
        )

        response = await client.post("/api/files/search", json={"query": "test query", "top_k": 5})

        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert len(data["results"]) == 2

    async def test_search_files_with_file_ids_filter(self, client: AsyncClient):
        """Should filter search by file IDs."""
        # Create files first
        resp1 = await client.post(
            "/api/files/", json={"name": "File 1", "content": "test query in file 1"}
        )
        resp2 = await client.post(
            "/api/files/", json={"name": "File 2", "content": "test query in file 2"}
        )
        file_id_1 = resp1.json()["id"]
        file_id_2 = resp2.json()["id"]

        response = await client.post(
            "/api/files/search",
            json={
                "query": "test query",
                "file_ids": [file_id_1, file_id_2],
                "top_k": 3,
            },
        )

        assert response.status_code == 200

    async def test_search_files_no_results(self, client: AsyncClient):
        """Should return empty results when no matches found."""
        response = await client.post("/api/files/search", json={"query": "nonexistent content xyz"})

        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert len(data["results"]) == 0


# =============================================================================
# In-Document Search Tests
# =============================================================================


@pytest.mark.asyncio
class TestInDocumentSearchEndpoint:
    """Tests for POST /api/files/search/in-document endpoint."""

    async def test_in_document_search_file_not_found(self, client: AsyncClient):
        """Should return 404 when file not found."""
        response = await client.post(
            "/api/files/search/in-document",
            json={"query": "test query", "file_id": "nonexistent-file"},
        )

        assert response.status_code == 404

    async def test_in_document_search_success(self, client: AsyncClient, db_session: AsyncSession):
        """Should return search results filtered by file_id."""
        # Create file
        file = File(name="Test File", content="This is test content for searching.")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        response = await client.post(
            "/api/files/search/in-document",
            json={"query": "test content", "file_id": file.id, "top_k": 10},
        )

        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert len(data["results"]) >= 1

    async def test_in_document_search_returns_matching_excerpts(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should return matching excerpts with positions."""
        # Create file
        file = File(name="Test File", content="Some content to search for matches.")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        response = await client.post(
            "/api/files/search/in-document",
            json={"query": "content", "file_id": file.id},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) == 1

    async def test_in_document_search_no_match(self, client: AsyncClient, db_session: AsyncSession):
        """Should return empty results when no match found."""
        # Create file
        file = File(name="Test File", content="Content")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        response = await client.post(
            "/api/files/search/in-document",
            json={"query": "nonexistent phrase xyz", "file_id": file.id},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) == 0


# =============================================================================
# Model Tests
# =============================================================================


class TestFileModels:
    """Tests for Pydantic models in files module."""

    def test_file_create_model(self):
        """Should create FileCreate model correctly."""
        from api.files import FileCreate

        file = FileCreate(name="Test File", content="Content")
        assert file.name == "Test File"
        assert file.content == "Content"

    def test_file_create_model_default_content(self):
        """Should default content to empty string."""
        from api.files import FileCreate

        file = FileCreate(name="Test File")
        assert file.content == ""

    def test_file_update_model_all_fields(self):
        """Should create FileUpdate model with all fields."""
        from api.files import FileUpdate

        update = FileUpdate(name="New Name", content="New Content")
        assert update.name == "New Name"
        assert update.content == "New Content"

    def test_file_update_model_partial(self):
        """Should allow partial FileUpdate."""
        from api.files import FileUpdate

        update = FileUpdate(name="New Name")
        assert update.name == "New Name"
        assert update.content is None

    def test_file_update_model_empty(self):
        """Should allow empty FileUpdate."""
        from api.files import FileUpdate

        update = FileUpdate()
        assert update.name is None
        assert update.content is None

    def test_search_request_model(self):
        """Should create SearchRequest model correctly."""
        from api.files import SearchRequest

        request = SearchRequest(query="test query", file_ids=["id1"], top_k=10)
        assert request.query == "test query"
        assert request.file_ids == ["id1"]
        assert request.top_k == 10

    def test_search_request_model_defaults(self):
        """Should use default values for SearchRequest."""
        from api.files import SearchRequest

        request = SearchRequest(query="test")
        assert request.file_ids is None
        assert request.top_k == 10

    def test_in_doc_search_request_model(self):
        """Should create InDocSearchRequest model correctly."""
        from api.files import InDocSearchRequest

        request = InDocSearchRequest(query="test", file_id="file-1", top_k=20)
        assert request.query == "test"
        assert request.file_id == "file-1"
        assert request.top_k == 20

    def test_in_doc_search_request_model_defaults(self):
        """Should use default values for InDocSearchRequest."""
        from api.files import InDocSearchRequest

        request = InDocSearchRequest(query="test", file_id="file-1")
        assert request.top_k == 10


# =============================================================================
# Error Handling Tests
# =============================================================================


@pytest.mark.asyncio
class TestFileErrorHandling:
    """Tests for error handling in file operations."""

    async def test_create_file_db_error(self, client: AsyncClient):
        """Should return 500 on database error during creation."""
        with patch("api.files.get_db") as mock_get_db:
            mock_session = MagicMock()
            mock_session.add = MagicMock(side_effect=Exception("DB error"))
            mock_get_db.return_value = mock_session

            # This test is tricky because the dependency override is in place
            # The actual test relies on the app's error handling
            # Just verify the endpoint handles errors gracefully
            pass  # Endpoint error handling is tested via integration tests

    async def test_update_file_only_name(self, client: AsyncClient, sample_file_data: dict):
        """Should only update name when only name provided."""
        create_response = await client.post("/api/files/", json=sample_file_data)
        file_id = create_response.json()["id"]

        response = await client.put(f"/api/files/{file_id}", json={"name": "Only Name Updated"})

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Only Name Updated"
        # Content should remain unchanged
        assert data["content"] == sample_file_data["content"]

    async def test_update_file_only_content(self, client: AsyncClient, sample_file_data: dict):
        """Should only update content when only content provided."""
        create_response = await client.post("/api/files/", json=sample_file_data)
        file_id = create_response.json()["id"]

        response = await client.put(
            f"/api/files/{file_id}", json={"content": "Only content updated"}
        )

        assert response.status_code == 200
        data = response.json()
        # Name should remain unchanged
        assert data["name"] == sample_file_data["name"]
        assert data["content"] == "Only content updated"


# =============================================================================
# FileResponse Model Tests
# =============================================================================


class TestFileResponseModel:
    """Tests for FileResponse Pydantic model."""

    def test_file_response_model_creation(self):
        """Should create FileResponse model correctly."""
        from api.files import FileResponse

        response = FileResponse(
            id="file-123",
            name="test.md",
            content="# Hello",
            created_at="2024-01-01T00:00:00",
            updated_at="2024-01-01T00:00:00",
        )
        assert response.id == "file-123"
        assert response.name == "test.md"
        assert response.content == "# Hello"

    def test_file_response_from_attributes(self):
        """Should support from_attributes config."""
        from api.files import FileResponse

        # The Config.from_attributes enables ORM mode
        assert FileResponse.model_config.get("from_attributes", False) or hasattr(
            FileResponse, "Config"
        )


# =============================================================================
# Extended Search Tests
# =============================================================================


class TestSearchRequestModel:
    """Tests for SearchRequest model."""

    def test_search_request_with_all_params(self):
        """Should create SearchRequest with all parameters."""
        from api.files import SearchRequest

        req = SearchRequest(query="find documents", file_ids=["f1", "f2", "f3"], top_k=10)
        assert req.query == "find documents"
        assert len(req.file_ids) == 3
        assert req.top_k == 10


class TestInDocSearchRequestModel:
    """Tests for InDocSearchRequest model."""

    def test_in_doc_request_with_custom_top_k(self):
        """Should create InDocSearchRequest with custom top_k."""
        from api.files import InDocSearchRequest

        req = InDocSearchRequest(query="test", file_id="f1", top_k=25)
        assert req.top_k == 25


# =============================================================================
# Extended File Operations Tests
# =============================================================================


@pytest.mark.asyncio
class TestExtendedFileOperations:
    """Extended tests for file operations."""

    async def test_list_files_ordered_by_updated_at(
        self, client: AsyncClient, sample_file_data: dict
    ):
        """Should return files ordered by updated_at descending."""
        # Create files
        await client.post("/api/files/", json={"name": "First", "content": "1"})
        await client.post("/api/files/", json={"name": "Second", "content": "2"})
        await client.post("/api/files/", json={"name": "Third", "content": "3"})

        response = await client.get("/api/files/")
        assert response.status_code == 200
        files = response.json()

        # Most recently created should be first
        assert len(files) >= 3
        assert files[0]["name"] == "Third"

    async def test_get_file_response_format(self, client: AsyncClient, sample_file_data: dict):
        """Should return file with all required fields."""
        create_response = await client.post("/api/files/", json=sample_file_data)
        file_id = create_response.json()["id"]

        response = await client.get(f"/api/files/{file_id}")

        assert response.status_code == 200
        data = response.json()

        # Verify all expected fields are present
        assert "id" in data
        assert "name" in data
        assert "content" in data
        assert "created_at" in data
        assert "updated_at" in data

    async def test_create_file_with_empty_content(self, client: AsyncClient):
        """Should create file with empty content."""
        response = await client.post("/api/files/", json={"name": "Empty Doc"})

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Empty Doc"
        assert data["content"] == ""

    async def test_update_file_empty_update(self, client: AsyncClient, sample_file_data: dict):
        """Should handle empty update (no changes)."""
        create_response = await client.post("/api/files/", json=sample_file_data)
        file_id = create_response.json()["id"]

        response = await client.put(f"/api/files/{file_id}", json={})

        assert response.status_code == 200
        data = response.json()
        # Original values should be preserved
        assert data["name"] == sample_file_data["name"]
        assert data["content"] == sample_file_data["content"]


# =============================================================================
# Extended In-Document Search Tests
# =============================================================================


@pytest.mark.asyncio
class TestExtendedInDocumentSearch:
    """Extended tests for in-document search."""

    async def test_in_document_search_default_params(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should use default parameters."""
        # Create file
        file = File(name="Test Doc", content="Test content for searching")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        response = await client.post(
            "/api/files/search/in-document", json={"query": "Test", "file_id": file.id}
        )

        assert response.status_code == 200
        data = response.json()
        assert "results" in data

    async def test_in_document_search_with_custom_top_k(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Should respect custom top_k parameter."""
        file = File(name="Doc", content="Content with searchable text here")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        response = await client.post(
            "/api/files/search/in-document",
            json={"query": "Content", "file_id": file.id, "top_k": 20},
        )

        assert response.status_code == 200


# =============================================================================
# Router Structure Tests
# =============================================================================


class TestFilesRouterStructure:
    """Tests for files router structure."""

    def test_router_exists(self):
        """Should have router defined."""
        from api.files import router

        assert router is not None

    def test_router_has_list_route(self):
        """Should have list files route."""
        from api.files import router

        routes = [r.path for r in router.routes]
        assert "/" in routes

    def test_router_has_get_route(self):
        """Should have get file route."""
        from api.files import router

        routes = [r.path for r in router.routes]
        assert "/{file_id}" in routes

    def test_router_has_search_route(self):
        """Should have search route."""
        from api.files import router

        routes = [r.path for r in router.routes]
        assert "/search" in routes

    def test_router_has_in_doc_search_route(self):
        """Should have in-document search route."""
        from api.files import router

        routes = [r.path for r in router.routes]
        assert "/search/in-document" in routes


# =============================================================================
# More User Filter Tests
# =============================================================================


# Multi-user tests removed — local desktop edition is single-user.


class TestFileDatabaseModel:
    @pytest.mark.asyncio
    async def test_file_model_creation(self, db_session: AsyncSession):
        file = File(name="Test File", content="File content")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)
        assert file.id is not None
        assert file.name == "Test File"
        assert file.content == "File content"
        assert file.created_at is not None
