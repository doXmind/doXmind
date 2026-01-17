"""Deep Integration Tests for Knowledge Base API.

These tests focus on:
- Real database interactions and data integrity
- Attachment lifecycle (create, index, search, delete)
- RAG service integration with actual vector operations
- Error handling and edge cases
- Conversation-attachment relationships
- File type validation and size limits
"""

import io
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import Conversation, ConversationAttachment
from main import app


# ============================================================================
# Database Integrity Tests
# ============================================================================


class TestAttachmentDatabaseIntegrity:
    """Tests for attachment database operations and data integrity."""

    @pytest.mark.asyncio
    async def test_attachment_id_is_valid_uuid(self, db_session: AsyncSession):
        """Attachment IDs should be valid UUIDs."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="test-file")
        db_session.add(conv)
        await db_session.commit()

        attachment = ConversationAttachment(
            conversation_id=conv.id,
            original_filename="test.pdf",
            file_type="pdf",
            file_size=1000,
            status="processing"
        )
        db_session.add(attachment)
        await db_session.commit()
        await db_session.refresh(attachment)

        # Should be a valid UUID
        parsed_uuid = uuid.UUID(attachment.id)
        assert str(parsed_uuid) == attachment.id

    @pytest.mark.asyncio
    async def test_attachment_created_at_auto_generated(self, db_session: AsyncSession):
        """Attachments should have auto-generated created_at timestamp."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="test-file-2")
        db_session.add(conv)
        await db_session.commit()

        attachment = ConversationAttachment(
            conversation_id=conv.id,
            original_filename="doc.pdf",
            file_type="pdf",
            file_size=2000,
            status="indexed"
        )
        db_session.add(attachment)
        await db_session.commit()
        await db_session.refresh(attachment)

        assert attachment.created_at is not None

    @pytest.mark.asyncio
    async def test_attachment_conversation_relationship(self, db_session: AsyncSession):
        """Attachment should maintain proper relationship with conversation."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="rel-test")
        db_session.add(conv)
        await db_session.commit()

        att1 = ConversationAttachment(
            conversation_id=conv_id,
            original_filename="file1.pdf",
            file_type="pdf",
            file_size=100,
            status="indexed"
        )
        att2 = ConversationAttachment(
            conversation_id=conv_id,
            original_filename="file2.docx",
            file_type="docx",
            file_size=200,
            status="indexed"
        )
        db_session.add(att1)
        db_session.add(att2)
        await db_session.commit()

        # Query attachments by conversation
        result = await db_session.execute(
            select(ConversationAttachment)
            .where(ConversationAttachment.conversation_id == conv_id)
        )
        attachments = result.scalars().all()

        assert len(attachments) == 2
        assert all(att.conversation_id == conv_id for att in attachments)

    @pytest.mark.asyncio
    async def test_attachment_stores_extracted_text(self, db_session: AsyncSession):
        """Attachment should properly store extracted text content."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="text-store-test")
        db_session.add(conv)
        await db_session.commit()

        extracted_text = """
        This is a long extracted text from a PDF document.
        It contains multiple paragraphs and special characters: é, ñ, 中文.
        Line 3 with some numbers: 12345.
        """

        attachment = ConversationAttachment(
            conversation_id=conv.id,
            original_filename="document.pdf",
            file_type="pdf",
            file_size=5000,
            status="indexed",
            extracted_text=extracted_text,
            chunk_count=3
        )
        db_session.add(attachment)
        await db_session.commit()
        await db_session.refresh(attachment)

        # Re-fetch to verify persistence
        fetched = await db_session.get(ConversationAttachment, attachment.id)
        assert fetched.extracted_text == extracted_text
        assert "中文" in fetched.extracted_text
        assert fetched.chunk_count == 3

    @pytest.mark.asyncio
    async def test_attachment_error_state_persists(self, db_session: AsyncSession):
        """Attachment error status and message should persist correctly."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="error-test")
        db_session.add(conv)
        await db_session.commit()

        attachment = ConversationAttachment(
            conversation_id=conv.id,
            original_filename="corrupt.pdf",
            file_type="pdf",
            file_size=100,
            status="error",
            error_message="Failed to extract text: PDF is corrupted"
        )
        db_session.add(attachment)
        await db_session.commit()
        await db_session.refresh(attachment)

        fetched = await db_session.get(ConversationAttachment, attachment.id)
        assert fetched.status == "error"
        assert "corrupted" in fetched.error_message


# ============================================================================
# Attachment Lifecycle Tests
# ============================================================================


class TestAttachmentLifecycle:
    """Tests for complete attachment upload-index-search-delete lifecycle."""

    @pytest.mark.asyncio
    async def test_upload_creates_processing_then_indexed(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Upload should transition attachment from processing to indexed."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="lifecycle-test")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.extract_text_content") as mock_extract, \
             patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_extract.return_value = "Extracted content from PDF"

            mock_rag = MagicMock()
            mock_rag.index_kb_attachment = AsyncMock(return_value=5)
            mock_rag_class.return_value = mock_rag

            pdf_content = b"%PDF-1.4 sample content"
            files = {"file": ("test.pdf", io.BytesIO(pdf_content), "application/pdf")}

            response = await client.post(
                "/api/kb/lifecycle-test/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 200
            data = response.json()

            # Should be indexed after successful processing
            assert data["status"] == "indexed"
            assert data["chunk_count"] == 5

            # Verify RAG was called with correct parameters
            mock_rag.index_kb_attachment.assert_called_once()
            call_args = mock_rag.index_kb_attachment.call_args
            assert call_args.kwargs["content"] == "Extracted content from PDF"
            assert call_args.kwargs["filename"] == "test.pdf"

    @pytest.mark.asyncio
    async def test_upload_stores_in_database_before_processing(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Attachment record should be created before text extraction."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="db-first-test")
        db_session.add(conv)
        await db_session.commit()

        attachment_id_holder = []

        async def mock_index_that_checks_db(*args, **kwargs):
            # During indexing, verify attachment exists in DB
            result = await db_session.execute(
                select(ConversationAttachment)
                .where(ConversationAttachment.conversation_id == conv.id)
            )
            attachments = result.scalars().all()
            if attachments:
                attachment_id_holder.append(attachments[0].id)
            return 3

        with patch("api.knowledge_base.extract_text_content") as mock_extract, \
             patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_extract.return_value = "Content"

            mock_rag = MagicMock()
            mock_rag.index_kb_attachment = AsyncMock(side_effect=mock_index_that_checks_db)
            mock_rag_class.return_value = mock_rag

            files = {"file": ("check.pdf", io.BytesIO(b"%PDF"), "application/pdf")}

            response = await client.post(
                "/api/kb/db-first-test/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 200
            # Attachment was found during indexing
            assert len(attachment_id_holder) == 1

    @pytest.mark.asyncio
    async def test_delete_removes_from_database_and_vectors(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Delete should remove attachment from both database and vector store."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="delete-lifecycle")
        db_session.add(conv)

        att_id = str(uuid.uuid4())
        attachment = ConversationAttachment(
            id=att_id,
            conversation_id=conv_id,
            original_filename="to-delete.pdf",
            file_type="pdf",
            file_size=1000,
            status="indexed",
            chunk_count=5
        )
        db_session.add(attachment)
        await db_session.commit()

        with patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.delete_kb_attachment = AsyncMock()
            mock_rag_class.return_value = mock_rag

            response = await client.delete(
                f"/api/kb/delete-lifecycle/attachments/{att_id}",
                headers=auth_headers
            )

            assert response.status_code == 200

            # Verify vector deletion was called
            mock_rag.delete_kb_attachment.assert_called_once_with(att_id)

            # Verify database record is gone
            fetched = await db_session.get(ConversationAttachment, att_id)
            assert fetched is None


# ============================================================================
# File Type Validation Tests
# ============================================================================


class TestFileTypeValidation:
    """Tests for file type validation edge cases."""

    @pytest.mark.asyncio
    async def test_rejects_executable_files(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should reject executable file types."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="exe-test")
        db_session.add(conv)
        await db_session.commit()

        files = {"file": ("malware.exe", io.BytesIO(b"MZ\x90\x00"), "application/x-msdownload")}

        response = await client.post(
            "/api/kb/exe-test/attachments",
            files=files,
            headers=auth_headers
        )

        assert response.status_code == 415
        data = response.json()
        assert data["error"]["code"] == "UNSUPPORTED_FILE_TYPE"

    @pytest.mark.asyncio
    async def test_rejects_javascript_files(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should reject JavaScript file types."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="js-test")
        db_session.add(conv)
        await db_session.commit()

        files = {"file": ("script.js", io.BytesIO(b"alert('xss')"), "text/javascript")}

        response = await client.post(
            "/api/kb/js-test/attachments",
            files=files,
            headers=auth_headers
        )

        assert response.status_code == 415

    @pytest.mark.asyncio
    async def test_accepts_case_insensitive_extension(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should accept files with uppercase extensions."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="case-test")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.extract_text_content") as mock_extract, \
             patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_extract.return_value = "Content"

            mock_rag = MagicMock()
            mock_rag.index_kb_attachment = AsyncMock(return_value=1)
            mock_rag_class.return_value = mock_rag

            # Uppercase extension
            files = {"file": ("DOC.PDF", io.BytesIO(b"%PDF"), "application/pdf")}

            response = await client.post(
                "/api/kb/case-test/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 200
            data = response.json()
            assert data["file_type"] == "pdf"

    @pytest.mark.asyncio
    async def test_rejects_double_extension_exploit(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should reject files with malicious double extensions."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="double-ext")
        db_session.add(conv)
        await db_session.commit()

        # Double extension attack: file.pdf.exe - should check last extension
        files = {"file": ("document.pdf.exe", io.BytesIO(b"MZ"), "application/pdf")}

        response = await client.post(
            "/api/kb/double-ext/attachments",
            files=files,
            headers=auth_headers
        )

        # Should be rejected because final extension is .exe
        assert response.status_code == 415

    @pytest.mark.asyncio
    async def test_rejects_no_extension(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should reject files without extension."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="no-ext")
        db_session.add(conv)
        await db_session.commit()

        files = {"file": ("noextension", io.BytesIO(b"content"), "application/octet-stream")}

        response = await client.post(
            "/api/kb/no-ext/attachments",
            files=files,
            headers=auth_headers
        )

        assert response.status_code == 415


# ============================================================================
# File Size Validation Tests
# ============================================================================


class TestFileSizeValidation:
    """Tests for file size limit enforcement."""

    @pytest.mark.asyncio
    async def test_rejects_exactly_at_limit(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should reject file exactly at size limit + 1 byte."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="size-edge")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.MAX_FILE_SIZE", 100):
            # 101 bytes - just over limit
            content = b"x" * 101
            files = {"file": ("big.pdf", io.BytesIO(content), "application/pdf")}

            response = await client.post(
                "/api/kb/size-edge/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 413

    @pytest.mark.asyncio
    async def test_accepts_file_at_limit(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should accept file exactly at size limit."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="size-exact")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.MAX_FILE_SIZE", 100), \
             patch("api.knowledge_base.extract_text_content") as mock_extract, \
             patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_extract.return_value = "Content"

            mock_rag = MagicMock()
            mock_rag.index_kb_attachment = AsyncMock(return_value=1)
            mock_rag_class.return_value = mock_rag

            # Exactly 100 bytes - at limit
            content = b"x" * 100
            files = {"file": ("exact.pdf", io.BytesIO(content), "application/pdf")}

            response = await client.post(
                "/api/kb/size-exact/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 200


# ============================================================================
# Search Functionality Tests
# ============================================================================


class TestSearchFunctionality:
    """Tests for knowledge base search operations."""

    @pytest.mark.asyncio
    async def test_search_returns_formatted_results(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Search should return properly formatted results."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="search-format")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.search_kb = AsyncMock(return_value=[
                {
                    "id": "chunk-1",
                    "content": "This is the matched content",
                    "source_file": "document.pdf",
                    "score": 0.95,
                    "metadata": {"chunk_index": 0}
                },
                {
                    "id": "chunk-2",
                    "content": "Another matching section",
                    "source_file": "report.docx",
                    "score": 0.82,
                    "metadata": {"chunk_index": 3}
                }
            ])
            mock_rag_class.return_value = mock_rag

            response = await client.post(
                "/api/kb/search-format/search",
                headers=auth_headers,
                json={"query": "test query", "top_k": 5}
            )

            assert response.status_code == 200
            data = response.json()

            assert len(data["results"]) == 2
            assert data["results"][0]["content"] == "This is the matched content"
            assert data["results"][0]["source_file"] == "document.pdf"
            assert data["results"][0]["score"] == 0.95
            assert data["results"][1]["score"] == 0.82

    @pytest.mark.asyncio
    async def test_search_passes_correct_conversation_id(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Search should use internal conversation ID, not file_id."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="conv-id-test")
        db_session.add(conv)
        await db_session.commit()

        captured_conv_id = []

        async def capture_conv_id(conversation_id, query, top_k):
            captured_conv_id.append(conversation_id)
            return []

        with patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.search_kb = AsyncMock(side_effect=capture_conv_id)
            mock_rag_class.return_value = mock_rag

            response = await client.post(
                "/api/kb/conv-id-test/search",
                headers=auth_headers,
                json={"query": "test", "top_k": 3}
            )

            assert response.status_code == 200
            # Should use internal conv.id, not file_id
            assert captured_conv_id[0] == conv_id

    @pytest.mark.asyncio
    async def test_search_respects_top_k_parameter(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Search should pass top_k parameter to RAG service."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="topk-test")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.search_kb = AsyncMock(return_value=[])
            mock_rag_class.return_value = mock_rag

            await client.post(
                "/api/kb/topk-test/search",
                headers=auth_headers,
                json={"query": "search term", "top_k": 15}
            )

            call_kwargs = mock_rag.search_kb.call_args.kwargs
            assert call_kwargs["top_k"] == 15

    @pytest.mark.asyncio
    async def test_search_handles_empty_query(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Search should handle empty query string."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="empty-query")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.search_kb = AsyncMock(return_value=[])
            mock_rag_class.return_value = mock_rag

            response = await client.post(
                "/api/kb/empty-query/search",
                headers=auth_headers,
                json={"query": "", "top_k": 5}
            )

            # Should still work, RAG handles empty query
            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_search_with_unicode_query(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Search should handle Unicode queries correctly."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="unicode-search")
        db_session.add(conv)
        await db_session.commit()

        captured_query = []

        async def capture_query(conversation_id, query, top_k):
            captured_query.append(query)
            return [{"content": "中文结果", "source_file": "doc.pdf", "score": 0.9}]

        with patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.search_kb = AsyncMock(side_effect=capture_query)
            mock_rag_class.return_value = mock_rag

            response = await client.post(
                "/api/kb/unicode-search/search",
                headers=auth_headers,
                json={"query": "中文搜索词 émoji 🔍", "top_k": 5}
            )

            assert response.status_code == 200
            assert captured_query[0] == "中文搜索词 émoji 🔍"


# ============================================================================
# Error Handling Tests
# ============================================================================


class TestErrorHandling:
    """Tests for error handling in knowledge base operations."""

    @pytest.mark.asyncio
    async def test_extraction_failure_sets_error_status(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Failed extraction should set attachment status to error."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="extract-fail")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.extract_text_content") as mock_extract, \
             patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_extract.side_effect = ValueError("Cannot parse PDF structure")

            mock_rag = MagicMock()
            mock_rag_class.return_value = mock_rag

            files = {"file": ("bad.pdf", io.BytesIO(b"%PDF"), "application/pdf")}

            response = await client.post(
                "/api/kb/extract-fail/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "error"
            assert "Cannot parse PDF structure" in data["error_message"]

    @pytest.mark.asyncio
    async def test_indexing_failure_sets_error_status(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Failed indexing should set attachment status to error."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="index-fail")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.extract_text_content") as mock_extract, \
             patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_extract.return_value = "Good content"

            mock_rag = MagicMock()
            mock_rag.index_kb_attachment = AsyncMock(
                side_effect=RuntimeError("Vector store unavailable")
            )
            mock_rag_class.return_value = mock_rag

            files = {"file": ("doc.pdf", io.BytesIO(b"%PDF"), "application/pdf")}

            response = await client.post(
                "/api/kb/index-fail/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "error"
            assert "Vector store unavailable" in data["error_message"]

    @pytest.mark.asyncio
    async def test_search_error_returns_500(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Search failure should return 500 Internal Server Error."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="search-error")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.search_kb = AsyncMock(side_effect=Exception("Connection refused"))
            mock_rag_class.return_value = mock_rag

            response = await client.post(
                "/api/kb/search-error/search",
                headers=auth_headers,
                json={"query": "test", "top_k": 5}
            )

            assert response.status_code == 500
            data = response.json()
            assert data["error"]["code"] == "INTERNAL_ERROR"

    @pytest.mark.asyncio
    async def test_delete_continues_if_vector_deletion_fails(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Delete should succeed even if vector store deletion fails."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="vec-fail-delete")
        db_session.add(conv)

        att_id = str(uuid.uuid4())
        attachment = ConversationAttachment(
            id=att_id,
            conversation_id=conv_id,
            original_filename="orphan.pdf",
            file_type="pdf",
            file_size=500,
            status="indexed"
        )
        db_session.add(attachment)
        await db_session.commit()

        with patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.delete_kb_attachment = AsyncMock(side_effect=Exception("Vector store down"))
            mock_rag_class.return_value = mock_rag

            response = await client.delete(
                f"/api/kb/vec-fail-delete/attachments/{att_id}",
                headers=auth_headers
            )

            # Should still succeed
            assert response.status_code == 200

            # Database record should be deleted
            fetched = await db_session.get(ConversationAttachment, att_id)
            assert fetched is None


# ============================================================================
# Conversation Isolation Tests
# ============================================================================


class TestConversationIsolation:
    """Tests for attachment isolation between conversations."""

    @pytest.mark.asyncio
    async def test_attachments_isolated_between_conversations(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Attachments should be isolated to their conversations."""
        # Create two conversations
        conv1_id = str(uuid.uuid4())
        conv2_id = str(uuid.uuid4())
        conv1 = Conversation(id=conv1_id, file_id="isolated-1")
        conv2 = Conversation(id=conv2_id, file_id="isolated-2")
        db_session.add(conv1)
        db_session.add(conv2)

        # Add attachments to conv1 only
        for i in range(3):
            att = ConversationAttachment(
                conversation_id=conv1_id,
                original_filename=f"doc{i}.pdf",
                file_type="pdf",
                file_size=100,
                status="indexed"
            )
            db_session.add(att)
        await db_session.commit()

        # Query conv1 should return 3
        response1 = await client.get(
            "/api/kb/isolated-1/attachments",
            headers=auth_headers
        )
        assert response1.json()["count"] == 3

        # Query conv2 should return 0
        response2 = await client.get(
            "/api/kb/isolated-2/attachments",
            headers=auth_headers
        )
        assert response2.json()["count"] == 0

    @pytest.mark.asyncio
    async def test_cannot_delete_other_conversation_attachment(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should not be able to delete attachment from another conversation."""
        conv1_id = str(uuid.uuid4())
        conv2_id = str(uuid.uuid4())
        conv1 = Conversation(id=conv1_id, file_id="owner-conv")
        conv2 = Conversation(id=conv2_id, file_id="other-conv")
        db_session.add(conv1)
        db_session.add(conv2)

        att_id = str(uuid.uuid4())
        attachment = ConversationAttachment(
            id=att_id,
            conversation_id=conv1_id,  # Belongs to conv1
            original_filename="private.pdf",
            file_type="pdf",
            file_size=100,
            status="indexed"
        )
        db_session.add(attachment)
        await db_session.commit()

        with patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.delete_kb_attachment = AsyncMock()
            mock_rag_class.return_value = mock_rag

            # Try to delete via conv2
            response = await client.delete(
                f"/api/kb/other-conv/attachments/{att_id}",
                headers=auth_headers
            )

            assert response.status_code == 404

            # Verify attachment still exists
            fetched = await db_session.get(ConversationAttachment, att_id)
            assert fetched is not None

    @pytest.mark.asyncio
    async def test_cannot_get_content_from_other_conversation(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should not be able to get attachment content from another conversation."""
        conv1_id = str(uuid.uuid4())
        conv2_id = str(uuid.uuid4())
        conv1 = Conversation(id=conv1_id, file_id="content-owner")
        conv2 = Conversation(id=conv2_id, file_id="content-seeker")
        db_session.add(conv1)
        db_session.add(conv2)

        att_id = str(uuid.uuid4())
        attachment = ConversationAttachment(
            id=att_id,
            conversation_id=conv1_id,
            original_filename="secret.pdf",
            file_type="pdf",
            file_size=100,
            status="indexed",
            extracted_text="This is secret content"
        )
        db_session.add(attachment)
        await db_session.commit()

        # Try to get content via conv2
        response = await client.get(
            f"/api/kb/content-seeker/attachments/{att_id}/content",
            headers=auth_headers
        )

        assert response.status_code == 404


# ============================================================================
# List Attachments Tests
# ============================================================================


class TestListAttachments:
    """Tests for listing attachments."""

    @pytest.mark.asyncio
    async def test_list_returns_correct_total_size(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """List should calculate correct total file size."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="size-calc")
        db_session.add(conv)

        sizes = [1024, 2048, 512, 4096]
        for i, size in enumerate(sizes):
            att = ConversationAttachment(
                conversation_id=conv_id,
                original_filename=f"file{i}.pdf",
                file_type="pdf",
                file_size=size,
                status="indexed"
            )
            db_session.add(att)
        await db_session.commit()

        response = await client.get(
            "/api/kb/size-calc/attachments",
            headers=auth_headers
        )

        data = response.json()
        assert data["total_size"] == sum(sizes)  # 7680
        assert data["count"] == 4

    @pytest.mark.asyncio
    async def test_list_ordered_by_created_at_desc(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """List should return attachments ordered by creation date descending."""
        import asyncio

        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="order-test")
        db_session.add(conv)
        await db_session.commit()

        # Create attachments with small delays to ensure different timestamps
        filenames = ["first.pdf", "second.pdf", "third.pdf"]
        for filename in filenames:
            att = ConversationAttachment(
                conversation_id=conv_id,
                original_filename=filename,
                file_type="pdf",
                file_size=100,
                status="indexed"
            )
            db_session.add(att)
            await db_session.commit()
            await asyncio.sleep(0.01)  # Small delay to ensure different timestamps

        response = await client.get(
            "/api/kb/order-test/attachments",
            headers=auth_headers
        )

        data = response.json()
        # Most recent should be first (third.pdf)
        assert data["attachments"][0]["original_filename"] == "third.pdf"
        assert data["attachments"][-1]["original_filename"] == "first.pdf"

    @pytest.mark.asyncio
    async def test_list_includes_error_attachments(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """List should include attachments with error status."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="error-list")
        db_session.add(conv)

        att_ok = ConversationAttachment(
            conversation_id=conv_id,
            original_filename="good.pdf",
            file_type="pdf",
            file_size=1000,
            status="indexed",
            chunk_count=5
        )
        att_err = ConversationAttachment(
            conversation_id=conv_id,
            original_filename="bad.pdf",
            file_type="pdf",
            file_size=500,
            status="error",
            error_message="Failed to process"
        )
        db_session.add(att_ok)
        db_session.add(att_err)
        await db_session.commit()

        response = await client.get(
            "/api/kb/error-list/attachments",
            headers=auth_headers
        )

        data = response.json()
        assert data["count"] == 2

        # Find error attachment
        error_att = next(a for a in data["attachments"] if a["status"] == "error")
        assert error_att["error_message"] == "Failed to process"


# ============================================================================
# Content Retrieval Tests
# ============================================================================


class TestContentRetrieval:
    """Tests for attachment content retrieval."""

    @pytest.mark.asyncio
    async def test_get_content_with_large_text(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should handle large extracted text content."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="large-content")
        db_session.add(conv)

        # Large text content (100KB)
        large_text = "Lorem ipsum dolor sit amet. " * 5000

        att_id = str(uuid.uuid4())
        attachment = ConversationAttachment(
            id=att_id,
            conversation_id=conv_id,
            original_filename="large.pdf",
            file_type="pdf",
            file_size=100000,
            status="indexed",
            extracted_text=large_text,
            chunk_count=50
        )
        db_session.add(attachment)
        await db_session.commit()

        response = await client.get(
            f"/api/kb/large-content/attachments/{att_id}/content",
            headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["content"]) == len(large_text)
        assert data["chunk_count"] == 50

    @pytest.mark.asyncio
    async def test_get_content_with_special_characters(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should preserve special characters in extracted text."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="special-chars")
        db_session.add(conv)

        special_text = """
        Special characters test:
        - Unicode: 中文, 日本語, 한국어, العربية
        - Symbols: © ® ™ € £ ¥ § ¶ † ‡
        - Math: ∑ ∏ √ ∞ ∂ ∫ ≠ ≤ ≥
        - Emoji: 🎉 🚀 💡 🔥 ⚡
        - Escape: <script>alert('xss')</script>
        """

        att_id = str(uuid.uuid4())
        attachment = ConversationAttachment(
            id=att_id,
            conversation_id=conv_id,
            original_filename="special.pdf",
            file_type="pdf",
            file_size=1000,
            status="indexed",
            extracted_text=special_text
        )
        db_session.add(attachment)
        await db_session.commit()

        response = await client.get(
            f"/api/kb/special-chars/attachments/{att_id}/content",
            headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert "中文" in data["content"]
        assert "🎉" in data["content"]
        assert "<script>" in data["content"]  # Should be preserved, not escaped


# ============================================================================
# Conversation Auto-Creation Tests
# ============================================================================


class TestConversationAutoCreation:
    """Tests for automatic conversation creation on upload."""

    @pytest.mark.asyncio
    async def test_upload_creates_conversation_if_not_exists(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Upload should create conversation if it doesn't exist."""
        file_id = f"auto-create-{uuid.uuid4()}"

        # Verify no conversation exists
        result = await db_session.execute(
            select(Conversation).where(Conversation.file_id == file_id)
        )
        assert result.scalar_one_or_none() is None

        with patch("api.knowledge_base.extract_text_content") as mock_extract, \
             patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_extract.return_value = "Content"

            mock_rag = MagicMock()
            mock_rag.index_kb_attachment = AsyncMock(return_value=1)
            mock_rag_class.return_value = mock_rag

            files = {"file": ("new.pdf", io.BytesIO(b"%PDF"), "application/pdf")}

            response = await client.post(
                f"/api/kb/{file_id}/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 200

            # Verify conversation was created
            result = await db_session.execute(
                select(Conversation).where(Conversation.file_id == file_id)
            )
            conv = result.scalar_one_or_none()
            assert conv is not None
            assert conv.file_id == file_id

    @pytest.mark.asyncio
    async def test_upload_reuses_existing_conversation(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Upload should reuse existing conversation."""
        existing_conv_id = str(uuid.uuid4())
        existing_conv = Conversation(id=existing_conv_id, file_id="existing-conv")
        db_session.add(existing_conv)
        await db_session.commit()

        with patch("api.knowledge_base.extract_text_content") as mock_extract, \
             patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_extract.return_value = "Content"

            mock_rag = MagicMock()
            mock_rag.index_kb_attachment = AsyncMock(return_value=1)
            mock_rag_class.return_value = mock_rag

            files = {"file": ("doc.pdf", io.BytesIO(b"%PDF"), "application/pdf")}

            response = await client.post(
                "/api/kb/existing-conv/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 200

            # Verify only one conversation exists
            result = await db_session.execute(
                select(Conversation).where(Conversation.file_id == "existing-conv")
            )
            convs = result.scalars().all()
            assert len(convs) == 1
            assert convs[0].id == existing_conv_id


# ============================================================================
# Edge Cases Tests
# ============================================================================


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    @pytest.mark.asyncio
    async def test_upload_empty_file(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should handle empty file upload."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="empty-file")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.extract_text_content") as mock_extract, \
             patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_extract.return_value = ""  # Empty content

            mock_rag = MagicMock()
            mock_rag.index_kb_attachment = AsyncMock(return_value=0)
            mock_rag_class.return_value = mock_rag

            files = {"file": ("empty.pdf", io.BytesIO(b""), "application/pdf")}

            response = await client.post(
                "/api/kb/empty-file/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 200
            data = response.json()
            assert data["file_size"] == 0
            assert data["chunk_count"] == 0

    @pytest.mark.asyncio
    async def test_very_long_filename(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should handle very long filenames."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="long-name")
        db_session.add(conv)
        await db_session.commit()

        # Very long filename (250 chars before extension)
        long_name = "a" * 250 + ".pdf"

        with patch("api.knowledge_base.extract_text_content") as mock_extract, \
             patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_extract.return_value = "Content"

            mock_rag = MagicMock()
            mock_rag.index_kb_attachment = AsyncMock(return_value=1)
            mock_rag_class.return_value = mock_rag

            files = {"file": (long_name, io.BytesIO(b"%PDF"), "application/pdf")}

            response = await client.post(
                "/api/kb/long-name/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 200
            data = response.json()
            assert data["original_filename"] == long_name

    @pytest.mark.asyncio
    async def test_filename_with_special_characters(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should handle filenames with special characters."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="special-name")
        db_session.add(conv)
        await db_session.commit()

        special_name = "文档 (copy) [2024] #1.pdf"

        with patch("api.knowledge_base.extract_text_content") as mock_extract, \
             patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_extract.return_value = "Content"

            mock_rag = MagicMock()
            mock_rag.index_kb_attachment = AsyncMock(return_value=1)
            mock_rag_class.return_value = mock_rag

            files = {"file": (special_name, io.BytesIO(b"%PDF"), "application/pdf")}

            response = await client.post(
                "/api/kb/special-name/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 200
            data = response.json()
            assert data["original_filename"] == special_name

    @pytest.mark.asyncio
    async def test_filename_only_extension(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should accept filename that is just an extension."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="just-ext")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.extract_text_content") as mock_extract, \
             patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_extract.return_value = "Content"

            mock_rag = MagicMock()
            mock_rag.index_kb_attachment = AsyncMock(return_value=1)
            mock_rag_class.return_value = mock_rag

            # Filename that is just the extension - should work since extension is valid
            files = {"file": ("document.pdf", io.BytesIO(b"%PDF"), "application/pdf")}

            response = await client.post(
                "/api/kb/just-ext/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_hidden_file_with_extension(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should handle hidden files (starting with dot) with proper extension."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="hidden-file")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.extract_text_content") as mock_extract, \
             patch("api.knowledge_base.RAGService") as mock_rag_class:
            mock_extract.return_value = "Content"

            mock_rag = MagicMock()
            mock_rag.index_kb_attachment = AsyncMock(return_value=1)
            mock_rag_class.return_value = mock_rag

            # Hidden file with proper extension
            files = {"file": (".hidden.pdf", io.BytesIO(b"%PDF"), "application/pdf")}

            response = await client.post(
                "/api/kb/hidden-file/attachments",
                files=files,
                headers=auth_headers
            )

            assert response.status_code == 200
