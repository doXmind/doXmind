"""HTML and search utilities for the RAG system."""

import html as html_module
import re

from config import get_settings

# Get embedding dimension from config (supports 256-1536 for text-embedding-3-small)
EMBEDDING_DIMENSION = get_settings().embedding_dimension


def strip_html_tags(html: str) -> str:
    """Strip HTML tags and return plain text.

    Used to make search results more readable.
    """
    if not html:
        return ""

    # Remove HTML tags
    text = re.sub(r"<[^>]+>", " ", html)

    # Decode all HTML entities
    text = html_module.unescape(text)

    # Clean up whitespace
    text = re.sub(r"\s+", " ", text).strip()

    return text


def reciprocal_rank_fusion(
    semantic_results: list[dict],
    keyword_results: list[dict],
    k: int = 60,
    semantic_weight: float = 0.7,
    keyword_weight: float = 0.3,
    extra_result_lists: list[tuple[list[dict], float, str]] | None = None,
) -> list[dict]:
    """Combine search results from multiple retrieval methods using Reciprocal Rank Fusion.

    RRF Score = sum(weight / (k + rank))

    This algorithm effectively merges results from multiple retrieval methods,
    giving higher scores to documents that appear in multiple result sets.

    Args:
        semantic_results: Results from vector similarity search
        keyword_results: Results from full-text keyword search
        k: RRF constant (default 60, prevents high-ranked items from dominating)
        semantic_weight: Weight for semantic search results (0-1)
        keyword_weight: Weight for keyword search results (0-1)
        extra_result_lists: Optional list of (results, weight, label) tuples for
            additional retrieval signals (e.g., filename matching)

    Returns:
        Fused and sorted list of results
    """
    scores: dict[str, dict] = {}

    # Score semantic results
    for rank, result in enumerate(semantic_results, 1):
        doc_id = result["id"]
        scores[doc_id] = {
            "doc": result,
            "score": semantic_weight / (k + rank),
            "semantic_rank": rank,
            "keyword_rank": None,
        }

    # Score keyword results
    for rank, result in enumerate(keyword_results, 1):
        doc_id = result["id"]
        if doc_id not in scores:
            scores[doc_id] = {
                "doc": result,
                "score": 0,
                "semantic_rank": None,
                "keyword_rank": rank,
            }
        else:
            scores[doc_id]["keyword_rank"] = rank
        scores[doc_id]["score"] += keyword_weight / (k + rank)

    # Score extra result lists (e.g., filename search)
    extra_labels: list[str] = []
    if extra_result_lists:
        for results, weight, label in extra_result_lists:
            extra_labels.append(label)
            for rank, result in enumerate(results, 1):
                doc_id = result["id"]
                if doc_id not in scores:
                    scores[doc_id] = {
                        "doc": result,
                        "score": 0,
                        "semantic_rank": None,
                        "keyword_rank": None,
                    }
                scores[doc_id]["score"] += weight / (k + rank)
                scores[doc_id][f"{label}_rank"] = rank

    # Sort by combined score
    sorted_results = sorted(scores.values(), key=lambda x: x["score"], reverse=True)

    # Return documents with RRF metadata
    return [
        {
            **item["doc"],
            "rrf_score": item["score"],
            "semantic_rank": item["semantic_rank"],
            "keyword_rank": item["keyword_rank"],
            **{f"{label}_rank": item.get(f"{label}_rank") for label in extra_labels},
        }
        for item in sorted_results
    ]
