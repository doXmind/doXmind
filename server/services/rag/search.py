"""RAG search service using PostgreSQL pgvector.

Provides methods for indexing and searching documents using
vector similarity search in PostgreSQL.
"""

import asyncio
import hashlib
import json
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from services.rag.chunking import (
    DEFAULT_CHUNK_STRATEGY,
    DEFAULT_STRATEGY_FACTORY,
    SENTENCE_CHUNK_STRATEGY,
    ChunkingStrategy,
)
from services.rag.embedding import get_embedding, get_embeddings_batch
from services.rag.html_utils import reciprocal_rank_fusion, strip_html_tags

logger = logging.getLogger(__name__)


class RAGService:
    """RAG service using PostgreSQL pgvector.

    Provides methods for indexing and searching documents using
    vector similarity search in PostgreSQL.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    # -------------------------------------------------------------------------
    # Document Indexing (Chunk-level)
    # -------------------------------------------------------------------------

    async def index_file(
        self,
        file_id: str,
        content: str,
        metadata: dict[str, Any] | None = None,
        strategy: ChunkingStrategy | None = None,
    ):
        """Index a file's content at chunk level with position tracking.

        Uses a transactional approach: embeddings are generated before any
        database changes, then delete + insert happen in a single transaction
        to prevent data loss if embedding API fails mid-way.
        """
        try:
            # Skip indexing if content is essentially empty
            plain_content = strip_html_tags(content)
            if not plain_content or len(plain_content) < 10:
                logger.info(f"Skipping index for file {file_id}: content too short")
                await self.delete_file(file_id)  # Clean up any existing vectors
                return

            strategy = strategy or DEFAULT_CHUNK_STRATEGY
            chunks = strategy.chunk(content)

            if not chunks:
                return

            # Find positions of each chunk in original content for highlighting
            chunk_positions = self._find_chunk_positions(content, chunks)

            # Get embeddings BEFORE touching the database — if this fails,
            # existing vectors remain intact
            embeddings = await get_embeddings_batch(chunks)

            # Delete old vectors and insert new ones in a single transaction
            await self.db.execute(
                text("DELETE FROM vectors WHERE file_id = :file_id AND chunk_type = 'document'"),
                {"file_id": file_id},
            )

            # Insert chunks with embeddings and position metadata
            base_metadata = metadata or {}

            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=False)):
                chunk_id = f"{file_id}_{i}"
                start_pos, end_pos = chunk_positions[i]

                # Include position in metadata for highlighting
                chunk_metadata = {
                    **base_metadata,
                    "start": start_pos,
                    "end": end_pos,
                }
                metadata_json = json.dumps(chunk_metadata)

                await self.db.execute(
                    text("""
                        INSERT INTO vectors (id, content, embedding, chunk_type, file_id, chunk_index, metadata)
                        VALUES (:id, :content, :embedding, 'document', :file_id, :chunk_index, CAST(:metadata AS jsonb))
                        ON CONFLICT (id) DO UPDATE SET
                            content = EXCLUDED.content,
                            embedding = EXCLUDED.embedding,
                            metadata = EXCLUDED.metadata
                    """),
                    {
                        "id": chunk_id,
                        "content": chunk,
                        "embedding": str(embedding),
                        "file_id": file_id,
                        "chunk_index": i,
                        "metadata": metadata_json,
                    },
                )

            await self.db.commit()
            logger.info(f"Indexed {len(chunks)} chunks for file {file_id}")

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to index file {file_id}: {e}")
            raise

    def _find_chunk_positions(self, content: str, chunks: list[str]) -> list[tuple[int, int]]:
        """Find start/end positions of each chunk in the original content.

        Uses sequential search to handle overlapping chunks correctly.
        Returns list of (start, end) tuples for each chunk.
        """
        positions: list[tuple[int, int]] = []
        search_start = 0

        for chunk in chunks:
            # Normalize whitespace for matching
            chunk_normalized = " ".join(chunk.split())

            # Try exact match first
            pos = content.find(chunk, search_start)

            if pos == -1:
                # Try normalized matching (handles whitespace differences)
                # Search in a window around expected position
                window_start = max(0, search_start - 100)
                window_end = min(len(content), search_start + len(chunk) + 500)
                window = content[window_start:window_end]
                window_normalized = " ".join(window.split())

                # Find chunk in normalized window
                norm_pos = window_normalized.find(chunk_normalized)
                # Map back to original position (approximate) or use search_start as fallback
                pos = window_start + norm_pos if norm_pos != -1 else search_start

            end_pos = pos + len(chunk)
            positions.append((pos, end_pos))

            # Move search start for next chunk (allow some overlap)
            search_start = max(search_start, pos + len(chunk) // 2)

        return positions

    async def search(
        self,
        query: str,
        file_ids: list[str] | None = None,
        top_k: int = 5,
        user_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Search for relevant document chunks using cosine similarity.

        Args:
            query: Search query text
            file_ids: Optional list of file IDs to search within
            top_k: Maximum number of results to return
            user_id: Optional user ID to filter results (only return user's files)
        """
        try:
            query_embedding = await get_embedding(query)

            # Build query with optional file and user filters
            params: dict[str, Any] = {"embedding": str(query_embedding), "limit": top_k}

            # Base conditions
            conditions = ["chunk_type = 'document'"]

            if file_ids:
                conditions.append("file_id = ANY(:file_ids)")
                params["file_ids"] = file_ids

            if user_id:
                # Filter by user_id in metadata, also include vectors without user_id for backward compatibility
                conditions.append(
                    "(metadata->>'user_id' = :user_id OR metadata->>'user_id' IS NULL)"
                )
                params["user_id"] = user_id

            where_clause = " AND ".join(conditions)

            result = await self.db.execute(
                text(f"""
                    SELECT id, content, file_id, chunk_index, metadata,
                           1 - (embedding <=> :embedding) as score
                    FROM vectors
                    WHERE {where_clause}
                    ORDER BY embedding <=> :embedding
                    LIMIT :limit
                """),
                params,
            )

            rows = result.fetchall()
            results = []
            for row in rows:
                # Strip HTML tags for readable content
                plain_content = strip_html_tags(row.content)

                settings = get_settings()

                # Skip empty content
                if not plain_content or len(plain_content) < settings.search_min_content_length:
                    continue

                distance = 1 - row.score

                # Filter out low relevance results
                if distance > settings.search_distance_threshold:
                    continue

                results.append(
                    {
                        "id": row.id,
                        "content": plain_content,
                        "metadata": {
                            "file_id": row.file_id,
                            "chunk_index": row.chunk_index,
                            **(row.metadata or {}),
                        },
                        "distance": distance,
                    }
                )

            return results

        except Exception as e:
            logger.error(f"Search error: {e}")
            return []

    # -------------------------------------------------------------------------
    # Hybrid Search Methods
    # -------------------------------------------------------------------------

    async def _keyword_search(
        self,
        query: str,
        chunk_type: str = "document",
        file_ids: list[str] | None = None,
        user_id: str | None = None,
        top_k: int = 15,
    ) -> list[dict[str, Any]]:
        """Full-text keyword search using PostgreSQL tsvector.

        Uses ts_rank_cd for ranking, which considers document length
        and position of matches.

        Args:
            query: Search query text
            chunk_type: Type of chunks to search ('document', 'sentence', 'kb')
            file_ids: Optional list of file IDs to search within
            user_id: Optional user ID to filter results
            top_k: Maximum number of results to return
        """
        try:
            params: dict[str, Any] = {"query": query, "limit": top_k, "chunk_type": chunk_type}
            conditions = ["chunk_type = :chunk_type"]

            if file_ids:
                conditions.append("file_id = ANY(:file_ids)")
                params["file_ids"] = file_ids

            if user_id:
                conditions.append(
                    "(metadata->>'user_id' = :user_id OR metadata->>'user_id' IS NULL)"
                )
                params["user_id"] = user_id

            # Require search_vector to exist and match
            conditions.append("search_vector IS NOT NULL")
            conditions.append("search_vector @@ plainto_tsquery('english', :query)")

            where_clause = " AND ".join(conditions)

            result = await self.db.execute(
                text(f"""
                    SELECT id, content, file_id, chunk_index, metadata,
                           ts_rank_cd(search_vector, plainto_tsquery('english', :query)) as rank
                    FROM vectors
                    WHERE {where_clause}
                    ORDER BY rank DESC
                    LIMIT :limit
                """),
                params,
            )

            rows = result.fetchall()
            results = []
            for row in rows:
                # Strip HTML tags for readable content
                plain_content = strip_html_tags(row.content)

                # Skip empty content
                if not plain_content or len(plain_content) < 3:
                    continue

                results.append(
                    {
                        "id": row.id,
                        "content": plain_content,
                        "metadata": {
                            "file_id": row.file_id,
                            "chunk_index": row.chunk_index,
                            **(row.metadata or {}),
                        },
                        "keyword_rank": row.rank,
                    }
                )

            return results

        except Exception as e:
            logger.error(f"Keyword search error: {e}")
            return []

    async def hybrid_search(
        self,
        query: str,
        file_ids: list[str] | None = None,
        top_k: int = 5,
        user_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Hybrid search combining semantic (vector) and keyword (BM25) search.

        Uses Reciprocal Rank Fusion (RRF) to combine results from both
        retrieval methods. This handles both semantic similarity and
        exact keyword matches (proper nouns, technical terms).

        Args:
            query: Search query text
            file_ids: Optional list of file IDs to search within
            top_k: Maximum number of results to return
            user_id: Optional user ID to filter results
        """
        settings = get_settings()

        # Check if hybrid search is enabled
        if not settings.hybrid_search_enabled:
            return await self.search(query, file_ids, top_k, user_id)

        # Fetch more candidates for fusion
        expanded_k = top_k * settings.search_expanded_k_multiplier

        # Run semantic and keyword searches in parallel with graceful degradation
        semantic_task = self.search(query, file_ids, expanded_k, user_id)
        keyword_task = self._keyword_search(query, "document", file_ids, user_id, expanded_k)

        semantic_results, keyword_results = await asyncio.gather(
            semantic_task, keyword_task, return_exceptions=True
        )

        # Handle partial failures gracefully
        if isinstance(semantic_results, Exception):
            logger.error(f"Semantic search failed in hybrid_search: {semantic_results}")
            semantic_results = []
        if isinstance(keyword_results, Exception):
            logger.error(f"Keyword search failed in hybrid_search: {keyword_results}")
            keyword_results = []

        # If no keyword results, fall back to semantic only
        if not keyword_results:
            return semantic_results[:top_k]

        # Fuse results using RRF
        fused = reciprocal_rank_fusion(
            semantic_results,
            keyword_results,
            k=settings.rrf_k,
            semantic_weight=settings.semantic_weight,
            keyword_weight=settings.keyword_weight,
        )

        logger.info(
            f"Hybrid search: {len(semantic_results)} semantic, "
            f"{len(keyword_results)} keyword, {len(fused)} fused"
        )

        return fused[:top_k]

    async def hybrid_search_with_rerank(
        self,
        query: str,
        file_ids: list[str] | None = None,
        top_k: int = 5,
        user_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Hybrid search with GPT-based reranking for improved relevance.

        1. Performs hybrid search to get initial candidates
        2. Reranks candidates using GPT with structured outputs
        3. Returns top-k most relevant results

        Args:
            query: Search query text
            file_ids: Optional list of file IDs to search within
            top_k: Maximum number of results to return
            user_id: Optional user ID to filter results
        """
        settings = get_settings()

        # Get more candidates for reranking
        candidates_k = settings.reranking_candidates

        # Get initial candidates via hybrid search
        candidates = await self.hybrid_search(query, file_ids, candidates_k, user_id)

        # Rerank if enabled and we have candidates
        if settings.reranking_enabled and len(candidates) > 1:
            try:
                from services.reranker_service import GPTReranker

                reranker = GPTReranker()
                candidates = await reranker.rerank(query, candidates, top_k)
                logger.info(f"Reranked {len(candidates)} candidates")
            except Exception as e:
                logger.warning(f"Reranking failed, using hybrid results: {e}")

        return candidates[:top_k]

    async def delete_file(self, file_id: str):
        """Delete all vectors for a file."""
        try:
            result = await self.db.execute(
                text("DELETE FROM vectors WHERE file_id = :file_id"), {"file_id": file_id}
            )
            await self.db.commit()
            if result.rowcount > 0:
                logger.info(f"Deleted {result.rowcount} chunks for file {file_id}")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to delete file {file_id}: {e}")

    # -------------------------------------------------------------------------
    # Sentence-level Indexing
    # -------------------------------------------------------------------------

    async def index_file_sentences(
        self, file_id: str, content: str, metadata: dict[str, Any] | None = None
    ):
        """Index a file at sentence level for precise in-document search.

        Uses a transactional approach: embeddings are generated before any
        database changes to prevent data loss if embedding API fails.
        """
        try:
            sentences = SENTENCE_CHUNK_STRATEGY.chunk(content)
            if not sentences:
                return

            # Get embeddings BEFORE touching the database
            embeddings = await get_embeddings_batch(sentences)

            # Delete old sentence chunks and insert new ones in a single transaction
            await self.db.execute(
                text("DELETE FROM vectors WHERE file_id = :file_id AND chunk_type = 'sentence'"),
                {"file_id": file_id},
            )

            # Serialize metadata to JSON string for asyncpg JSONB support
            metadata_json = json.dumps(metadata or {})

            for i, (sentence, embedding) in enumerate(zip(sentences, embeddings, strict=False)):
                chunk_id = f"{file_id}_sent_{i}"
                await self.db.execute(
                    text("""
                        INSERT INTO vectors (id, content, embedding, chunk_type, file_id, chunk_index, metadata)
                        VALUES (:id, :content, :embedding, 'sentence', :file_id, :chunk_index, CAST(:metadata AS jsonb))
                        ON CONFLICT (id) DO UPDATE SET
                            content = EXCLUDED.content,
                            embedding = EXCLUDED.embedding,
                            metadata = EXCLUDED.metadata
                    """),
                    {
                        "id": chunk_id,
                        "content": sentence,
                        "embedding": str(embedding),
                        "file_id": file_id,
                        "chunk_index": i,
                        "metadata": metadata_json,
                    },
                )

            await self.db.commit()
            # Log chunk samples for debugging
            if sentences:
                samples = [s[:50] + "..." if len(s) > 50 else s for s in sentences[:3]]
                logger.info(
                    f"Indexed {len(sentences)} markdown chunks for file {file_id}. "
                    f"Samples: {samples}"
                )

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to index sentences for file {file_id}: {e}")
            raise

    async def search_sentences(
        self,
        query: str,
        file_id: str,
        top_k: int = 10,
        min_score: float = 0.3,
        use_hybrid: bool = True,
    ) -> list[dict[str, Any]]:
        """Search for relevant sentences within a specific file.

        Args:
            query: Search query text
            file_id: File to search within
            top_k: Maximum number of results
            min_score: Minimum similarity score (0-1)
            use_hybrid: Use hybrid search (semantic + keyword with RRF)
        """
        if use_hybrid:
            return await self._hybrid_search_sentences(query, file_id, top_k, min_score)
        return await self._semantic_search_sentences(query, file_id, top_k, min_score)

    async def _semantic_search_sentences(
        self, query: str, file_id: str, top_k: int = 10, min_score: float = 0.3
    ) -> list[dict[str, Any]]:
        """Pure semantic (vector) search for sentences."""
        try:
            query_embedding = await get_embedding(query)

            result = await self.db.execute(
                text("""
                    SELECT id, content, chunk_index, metadata,
                           1 - (embedding <=> :embedding) as score
                    FROM vectors
                    WHERE chunk_type = 'sentence'
                      AND file_id = :file_id
                    ORDER BY embedding <=> :embedding
                    LIMIT :limit
                """),
                {"embedding": str(query_embedding), "file_id": file_id, "limit": top_k * 2},
            )

            rows = result.fetchall()
            results = []
            for row in rows:
                if row.score < min_score:
                    continue
                # Strip HTML tags for readable content
                plain_content = strip_html_tags(row.content)
                if not plain_content or len(plain_content) < 3:
                    continue
                results.append(
                    {
                        "id": row.id,
                        "content": plain_content,
                        "metadata": {
                            "file_id": file_id,
                            "chunk_index": row.chunk_index,
                            **(row.metadata or {}),
                        },
                        "distance": 1 - row.score,
                    }
                )

            return results[:top_k]

        except Exception as e:
            logger.error(f"Semantic sentence search error: {e}")
            return []

    async def _keyword_search_sentences(
        self, query: str, file_id: str, top_k: int = 15
    ) -> list[dict[str, Any]]:
        """Full-text keyword search for sentences within a file."""
        try:
            result = await self.db.execute(
                text("""
                    SELECT id, content, chunk_index, metadata,
                           ts_rank_cd(search_vector, plainto_tsquery('english', :query)) as rank
                    FROM vectors
                    WHERE chunk_type = 'sentence'
                      AND file_id = :file_id
                      AND search_vector IS NOT NULL
                      AND search_vector @@ plainto_tsquery('english', :query)
                    ORDER BY rank DESC
                    LIMIT :limit
                """),
                {"query": query, "file_id": file_id, "limit": top_k},
            )

            rows = result.fetchall()
            results = []
            for row in rows:
                plain_content = strip_html_tags(row.content)
                if not plain_content or len(plain_content) < 3:
                    continue
                results.append(
                    {
                        "id": row.id,
                        "content": plain_content,
                        "metadata": {
                            "file_id": file_id,
                            "chunk_index": row.chunk_index,
                            **(row.metadata or {}),
                        },
                        "keyword_rank": row.rank,
                    }
                )

            return results

        except Exception as e:
            logger.error(f"Keyword sentence search error: {e}")
            return []

    async def _hybrid_search_sentences(
        self, query: str, file_id: str, top_k: int = 10, min_score: float = 0.3
    ) -> list[dict[str, Any]]:
        """Hybrid search for sentences combining semantic and keyword search.

        Uses RRF (Reciprocal Rank Fusion) to combine results.
        """
        settings = get_settings()

        # Fetch more candidates for fusion
        expanded_k = top_k * settings.search_expanded_k_multiplier

        # Run semantic and keyword searches in parallel with graceful degradation
        semantic_task = self._semantic_search_sentences(query, file_id, expanded_k, min_score)
        keyword_task = self._keyword_search_sentences(query, file_id, expanded_k)

        semantic_results, keyword_results = await asyncio.gather(
            semantic_task, keyword_task, return_exceptions=True
        )

        # Handle partial failures gracefully
        if isinstance(semantic_results, Exception):
            logger.error(f"Semantic search failed in hybrid_search_sentences: {semantic_results}")
            semantic_results = []
        if isinstance(keyword_results, Exception):
            logger.error(f"Keyword search failed in hybrid_search_sentences: {keyword_results}")
            keyword_results = []

        # If no keyword results, fall back to semantic only
        if not keyword_results:
            logger.info(
                f"Hybrid sentence search: {len(semantic_results)} semantic only (no keyword matches)"
            )
            return semantic_results[:top_k]

        # Fuse results using RRF
        fused = reciprocal_rank_fusion(
            semantic_results,
            keyword_results,
            k=settings.rrf_k,
            semantic_weight=settings.semantic_weight,
            keyword_weight=settings.keyword_weight,
        )

        logger.info(
            f"Hybrid sentence search: {len(semantic_results)} semantic, "
            f"{len(keyword_results)} keyword, {len(fused)} fused"
        )

        return fused[:top_k]

    async def _delete_sentence_chunks(self, file_id: str):
        """Delete sentence-level chunks for a file."""
        try:
            result = await self.db.execute(
                text("DELETE FROM vectors WHERE file_id = :file_id AND chunk_type = 'sentence'"),
                {"file_id": file_id},
            )
            await self.db.commit()
            if result.rowcount > 0:
                logger.info(f"Deleted {result.rowcount} sentence chunks for file {file_id}")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to delete sentence chunks for {file_id}: {e}")

    # -------------------------------------------------------------------------
    # Knowledge Base Methods
    # -------------------------------------------------------------------------

    async def index_kb_attachment(
        self,
        attachment_id: str,
        conversation_id: str,
        content: str,
        filename: str,
        strategy: ChunkingStrategy | None = None,
    ) -> int:
        """Index a knowledge base attachment.

        Uses a transactional approach: embeddings are generated before any
        database changes to prevent data loss if embedding API fails.

        Args:
            attachment_id: Unique attachment ID
            conversation_id: Conversation this attachment belongs to
            content: Text content to index
            filename: Original filename (used for strategy auto-detection)
            strategy: Optional chunking strategy. If None, auto-detects.
        """
        try:
            # Auto-detect strategy if not provided
            if strategy is None:
                strategy = DEFAULT_STRATEGY_FACTORY.get_strategy(content, filename)

            chunks = strategy.chunk(content)
            if not chunks:
                return 0

            # Get embeddings BEFORE touching the database
            embeddings = await get_embeddings_batch(chunks)
            total_chunks = len(chunks)

            # Delete old KB chunks and insert new ones in a single transaction
            await self.db.execute(
                text("DELETE FROM vectors WHERE attachment_id = :attachment_id"),
                {"attachment_id": attachment_id},
            )

            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=False)):
                chunk_id = f"kb_{attachment_id}_{i}"
                await self.db.execute(
                    text("""
                        INSERT INTO vectors (id, content, embedding, chunk_type, conversation_id, attachment_id, filename, chunk_index, total_chunks)
                        VALUES (:id, :content, :embedding, 'kb', :conversation_id, :attachment_id, :filename, :chunk_index, :total_chunks)
                        ON CONFLICT (id) DO UPDATE SET
                            content = EXCLUDED.content,
                            embedding = EXCLUDED.embedding
                    """),
                    {
                        "id": chunk_id,
                        "content": chunk,
                        "embedding": str(embedding),
                        "conversation_id": conversation_id,
                        "attachment_id": attachment_id,
                        "filename": filename,
                        "chunk_index": i,
                        "total_chunks": total_chunks,
                    },
                )

            await self.db.commit()
            logger.info(f"Indexed {total_chunks} KB chunks for attachment {attachment_id}")
            return total_chunks

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to index KB attachment {attachment_id}: {e}")
            raise

    async def search_kb(
        self,
        conversation_id: str,
        query: str,
        top_k: int = 5,
        use_hybrid: bool = True,
        use_rerank: bool = True,
    ) -> list[dict[str, Any]]:
        """Search within a conversation's knowledge base.

        Args:
            conversation_id: Conversation ID to search within
            query: Search query text
            top_k: Maximum number of results to return
            use_hybrid: Use hybrid search (semantic + keyword with RRF)
            use_rerank: Use GPT reranking for improved relevance

        Returns:
            List of search results with content, metadata, and scores
        """
        settings = get_settings()

        # Check if hybrid/rerank are enabled in settings
        hybrid_enabled = use_hybrid and settings.hybrid_search_enabled
        rerank_enabled = use_rerank and settings.reranking_enabled

        if rerank_enabled:
            return await self.hybrid_search_kb_with_rerank(conversation_id, query, top_k)
        elif hybrid_enabled:
            return await self.hybrid_search_kb(conversation_id, query, top_k)
        else:
            return await self._semantic_search_kb(conversation_id, query, top_k)

    async def _semantic_search_kb(
        self, conversation_id: str, query: str, top_k: int = 5
    ) -> list[dict[str, Any]]:
        """Pure semantic (vector) search within KB."""
        try:
            query_embedding = await get_embedding(query)

            result = await self.db.execute(
                text("""
                    SELECT id, content, attachment_id, filename, chunk_index, total_chunks,
                           1 - (embedding <=> :embedding) as score
                    FROM vectors
                    WHERE chunk_type = 'kb'
                      AND conversation_id = :conversation_id
                    ORDER BY embedding <=> :embedding
                    LIMIT :limit
                """),
                {
                    "embedding": str(query_embedding),
                    "conversation_id": conversation_id,
                    "limit": top_k,
                },
            )

            rows = result.fetchall()
            return [
                {
                    "id": row.id,
                    "content": row.content,
                    "metadata": {
                        "attachment_id": row.attachment_id,
                        "filename": row.filename,
                        "chunk_index": row.chunk_index,
                        "total_chunks": row.total_chunks,
                    },
                    "score": row.score,
                    "source_file": row.filename,
                }
                for row in rows
            ]

        except Exception as e:
            logger.error(f"KB semantic search error: {e}")
            return []

    async def _keyword_search_kb(
        self, conversation_id: str, query: str, top_k: int = 15
    ) -> list[dict[str, Any]]:
        """Full-text keyword search within KB using PostgreSQL tsvector.

        Args:
            conversation_id: Conversation ID to search within
            query: Search query text
            top_k: Maximum number of results to return
        """
        try:
            result = await self.db.execute(
                text("""
                    SELECT id, content, attachment_id, filename, chunk_index, total_chunks,
                           ts_rank_cd(search_vector, plainto_tsquery('english', :query)) as rank
                    FROM vectors
                    WHERE chunk_type = 'kb'
                      AND conversation_id = :conversation_id
                      AND search_vector IS NOT NULL
                      AND search_vector @@ plainto_tsquery('english', :query)
                    ORDER BY rank DESC
                    LIMIT :limit
                """),
                {"query": query, "conversation_id": conversation_id, "limit": top_k},
            )

            rows = result.fetchall()
            return [
                {
                    "id": row.id,
                    "content": row.content,
                    "metadata": {
                        "attachment_id": row.attachment_id,
                        "filename": row.filename,
                        "chunk_index": row.chunk_index,
                        "total_chunks": row.total_chunks,
                    },
                    "score": row.rank,
                    "source_file": row.filename,
                }
                for row in rows
            ]

        except Exception as e:
            logger.error(f"KB keyword search error: {e}")
            return []

    async def hybrid_search_kb(
        self, conversation_id: str, query: str, top_k: int = 5
    ) -> list[dict[str, Any]]:
        """Hybrid search combining semantic and keyword search for KB.

        Uses Reciprocal Rank Fusion (RRF) to combine results from both
        retrieval methods.

        Args:
            conversation_id: Conversation ID to search within
            query: Search query text
            top_k: Maximum number of results to return
        """
        settings = get_settings()

        # Fetch more candidates for fusion
        expanded_k = top_k * settings.search_expanded_k_multiplier

        # Run semantic and keyword searches in parallel with graceful degradation
        semantic_task = self._semantic_search_kb(conversation_id, query, expanded_k)
        keyword_task = self._keyword_search_kb(conversation_id, query, expanded_k)

        semantic_results, keyword_results = await asyncio.gather(
            semantic_task, keyword_task, return_exceptions=True
        )

        # Handle partial failures gracefully
        if isinstance(semantic_results, Exception):
            logger.error(f"Semantic search failed in hybrid_search_kb: {semantic_results}")
            semantic_results = []
        if isinstance(keyword_results, Exception):
            logger.error(f"Keyword search failed in hybrid_search_kb: {keyword_results}")
            keyword_results = []

        # If no keyword results, fall back to semantic only
        if not keyword_results:
            logger.info(
                f"KB hybrid search: {len(semantic_results)} semantic only (no keyword matches)"
            )
            return semantic_results[:top_k]

        # Fuse results using RRF
        fused = reciprocal_rank_fusion(
            semantic_results,
            keyword_results,
            k=settings.rrf_k,
            semantic_weight=settings.semantic_weight,
            keyword_weight=settings.keyword_weight,
        )

        logger.info(
            f"KB hybrid search: {len(semantic_results)} semantic, "
            f"{len(keyword_results)} keyword, {len(fused)} fused"
        )

        return fused[:top_k]

    async def hybrid_search_kb_with_rerank(
        self, conversation_id: str, query: str, top_k: int = 5
    ) -> list[dict[str, Any]]:
        """Hybrid search with GPT-based reranking for KB.

        1. Performs hybrid search to get initial candidates
        2. Reranks candidates using GPT with structured outputs
        3. Returns top-k most relevant results

        Args:
            conversation_id: Conversation ID to search within
            query: Search query text
            top_k: Maximum number of results to return
        """
        settings = get_settings()

        # Get more candidates for reranking
        candidates_k = settings.reranking_candidates

        # Get initial candidates via hybrid search
        candidates = await self.hybrid_search_kb(conversation_id, query, candidates_k)

        # Rerank if we have candidates
        if len(candidates) > 1:
            try:
                from services.reranker_service import GPTReranker

                reranker = GPTReranker()
                candidates = await reranker.rerank(query, candidates, top_k)
                logger.info(f"KB reranked {len(candidates)} candidates")
            except Exception as e:
                logger.warning(f"KB reranking failed, using hybrid results: {e}")

        return candidates[:top_k]

    async def delete_kb_attachment(self, attachment_id: str):
        """Delete all vector chunks for a KB attachment."""
        try:
            result = await self.db.execute(
                text("DELETE FROM vectors WHERE attachment_id = :attachment_id"),
                {"attachment_id": attachment_id},
            )
            await self.db.commit()
            if result.rowcount > 0:
                logger.info(f"Deleted {result.rowcount} KB chunks for attachment {attachment_id}")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to delete KB attachment {attachment_id}: {e}")

    async def get_kb_document_content(
        self, attachment_id: str, start_chunk: int = 0, end_chunk: int | None = None
    ) -> dict[str, Any]:
        """Get ordered content chunks from a KB attachment."""
        try:
            result = await self.db.execute(
                text("""
                    SELECT content, filename, chunk_index, total_chunks
                    FROM vectors
                    WHERE attachment_id = :attachment_id
                    ORDER BY chunk_index
                """),
                {"attachment_id": attachment_id},
            )

            rows = result.fetchall()
            if not rows:
                return {
                    "content": "",
                    "total_chunks": 0,
                    "filename": "Unknown",
                    "chunks_returned": 0,
                }

            total_chunks = rows[0].total_chunks or len(rows)
            filename = rows[0].filename or "Unknown"

            # Apply slice
            rows = rows[start_chunk:end_chunk] if end_chunk is not None else rows[start_chunk:]

            content = "\n\n".join([row.content for row in rows])

            return {
                "content": content,
                "total_chunks": total_chunks,
                "filename": filename,
                "chunks_returned": len(rows),
            }

        except Exception as e:
            logger.error(f"Failed to get KB document content: {e}")
            return {"content": "", "total_chunks": 0, "filename": "Unknown", "chunks_returned": 0}

    # -------------------------------------------------------------------------
    # Utility Methods
    # -------------------------------------------------------------------------

    @staticmethod
    def generate_id(text_content: str) -> str:
        """Generate a unique ID for a text chunk."""
        return hashlib.md5(text_content.encode()).hexdigest()[:16]
