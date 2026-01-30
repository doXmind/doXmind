"""GPT-based reranking service using structured outputs.

This module provides document reranking using OpenAI GPT models with
structured JSON outputs. The reranker scores each document by relevance
to the query and returns a reordered list.

Benefits of GPT reranking:
- Semantic understanding beyond keyword matching
- Structured outputs ensure reliable JSON format
- Uses existing OpenAI API key (no new dependencies)
"""

import logging
from typing import Any

from pydantic import BaseModel

from config import get_settings

logger = logging.getLogger(__name__)


# ============================================================================
# Pydantic Models for Structured Output
# ============================================================================

class RankedDocument(BaseModel):
    """A single document with its relevance score."""

    index: int  # Original index in the candidates list
    relevance_score: float  # Score from 0.0 (irrelevant) to 1.0 (highly relevant)
    reasoning: str  # Brief explanation for the score


class RerankResponse(BaseModel):
    """Response containing ranked documents."""

    ranked_documents: list[RankedDocument]


# ============================================================================
# GPT Reranker
# ============================================================================

class GPTReranker:
    """Rerank documents using GPT with structured outputs.

    Uses OpenAI's chat completions API with Pydantic models for
    guaranteed JSON schema adherence.

    Example:
        >>> reranker = GPTReranker()
        >>> results = await reranker.rerank(
        ...     query="machine learning",
        ...     documents=[{"id": "1", "content": "ML is..."}],
        ...     top_n=5
        ... )
    """

    def __init__(self):
        self.settings = get_settings()
        self._client = None

    @property
    def client(self):
        """Lazy initialization of OpenAI client."""
        if self._client is None:
            from openai import AsyncOpenAI
            self._client = AsyncOpenAI(api_key=self.settings.openai_api_key)
        return self._client

    async def rerank(
        self,
        query: str,
        documents: list[dict[str, Any]],
        top_n: int = 10,
        min_relevance_score: float = 0.2
    ) -> list[dict[str, Any]]:
        """Rerank documents by relevance to query using GPT.

        Args:
            query: The search query
            documents: List of candidate documents with 'id' and 'content' keys
            top_n: Number of top results to return
            min_relevance_score: Minimum relevance score (0-1) to include in results.
                Documents below this threshold are filtered out as irrelevant.

        Returns:
            Reranked list of documents with added rerank_score and reasoning
        """
        if not documents:
            return []

        if len(documents) <= 1:
            return documents[:top_n]

        # Build prompt with numbered documents (truncate content for token efficiency)
        docs_text = "\n\n".join([
            f"[{i}] {doc.get('content', '')[:500]}"
            for i, doc in enumerate(documents)
        ])

        system_prompt = """You are a search relevance expert. Given a query and candidate documents,
rank each document by its relevance to the query.

For each document:
- index: The document number [0], [1], [2], etc.
- relevance_score: A score from 0.0 (completely irrelevant) to 1.0 (highly relevant)
- reasoning: A brief (1 sentence) explanation of why this score was given

Consider semantic meaning, context, and informativeness - not just keyword matching.
A document that directly answers the query should score higher than one that merely mentions related terms."""

        user_prompt = f"""Query: {query}

Documents:
{docs_text}

Rank all {len(documents)} documents by relevance."""

        try:
            # Get reranking model from settings (default: gpt-5-nano)
            model = getattr(self.settings, "reranking_model", "gpt-4o-mini")

            response = await self.client.beta.chat.completions.parse(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_format=RerankResponse,
                max_tokens=1500,
                temperature=0.0  # Deterministic for consistent rankings
            )

            # Parse the structured response
            parsed = response.choices[0].message.parsed

            if not parsed or not parsed.ranked_documents:
                logger.warning("GPT reranker returned empty rankings")
                return documents[:top_n]

            # Sort by relevance score (descending) and filter out irrelevant docs
            sorted_rankings = sorted(
                parsed.ranked_documents,
                key=lambda x: x.relevance_score,
                reverse=True
            )

            # Build reranked results, filtering out low-relevance documents
            reranked: list[dict[str, Any]] = []
            filtered_count = 0
            for rank in sorted_rankings:
                if len(reranked) >= top_n:
                    break
                if rank.relevance_score < min_relevance_score:
                    filtered_count += 1
                    continue
                if 0 <= rank.index < len(documents):
                    doc = documents[rank.index].copy()
                    doc["rerank_score"] = rank.relevance_score
                    doc["rerank_reasoning"] = rank.reasoning
                    reranked.append(doc)

            logger.info(
                f"GPT reranked {len(documents)} docs -> {len(reranked)} results "
                f"(filtered {filtered_count} irrelevant, model: {model})"
            )

            return reranked

        except Exception as e:
            logger.error(f"GPT reranking failed: {e}")
            # Fall back to original order on error
            return documents[:top_n]


class NoOpReranker:
    """No-op reranker that returns documents unchanged.

    Used when reranking is disabled.
    """

    async def rerank(
        self,
        _query: str,
        documents: list[dict[str, Any]],
        top_n: int = 10,
        min_relevance_score: float = 0.2  # Unused, for API compatibility
    ) -> list[dict[str, Any]]:
        """Return documents unchanged."""
        del min_relevance_score  # Unused in no-op reranker
        return documents[:top_n]


def get_reranker():
    """Factory function to get the appropriate reranker.

    Returns GPTReranker if reranking is enabled, NoOpReranker otherwise.
    """
    settings = get_settings()

    if getattr(settings, "reranking_enabled", False):
        return GPTReranker()

    return NoOpReranker()
