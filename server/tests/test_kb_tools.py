"""Tests for Knowledge Base Tools.

Tests the KB tool executors:
- list_kb_documents
- search_knowledge_base
- read_kb_document
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.tools.kb_tools import (
    KB_TOOL_NAMES,
    execute_kb_tool,
    execute_list_kb_documents,
    execute_read_kb_document,
    execute_search_knowledge_base,
    is_kb_tool,
)

# ============================================================================
# is_kb_tool Tests
# ============================================================================


class TestIsKBTool:
    """Tests for is_kb_tool function."""

    def test_returns_true_for_kb_tools(self):
        """Should return True for all KB tools."""
        for tool in KB_TOOL_NAMES:
            assert is_kb_tool(tool) is True

    def test_returns_false_for_non_kb_tools(self):
        """Should return False for non-KB tools."""
        non_kb_tools = [
            "view_document",
            "str_replace_editor",
            "insert_text",
            "unknown_tool",
            "",
        ]
        for tool in non_kb_tools:
            assert is_kb_tool(tool) is False


# ============================================================================
# execute_list_kb_documents Tests
# ============================================================================


class TestListKBDocuments:
    """Tests for list_kb_documents tool."""

    @pytest.mark.asyncio
    async def test_returns_no_documents_message(self):
        """Should return message when no documents."""
        kb_context = {"attachments": []}

        result = await execute_list_kb_documents({}, kb_context)

        assert "No documents" in result["result"]

    @pytest.mark.asyncio
    async def test_lists_all_documents(self):
        """Should list all documents with details."""
        kb_context = {
            "attachments": [
                {"filename": "doc1.pdf", "file_type": "pdf", "chunk_count": 5},
                {"filename": "doc2.docx", "file_type": "docx", "chunk_count": 10},
            ]
        }

        result = await execute_list_kb_documents({}, kb_context)

        assert "doc1.pdf" in result["result"]
        assert "PDF" in result["result"]
        assert "5 sections" in result["result"]
        assert "doc2.docx" in result["result"]
        assert "DOCX" in result["result"]
        assert "10 sections" in result["result"]


# ============================================================================
# execute_search_knowledge_base Tests
# ============================================================================


class TestSearchKnowledgeBase:
    """Tests for search_knowledge_base tool."""

    @pytest.mark.asyncio
    async def test_requires_query(self):
        """Should return error when query is missing."""
        kb_context = {"conversation_id": "conv-1"}

        result = await execute_search_knowledge_base({}, kb_context)

        assert "error" in result
        assert "query" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_requires_query_not_empty(self):
        """Should return error when query is empty."""
        kb_context = {"conversation_id": "conv-1"}

        result = await execute_search_knowledge_base({"query": ""}, kb_context)

        assert "error" in result

    @pytest.mark.asyncio
    @patch("services.rag_service.RAGService")
    async def test_returns_formatted_results(self, mock_rag_class):
        """Should return formatted search results."""
        mock_rag = MagicMock()
        mock_rag.search_kb = AsyncMock(
            return_value=[
                {"content": "Result 1 content", "source_file": "doc1.pdf", "score": 0.95},
                {"content": "Result 2 content", "source_file": "doc2.pdf", "score": 0.85},
            ]
        )
        mock_rag_class.return_value = mock_rag

        mock_db = MagicMock()  # Mock database session
        kb_context = {"conversation_id": "conv-1", "db": mock_db}

        result = await execute_search_knowledge_base(
            {"query": "test query", "top_k": 5}, kb_context
        )

        assert "result" in result
        assert "Result 1" in result["result"]
        assert "doc1.pdf" in result["result"]
        assert "0.95" in result["result"]
        assert "Result 2" in result["result"]

    @pytest.mark.asyncio
    @patch("services.rag_service.RAGService")
    async def test_returns_no_results_message(self, mock_rag_class):
        """Should return message when no results found."""
        mock_rag = MagicMock()
        mock_rag.search_kb = AsyncMock(return_value=[])
        mock_rag_class.return_value = mock_rag

        mock_db = MagicMock()  # Mock database session
        kb_context = {"conversation_id": "conv-1", "db": mock_db}

        result = await execute_search_knowledge_base({"query": "nonexistent"}, kb_context)

        assert "result" in result
        assert "No relevant results" in result["result"]

    @pytest.mark.asyncio
    @patch("services.rag_service.RAGService")
    async def test_limits_top_k_to_max(self, mock_rag_class):
        """Should limit top_k to maximum of 10."""
        mock_rag = MagicMock()
        mock_rag.search_kb = AsyncMock(return_value=[])
        mock_rag_class.return_value = mock_rag

        mock_db = MagicMock()  # Mock database session
        kb_context = {"conversation_id": "conv-1", "db": mock_db}

        await execute_search_knowledge_base(
            {"query": "test", "top_k": 100},  # Request 100, should be limited to 10
            kb_context,
        )

        mock_rag.search_kb.assert_called_once_with("conv-1", "test", 10)

    @pytest.mark.asyncio
    @patch("services.rag_service.RAGService")
    async def test_handles_search_error(self, mock_rag_class):
        """Should return error when search fails."""
        mock_rag = MagicMock()
        mock_rag.search_kb = AsyncMock(side_effect=Exception("Search error"))
        mock_rag_class.return_value = mock_rag

        mock_db = MagicMock()  # Mock database session
        kb_context = {"conversation_id": "conv-1", "db": mock_db}

        result = await execute_search_knowledge_base({"query": "test"}, kb_context)

        assert "error" in result
        assert "Search failed" in result["error"]


# ============================================================================
# execute_read_kb_document Tests
# ============================================================================


class TestReadKBDocument:
    """Tests for read_kb_document tool."""

    @pytest.mark.asyncio
    async def test_requires_document_name(self):
        """Should return error when document name is missing."""
        kb_context = {"attachments": []}

        result = await execute_read_kb_document({}, kb_context)

        assert "error" in result
        assert "Document name" in result["error"]

    @pytest.mark.asyncio
    async def test_document_not_found(self):
        """Should return error when document not found."""
        kb_context = {
            "attachments": [
                {"filename": "doc1.pdf", "id": "att-1"},
            ]
        }

        result = await execute_read_kb_document({"document_name": "nonexistent.pdf"}, kb_context)

        assert "error" in result
        assert "not found" in result["error"]
        assert "doc1.pdf" in result["error"]  # Should list available docs

    @pytest.mark.asyncio
    async def test_finds_document_by_exact_name(self):
        """Should find document by exact name match."""
        mock_db = MagicMock()  # Mock database session
        kb_context = {
            "attachments": [
                {"filename": "doc1.pdf", "id": "att-1"},
                {"filename": "doc2.pdf", "id": "att-2"},
            ],
            "db": mock_db,
        }

        with patch("services.rag_service.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.get_kb_document_content = AsyncMock(
                return_value={
                    "content": "Document content",
                    "filename": "doc1.pdf",
                    "total_chunks": 5,
                    "chunks_returned": 3,
                }
            )
            mock_rag_class.return_value = mock_rag

            result = await execute_read_kb_document({"document_name": "doc1.pdf"}, kb_context)

            assert "result" in result
            mock_rag.get_kb_document_content.assert_called_once_with("att-1", 0, 5)

    @pytest.mark.asyncio
    async def test_finds_document_by_partial_name(self):
        """Should find document by partial name match."""
        mock_db = MagicMock()  # Mock database session
        kb_context = {
            "attachments": [
                {"filename": "my_document_2024.pdf", "id": "att-1"},
            ],
            "db": mock_db,
        }

        with patch("services.rag_service.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.get_kb_document_content = AsyncMock(
                return_value={
                    "content": "Content",
                    "filename": "my_document_2024.pdf",
                    "total_chunks": 3,
                    "chunks_returned": 3,
                }
            )
            mock_rag_class.return_value = mock_rag

            result = await execute_read_kb_document(
                {"document_name": "document"},  # Partial match
                kb_context,
            )

            assert "result" in result

    @pytest.mark.asyncio
    async def test_case_insensitive_match(self):
        """Should match document name case-insensitively."""
        mock_db = MagicMock()  # Mock database session
        kb_context = {
            "attachments": [
                {"filename": "MyDocument.PDF", "id": "att-1"},
            ],
            "db": mock_db,
        }

        with patch("services.rag_service.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.get_kb_document_content = AsyncMock(
                return_value={
                    "content": "Content",
                    "filename": "MyDocument.PDF",
                    "total_chunks": 2,
                    "chunks_returned": 2,
                }
            )
            mock_rag_class.return_value = mock_rag

            result = await execute_read_kb_document(
                {"document_name": "mydocument.pdf"},  # Different case
                kb_context,
            )

            assert "result" in result

    @pytest.mark.asyncio
    async def test_respects_start_section(self):
        """Should use start_section parameter."""
        mock_db = MagicMock()  # Mock database session
        kb_context = {
            "attachments": [
                {"filename": "doc.pdf", "id": "att-1"},
            ],
            "db": mock_db,
        }

        with patch("services.rag_service.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.get_kb_document_content = AsyncMock(
                return_value={
                    "content": "Content",
                    "filename": "doc.pdf",
                    "total_chunks": 10,
                    "chunks_returned": 3,
                }
            )
            mock_rag_class.return_value = mock_rag

            await execute_read_kb_document(
                {"document_name": "doc.pdf", "start_section": 5, "num_sections": 3}, kb_context
            )

            mock_rag.get_kb_document_content.assert_called_once_with("att-1", 5, 8)

    @pytest.mark.asyncio
    async def test_returns_no_content_message(self):
        """Should return message when document is empty."""
        mock_db = MagicMock()  # Mock database session
        kb_context = {
            "attachments": [
                {"filename": "empty.pdf", "id": "att-1"},
            ],
            "db": mock_db,
        }

        with patch("services.rag_service.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.get_kb_document_content = AsyncMock(
                return_value={
                    "content": "",
                    "filename": "empty.pdf",
                    "total_chunks": 0,
                    "chunks_returned": 0,
                }
            )
            mock_rag_class.return_value = mock_rag

            result = await execute_read_kb_document({"document_name": "empty.pdf"}, kb_context)

            assert "result" in result
            assert "No content" in result["result"]

    @pytest.mark.asyncio
    async def test_handles_read_error(self):
        """Should return error when read fails."""
        mock_db = MagicMock()  # Mock database session
        kb_context = {
            "attachments": [
                {"filename": "doc.pdf", "id": "att-1"},
            ],
            "db": mock_db,
        }

        with patch("services.rag_service.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.get_kb_document_content = AsyncMock(side_effect=Exception("Read error"))
            mock_rag_class.return_value = mock_rag

            result = await execute_read_kb_document({"document_name": "doc.pdf"}, kb_context)

            assert "error" in result
            assert "Failed to read" in result["error"]


# ============================================================================
# execute_kb_tool Tests
# ============================================================================


class TestExecuteKBTool:
    """Tests for execute_kb_tool dispatcher."""

    @pytest.mark.asyncio
    async def test_returns_error_without_kb_context(self):
        """Should return error when kb_context is None."""
        result = await execute_kb_tool("list_kb_documents", {}, None)

        assert "error" in result
        assert "No knowledge base" in result["error"]

    @pytest.mark.asyncio
    async def test_returns_error_without_conversation_id(self):
        """Should return error when conversation_id is missing."""
        result = await execute_kb_tool(
            "list_kb_documents",
            {},
            {"attachments": []},  # No conversation_id
        )

        assert "error" in result
        assert "No conversation context" in result["error"]

    @pytest.mark.asyncio
    async def test_returns_error_for_unknown_tool(self):
        """Should return error for unknown tool name."""
        result = await execute_kb_tool(
            "unknown_kb_tool", {}, {"conversation_id": "conv-1", "attachments": []}
        )

        assert "error" in result
        assert "Unknown KB tool" in result["error"]

    @pytest.mark.asyncio
    async def test_executes_list_kb_documents(self):
        """Should execute list_kb_documents tool."""
        result = await execute_kb_tool(
            "list_kb_documents", {}, {"conversation_id": "conv-1", "attachments": []}
        )

        assert "result" in result
        assert "No documents" in result["result"]

    @pytest.mark.asyncio
    async def test_executes_search_knowledge_base(self):
        """Should execute search_knowledge_base tool."""
        mock_db = MagicMock()  # Mock database session
        with patch("services.rag_service.RAGService") as mock_rag_class:
            mock_rag = MagicMock()
            mock_rag.search_kb = AsyncMock(return_value=[])
            mock_rag_class.return_value = mock_rag

            result = await execute_kb_tool(
                "search_knowledge_base",
                {"query": "test"},
                {"conversation_id": "conv-1", "attachments": [], "db": mock_db},
            )

            assert "result" in result

    @pytest.mark.asyncio
    async def test_executes_read_kb_document(self):
        """Should execute read_kb_document tool."""
        result = await execute_kb_tool(
            "read_kb_document",
            {"document_name": "test.pdf"},
            {"conversation_id": "conv-1", "attachments": []},
        )

        # Should return error since document not found
        assert "error" in result
