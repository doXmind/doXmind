"""Tests for RAG Service.

Tests chunking strategies, vector store operations, and search functionality.
Uses mock collections to avoid actual Chroma operations.
"""

from unittest.mock import MagicMock, patch

import pytest

from services.rag_service import (
    DEFAULT_CHUNK_STRATEGY,
    OverlapChunkingStrategy,
    RAGService,
    SENTENCE_CHUNK_STRATEGY,
    SentenceChunkingStrategy,
)


# ============================================================================
# Chunking Strategy Tests
# ============================================================================


class TestOverlapChunkingStrategy:
    """Tests for OverlapChunkingStrategy."""

    def test_chunk_empty_text(self):
        """Should return empty list for empty text."""
        strategy = OverlapChunkingStrategy()

        result = strategy.chunk("")

        assert result == []

    def test_chunk_whitespace_only(self):
        """Should return empty list for whitespace-only text."""
        strategy = OverlapChunkingStrategy()

        result = strategy.chunk("   \n\n   ")

        assert result == []

    def test_chunk_short_text(self):
        """Should return single chunk for short text."""
        strategy = OverlapChunkingStrategy(chunk_size=100, overlap=20)

        result = strategy.chunk("This is a short text.")

        assert len(result) == 1
        assert result[0] == "This is a short text."

    def test_chunk_long_text_creates_multiple_chunks(self):
        """Should create multiple overlapping chunks for long text."""
        strategy = OverlapChunkingStrategy(chunk_size=50, overlap=10)
        long_text = "A" * 100  # 100 characters

        result = strategy.chunk(long_text)

        assert len(result) > 1

    def test_chunk_breaks_at_sentence_boundary(self):
        """Should try to break at sentence boundaries."""
        strategy = OverlapChunkingStrategy(chunk_size=80, overlap=20)
        text = "First sentence. Second sentence. Third sentence. Fourth sentence."

        result = strategy.chunk(text)

        # Each chunk should ideally end at a period
        for chunk in result[:-1]:  # Except possibly last chunk
            assert chunk.rstrip().endswith(".") or len(chunk) >= strategy.chunk_size // 2

    def test_chunk_handles_chinese_text(self):
        """Should handle Chinese sentence breaks."""
        strategy = OverlapChunkingStrategy(chunk_size=50, overlap=10)
        text = "第一句话。第二句话。第三句话。第四句话。"

        result = strategy.chunk(text)

        assert len(result) >= 1
        assert "。" in result[0]

    def test_chunk_with_newlines(self):
        """Should break at newlines when appropriate."""
        strategy = OverlapChunkingStrategy(chunk_size=50, overlap=10)
        text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph."

        result = strategy.chunk(text)

        assert len(result) >= 1


class TestSentenceChunkingStrategy:
    """Tests for SentenceChunkingStrategy."""

    def test_chunk_empty_text(self):
        """Should return empty list for empty text."""
        strategy = SentenceChunkingStrategy()

        result = strategy.chunk("")

        assert result == []

    def test_chunk_whitespace_only(self):
        """Should return empty list for whitespace-only text."""
        strategy = SentenceChunkingStrategy()

        result = strategy.chunk("   \n\n   ")

        assert result == []

    def test_chunk_single_sentence(self):
        """Should return single sentence."""
        strategy = SentenceChunkingStrategy()

        result = strategy.chunk("This is a sentence.")

        assert len(result) == 1
        assert result[0] == "This is a sentence."

    def test_chunk_multiple_sentences(self):
        """Should split into multiple sentences."""
        strategy = SentenceChunkingStrategy()

        result = strategy.chunk("First sentence. Second sentence! Third sentence?")

        assert len(result) == 3

    def test_chunk_filters_short_sentences(self):
        """Should filter out sentences shorter than min_length."""
        strategy = SentenceChunkingStrategy(min_length=10)

        result = strategy.chunk("Hi. This is a longer sentence. Bye.")

        # "Hi" and "Bye" should be filtered
        assert len(result) == 1
        assert "longer sentence" in result[0]

    def test_chunk_handles_chinese_delimiters(self):
        """Should split on Chinese punctuation."""
        strategy = SentenceChunkingStrategy(min_length=3)  # Lower threshold for Chinese

        result = strategy.chunk("这是第一句话内容。这是第二句话内容！这是第三句话内容？")

        assert len(result) == 3

    def test_chunk_strips_html_tags(self):
        """Should remove HTML tags."""
        strategy = SentenceChunkingStrategy()

        result = strategy.chunk("<p>This is a <strong>sentence</strong>.</p>")

        assert len(result) >= 1
        assert "<" not in result[0]
        assert ">" not in result[0]

    def test_chunk_handles_paragraph_breaks(self):
        """Should split on paragraph breaks."""
        strategy = SentenceChunkingStrategy()

        result = strategy.chunk("First paragraph\n\nSecond paragraph\n\nThird paragraph")

        assert len(result) == 3


# ============================================================================
# Default Strategy Tests
# ============================================================================


class TestDefaultStrategies:
    """Tests for default strategy instances."""

    def test_default_chunk_strategy_exists(self):
        """DEFAULT_CHUNK_STRATEGY should be OverlapChunkingStrategy."""
        assert isinstance(DEFAULT_CHUNK_STRATEGY, OverlapChunkingStrategy)

    def test_sentence_chunk_strategy_exists(self):
        """SENTENCE_CHUNK_STRATEGY should be SentenceChunkingStrategy."""
        assert isinstance(SENTENCE_CHUNK_STRATEGY, SentenceChunkingStrategy)


# ============================================================================
# RAG Service Tests
# ============================================================================


class TestRAGServiceInit:
    """Tests for RAGService initialization."""

    @patch("services.rag_service.get_vector_store_manager")
    def test_init_gets_collection(self, mock_manager_factory):
        """Should get collection from manager."""
        mock_manager = MagicMock()
        mock_collection = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()

        assert service.collection == mock_collection


class TestRAGServiceIndexFile:
    """Tests for file indexing."""

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_index_file_creates_chunks(self, mock_manager_factory):
        """Should create and upsert chunks."""
        mock_collection = MagicMock()
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        await service.index_file("file-1", "This is the content to index.")

        mock_collection.upsert.assert_called_once()
        call_args = mock_collection.upsert.call_args
        assert "ids" in call_args.kwargs
        assert "documents" in call_args.kwargs
        assert "metadatas" in call_args.kwargs

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_index_file_deletes_existing_first(self, mock_manager_factory):
        """Should delete existing chunks before indexing."""
        mock_collection = MagicMock()
        mock_collection.get.return_value = {"ids": ["file-1_0", "file-1_1"]}
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        await service.index_file("file-1", "New content")

        # Should call delete before upsert
        mock_collection.delete.assert_called_once()

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_index_file_with_metadata(self, mock_manager_factory):
        """Should include metadata in chunks."""
        mock_collection = MagicMock()
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        await service.index_file(
            "file-1",
            "Content",
            metadata={"custom_field": "value"}
        )

        call_args = mock_collection.upsert.call_args
        metadatas = call_args.kwargs["metadatas"]
        assert metadatas[0]["custom_field"] == "value"
        assert metadatas[0]["file_id"] == "file-1"

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_index_file_skips_empty_content(self, mock_manager_factory):
        """Should not upsert for empty content."""
        mock_collection = MagicMock()
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        await service.index_file("file-1", "")

        mock_collection.upsert.assert_not_called()


class TestRAGServiceSearch:
    """Tests for search functionality."""

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_search_returns_results(self, mock_manager_factory):
        """Should return formatted search results."""
        mock_collection = MagicMock()
        mock_collection.query.return_value = {
            "ids": [["id-1", "id-2"]],
            "documents": [["Doc 1 content", "Doc 2 content"]],
            "metadatas": [[{"file_id": "f1"}, {"file_id": "f2"}]],
            "distances": [[0.1, 0.2]]
        }
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        results = await service.search("query")

        assert len(results) == 2
        assert results[0]["id"] == "id-1"
        assert results[0]["content"] == "Doc 1 content"
        assert results[0]["distance"] == 0.1

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_search_with_file_filter(self, mock_manager_factory):
        """Should filter by file IDs when provided."""
        mock_collection = MagicMock()
        mock_collection.query.return_value = {
            "ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]
        }
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        await service.search("query", file_ids=["file-1", "file-2"])

        call_args = mock_collection.query.call_args
        assert call_args.kwargs["where"] == {"file_id": {"$in": ["file-1", "file-2"]}}

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_search_handles_error(self, mock_manager_factory):
        """Should return empty list on error."""
        mock_collection = MagicMock()
        mock_collection.query.side_effect = Exception("Query error")
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        results = await service.search("query")

        assert results == []


class TestRAGServiceDeleteFile:
    """Tests for file deletion."""

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_delete_file_removes_chunks(self, mock_manager_factory):
        """Should delete all chunks for a file."""
        mock_collection = MagicMock()
        mock_collection.get.return_value = {"ids": ["file-1_0", "file-1_1"]}
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        await service.delete_file("file-1")

        mock_collection.delete.assert_called_once_with(ids=["file-1_0", "file-1_1"])

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_delete_file_handles_no_chunks(self, mock_manager_factory):
        """Should handle case when no chunks exist."""
        mock_collection = MagicMock()
        mock_collection.get.return_value = {"ids": []}
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        await service.delete_file("nonexistent")

        mock_collection.delete.assert_not_called()


class TestRAGServiceSentenceIndexing:
    """Tests for sentence-level indexing."""

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_index_file_sentences_creates_sentence_chunks(
        self, mock_manager_factory
    ):
        """Should create sentence-level chunks."""
        mock_collection = MagicMock()
        mock_collection.get.return_value = {"ids": []}
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        await service.index_file_sentences(
            "file-1",
            "First sentence. Second sentence."
        )

        call_args = mock_collection.upsert.call_args
        metadatas = call_args.kwargs["metadatas"]
        assert metadatas[0]["chunk_type"] == "sentence"

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_search_sentences_filters_by_file_and_type(
        self, mock_manager_factory
    ):
        """Should filter by file_id and chunk_type."""
        mock_collection = MagicMock()
        mock_collection.query.return_value = {
            "ids": [["sent-1"]],
            "documents": [["Sentence content"]],
            "metadatas": [[{"file_id": "file-1", "chunk_type": "sentence"}]],
            "distances": [[0.1]]
        }
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        await service.search_sentences("query", "file-1")

        call_args = mock_collection.query.call_args
        where_filter = call_args.kwargs["where"]
        assert where_filter["$and"][0]["file_id"] == "file-1"
        assert where_filter["$and"][1]["chunk_type"] == "sentence"

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_search_sentences_filters_by_min_score(self, mock_manager_factory):
        """Should filter results below min_score."""
        mock_collection = MagicMock()
        mock_collection.query.return_value = {
            "ids": [["sent-1", "sent-2"]],
            "documents": [["Good match", "Poor match"]],
            "metadatas": [[{}, {}]],
            "distances": [[0.1, 0.5]]  # scores: 0.9, 0.5
        }
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        results = await service.search_sentences("query", "file-1", min_score=0.7)

        # Only first result (score 0.9) should pass
        assert len(results) == 1
        assert results[0]["content"] == "Good match"


class TestRAGServiceKB:
    """Tests for Knowledge Base methods."""

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_index_kb_attachment_returns_chunk_count(self, mock_manager_factory):
        """Should return number of chunks indexed."""
        mock_collection = MagicMock()
        mock_collection.get.return_value = {"ids": []}
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        count = await service.index_kb_attachment(
            "att-1", "conv-1", "This is the content.", "doc.pdf"
        )

        assert count >= 1
        call_args = mock_collection.upsert.call_args
        metadatas = call_args.kwargs["metadatas"]
        assert metadatas[0]["chunk_type"] == "kb"
        assert metadatas[0]["conversation_id"] == "conv-1"
        assert metadatas[0]["attachment_id"] == "att-1"

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_search_kb_filters_by_conversation(self, mock_manager_factory):
        """Should filter by conversation_id and kb type."""
        mock_collection = MagicMock()
        mock_collection.query.return_value = {
            "ids": [["kb-1"]],
            "documents": [["KB content"]],
            "metadatas": [[{"filename": "doc.pdf"}]],
            "distances": [[0.1]]
        }
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        results = await service.search_kb("conv-1", "query")

        call_args = mock_collection.query.call_args
        where_filter = call_args.kwargs["where"]
        assert where_filter["$and"][0]["chunk_type"] == "kb"
        assert where_filter["$and"][1]["conversation_id"] == "conv-1"

        assert len(results) == 1
        assert results[0]["source_file"] == "doc.pdf"
        assert results[0]["score"] == pytest.approx(0.9)  # 1 - 0.1

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_delete_kb_attachment(self, mock_manager_factory):
        """Should delete KB attachment chunks."""
        mock_collection = MagicMock()
        mock_collection.get.return_value = {"ids": ["kb_att-1_0", "kb_att-1_1"]}
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        await service.delete_kb_attachment("att-1")

        mock_collection.delete.assert_called_once()

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_get_kb_document_content_returns_ordered_chunks(
        self, mock_manager_factory
    ):
        """Should return chunks in order."""
        mock_collection = MagicMock()
        mock_collection.get.return_value = {
            "ids": ["kb_1", "kb_0", "kb_2"],
            "documents": ["Chunk 2", "Chunk 1", "Chunk 3"],
            "metadatas": [
                {"chunk_index": 1, "filename": "doc.pdf"},
                {"chunk_index": 0, "filename": "doc.pdf"},
                {"chunk_index": 2, "filename": "doc.pdf"}
            ]
        }
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        result = await service.get_kb_document_content("att-1")

        # Should be ordered by chunk_index
        assert "Chunk 1" in result["content"]
        assert result["content"].index("Chunk 1") < result["content"].index("Chunk 2")
        assert result["total_chunks"] == 3
        assert result["filename"] == "doc.pdf"

    @pytest.mark.asyncio
    @patch("services.rag_service.get_vector_store_manager")
    async def test_get_kb_document_content_slices_chunks(self, mock_manager_factory):
        """Should support slicing chunks."""
        mock_collection = MagicMock()
        mock_collection.get.return_value = {
            "ids": ["kb_0", "kb_1", "kb_2"],
            "documents": ["Chunk 1", "Chunk 2", "Chunk 3"],
            "metadatas": [
                {"chunk_index": 0, "filename": "doc.pdf"},
                {"chunk_index": 1, "filename": "doc.pdf"},
                {"chunk_index": 2, "filename": "doc.pdf"}
            ]
        }
        mock_manager = MagicMock()
        mock_manager.collection = mock_collection
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        result = await service.get_kb_document_content("att-1", start_chunk=1, end_chunk=2)

        assert result["chunks_returned"] == 1
        assert "Chunk 2" in result["content"]
        assert "Chunk 1" not in result["content"]


# ============================================================================
# Utility Method Tests
# ============================================================================


class TestRAGServiceUtils:
    """Tests for utility methods."""

    def test_generate_id_creates_consistent_hash(self):
        """Should generate consistent IDs for same text."""
        id1 = RAGService.generate_id("Test text")
        id2 = RAGService.generate_id("Test text")

        assert id1 == id2
        assert len(id1) == 16

    def test_generate_id_different_for_different_text(self):
        """Should generate different IDs for different text."""
        id1 = RAGService.generate_id("Text 1")
        id2 = RAGService.generate_id("Text 2")

        assert id1 != id2

    @patch("services.rag_service.get_vector_store_manager")
    def test_format_results(self, mock_manager_factory):
        """Should format query results correctly."""
        mock_manager = MagicMock()
        mock_manager_factory.return_value = mock_manager

        service = RAGService()
        raw_results = {
            "ids": [["id-1", "id-2"]],
            "documents": [["Content 1", "Content 2"]],
            "metadatas": [[{"key": "val1"}, {"key": "val2"}]],
            "distances": [[0.1, 0.2]]
        }

        formatted = service._format_results(raw_results)

        assert len(formatted) == 2
        assert formatted[0]["id"] == "id-1"
        assert formatted[0]["content"] == "Content 1"
        assert formatted[0]["metadata"] == {"key": "val1"}
        assert formatted[0]["distance"] == 0.1
