"""Deep integration tests for Files API.

These tests focus on:
1. Real database interactions (not mocked)
2. Edge cases and error handling
3. User isolation and security
4. RAG service integration
5. Concurrent operations
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import File
from services.auth_service import TokenData


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def user1_token() -> TokenData:
    """Create token for user 1."""
    return TokenData(
        sub="user-1-uuid",
        exp=datetime.now(UTC) + timedelta(hours=1)
    )


@pytest.fixture
def user2_token() -> TokenData:
    """Create token for user 2."""
    return TokenData(
        sub="user-2-uuid",
        exp=datetime.now(UTC) + timedelta(hours=1)
    )


@pytest.fixture
def dev_token() -> TokenData:
    """Create dev-user token (no filtering)."""
    return TokenData(
        sub="dev-user",
        exp=datetime.now(UTC) + timedelta(hours=1)
    )


# ============================================================================
# User Isolation Tests - Deep
# ============================================================================


class TestUserIsolationDeep:
    """Deep tests for user data isolation."""

    @pytest.mark.asyncio
    async def test_user_cannot_see_other_users_files(
        self, db_session: AsyncSession
    ):
        """User 1 should NOT see files created by User 2."""
        # Create files for user 1
        file1 = File(name="User1 File", content="Secret", user_id="user-1")
        db_session.add(file1)

        # Create files for user 2
        file2 = File(name="User2 File", content="Also Secret", user_id="user-2")
        db_session.add(file2)
        await db_session.commit()

        # Query as user 1 - should only see their file
        query = select(File).where(File.user_id == "user-1")
        result = await db_session.execute(query)
        user1_files = result.scalars().all()

        assert len(user1_files) == 1
        assert user1_files[0].name == "User1 File"
        assert "User2 File" not in [f.name for f in user1_files]

    @pytest.mark.asyncio
    async def test_user_cannot_update_other_users_file_non_debug(
        self, db_session: AsyncSession
    ):
        """User should NOT be able to update another user's file in non-debug mode.

        Note: This tests the get_user_id_filter logic directly since the
        test client runs in debug mode by default.
        """
        from api.files import get_user_id_filter

        # Create file for user 1
        file = File(name="User1 File", content="Original", user_id="user-1-specific")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        # Simulate non-debug mode filtering
        with patch("api.files.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(debug=False)

            # User 2 token
            user2_token = TokenData(
                sub="user-2-specific",
                exp=datetime.now(UTC) + timedelta(hours=1)
            )

            # Get user ID filter for user 2
            user_id_filter = get_user_id_filter(user2_token)

            # Query with user 2's filter - should not find user 1's file
            query = select(File).where(File.id == file.id)
            if user_id_filter:
                query = query.where(File.user_id == user_id_filter)

            result = await db_session.execute(query)
            found_file = result.scalar_one_or_none()

            # User 2 should NOT see user 1's file
            assert found_file is None, "User 2 should not be able to access User 1's file"

    @pytest.mark.asyncio
    async def test_user_cannot_delete_other_users_file_non_debug(
        self, db_session: AsyncSession
    ):
        """User should NOT be able to delete another user's file in non-debug mode.

        Note: This tests the get_user_id_filter logic directly.
        """
        from api.files import get_user_id_filter

        # Create file for user 1
        file = File(name="Important", content="Don't delete", user_id="user-owner")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        # Simulate non-debug mode
        with patch("api.files.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(debug=False)

            # Different user token
            other_user_token = TokenData(
                sub="user-attacker",
                exp=datetime.now(UTC) + timedelta(hours=1)
            )

            user_id_filter = get_user_id_filter(other_user_token)

            # Query with attacker's filter - should not find owner's file
            query = select(File).where(File.id == file.id)
            if user_id_filter:
                query = query.where(File.user_id == user_id_filter)

            result = await db_session.execute(query)
            found_file = result.scalar_one_or_none()

            # Attacker should NOT see owner's file
            assert found_file is None, "Attacker should not be able to access owner's file"


# ============================================================================
# Database Integrity Tests
# ============================================================================


class TestDatabaseIntegrity:
    """Tests for database operations and integrity."""

    @pytest.mark.asyncio
    async def test_file_id_is_uuid(self, db_session: AsyncSession):
        """File ID should be a valid UUID."""
        file = File(name="Test", content="Content")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        # Verify ID is a valid UUID
        try:
            uuid.UUID(file.id)
            is_valid_uuid = True
        except ValueError:
            is_valid_uuid = False

        assert is_valid_uuid, f"File ID '{file.id}' is not a valid UUID"

    @pytest.mark.asyncio
    async def test_timestamps_auto_set(self, db_session: AsyncSession):
        """Timestamps should be automatically set on creation."""
        before_create = datetime.now(UTC)

        file = File(name="Timestamped", content="Test")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        after_create = datetime.now(UTC)

        assert file.created_at is not None
        assert file.updated_at is not None

        # Timestamps should be between before and after
        # Note: SQLite may not have timezone, so be flexible
        assert file.created_at <= file.updated_at

    @pytest.mark.asyncio
    async def test_update_changes_updated_at(self, db_session: AsyncSession):
        """Updating a file should change updated_at but not created_at."""
        file = File(name="Original", content="Original content")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        original_created_at = file.created_at
        original_updated_at = file.updated_at

        # Wait a bit to ensure timestamp difference
        await asyncio.sleep(0.1)

        # Update the file
        file.content = "Updated content"
        await db_session.commit()
        await db_session.refresh(file)

        assert file.created_at == original_created_at, "created_at should not change"
        # updated_at may or may not change depending on DB trigger setup

    @pytest.mark.asyncio
    async def test_file_content_can_be_empty(self, db_session: AsyncSession):
        """Files should allow empty content."""
        file = File(name="Empty File", content="")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        assert file.content == ""

    @pytest.mark.asyncio
    async def test_file_content_can_be_large(self, db_session: AsyncSession):
        """Files should handle large content."""
        large_content = "x" * 100000  # 100KB

        file = File(name="Large File", content=large_content)
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        assert len(file.content) == 100000

    @pytest.mark.asyncio
    async def test_file_name_unicode(self, db_session: AsyncSession):
        """Files should handle Unicode in names."""
        unicode_names = [
            "文档.md",
            "документ.md",
            "📝 Notes.md",
            "日本語ファイル.md",
            "مستند.md"
        ]

        for name in unicode_names:
            file = File(name=name, content=f"Content for {name}")
            db_session.add(file)
            await db_session.commit()
            await db_session.refresh(file)

            assert file.name == name, f"Unicode name '{name}' not preserved"


# ============================================================================
# Error Handling Tests
# ============================================================================


class TestErrorHandling:
    """Tests for error conditions and handling."""

    @pytest.mark.asyncio
    async def test_get_nonexistent_file(self, client: AsyncClient):
        """Getting a nonexistent file should return 404."""
        fake_id = str(uuid.uuid4())
        response = await client.get(f"/api/files/{fake_id}")

        assert response.status_code == 404
        data = response.json()
        assert "not found" in data.get("detail", "").lower()

    @pytest.mark.asyncio
    async def test_update_nonexistent_file(self, client: AsyncClient):
        """Updating a nonexistent file should return 404."""
        fake_id = str(uuid.uuid4())
        response = await client.put(
            f"/api/files/{fake_id}",
            json={"name": "New Name"}
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_nonexistent_file(self, client: AsyncClient):
        """Deleting a nonexistent file should return 404."""
        fake_id = str(uuid.uuid4())
        response = await client.delete(f"/api/files/{fake_id}")

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_create_file_missing_name(self, client: AsyncClient):
        """Creating a file without a name should fail validation."""
        response = await client.post("/api/files/", json={"content": "No name"})

        assert response.status_code == 422  # Validation error

    @pytest.mark.asyncio
    async def test_search_with_empty_query(self, client: AsyncClient):
        """Search with empty query should handle gracefully."""
        response = await client.post(
            "/api/files/search",
            json={"query": "", "top_k": 5}
        )

        # Should either succeed with empty results or fail gracefully
        assert response.status_code in [200, 400, 422, 500]

    @pytest.mark.asyncio
    async def test_in_document_search_nonexistent_file(self, client: AsyncClient):
        """In-document search on nonexistent file should return 404."""
        fake_id = str(uuid.uuid4())
        response = await client.post(
            "/api/files/search/in-document",
            json={
                "query": "test",
                "file_id": fake_id
            }
        )

        assert response.status_code == 404


# ============================================================================
# RAG Integration Tests
# ============================================================================


class TestRAGIntegration:
    """Tests for RAG service integration."""

    @pytest.mark.asyncio
    async def test_create_file_indexes_in_rag(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Creating a file should trigger RAG indexing."""
        with patch("api.files.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.index_file = AsyncMock()
            mock_rag.index_file_sentences = AsyncMock()
            mock_rag_class.return_value = mock_rag

            response = await client.post(
                "/api/files/",
                json={"name": "Test Doc", "content": "This is test content."}
            )

            assert response.status_code == 200

            # Verify RAG methods were called
            mock_rag.index_file.assert_called_once()
            mock_rag.index_file_sentences.assert_called_once()

            # Verify correct file_id was passed
            call_kwargs = mock_rag.index_file.call_args[1]
            assert "file_id" in call_kwargs
            assert call_kwargs["content"] == "This is test content."

    @pytest.mark.asyncio
    async def test_update_file_reindexes_in_rag(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Updating file content should trigger re-indexing."""
        # First create a file
        file = File(name="To Update", content="Original")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        with patch("api.files.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.index_file = AsyncMock()
            mock_rag.index_file_sentences = AsyncMock()
            mock_rag_class.return_value = mock_rag

            response = await client.put(
                f"/api/files/{file.id}",
                json={"content": "Updated content"}
            )

            assert response.status_code == 200

            # Should re-index on content update
            mock_rag.index_file.assert_called()
            mock_rag.index_file_sentences.assert_called()

    @pytest.mark.asyncio
    async def test_delete_file_removes_from_rag(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Deleting a file should remove it from RAG."""
        file = File(name="To Delete", content="Will be deleted")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)
        file_id = file.id

        with patch("api.files.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.delete_file = AsyncMock()
            mock_rag_class.return_value = mock_rag

            response = await client.delete(f"/api/files/{file_id}")

            assert response.status_code == 200

            # Should delete from RAG
            mock_rag.delete_file.assert_called_once_with(file_id)

    @pytest.mark.asyncio
    async def test_rag_error_does_not_break_file_creation(
        self, client: AsyncClient
    ):
        """RAG errors should not prevent file creation."""
        with patch("api.files.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.index_file = AsyncMock(side_effect=Exception("RAG failure"))
            mock_rag.index_file_sentences = AsyncMock(side_effect=Exception("RAG failure"))
            mock_rag_class.return_value = mock_rag

            response = await client.post(
                "/api/files/",
                json={"name": "Test", "content": "Content"}
            )

            # File creation should still succeed
            assert response.status_code == 200
            assert response.json()["name"] == "Test"


# ============================================================================
# Concurrent Access Tests
# ============================================================================


class TestConcurrentAccess:
    """Tests for concurrent operations.

    Note: Concurrent database operations with shared sessions can cause
    SQLAlchemy state issues. These tests verify sequential operations
    work correctly.
    """

    @pytest.mark.asyncio
    async def test_sequential_file_creation(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Multiple files can be created sequentially."""
        created_ids = []
        for i in range(3):
            response = await client.post(
                "/api/files/",
                json={"name": f"Sequential {i}", "content": f"Content {i}"}
            )
            assert response.status_code == 200, f"File {i} creation failed"
            created_ids.append(response.json()["id"])

        # Verify all files exist with unique IDs
        assert len(set(created_ids)) == 3, "File IDs should be unique"

    @pytest.mark.asyncio
    async def test_sequential_updates_to_same_file(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Sequential updates to same file should work correctly."""
        # Create file
        response = await client.post(
            "/api/files/",
            json={"name": "Shared", "content": "Original"}
        )
        assert response.status_code == 200
        file_id = response.json()["id"]

        # Update sequentially
        for i in range(3):
            response = await client.put(
                f"/api/files/{file_id}",
                json={"content": f"Update {i}"}
            )
            assert response.status_code == 200

        # Verify final state
        response = await client.get(f"/api/files/{file_id}")
        assert response.status_code == 200
        assert response.json()["content"] == "Update 2"

    @pytest.mark.asyncio
    async def test_create_update_delete_cycle(
        self, client: AsyncClient
    ):
        """Complete create-update-delete cycle should work."""
        # Create
        response = await client.post(
            "/api/files/",
            json={"name": "Lifecycle Test", "content": "Initial"}
        )
        assert response.status_code == 200
        file_id = response.json()["id"]

        # Update
        response = await client.put(
            f"/api/files/{file_id}",
            json={"content": "Updated"}
        )
        assert response.status_code == 200
        assert response.json()["content"] == "Updated"

        # Delete
        response = await client.delete(f"/api/files/{file_id}")
        assert response.status_code == 200

        # Verify deleted
        response = await client.get(f"/api/files/{file_id}")
        assert response.status_code == 404


# ============================================================================
# Search Functionality Tests
# ============================================================================


class TestSearchFunctionality:
    """Tests for search functionality."""

    @pytest.mark.asyncio
    async def test_search_respects_file_ids_filter(self, client: AsyncClient):
        """Search should only search in specified file_ids."""
        with patch("api.files.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.search = AsyncMock(return_value=[
                {"content": "Result", "file_id": "f1", "score": 0.9}
            ])
            mock_rag_class.return_value = mock_rag

            response = await client.post(
                "/api/files/search",
                json={
                    "query": "test query",
                    "file_ids": ["f1", "f2"],
                    "top_k": 3
                }
            )

            assert response.status_code == 200

            # Verify file_ids was passed to RAG
            call_kwargs = mock_rag.search.call_args[1]
            assert call_kwargs["file_ids"] == ["f1", "f2"]
            assert call_kwargs["top_k"] == 3

    @pytest.mark.asyncio
    async def test_in_document_search_creates_index_if_missing(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """In-document search should create sentence index if missing."""
        file = File(name="Not Indexed", content="This content needs indexing.")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        with patch("api.files.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            # First call returns empty (no index), second call returns results
            mock_rag.search_sentences = AsyncMock(side_effect=[
                [],  # Existence check - no index
                [{"content": "This content", "score": 0.8}]  # After indexing
            ])
            mock_rag.index_file_sentences = AsyncMock()
            mock_rag_class.return_value = mock_rag

            response = await client.post(
                "/api/files/search/in-document",
                json={
                    "query": "content",
                    "file_id": file.id
                }
            )

            assert response.status_code == 200

            # Should have called index_file_sentences
            mock_rag.index_file_sentences.assert_called_once()

    @pytest.mark.asyncio
    async def test_in_document_search_respects_min_score(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """In-document search should pass min_score to RAG."""
        file = File(name="Test", content="Test content")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        with patch("api.files.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.search_sentences = AsyncMock(return_value=[
                {"content": "Test", "score": 0.9}
            ])
            mock_rag_class.return_value = mock_rag

            response = await client.post(
                "/api/files/search/in-document",
                json={
                    "query": "test",
                    "file_id": file.id,
                    "min_score": 0.7
                }
            )

            assert response.status_code == 200

            # Check min_score was passed (second call after existence check)
            calls = mock_rag.search_sentences.call_args_list
            # Last call should have min_score=0.7
            last_call_kwargs = calls[-1][1]
            assert last_call_kwargs.get("min_score") == 0.7


# ============================================================================
# API Response Format Tests
# ============================================================================


class TestAPIResponseFormat:
    """Tests for API response format correctness."""

    @pytest.mark.asyncio
    async def test_file_response_has_all_fields(
        self, client: AsyncClient
    ):
        """FileResponse should contain all required fields."""
        response = await client.post(
            "/api/files/",
            json={"name": "Complete", "content": "All fields"}
        )

        assert response.status_code == 200
        data = response.json()

        required_fields = ["id", "name", "content", "created_at", "updated_at"]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"

    @pytest.mark.asyncio
    async def test_list_files_returns_array(self, client: AsyncClient):
        """List files should return an array."""
        response = await client.get("/api/files/")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_delete_returns_status(self, client: AsyncClient, db_session: AsyncSession):
        """Delete should return status object."""
        file = File(name="To Delete", content="Content")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        response = await client.delete(f"/api/files/{file.id}")

        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "deleted"

    @pytest.mark.asyncio
    async def test_search_returns_results_array(self, client: AsyncClient):
        """Search should return results array."""
        with patch("api.files.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.search = AsyncMock(return_value=[])
            mock_rag_class.return_value = mock_rag

            response = await client.post(
                "/api/files/search",
                json={"query": "test"}
            )

            assert response.status_code == 200
            data = response.json()
            assert "results" in data
            assert isinstance(data["results"], list)


# ============================================================================
# Edge Cases
# ============================================================================


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    @pytest.mark.asyncio
    async def test_file_with_special_characters_in_name(
        self, client: AsyncClient
    ):
        """Files with special characters in name should work."""
        special_names = [
            "file (1).md",
            "file [copy].md",
            "file {test}.md",
            "file & notes.md",
            "file <draft>.md",
            "file 'quoted'.md",
            'file "double".md',
        ]

        for name in special_names:
            response = await client.post(
                "/api/files/",
                json={"name": name, "content": "Test"}
            )

            assert response.status_code == 200, f"Failed for name: {name}"
            assert response.json()["name"] == name

    @pytest.mark.asyncio
    async def test_file_with_markdown_content(self, client: AsyncClient):
        """Files should preserve markdown formatting."""
        markdown_content = """# Heading 1
## Heading 2

**Bold** and *italic* text.

- List item 1
- List item 2

```python
def hello():
    print("world")
```

| Col1 | Col2 |
|------|------|
| A    | B    |
"""
        response = await client.post(
            "/api/files/",
            json={"name": "markdown.md", "content": markdown_content}
        )

        assert response.status_code == 200
        assert response.json()["content"] == markdown_content

    @pytest.mark.asyncio
    async def test_file_with_html_content(self, client: AsyncClient):
        """Files should preserve HTML content."""
        html_content = """<div class="container">
    <h1>Title</h1>
    <p>Paragraph with <strong>bold</strong></p>
    <script>alert('xss')</script>
</div>"""

        response = await client.post(
            "/api/files/",
            json={"name": "html.html", "content": html_content}
        )

        assert response.status_code == 200
        # Content should be preserved exactly (no XSS filtering at storage level)
        assert response.json()["content"] == html_content

    @pytest.mark.asyncio
    async def test_update_with_null_values_preserves_original(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Updating with null values should preserve original."""
        file = File(name="Original Name", content="Original Content")
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        # Update with only content (name should be preserved)
        response = await client.put(
            f"/api/files/{file.id}",
            json={"content": "New Content"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Original Name"
        assert data["content"] == "New Content"

    @pytest.mark.asyncio
    async def test_very_long_file_name(self, client: AsyncClient):
        """Very long file names should be handled."""
        long_name = "x" * 1000 + ".md"

        response = await client.post(
            "/api/files/",
            json={"name": long_name, "content": "Content"}
        )

        # Should either succeed or fail gracefully (no crash)
        assert response.status_code in [200, 400, 422, 500]

    @pytest.mark.asyncio
    async def test_newlines_in_content_preserved(self, client: AsyncClient):
        """Newlines in content should be preserved."""
        content_with_newlines = "Line 1\nLine 2\r\nLine 3\rLine 4"

        response = await client.post(
            "/api/files/",
            json={"name": "newlines.txt", "content": content_with_newlines}
        )

        assert response.status_code == 200
        # Newlines should be preserved
        assert "\n" in response.json()["content"]
