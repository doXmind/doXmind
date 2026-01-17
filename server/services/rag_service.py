"""RAG Service using PostgreSQL pgvector for vector storage.

This module provides vector search capabilities using pgvector extension:
- Document chunks (for cross-file search)
- Sentence-level chunks (for in-document search)
- Knowledge base attachments (for conversation-scoped search)

Requires: PostgreSQL with pgvector extension enabled
"""

import hashlib
import json
import logging
import re
from abc import ABC, abstractmethod
from typing import Any

import openai
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings

logger = logging.getLogger(__name__)

# Embedding dimension for text-embedding-3-small
EMBEDDING_DIMENSION = 1536


# ============================================================================
# Chunking Strategies
# ============================================================================

class ChunkingStrategy(ABC):
    """Abstract base class for text chunking strategies."""

    @abstractmethod
    def chunk(self, text: str) -> list[str]:
        """Split text into chunks."""
        pass


class OverlapChunkingStrategy(ChunkingStrategy):
    """Chunk text with overlapping windows.

    Good for general document search where context matters.
    """

    def __init__(self, chunk_size: int = 1000, overlap: int = 200):
        self.chunk_size = chunk_size
        self.overlap = overlap

    def chunk(self, text: str) -> list[str]:
        if not text.strip():
            return []

        chunks = []
        start = 0

        while start < len(text):
            end = start + self.chunk_size
            chunk = text[start:end]

            # Try to break at sentence boundary
            if end < len(text):
                for sep in ["\u3002", ".", "\n\n", "\n"]:
                    last_sep = chunk.rfind(sep)
                    if last_sep > self.chunk_size // 2:
                        chunk = chunk[:last_sep + 1]
                        end = start + last_sep + 1
                        break

            chunk = chunk.strip()
            if chunk:
                chunks.append(chunk)

            start = end - self.overlap

        return chunks


class SentenceChunkingStrategy(ChunkingStrategy):
    """Chunk text into individual sentences.

    Good for precise in-document search and highlighting.
    """

    def __init__(self, min_length: int = 5):
        self.min_length = min_length

    def chunk(self, text: str) -> list[str]:
        if not text.strip():
            return []

        # Strip HTML tags
        clean_text = re.sub(r'<[^>]+>', ' ', text)

        # Split by sentence delimiters (Chinese and English)
        sentences = re.split(r'(?<=[\u3002\uff01\uff1f.!?])\s*|\n\n+', clean_text)

        chunks = []
        for sentence in sentences:
            sentence = sentence.strip()
            if sentence and len(sentence) > self.min_length:
                chunks.append(sentence)

        return chunks


# Default strategies
DEFAULT_CHUNK_STRATEGY = OverlapChunkingStrategy()
SENTENCE_CHUNK_STRATEGY = SentenceChunkingStrategy()


# ============================================================================
# Embedding Functions
# ============================================================================

async def get_embedding(text_content: str) -> list[float]:
    """Generate embedding vector for text using OpenAI."""
    settings = get_settings()

    if not settings.openai_api_key:
        raise RuntimeError("OpenAI API key required for pgvector embeddings")

    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=text_content
    )
    return response.data[0].embedding


async def get_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for multiple texts in a batch."""
    settings = get_settings()

    if not settings.openai_api_key:
        raise RuntimeError("OpenAI API key required for pgvector embeddings")

    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=texts
    )
    return [item.embedding for item in response.data]


# ============================================================================
# Database Initialization
# ============================================================================

async def init_pgvector(db: AsyncSession):
    """Initialize pgvector extension and create vector table.

    Should be called once at application startup.
    """
    settings = get_settings()

    if not settings.pgvector_enabled:
        logger.info("pgvector is disabled via PGVECTOR_ENABLED=false")
        return

    try:
        # Create pgvector extension
        await db.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

        # Check if vectors table exists with wrong column type (e.g., TEXT instead of VECTOR)
        # This can happen if tests created the table with a mock schema
        result = await db.execute(text("""
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'vectors' AND column_name = 'embedding'
        """))
        row = result.fetchone()

        if row and row[0] == 'text':
            # Table exists with wrong type, drop and recreate
            logger.warning("Vectors table has TEXT embedding column, recreating with VECTOR type")
            await db.execute(text("DROP TABLE IF EXISTS vectors CASCADE"))

        # Create vectors table for storing all embeddings
        await db.execute(text(f"""
            CREATE TABLE IF NOT EXISTS vectors (
                id VARCHAR(255) PRIMARY KEY,
                content TEXT NOT NULL,
                embedding VECTOR({EMBEDDING_DIMENSION}),
                chunk_type VARCHAR(50) NOT NULL,
                file_id VARCHAR(36),
                conversation_id VARCHAR(36),
                attachment_id VARCHAR(36),
                filename VARCHAR(255),
                chunk_index INTEGER,
                total_chunks INTEGER,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))

        # Create indexes for efficient querying
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_vectors_file_id ON vectors(file_id)"
        ))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_vectors_conversation_id ON vectors(conversation_id)"
        ))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_vectors_chunk_type ON vectors(chunk_type)"
        ))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_vectors_attachment_id ON vectors(attachment_id)"
        ))

        # Create HNSW index for vector similarity search (cosine distance)
        await db.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_vectors_embedding
            ON vectors USING hnsw (embedding vector_cosine_ops)
        """))

        await db.commit()
        logger.info("pgvector initialized successfully")

    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to initialize pgvector: {e}")
        raise


# ============================================================================
# RAG Service
# ============================================================================

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
        strategy: ChunkingStrategy | None = None
    ):
        """Index a file's content at chunk level."""
        try:
            await self.delete_file(file_id)

            strategy = strategy or DEFAULT_CHUNK_STRATEGY
            chunks = strategy.chunk(content)

            if not chunks:
                return

            # Get embeddings in batch
            embeddings = await get_embeddings_batch(chunks)

            # Insert chunks with embeddings
            # Serialize metadata to JSON string for asyncpg JSONB support
            metadata_json = json.dumps(metadata or {})

            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=False)):
                chunk_id = f"{file_id}_{i}"
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
                        "metadata": metadata_json
                    }
                )

            await self.db.commit()
            logger.info(f"Indexed {len(chunks)} chunks for file {file_id}")

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to index file {file_id}: {e}")
            raise

    async def search(
        self,
        query: str,
        file_ids: list[str] | None = None,
        top_k: int = 5
    ) -> list[dict[str, Any]]:
        """Search for relevant document chunks using cosine similarity."""
        try:
            query_embedding = await get_embedding(query)

            # Build query with optional file filter
            if file_ids:
                result = await self.db.execute(
                    text("""
                        SELECT id, content, file_id, chunk_index, metadata,
                               1 - (embedding <=> :embedding) as score
                        FROM vectors
                        WHERE chunk_type = 'document'
                          AND file_id = ANY(:file_ids)
                        ORDER BY embedding <=> :embedding
                        LIMIT :limit
                    """),
                    {"embedding": str(query_embedding), "file_ids": file_ids, "limit": top_k}
                )
            else:
                result = await self.db.execute(
                    text("""
                        SELECT id, content, file_id, chunk_index, metadata,
                               1 - (embedding <=> :embedding) as score
                        FROM vectors
                        WHERE chunk_type = 'document'
                        ORDER BY embedding <=> :embedding
                        LIMIT :limit
                    """),
                    {"embedding": str(query_embedding), "limit": top_k}
                )

            rows = result.fetchall()
            return [
                {
                    "id": row.id,
                    "content": row.content,
                    "metadata": {"file_id": row.file_id, "chunk_index": row.chunk_index, **(row.metadata or {})},
                    "distance": 1 - row.score
                }
                for row in rows
            ]

        except Exception as e:
            logger.error(f"Search error: {e}")
            return []

    async def delete_file(self, file_id: str):
        """Delete all vectors for a file."""
        try:
            result = await self.db.execute(
                text("DELETE FROM vectors WHERE file_id = :file_id"),
                {"file_id": file_id}
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
        self,
        file_id: str,
        content: str,
        metadata: dict[str, Any] | None = None
    ):
        """Index a file at sentence level for precise in-document search."""
        try:
            await self._delete_sentence_chunks(file_id)

            sentences = SENTENCE_CHUNK_STRATEGY.chunk(content)
            if not sentences:
                return

            embeddings = await get_embeddings_batch(sentences)

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
                        "metadata": metadata_json
                    }
                )

            await self.db.commit()
            logger.info(f"Indexed {len(sentences)} sentences for file {file_id}")

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to index sentences for file {file_id}: {e}")
            raise

    async def search_sentences(
        self,
        query: str,
        file_id: str,
        top_k: int = 10,
        min_score: float = 0.7
    ) -> list[dict[str, Any]]:
        """Search for relevant sentences within a specific file."""
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
                {"embedding": str(query_embedding), "file_id": file_id, "limit": top_k}
            )

            rows = result.fetchall()
            results = [
                {
                    "id": row.id,
                    "content": row.content,
                    "metadata": {"file_id": file_id, "chunk_index": row.chunk_index, "chunk_type": "sentence"},
                    "distance": 1 - row.score
                }
                for row in rows
                if row.score >= min_score
            ]

            logger.info(f"Sentence search: {len(rows)} total, {len(results)} after filtering (min_score={min_score})")
            return results

        except Exception as e:
            logger.error(f"Sentence search error: {e}")
            return []

    async def _delete_sentence_chunks(self, file_id: str):
        """Delete sentence-level chunks for a file."""
        try:
            result = await self.db.execute(
                text("DELETE FROM vectors WHERE file_id = :file_id AND chunk_type = 'sentence'"),
                {"file_id": file_id}
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
        filename: str
    ) -> int:
        """Index a knowledge base attachment."""
        try:
            await self.delete_kb_attachment(attachment_id)

            chunks = DEFAULT_CHUNK_STRATEGY.chunk(content)
            if not chunks:
                return 0

            embeddings = await get_embeddings_batch(chunks)
            total_chunks = len(chunks)

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
                        "total_chunks": total_chunks
                    }
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
        top_k: int = 5
    ) -> list[dict[str, Any]]:
        """Search within a conversation's knowledge base."""
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
                {"embedding": str(query_embedding), "conversation_id": conversation_id, "limit": top_k}
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
                        "total_chunks": row.total_chunks
                    },
                    "score": row.score,
                    "source_file": row.filename
                }
                for row in rows
            ]

        except Exception as e:
            logger.error(f"KB search error: {e}")
            return []

    async def delete_kb_attachment(self, attachment_id: str):
        """Delete all vector chunks for a KB attachment."""
        try:
            result = await self.db.execute(
                text("DELETE FROM vectors WHERE attachment_id = :attachment_id"),
                {"attachment_id": attachment_id}
            )
            await self.db.commit()
            if result.rowcount > 0:
                logger.info(f"Deleted {result.rowcount} KB chunks for attachment {attachment_id}")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to delete KB attachment {attachment_id}: {e}")

    async def get_kb_document_content(
        self,
        attachment_id: str,
        start_chunk: int = 0,
        end_chunk: int | None = None
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
                {"attachment_id": attachment_id}
            )

            rows = result.fetchall()
            if not rows:
                return {"content": "", "total_chunks": 0, "filename": "Unknown", "chunks_returned": 0}

            total_chunks = rows[0].total_chunks or len(rows)
            filename = rows[0].filename or "Unknown"

            # Apply slice
            if end_chunk is not None:
                rows = rows[start_chunk:end_chunk]
            else:
                rows = rows[start_chunk:]

            content = "\n\n".join([row.content for row in rows])

            return {
                "content": content,
                "total_chunks": total_chunks,
                "filename": filename,
                "chunks_returned": len(rows)
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
