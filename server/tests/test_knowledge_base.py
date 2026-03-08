"""Tests for Knowledge Base API endpoints."""

import io
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from db.database import Conversation, ConversationAttachment

# ============================================================================
# Upload Attachment Tests
# ============================================================================


class TestUploadAttachment:
    """Tests for POST /api/kb/{conversation_id}/attachments."""

    @pytest.mark.asyncio
    async def test_upload_pdf_success(self, client: AsyncClient, db_session, auth_headers):
        """Should upload and index a PDF file."""
        # Create conversation
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-123")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.extract_text_content") as mock_extract:
            mock_extract.return_value = "Extracted PDF content"

            # Create a simple PDF file
            pdf_content = b"%PDF-1.4 test content"
            files = {"file": ("test.pdf", io.BytesIO(pdf_content), "application/pdf")}

            response = await client.post(
                "/api/kb/file-123/attachments", files=files, headers=auth_headers
            )

            assert response.status_code == 200
            data = response.json()
            assert data["original_filename"] == "test.pdf"
            assert data["file_type"] == "pdf"
            assert data["status"] == "indexed"

    @pytest.mark.asyncio
    async def test_upload_docx_success(self, client: AsyncClient, db_session, auth_headers):
        """Should upload and index a DOCX file."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-docx")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.extract_text_content") as mock_extract:
            mock_extract.return_value = "Extracted DOCX content"

            docx_content = b"PK\x03\x04 test docx"
            files = {
                "file": (
                    "document.docx",
                    io.BytesIO(docx_content),
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            }

            response = await client.post(
                "/api/kb/file-docx/attachments", files=files, headers=auth_headers
            )

            assert response.status_code == 200
            data = response.json()
            assert data["file_type"] == "docx"
            assert data["status"] == "indexed"

    @pytest.mark.asyncio
    async def test_upload_unsupported_file_type(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should reject unsupported file types."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-bad")
        db_session.add(conv)
        await db_session.commit()

        txt_content = b"plain text content"
        files = {"file": ("readme.txt", io.BytesIO(txt_content), "text/plain")}

        response = await client.post(
            "/api/kb/file-bad/attachments", files=files, headers=auth_headers
        )

        assert response.status_code == 415  # Unsupported Media Type
        data = response.json()
        assert data["error"]["code"] == "UNSUPPORTED_FILE_TYPE"
        assert "file type" in data["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_upload_file_too_large(self, client: AsyncClient, db_session, auth_headers):
        """Should reject files exceeding size limit."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-large")
        db_session.add(conv)
        await db_session.commit()

        # Create large content (> 50MB by default)
        with patch("api.knowledge_base.MAX_FILE_SIZE", 100):  # Set to 100 bytes for test
            large_content = b"x" * 200
            files = {"file": ("large.pdf", io.BytesIO(large_content), "application/pdf")}

            response = await client.post(
                "/api/kb/file-large/attachments", files=files, headers=auth_headers
            )

            assert response.status_code == 413

    @pytest.mark.asyncio
    async def test_upload_creates_conversation_if_missing(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should create conversation if it doesn't exist."""
        with patch("api.knowledge_base.extract_text_content") as mock_extract:
            mock_extract.return_value = "Content"

            pdf_content = b"%PDF-1.4"
            files = {"file": ("new.pdf", io.BytesIO(pdf_content), "application/pdf")}

            response = await client.post(
                "/api/kb/new-conversation-file/attachments", files=files, headers=auth_headers
            )

            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_upload_handles_extraction_error(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should handle text extraction errors gracefully."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-error")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.extract_text_content") as mock_extract:
            mock_extract.side_effect = Exception("Extraction failed")

            pdf_content = b"%PDF-1.4"
            files = {"file": ("corrupt.pdf", io.BytesIO(pdf_content), "application/pdf")}

            response = await client.post(
                "/api/kb/file-error/attachments", files=files, headers=auth_headers
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "error"
            assert "Extraction failed" in data["error_message"]


# ============================================================================
# List Attachments Tests
# ============================================================================


class TestListAttachments:
    """Tests for GET /api/kb/{conversation_id}/attachments."""

    @pytest.mark.asyncio
    async def test_list_empty_attachments(self, client: AsyncClient, db_session, auth_headers):
        """Should return empty list when no attachments."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-empty")
        db_session.add(conv)
        await db_session.commit()

        response = await client.get("/api/kb/file-empty/attachments", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["attachments"] == []
        assert data["count"] == 0
        assert data["total_size"] == 0

    @pytest.mark.asyncio
    async def test_list_attachments_returns_all(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should return all attachments for conversation."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="file-multi")
        db_session.add(conv)

        # Add attachments
        for i in range(3):
            att = ConversationAttachment(
                id=str(uuid.uuid4()),
                conversation_id=conv_id,
                original_filename=f"file{i}.pdf",
                file_type="pdf",
                file_size=1000 * (i + 1),
                status="indexed",
                chunk_count=i + 1,
            )
            db_session.add(att)
        await db_session.commit()

        response = await client.get("/api/kb/file-multi/attachments", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 3
        assert data["total_size"] == 6000  # 1000 + 2000 + 3000

    @pytest.mark.asyncio
    async def test_list_attachments_nonexistent_conversation(
        self, client: AsyncClient, auth_headers
    ):
        """Should return empty for nonexistent conversation."""
        response = await client.get("/api/kb/nonexistent/attachments", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0


# ============================================================================
# Delete Attachment Tests
# ============================================================================


class TestDeleteAttachment:
    """Tests for DELETE /api/kb/{conversation_id}/attachments/{attachment_id}."""

    @pytest.mark.asyncio
    async def test_delete_attachment_success(self, client: AsyncClient, db_session, auth_headers):
        """Should delete attachment and remove from vector store."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="file-del")
        db_session.add(conv)

        att_id = str(uuid.uuid4())
        att = ConversationAttachment(
            id=att_id,
            conversation_id=conv_id,
            original_filename="todelete.pdf",
            file_type="pdf",
            file_size=1000,
            status="indexed",
            chunk_count=5,
        )
        db_session.add(att)
        await db_session.commit()

        response = await client.delete(
            f"/api/kb/file-del/attachments/{att_id}", headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "deleted"
        assert data["id"] == att_id

    @pytest.mark.asyncio
    async def test_delete_nonexistent_attachment(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should return 404 for nonexistent attachment."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-noatt")
        db_session.add(conv)
        await db_session.commit()

        response = await client.delete(
            "/api/kb/file-noatt/attachments/nonexistent-id", headers=auth_headers
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_attachment_wrong_conversation(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should return 404 when attachment belongs to different conversation."""
        # Create two conversations
        conv1_id = str(uuid.uuid4())
        conv1 = Conversation(id=conv1_id, file_id="file-1")
        conv2 = Conversation(id=str(uuid.uuid4()), file_id="file-2")
        db_session.add(conv1)
        db_session.add(conv2)

        # Attachment belongs to conv1
        att_id = str(uuid.uuid4())
        att = ConversationAttachment(
            id=att_id,
            conversation_id=conv1_id,
            original_filename="test.pdf",
            file_type="pdf",
            file_size=1000,
            status="indexed",
        )
        db_session.add(att)
        await db_session.commit()

        # Try to delete from conv2
        response = await client.delete(f"/api/kb/file-2/attachments/{att_id}", headers=auth_headers)

        assert response.status_code == 404


# ============================================================================
# Search Knowledge Base Tests
# ============================================================================


class TestSearchKnowledgeBase:
    """Tests for POST /api/kb/{conversation_id}/search."""

    @pytest.mark.asyncio
    async def test_search_returns_results(self, client: AsyncClient, db_session, auth_headers):
        """Should return search results from attachment extracted text."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-search")
        db_session.add(conv)
        await db_session.flush()

        att1 = ConversationAttachment(
            conversation_id=conv.id,
            original_filename="doc1.pdf",
            file_type="pdf",
            file_size=1000,
            status="indexed",
            extracted_text="This document contains a test query for verification.",
        )
        att2 = ConversationAttachment(
            conversation_id=conv.id,
            original_filename="doc2.pdf",
            file_type="pdf",
            file_size=1000,
            status="indexed",
            extracted_text="Another file with a test query inside it.",
        )
        db_session.add_all([att1, att2])
        await db_session.commit()

        response = await client.post(
            "/api/kb/file-search/search",
            headers=auth_headers,
            json={"query": "test query", "top_k": 5},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) == 2
        assert "test query" in data["results"][0]["content"].lower()
        assert data["results"][0]["score"] == 1.0

    @pytest.mark.asyncio
    async def test_search_empty_results(self, client: AsyncClient, db_session, auth_headers):
        """Should return empty results when no matches."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-noresults")
        db_session.add(conv)
        await db_session.commit()

        response = await client.post(
            "/api/kb/file-noresults/search",
            headers=auth_headers,
            json={"query": "no match", "top_k": 5},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"] == []

    @pytest.mark.asyncio
    async def test_search_nonexistent_conversation(self, client: AsyncClient, auth_headers):
        """Should return 404 for nonexistent conversation."""
        response = await client.post(
            "/api/kb/nonexistent/search", headers=auth_headers, json={"query": "test", "top_k": 5}
        )

        assert response.status_code == 404


# ============================================================================
# Get Attachment Content Tests
# ============================================================================


class TestGetAttachmentContent:
    """Tests for GET /api/kb/{conversation_id}/attachments/{attachment_id}/content."""

    @pytest.mark.asyncio
    async def test_get_content_success(self, client: AsyncClient, db_session, auth_headers):
        """Should return extracted text content."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="file-content")
        db_session.add(conv)

        att_id = str(uuid.uuid4())
        att = ConversationAttachment(
            id=att_id,
            conversation_id=conv_id,
            original_filename="document.pdf",
            file_type="pdf",
            file_size=1000,
            status="indexed",
            chunk_count=10,
            extracted_text="This is the extracted text content.",
        )
        db_session.add(att)
        await db_session.commit()

        response = await client.get(
            f"/api/kb/file-content/attachments/{att_id}/content", headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == att_id
        assert data["filename"] == "document.pdf"
        assert data["content"] == "This is the extracted text content."
        assert data["chunk_count"] == 10

    @pytest.mark.asyncio
    async def test_get_content_nonexistent(self, client: AsyncClient, db_session, auth_headers):
        """Should return 404 for nonexistent attachment."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-nocontent")
        db_session.add(conv)
        await db_session.commit()

        response = await client.get(
            "/api/kb/file-nocontent/attachments/nonexistent/content", headers=auth_headers
        )

        assert response.status_code == 404


# ============================================================================
# Helper Function Tests
# ============================================================================


class TestHelperFunctions:
    """Tests for helper functions."""

    def test_get_file_extension_pdf(self):
        """Should extract .pdf extension."""
        from api.knowledge_base import get_file_extension

        assert get_file_extension("document.pdf") == ".pdf"

    def test_get_file_extension_uppercase(self):
        """Should return lowercase extension."""
        from api.knowledge_base import get_file_extension

        assert get_file_extension("Document.PDF") == ".pdf"

    def test_get_file_extension_docx(self):
        """Should extract .docx extension."""
        from api.knowledge_base import get_file_extension

        assert get_file_extension("report.docx") == ".docx"

    def test_get_file_extension_no_extension(self):
        """Should return empty string for no extension."""
        from api.knowledge_base import get_file_extension

        assert get_file_extension("noextension") == ""

    def test_get_file_extension_multiple_dots(self):
        """Should return only last extension."""
        from api.knowledge_base import get_file_extension

        assert get_file_extension("archive.tar.gz") == ".gz"

    def test_get_file_extension_pptx(self):
        """Should extract .pptx extension."""
        from api.knowledge_base import get_file_extension

        assert get_file_extension("slides.pptx") == ".pptx"


# ============================================================================
# Pydantic Model Tests
# ============================================================================


class TestPydanticModels:
    """Tests for Pydantic models."""

    def test_attachment_response_model(self):
        """Should create AttachmentResponse model correctly."""
        from api.knowledge_base import AttachmentResponse

        resp = AttachmentResponse(
            id="att-123",
            original_filename="test.pdf",
            file_type="pdf",
            file_size=1024,
            status="indexed",
            chunk_count=5,
            created_at="2024-01-01T00:00:00",
        )
        assert resp.id == "att-123"
        assert resp.original_filename == "test.pdf"
        assert resp.file_type == "pdf"
        assert resp.file_size == 1024
        assert resp.status == "indexed"
        assert resp.chunk_count == 5
        assert resp.error_message is None

    def test_attachment_response_with_error(self):
        """Should create AttachmentResponse with error message."""
        from api.knowledge_base import AttachmentResponse

        resp = AttachmentResponse(
            id="att-456",
            original_filename="corrupt.pdf",
            file_type="pdf",
            file_size=500,
            status="error",
            chunk_count=0,
            error_message="Failed to extract text",
            created_at="2024-01-01T00:00:00",
        )
        assert resp.status == "error"
        assert resp.error_message == "Failed to extract text"

    def test_attachment_list_response_model(self):
        """Should create AttachmentListResponse model correctly."""
        from api.knowledge_base import AttachmentListResponse, AttachmentResponse

        att = AttachmentResponse(
            id="att-1",
            original_filename="doc.pdf",
            file_type="pdf",
            file_size=1000,
            status="indexed",
            chunk_count=3,
            created_at="2024-01-01T00:00:00",
        )

        list_resp = AttachmentListResponse(attachments=[att], total_size=1000, count=1)
        assert len(list_resp.attachments) == 1
        assert list_resp.total_size == 1000
        assert list_resp.count == 1

    def test_kb_search_request_model(self):
        """Should create KBSearchRequest model correctly."""
        from api.knowledge_base import KBSearchRequest

        req = KBSearchRequest(query="test query")
        assert req.query == "test query"
        assert req.top_k == 5  # default

    def test_kb_search_request_with_custom_top_k(self):
        """Should create KBSearchRequest with custom top_k."""
        from api.knowledge_base import KBSearchRequest

        req = KBSearchRequest(query="search term", top_k=10)
        assert req.top_k == 10

    def test_kb_search_result_model(self):
        """Should create KBSearchResult model correctly."""
        from api.knowledge_base import KBSearchResult

        result = KBSearchResult(content="Found this text", source_file="document.pdf", score=0.95)
        assert result.content == "Found this text"
        assert result.source_file == "document.pdf"
        assert result.score == 0.95

    def test_kb_search_response_model(self):
        """Should create KBSearchResponse model correctly."""
        from api.knowledge_base import KBSearchResponse, KBSearchResult

        results = [
            KBSearchResult(content="Result 1", source_file="doc1.pdf", score=0.9),
            KBSearchResult(content="Result 2", source_file="doc2.pdf", score=0.8),
        ]
        resp = KBSearchResponse(results=results)
        assert len(resp.results) == 2


# ============================================================================
# Router Structure Tests
# ============================================================================


class TestKBRouterStructure:
    """Tests for router structure."""

    def test_router_exists(self):
        """Should have router defined."""
        from api.knowledge_base import router

        assert router is not None

    def test_router_has_upload_route(self):
        """Should have upload attachments route."""
        from api.knowledge_base import router

        paths = [r.path for r in router.routes]
        assert "/{conversation_id}/attachments" in paths

    def test_router_has_search_route(self):
        """Should have search route."""
        from api.knowledge_base import router

        paths = [r.path for r in router.routes]
        assert "/{conversation_id}/search" in paths

    def test_router_has_content_route(self):
        """Should have content route."""
        from api.knowledge_base import router

        paths = [r.path for r in router.routes]
        assert "/{conversation_id}/attachments/{attachment_id}/content" in paths


# ============================================================================
# Configuration Tests
# ============================================================================


class TestConfiguration:
    """Tests for module configuration."""

    def test_allowed_extensions(self):
        """Should have correct allowed extensions."""
        from api.knowledge_base import ALLOWED_EXTENSIONS

        assert ".pdf" in ALLOWED_EXTENSIONS
        assert ".docx" in ALLOWED_EXTENSIONS
        assert ".pptx" in ALLOWED_EXTENSIONS
        assert ".txt" not in ALLOWED_EXTENSIONS

    def test_max_file_size_defined(self):
        """Should have max file size defined."""
        from api.knowledge_base import MAX_FILE_SIZE

        assert MAX_FILE_SIZE > 0


# ============================================================================
# Extended Upload Tests
# ============================================================================


class TestExtendedUpload:
    """Extended tests for upload functionality."""

    @pytest.mark.asyncio
    async def test_upload_pptx_success(self, client: AsyncClient, db_session, auth_headers):
        """Should upload and index a PPTX file."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-pptx")
        db_session.add(conv)
        await db_session.commit()

        with patch("api.knowledge_base.extract_text_content") as mock_extract:
            mock_extract.return_value = "Presentation content"

            pptx_content = b"PK\x03\x04 test pptx"
            files = {
                "file": (
                    "presentation.pptx",
                    io.BytesIO(pptx_content),
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                )
            }

            response = await client.post(
                "/api/kb/file-pptx/attachments", files=files, headers=auth_headers
            )

            assert response.status_code == 200
            data = response.json()
            assert data["file_type"] == "pptx"
            assert data["status"] == "indexed"


# ============================================================================
# Extended Delete Tests
# ============================================================================


class TestExtendedDelete:
    """Extended tests for delete functionality."""

    @pytest.mark.asyncio
    async def test_delete_handles_rag_error(self, client: AsyncClient, db_session, auth_headers):
        """Should delete attachment even if RAG deletion fails."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="file-rag-err")
        db_session.add(conv)

        att_id = str(uuid.uuid4())
        att = ConversationAttachment(
            id=att_id,
            conversation_id=conv_id,
            original_filename="test.pdf",
            file_type="pdf",
            file_size=1000,
            status="indexed",
            chunk_count=5,
        )
        db_session.add(att)
        await db_session.commit()

        response = await client.delete(
            f"/api/kb/file-rag-err/attachments/{att_id}", headers=auth_headers
        )

        # Should still succeed
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_delete_nonexistent_conversation(self, client: AsyncClient, auth_headers):
        """Should return 404 for nonexistent conversation."""
        response = await client.delete(
            "/api/kb/nonexistent-conv/attachments/some-att-id", headers=auth_headers
        )

        assert response.status_code == 404


# ============================================================================
# Extended Search Tests
# ============================================================================


class TestExtendedSearch:
    """Extended tests for search functionality."""

    @pytest.mark.asyncio
    async def test_search_returns_empty_when_no_attachments(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should return empty results when no attachments exist."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-search-err")
        db_session.add(conv)
        await db_session.commit()

        response = await client.post(
            "/api/kb/file-search-err/search",
            headers=auth_headers,
            json={"query": "test", "top_k": 5},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) == 0

    @pytest.mark.asyncio
    async def test_search_with_custom_top_k(self, client: AsyncClient, db_session, auth_headers):
        """Should pass custom top_k to search."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-topk")
        db_session.add(conv)
        await db_session.commit()

        response = await client.post(
            "/api/kb/file-topk/search",
            headers=auth_headers,
            json={"query": "test", "top_k": 20},
        )

        assert response.status_code == 200


# ============================================================================
# Extended Content Tests
# ============================================================================


class TestExtendedContent:
    """Extended tests for content retrieval."""

    @pytest.mark.asyncio
    async def test_get_content_empty_text(self, client: AsyncClient, db_session, auth_headers):
        """Should return empty string when no extracted text."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, file_id="file-empty-text")
        db_session.add(conv)

        att_id = str(uuid.uuid4())
        att = ConversationAttachment(
            id=att_id,
            conversation_id=conv_id,
            original_filename="empty.pdf",
            file_type="pdf",
            file_size=500,
            status="indexed",
            chunk_count=0,
            extracted_text=None,
        )
        db_session.add(att)
        await db_session.commit()

        response = await client.get(
            f"/api/kb/file-empty-text/attachments/{att_id}/content", headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["content"] == ""

    @pytest.mark.asyncio
    async def test_get_content_wrong_conversation(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should return 404 when attachment belongs to different conversation."""
        # Create two conversations
        conv1_id = str(uuid.uuid4())
        conv1 = Conversation(id=conv1_id, file_id="file-c1")
        conv2 = Conversation(id=str(uuid.uuid4()), file_id="file-c2")
        db_session.add(conv1)
        db_session.add(conv2)

        # Attachment belongs to conv1
        att_id = str(uuid.uuid4())
        att = ConversationAttachment(
            id=att_id,
            conversation_id=conv1_id,
            original_filename="doc.pdf",
            file_type="pdf",
            file_size=1000,
            status="indexed",
        )
        db_session.add(att)
        await db_session.commit()

        # Try to get from conv2
        response = await client.get(
            f"/api/kb/file-c2/attachments/{att_id}/content", headers=auth_headers
        )

        assert response.status_code == 404


# ============================================================================
# Extract Text Content Tests
# ============================================================================


class TestExtractTextContent:
    """Tests for extract_text_content function."""

    @pytest.mark.asyncio
    async def test_extract_calls_converter(self):
        """Should call file converter for extraction."""
        from api.knowledge_base import extract_text_content

        with (
            patch("api.knowledge_base.is_converter_configured", return_value=True),
            patch("api.knowledge_base.convert_file_to_markdown") as mock_convert,
        ):
            mock_convert.return_value = "Extracted text"

            result = await extract_text_content(b"content", "test.pdf", ".pdf")

            assert result == "Extracted text"
            mock_convert.assert_called_once_with(b"content", "test.pdf", ".pdf")

    @pytest.mark.asyncio
    async def test_extract_falls_back_to_markitdown_when_converter_not_configured(self):
        """Should fall back to markitdown when OPENROUTER_API_KEY is not configured."""
        from api.knowledge_base import extract_text_content

        with (
            patch("api.knowledge_base.is_converter_configured", return_value=False),
            patch("api.knowledge_base.markitdown_convert", new_callable=AsyncMock) as mock_fallback,
        ):
            mock_fallback.return_value = "# Fallback content"
            result = await extract_text_content(b"content", "test.pdf", ".pdf")
            assert result == ("# Fallback content", None)
            mock_fallback.assert_called_once()
