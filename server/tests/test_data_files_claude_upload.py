"""Tests for Claude Files API integration in data files upload.

Tests the optimized upload strategy:
- Small files (<500KB): skipped, sent inline as base64
- Large files (>=500KB): uploaded to Claude Files API asynchronously
- Images/PDFs: skipped, use native multimodal support
"""

from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import UploadFile

from api.data_files import (
    INLINE_FILE_THRESHOLD,
    SKIP_CLAUDE_UPLOAD_TYPES,
    upload_data_file,
    upload_to_claude_background,
)


class TestClaudeUploadStrategy:
    """Test Claude upload strategy decisions."""

    def test_inline_threshold_is_500kb(self):
        """Verify the threshold is set to 500KB."""
        assert INLINE_FILE_THRESHOLD == 500 * 1024  # 500KB

    def test_skip_types_include_images(self):
        """Verify images are in skip list."""
        assert "image/png" in SKIP_CLAUDE_UPLOAD_TYPES
        assert "image/jpeg" in SKIP_CLAUDE_UPLOAD_TYPES
        assert "image/gif" in SKIP_CLAUDE_UPLOAD_TYPES
        assert "image/webp" in SKIP_CLAUDE_UPLOAD_TYPES

    def test_skip_types_include_pdf(self):
        """Verify PDF is in skip list."""
        assert "application/pdf" in SKIP_CLAUDE_UPLOAD_TYPES


class TestUploadDataFile:
    """Test the upload_data_file endpoint."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        return db

    @pytest.fixture
    def mock_conversation(self):
        """Create a mock conversation."""
        conv = MagicMock()
        conv.id = "test-conversation-id"
        return conv

    @pytest.mark.asyncio
    async def test_small_csv_file_is_skipped(self, mock_db, mock_conversation):
        """Small CSV files should have claude_upload_status='skipped'."""
        # Create a small CSV file (100 bytes)
        content = b"col1,col2\nval1,val2\n"
        assert len(content) < INLINE_FILE_THRESHOLD

        file = UploadFile(
            filename="small.csv",
            file=BytesIO(content),
        )

        with patch("api.data_files.get_conversation_by_file_id", return_value=mock_conversation):
            with patch("api.data_files.get_data_parser_service") as mock_parser:
                mock_parser.return_value.parse_file = AsyncMock(
                    return_value={
                        "preview_data": [],
                        "column_names": ["col1", "col2"],
                        "row_count": 1,
                    }
                )
                with patch("asyncio.create_task") as mock_create_task:
                    # Mock the BackgroundTasks
                    background_tasks = MagicMock()

                    response = await upload_data_file(
                        conversation_id="test-conv",
                        background_tasks=background_tasks,
                        file=file,
                        db=mock_db,
                    )

                    # Should NOT start background upload for small files
                    mock_create_task.assert_not_called()

                    # Status should be 'skipped'
                    assert response.claudeUploadStatus == "skipped"
                    assert response.claudeFileId is None

    @pytest.mark.asyncio
    async def test_large_csv_file_triggers_background_upload(self, mock_db, mock_conversation):
        """Large CSV files should trigger background upload to Claude."""
        # Create a large CSV file (600KB)
        content = b"col1,col2\n" + b"value1,value2\n" * 40000  # ~600KB
        assert len(content) >= INLINE_FILE_THRESHOLD

        file = UploadFile(
            filename="large.csv",
            file=BytesIO(content),
        )

        with patch("api.data_files.get_conversation_by_file_id", return_value=mock_conversation):
            with patch("api.data_files.get_data_parser_service") as mock_parser:
                mock_parser.return_value.parse_file = AsyncMock(
                    return_value={
                        "preview_data": [],
                        "column_names": ["col1", "col2"],
                        "row_count": 40000,
                    }
                )
                with patch("asyncio.create_task") as mock_create_task:
                    background_tasks = MagicMock()

                    response = await upload_data_file(
                        conversation_id="test-conv",
                        background_tasks=background_tasks,
                        file=file,
                        db=mock_db,
                    )

                    # Should start background upload for large files
                    mock_create_task.assert_called_once()

                    # Status should be 'pending' (will change to 'uploading' then 'ready')
                    assert response.claudeUploadStatus == "pending"

    @pytest.mark.asyncio
    async def test_image_file_is_skipped(self, mock_db, mock_conversation):
        """Image files should have claude_upload_status='skipped' regardless of size."""
        # Create a large image file (1MB)
        content = b"\x89PNG\r\n\x1a\n" + b"\x00" * (1024 * 1024)
        assert len(content) >= INLINE_FILE_THRESHOLD

        file = UploadFile(
            filename="large_image.png",
            file=BytesIO(content),
        )

        with patch("api.data_files.get_conversation_by_file_id", return_value=mock_conversation):
            with patch("api.data_files.get_data_parser_service") as mock_parser:
                mock_parser.return_value.parse_file = AsyncMock(return_value={})
                with patch("asyncio.create_task") as mock_create_task:
                    background_tasks = MagicMock()

                    response = await upload_data_file(
                        conversation_id="test-conv",
                        background_tasks=background_tasks,
                        file=file,
                        db=mock_db,
                    )

                    # Should NOT start background upload for images
                    mock_create_task.assert_not_called()

                    # Status should be 'skipped'
                    assert response.claudeUploadStatus == "skipped"


class TestBackgroundUpload:
    """Test the background upload task."""

    @pytest.mark.asyncio
    async def test_background_upload_success(self):
        """Test successful background upload to Claude."""
        file_id = "test-file-id"
        content = b"test content"
        filename = "test.csv"
        mime_type = "text/csv"

        mock_data_file = MagicMock()
        mock_data_file.claude_upload_status = "pending"

        with patch("api.data_files.async_session") as mock_session_maker:
            mock_db = AsyncMock()
            mock_session_maker.return_value.__aenter__.return_value = mock_db

            # Mock the database query
            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = mock_data_file
            mock_db.execute.return_value = mock_result

            with patch("api.data_files.get_anthropic_files_service") as mock_files_service:
                mock_service = MagicMock()
                mock_service.upload_file = AsyncMock(return_value="claude-file-123")
                mock_files_service.return_value = mock_service

                await upload_to_claude_background(file_id, content, filename, mime_type)

                # Verify the file was uploaded
                mock_service.upload_file.assert_called_once_with(
                    content=content,
                    filename=filename,
                    mime_type=mime_type,
                )

                # Verify status was updated
                assert mock_data_file.claude_file_id == "claude-file-123"
                assert mock_data_file.claude_upload_status == "ready"

    @pytest.mark.asyncio
    async def test_background_upload_failure(self):
        """Test failed background upload to Claude."""
        file_id = "test-file-id"
        content = b"test content"
        filename = "test.csv"
        mime_type = "text/csv"

        mock_data_file = MagicMock()
        mock_data_file.claude_upload_status = "pending"

        with patch("api.data_files.async_session") as mock_session_maker:
            mock_db = AsyncMock()
            mock_session_maker.return_value.__aenter__.return_value = mock_db

            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = mock_data_file
            mock_db.execute.return_value = mock_result

            with patch("api.data_files.get_anthropic_files_service") as mock_files_service:
                mock_service = MagicMock()
                # Simulate upload failure (returns None)
                mock_service.upload_file = AsyncMock(return_value=None)
                mock_files_service.return_value = mock_service

                await upload_to_claude_background(file_id, content, filename, mime_type)

                # Verify status was set to error
                assert mock_data_file.claude_upload_status == "error"
                assert mock_data_file.claude_upload_error == "Failed to upload to Claude Files API"

    @pytest.mark.asyncio
    async def test_background_upload_exception(self):
        """Test exception handling in background upload."""
        file_id = "test-file-id"
        content = b"test content"
        filename = "test.csv"
        mime_type = "text/csv"

        mock_data_file = MagicMock()
        mock_data_file.claude_upload_status = "pending"

        with patch("api.data_files.async_session") as mock_session_maker:
            mock_db = AsyncMock()
            mock_session_maker.return_value.__aenter__.return_value = mock_db

            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = mock_data_file
            mock_db.execute.return_value = mock_result

            with patch("api.data_files.get_anthropic_files_service") as mock_files_service:
                mock_service = MagicMock()
                # Simulate exception
                mock_service.upload_file = AsyncMock(side_effect=Exception("Network error"))
                mock_files_service.return_value = mock_service

                # Should not raise, just log and update status
                await upload_to_claude_background(file_id, content, filename, mime_type)

                # Verify status was set to error
                assert mock_data_file.claude_upload_status == "error"
                assert "Network error" in mock_data_file.claude_upload_error


class TestWritingAgentIntegration:
    """Test WritingAgent's handling of pre-uploaded files."""

    @pytest.mark.asyncio
    async def test_uses_preupload_file_id_when_ready(self):
        """WritingAgent should use claude_file_id when status is 'ready'."""
        from agents.writing_agent import WritingAgent

        with patch.object(WritingAgent, "__init__", lambda x, **kwargs: None):
            agent = WritingAgent.__new__(WritingAgent)
            agent.files_service = MagicMock()
            agent.files_service.upload_file = AsyncMock(return_value="new-file-id")

            # Simulate a pre-uploaded file
            data_files = [
                {
                    "content": b"test,data\n1,2",
                    "mime_type": "text/csv",
                    "filename": "test.csv",
                    "claude_file_id": "pre-uploaded-123",
                    "claude_upload_status": "ready",
                    "file_size": 100,
                }
            ]

            content = await agent._build_multimodal_content(
                message="Analyze this",
                images=None,
                data_files=data_files,
            )

            # Should NOT call upload_file since file is already uploaded
            agent.files_service.upload_file.assert_not_called()

            # Should use the pre-uploaded file_id
            container_upload = next(
                (c for c in content if c.get("type") == "container_upload"), None
            )
            assert container_upload is not None
            assert container_upload["file_id"] == "pre-uploaded-123"

    @pytest.mark.asyncio
    async def test_uploads_when_status_skipped(self):
        """WritingAgent should upload when status is 'skipped' (small file)."""
        from agents.writing_agent import WritingAgent

        with patch.object(WritingAgent, "__init__", lambda x, **kwargs: None):
            agent = WritingAgent.__new__(WritingAgent)
            agent.files_service = MagicMock()
            agent.files_service.upload_file = AsyncMock(return_value="new-file-id")

            # Simulate a skipped (small) file
            data_files = [
                {
                    "content": b"test,data\n1,2",
                    "mime_type": "text/csv",
                    "filename": "small.csv",
                    "claude_file_id": None,
                    "claude_upload_status": "skipped",
                    "file_size": 100,
                }
            ]

            content = await agent._build_multimodal_content(
                message="Analyze this",
                images=None,
                data_files=data_files,
            )

            # Should call upload_file for skipped files
            agent.files_service.upload_file.assert_called_once()

            # Should use the newly uploaded file_id
            container_upload = next(
                (c for c in content if c.get("type") == "container_upload"), None
            )
            assert container_upload is not None
            assert container_upload["file_id"] == "new-file-id"


# Run with: pytest tests/test_data_files_claude_upload.py -v
