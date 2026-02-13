"""Tests for hybrid search and reranking functionality.

Tests the RRF algorithm, hybrid search methods, and GPT reranker.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.rag_service import reciprocal_rank_fusion
from services.reranker_service import (
    GPTReranker,
    NoOpReranker,
    RankedDocument,
    RerankResponse,
    get_reranker,
)

# =============================================================================
# RRF Algorithm Tests
# =============================================================================


class TestReciprocalRankFusion:
    """Tests for the RRF fusion algorithm."""

    def test_empty_inputs(self):
        """Should handle empty input lists."""
        result = reciprocal_rank_fusion([], [])
        assert result == []

    def test_semantic_only(self):
        """Should handle semantic-only results."""
        semantic = [
            {"id": "a", "content": "doc a"},
            {"id": "b", "content": "doc b"},
        ]
        result = reciprocal_rank_fusion(semantic, [])
        assert len(result) == 2
        assert result[0]["id"] == "a"  # Higher rank
        assert "rrf_score" in result[0]

    def test_keyword_only(self):
        """Should handle keyword-only results."""
        keyword = [
            {"id": "x", "content": "doc x"},
            {"id": "y", "content": "doc y"},
        ]
        result = reciprocal_rank_fusion([], keyword)
        assert len(result) == 2
        assert result[0]["id"] == "x"

    def test_overlapping_results(self):
        """Documents in both lists should get higher scores."""
        semantic = [
            {"id": "a", "content": "doc a"},
            {"id": "b", "content": "doc b"},
        ]
        keyword = [
            {"id": "b", "content": "doc b"},  # Overlaps
            {"id": "c", "content": "doc c"},
        ]
        result = reciprocal_rank_fusion(semantic, keyword)

        # "b" should be ranked highest (appears in both)
        assert result[0]["id"] == "b"
        assert result[0]["semantic_rank"] == 2
        assert result[0]["keyword_rank"] == 1

    def test_custom_weights(self):
        """Should respect custom semantic/keyword weights."""
        semantic = [{"id": "a", "content": "doc a"}]
        keyword = [{"id": "b", "content": "doc b"}]

        # Heavy semantic weight
        result_semantic = reciprocal_rank_fusion(
            semantic, keyword, semantic_weight=0.9, keyword_weight=0.1
        )
        assert result_semantic[0]["id"] == "a"

        # Heavy keyword weight
        result_keyword = reciprocal_rank_fusion(
            semantic, keyword, semantic_weight=0.1, keyword_weight=0.9
        )
        assert result_keyword[0]["id"] == "b"

    def test_rrf_k_constant(self):
        """RRF k constant should affect score distribution."""
        semantic = [
            {"id": "a", "content": "doc a"},
            {"id": "b", "content": "doc b"},
        ]

        # Low k: higher scores for top results
        result_low_k = reciprocal_rank_fusion(semantic, [], k=1)
        # High k: more compressed scores
        result_high_k = reciprocal_rank_fusion(semantic, [], k=100)

        # With low k, score difference should be larger
        low_k_diff = result_low_k[0]["rrf_score"] - result_low_k[1]["rrf_score"]
        high_k_diff = result_high_k[0]["rrf_score"] - result_high_k[1]["rrf_score"]
        assert low_k_diff > high_k_diff

    def test_preserves_metadata(self):
        """Should preserve document metadata."""
        semantic = [
            {"id": "a", "content": "doc a", "metadata": {"file_id": "file1", "extra": "data"}}
        ]
        result = reciprocal_rank_fusion(semantic, [])

        assert result[0]["metadata"]["file_id"] == "file1"
        assert result[0]["metadata"]["extra"] == "data"


# =============================================================================
# Reranker Tests
# =============================================================================


class TestNoOpReranker:
    """Tests for the no-op reranker."""

    @pytest.mark.asyncio
    async def test_returns_unchanged(self):
        """Should return documents unchanged."""
        reranker = NoOpReranker()
        docs = [{"id": "a"}, {"id": "b"}, {"id": "c"}]

        result = await reranker.rerank("query", docs, top_n=2)
        assert len(result) == 2
        assert result[0]["id"] == "a"
        assert result[1]["id"] == "b"

    @pytest.mark.asyncio
    async def test_handles_empty(self):
        """Should handle empty input."""
        reranker = NoOpReranker()
        result = await reranker.rerank("query", [], top_n=5)
        assert result == []


class TestGPTReranker:
    """Tests for the GPT reranker."""

    @pytest.mark.asyncio
    async def test_empty_documents(self):
        """Should return empty list for empty input."""
        reranker = GPTReranker()
        result = await reranker.rerank("query", [], top_n=5)
        assert result == []

    @pytest.mark.asyncio
    async def test_single_document(self):
        """Should return single document unchanged."""
        reranker = GPTReranker()
        docs = [{"id": "a", "content": "single doc"}]
        result = await reranker.rerank("query", docs, top_n=5)
        assert len(result) == 1
        assert result[0]["id"] == "a"

    @pytest.mark.asyncio
    async def test_rerank_with_mock(self):
        """Should rerank documents based on GPT response."""
        reranker = GPTReranker()

        # Mock the OpenAI response
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.parsed = RerankResponse(
            ranked_documents=[
                RankedDocument(index=1, relevance_score=0.95, reasoning="Most relevant"),
                RankedDocument(index=0, relevance_score=0.6, reasoning="Somewhat relevant"),
                RankedDocument(index=2, relevance_score=0.3, reasoning="Less relevant"),
            ]
        )

        docs = [
            {"id": "a", "content": "doc a"},
            {"id": "b", "content": "doc b"},
            {"id": "c", "content": "doc c"},
        ]

        # Mock the internal _client attribute
        mock_client = MagicMock()
        mock_client.beta.chat.completions.parse = AsyncMock(return_value=mock_response)
        reranker._client = mock_client

        result = await reranker.rerank("query", docs, top_n=3)

        # Should be reordered by relevance score
        assert result[0]["id"] == "b"  # index 1, highest score
        assert result[0]["rerank_score"] == 0.95
        assert result[0]["rerank_reasoning"] == "Most relevant"

        assert result[1]["id"] == "a"  # index 0
        assert result[2]["id"] == "c"  # index 2

    @pytest.mark.asyncio
    async def test_handles_api_error(self):
        """Should fall back to original order on API error."""
        reranker = GPTReranker()
        docs = [
            {"id": "a", "content": "doc a"},
            {"id": "b", "content": "doc b"},
        ]

        # Mock the internal _client attribute to raise an error
        mock_client = MagicMock()
        mock_client.beta.chat.completions.parse = AsyncMock(side_effect=Exception("API error"))
        reranker._client = mock_client

        result = await reranker.rerank("query", docs, top_n=2)

        # Should return original order
        assert result[0]["id"] == "a"
        assert result[1]["id"] == "b"

    @pytest.mark.asyncio
    async def test_respects_top_n(self):
        """Should respect top_n limit."""
        reranker = GPTReranker()

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.parsed = RerankResponse(
            ranked_documents=[
                RankedDocument(index=0, relevance_score=0.9, reasoning="r1"),
                RankedDocument(index=1, relevance_score=0.8, reasoning="r2"),
                RankedDocument(index=2, relevance_score=0.7, reasoning="r3"),
            ]
        )

        docs = [
            {"id": "a", "content": "doc a"},
            {"id": "b", "content": "doc b"},
            {"id": "c", "content": "doc c"},
        ]

        # Mock the internal _client attribute
        mock_client = MagicMock()
        mock_client.beta.chat.completions.parse = AsyncMock(return_value=mock_response)
        reranker._client = mock_client

        result = await reranker.rerank("query", docs, top_n=2)

        # Should only return top 2
        assert len(result) == 2


class TestGetReranker:
    """Tests for the reranker factory function."""

    def test_returns_noop_when_disabled(self):
        """Should return NoOpReranker when reranking is disabled."""
        with patch("services.reranker_service.get_settings") as mock_settings:
            mock_settings.return_value.reranking_enabled = False
            reranker = get_reranker()
            assert isinstance(reranker, NoOpReranker)

    def test_returns_gpt_when_enabled(self):
        """Should return GPTReranker when reranking is enabled."""
        with patch("services.reranker_service.get_settings") as mock_settings:
            mock_settings.return_value.reranking_enabled = True
            reranker = get_reranker()
            assert isinstance(reranker, GPTReranker)


# =============================================================================
# Integration Tests
# =============================================================================


class TestHybridSearchIntegration:
    """Integration tests for hybrid search workflow."""

    def test_rrf_with_realistic_data(self):
        """Test RRF with realistic search results."""
        # Simulate semantic results (by embedding similarity)
        semantic = [
            {"id": "doc1", "content": "Machine learning is a subset of AI", "distance": 0.1},
            {"id": "doc3", "content": "Deep learning uses neural networks", "distance": 0.2},
            {"id": "doc5", "content": "AI applications in healthcare", "distance": 0.3},
        ]

        # Simulate keyword results (by text matching)
        keyword = [
            {"id": "doc2", "content": "Machine learning algorithms", "keyword_rank": 0.9},
            {"id": "doc1", "content": "Machine learning is a subset of AI", "keyword_rank": 0.8},
            {"id": "doc4", "content": "Learning machine operations", "keyword_rank": 0.5},
        ]

        result = reciprocal_rank_fusion(semantic, keyword)

        # doc1 appears in both, should be ranked high
        doc1_rank = next(i for i, r in enumerate(result) if r["id"] == "doc1")
        assert doc1_rank <= 1  # Should be in top 2

        # All documents should be present
        result_ids = {r["id"] for r in result}
        assert result_ids == {"doc1", "doc2", "doc3", "doc4", "doc5"}

    def test_rrf_preserves_all_metadata(self):
        """RRF should preserve all original document metadata."""
        semantic = [
            {
                "id": "a",
                "content": "test content",
                "metadata": {"file_id": "f1", "chunk_index": 0, "user_id": "u1"},
                "distance": 0.1,
                "extra_field": "extra",
            }
        ]

        result = reciprocal_rank_fusion(semantic, [])

        assert result[0]["content"] == "test content"
        assert result[0]["metadata"]["file_id"] == "f1"
        assert result[0]["distance"] == 0.1
        assert result[0]["extra_field"] == "extra"


# =============================================================================
# RRF with Extra Result Lists (Filename Matching) Tests
# =============================================================================


class TestRRFWithExtraLists:
    """Tests for RRF with extra result lists (e.g., filename matching)."""

    def test_extra_list_boosts_overlapping_results(self):
        """Documents in both semantic and filename lists should get boosted."""
        semantic = [
            {"id": "a", "content": "doc a"},
            {"id": "b", "content": "doc b"},
        ]
        keyword = [
            {"id": "c", "content": "doc c"},
        ]
        filename = [
            {"id": "b", "content": "doc b"},  # Also in semantic (rank 2)
        ]

        result = reciprocal_rank_fusion(
            semantic, keyword, extra_result_lists=[(filename, 0.5, "filename")]
        )

        # "b" should be ranked #1 due to semantic + filename boost
        assert result[0]["id"] == "b"
        assert result[0]["filename_rank"] == 1
        assert result[0]["semantic_rank"] == 2

    def test_filename_only_match_appears_in_results(self):
        """Document only in filename list should still appear."""
        semantic = [{"id": "a", "content": "doc a"}]
        keyword = []
        filename = [{"id": "z", "content": "doc z"}]

        result = reciprocal_rank_fusion(
            semantic, keyword, extra_result_lists=[(filename, 0.5, "filename")]
        )

        result_ids = {r["id"] for r in result}
        assert "z" in result_ids
        # "z" should have filename_rank but no semantic/keyword rank
        z_result = next(r for r in result if r["id"] == "z")
        assert z_result["filename_rank"] == 1
        assert z_result["semantic_rank"] is None
        assert z_result["keyword_rank"] is None

    def test_no_extra_lists_backward_compatible(self):
        """None extra_result_lists should behave identically to old function."""
        semantic = [{"id": "a", "content": "doc a"}]
        keyword = [{"id": "b", "content": "doc b"}]

        result_with_none = reciprocal_rank_fusion(semantic, keyword, extra_result_lists=None)
        result_without = reciprocal_rank_fusion(semantic, keyword)

        assert len(result_with_none) == len(result_without)
        for r_new, r_old in zip(result_with_none, result_without, strict=True):
            assert r_new["id"] == r_old["id"]
            assert r_new["rrf_score"] == r_old["rrf_score"]

    def test_multiple_extra_lists(self):
        """Should handle multiple extra result lists correctly."""
        semantic = [{"id": "a", "content": "doc a"}]
        keyword = []
        list1 = [{"id": "b", "content": "doc b"}]
        list2 = [{"id": "c", "content": "doc c"}]

        result = reciprocal_rank_fusion(
            semantic,
            keyword,
            extra_result_lists=[
                (list1, 0.5, "filename"),
                (list2, 0.2, "another"),
            ],
        )

        result_ids = {r["id"] for r in result}
        assert result_ids == {"a", "b", "c"}

        # Check that both extra rank fields are present
        b_result = next(r for r in result if r["id"] == "b")
        assert b_result["filename_rank"] == 1

        c_result = next(r for r in result if r["id"] == "c")
        assert c_result["another_rank"] == 1

    def test_empty_extra_list(self):
        """Empty extra list should not affect results."""
        semantic = [{"id": "a", "content": "doc a"}]
        keyword = [{"id": "b", "content": "doc b"}]

        result = reciprocal_rank_fusion(
            semantic, keyword, extra_result_lists=[([], 0.5, "filename")]
        )

        assert len(result) == 2
        assert result[0]["id"] == "a"  # semantic weight > keyword weight

    def test_high_filename_weight_boosts_to_top(self):
        """A high filename weight should push filename matches to the top."""
        semantic = [
            {"id": "a", "content": "doc a"},
            {"id": "b", "content": "doc b"},
        ]
        keyword = [{"id": "a", "content": "doc a"}]
        filename = [{"id": "c", "content": "doc c"}]

        # Very high filename weight
        result = reciprocal_rank_fusion(
            semantic,
            keyword,
            semantic_weight=0.1,
            keyword_weight=0.1,
            extra_result_lists=[(filename, 5.0, "filename")],
        )

        assert result[0]["id"] == "c"
