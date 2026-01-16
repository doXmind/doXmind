"""
Tests for file management API endpoints.
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

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
        self, client: AsyncClient, db_session: AsyncSession, sample_file_data: dict
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

    async def test_update_file(
        self, client: AsyncClient, sample_file_data: dict
    ):
        """Test updating a file."""
        # Create a file first
        create_response = await client.post("/api/files/", json=sample_file_data)
        file_id = create_response.json()["id"]

        # Update the file
        update_data = {
            "name": "Updated Name",
            "content": "Updated content"
        }
        response = await client.put(f"/api/files/{file_id}", json=update_data)

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == update_data["name"]
        assert data["content"] == update_data["content"]

    async def test_update_file_partial(
        self, client: AsyncClient, sample_file_data: dict
    ):
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

    async def test_delete_file(
        self, client: AsyncClient, sample_file_data: dict
    ):
        """Test deleting a file."""
        # Create a file first
        create_response = await client.post("/api/files/", json=sample_file_data)
        file_id = create_response.json()["id"]

        # Delete the file
        response = await client.delete(f"/api/files/{file_id}")

        assert response.status_code == 200
        assert response.json()["status"] == "deleted"

        # Verify it's deleted
        get_response = await client.get(f"/api/files/{file_id}")
        assert get_response.status_code == 404

    async def test_delete_nonexistent_file(self, client: AsyncClient):
        """Test deleting a file that doesn't exist."""
        response = await client.delete("/api/files/nonexistent-id")

        assert response.status_code == 404

    async def test_list_files_multiple(
        self, client: AsyncClient, sample_file_data: dict
    ):
        """Test listing multiple files."""
        # Create multiple files
        for i in range(3):
            file_data = {
                "name": f"Test File {i}",
                "content": f"Content {i}"
            }
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
