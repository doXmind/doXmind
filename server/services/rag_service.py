"""RAG Service using Chroma for vector storage.

This module provides vector search capabilities for:
- Document chunks (for cross-file search)
- Sentence-level chunks (for in-document search)
- Knowledge base attachments (for conversation-scoped search)
"""

import chromadb
from chromadb.config import Settings
from chromadb.utils.embedding_functions import OpenAIEmbeddingFunction
from typing import List, Optional, Dict, Any
import logging
import hashlib
import re
from abc import ABC, abstractmethod

from config import get_settings

logger = logging.getLogger(__name__)


# ============================================================================
# Chunking Strategies
# ============================================================================

class ChunkingStrategy(ABC):
    """Abstract base class for text chunking strategies."""

    @abstractmethod
    def chunk(self, text: str) -> List[str]:
        """Split text into chunks."""
        pass


class OverlapChunkingStrategy(ChunkingStrategy):
    """Chunk text with overlapping windows.

    Good for general document search where context matters.
    """

    def __init__(self, chunk_size: int = 1000, overlap: int = 200):
        self.chunk_size = chunk_size
        self.overlap = overlap

    def chunk(self, text: str) -> List[str]:
        if not text.strip():
            return []

        chunks = []
        start = 0

        while start < len(text):
            end = start + self.chunk_size
            chunk = text[start:end]

            # Try to break at sentence boundary
            if end < len(text):
                for sep in ["。", ".", "\n\n", "\n"]:
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

    def chunk(self, text: str) -> List[str]:
        if not text.strip():
            return []

        # Strip HTML tags
        clean_text = re.sub(r'<[^>]+>', ' ', text)

        # Split by sentence delimiters (Chinese and English)
        sentences = re.split(r'(?<=[。！？.!?])\s*|\n\n+', clean_text)

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
# Vector Store Manager (Singleton)
# ============================================================================

class VectorStoreManager:
    """Manages Chroma client and collection initialization.

    Uses singleton pattern to ensure single connection.
    """

    _instance = None
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        # Skip if already initialized
        if VectorStoreManager._initialized:
            return

        self._client = None
        self._collection = None
        self._embedding_function = None

    @property
    def collection(self):
        """Get the Chroma collection, initializing if needed."""
        if self._collection is None:
            self._initialize()
        return self._collection

    def _get_embedding_function(self):
        """Get embedding function (OpenAI if available, else default)."""
        if self._embedding_function is not None:
            return self._embedding_function

        settings = get_settings()
        if settings.openai_api_key:
            try:
                self._embedding_function = OpenAIEmbeddingFunction(
                    api_key=settings.openai_api_key,
                    model_name="text-embedding-3-small"
                )
                logger.info("Using OpenAI text-embedding-3-small for embeddings")
            except Exception as e:
                logger.warning(f"Failed to initialize OpenAI embeddings: {e}")
                logger.info("Falling back to default Chroma embeddings")
        else:
            logger.info("No OpenAI API key found, using default Chroma embeddings")

        return self._embedding_function

    def _initialize(self):
        """Initialize Chroma client and collection."""
        settings = get_settings()

        try:
            if settings.use_chroma_server:
                self._client = chromadb.HttpClient(
                    host=settings.chroma_host,
                    port=settings.chroma_port,
                    settings=Settings(anonymized_telemetry=False)
                )
                logger.info(f"Connected to Chroma server at {settings.chroma_host}:{settings.chroma_port}")
            else:
                self._client = chromadb.PersistentClient(
                    path=settings.chroma_persist_dir,
                    settings=Settings(anonymized_telemetry=False)
                )
                logger.info(f"Using local Chroma storage at {settings.chroma_persist_dir}")

            embedding_fn = self._get_embedding_function()
            self._collection = self._client.get_or_create_collection(
                name="documents",
                metadata={"hnsw:space": "cosine"},
                embedding_function=embedding_fn
            )

            VectorStoreManager._initialized = True
            logger.info("Vector store initialized successfully")

        except Exception as e:
            logger.error(f"Failed to initialize vector store: {e}")
            raise RuntimeError(f"Vector store initialization failed: {e}")


# Global manager instance
_manager = None


def get_vector_store_manager() -> VectorStoreManager:
    """Get the singleton vector store manager."""
    global _manager
    if _manager is None:
        _manager = VectorStoreManager()
    return _manager


async def init_vector_store():
    """Initialize the vector store at application startup."""
    try:
        manager = get_vector_store_manager()
        # Access collection to trigger initialization
        _ = manager.collection
    except Exception as e:
        logger.error(f"Failed to initialize vector store: {e}")
        logger.warning("RAG features will be disabled")


# ============================================================================
# RAG Service
# ============================================================================

class RAGService:
    """RAG service for document retrieval.

    Provides methods for indexing and searching documents at
    different granularities (chunks, sentences, KB attachments).
    """

    def __init__(self):
        manager = get_vector_store_manager()
        self.collection = manager.collection

    # -------------------------------------------------------------------------
    # Document Indexing (Chunk-level)
    # -------------------------------------------------------------------------

    async def index_file(
        self,
        file_id: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        strategy: ChunkingStrategy = None
    ):
        """Index a file's content at chunk level.

        Args:
            file_id: Unique file identifier
            content: Text content to index
            metadata: Additional metadata to store
            strategy: Chunking strategy (defaults to overlap chunking)
        """
        try:
            await self.delete_file(file_id)

            strategy = strategy or DEFAULT_CHUNK_STRATEGY
            chunks = strategy.chunk(content)

            if not chunks:
                return

            ids = [f"{file_id}_{i}" for i in range(len(chunks))]
            metadatas = [
                {**(metadata or {}), "file_id": file_id, "chunk_index": i}
                for i in range(len(chunks))
            ]

            self.collection.upsert(ids=ids, documents=chunks, metadatas=metadatas)
            logger.info(f"Indexed {len(chunks)} chunks for file {file_id}")

        except Exception as e:
            logger.error(f"Failed to index file {file_id}: {e}")
            raise

    async def search(
        self,
        query: str,
        file_ids: Optional[List[str]] = None,
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """Search for relevant document chunks.

        Args:
            query: Search query
            file_ids: Optional list of file IDs to search within
            top_k: Maximum number of results

        Returns:
            List of search results with content, metadata, and distance
        """
        try:
            where_filter = {"file_id": {"$in": file_ids}} if file_ids else None

            results = self.collection.query(
                query_texts=[query],
                n_results=top_k,
                where=where_filter
            )

            return self._format_results(results)

        except Exception as e:
            logger.error(f"Search error: {e}")
            return []

    async def delete_file(self, file_id: str):
        """Delete all vectors for a file."""
        try:
            results = self.collection.get(where={"file_id": file_id})
            if results["ids"]:
                self.collection.delete(ids=results["ids"])
                logger.info(f"Deleted {len(results['ids'])} chunks for file {file_id}")
        except Exception as e:
            logger.error(f"Failed to delete file {file_id}: {e}")

    # -------------------------------------------------------------------------
    # Sentence-level Indexing (for in-document search)
    # -------------------------------------------------------------------------

    async def index_file_sentences(
        self,
        file_id: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Index a file at sentence level for precise in-document search.

        Uses separate chunk_type='sentence' to distinguish from regular chunks.
        """
        try:
            await self._delete_sentence_chunks(file_id)

            sentences = SENTENCE_CHUNK_STRATEGY.chunk(content)
            if not sentences:
                return

            sentence_prefix = f"{file_id}_sent"
            ids = [f"{sentence_prefix}_{i}" for i in range(len(sentences))]
            metadatas = [
                {
                    **(metadata or {}),
                    "file_id": file_id,
                    "chunk_index": i,
                    "chunk_type": "sentence"
                }
                for i in range(len(sentences))
            ]

            self.collection.upsert(ids=ids, documents=sentences, metadatas=metadatas)
            logger.info(f"Indexed {len(sentences)} sentences for file {file_id}")

        except Exception as e:
            logger.error(f"Failed to index sentences for file {file_id}: {e}")
            raise

    async def search_sentences(
        self,
        query: str,
        file_id: str,
        top_k: int = 10,
        min_score: float = 0.7
    ) -> List[Dict[str, Any]]:
        """Search for relevant sentences within a specific file.

        Args:
            query: Search query
            file_id: File to search within
            top_k: Maximum number of results
            min_score: Minimum similarity score (0-1), filters by 1-distance

        Returns:
            List of results above the minimum score threshold
        """
        try:
            where_filter = {
                "$and": [
                    {"file_id": file_id},
                    {"chunk_type": "sentence"}
                ]
            }

            results = self.collection.query(
                query_texts=[query],
                n_results=top_k,
                where=where_filter
            )

            # Filter by minimum score
            formatted = []
            for i in range(len(results["ids"][0])):
                distance = results["distances"][0][i] if results.get("distances") else 0
                score = 1 - distance

                if score >= min_score:
                    formatted.append({
                        "id": results["ids"][0][i],
                        "content": results["documents"][0][i],
                        "metadata": results["metadatas"][0][i],
                        "distance": distance
                    })

            logger.info(
                f"Sentence search: {len(results['ids'][0])} total, "
                f"{len(formatted)} after filtering (min_score={min_score})"
            )
            return formatted

        except Exception as e:
            logger.error(f"Sentence search error: {e}")
            return []

    async def _delete_sentence_chunks(self, file_id: str):
        """Delete sentence-level chunks for a file."""
        try:
            results = self.collection.get(
                where={
                    "$and": [
                        {"file_id": file_id},
                        {"chunk_type": "sentence"}
                    ]
                }
            )
            if results["ids"]:
                self.collection.delete(ids=results["ids"])
                logger.info(f"Deleted {len(results['ids'])} sentence chunks for file {file_id}")
        except Exception as e:
            logger.error(f"Failed to delete sentence chunks for {file_id}: {e}")

    # -------------------------------------------------------------------------
    # Knowledge Base Methods (Conversation-level attachments)
    # -------------------------------------------------------------------------

    async def index_kb_attachment(
        self,
        attachment_id: str,
        conversation_id: str,
        content: str,
        filename: str
    ) -> int:
        """Index a knowledge base attachment.

        Args:
            attachment_id: Unique attachment ID
            conversation_id: Conversation this attachment belongs to
            content: Text content to index
            filename: Original filename

        Returns:
            Number of chunks indexed
        """
        try:
            await self.delete_kb_attachment(attachment_id)

            chunks = DEFAULT_CHUNK_STRATEGY.chunk(content)
            if not chunks:
                return 0

            ids = [f"kb_{attachment_id}_{i}" for i in range(len(chunks))]
            metadatas = [
                {
                    "chunk_type": "kb",
                    "conversation_id": conversation_id,
                    "attachment_id": attachment_id,
                    "filename": filename,
                    "chunk_index": i,
                    "total_chunks": len(chunks)
                }
                for i in range(len(chunks))
            ]

            self.collection.upsert(ids=ids, documents=chunks, metadatas=metadatas)
            logger.info(f"Indexed {len(chunks)} KB chunks for attachment {attachment_id}")
            return len(chunks)

        except Exception as e:
            logger.error(f"Failed to index KB attachment {attachment_id}: {e}")
            raise

    async def search_kb(
        self,
        conversation_id: str,
        query: str,
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """Search within a conversation's knowledge base.

        Args:
            conversation_id: Conversation to search within
            query: Search query
            top_k: Maximum number of results

        Returns:
            List of results with content, source info, and scores
        """
        try:
            where_filter = {
                "$and": [
                    {"chunk_type": "kb"},
                    {"conversation_id": conversation_id}
                ]
            }

            results = self.collection.query(
                query_texts=[query],
                n_results=top_k,
                where=where_filter
            )

            formatted = []
            for i in range(len(results["ids"][0])):
                distance = results["distances"][0][i] if results.get("distances") else 0
                score = 1 - distance

                formatted.append({
                    "id": results["ids"][0][i],
                    "content": results["documents"][0][i],
                    "metadata": results["metadatas"][0][i],
                    "score": score,
                    "source_file": results["metadatas"][0][i].get("filename", "Unknown")
                })

            return formatted

        except Exception as e:
            logger.error(f"KB search error: {e}")
            return []

    async def delete_kb_attachment(self, attachment_id: str):
        """Delete all vector chunks for a KB attachment."""
        try:
            results = self.collection.get(where={"attachment_id": attachment_id})
            if results["ids"]:
                self.collection.delete(ids=results["ids"])
                logger.info(f"Deleted {len(results['ids'])} KB chunks for attachment {attachment_id}")
        except Exception as e:
            logger.error(f"Failed to delete KB attachment {attachment_id}: {e}")

    async def get_kb_document_content(
        self,
        attachment_id: str,
        start_chunk: int = 0,
        end_chunk: Optional[int] = None
    ) -> Dict[str, Any]:
        """Get ordered content chunks from a KB attachment.

        Args:
            attachment_id: Attachment ID
            start_chunk: Starting chunk index
            end_chunk: Ending chunk index (exclusive)

        Returns:
            Dict with content, total_chunks, filename, and chunks_returned
        """
        try:
            results = self.collection.get(where={"attachment_id": attachment_id})

            if not results["ids"]:
                return {"content": "", "total_chunks": 0, "filename": "Unknown", "chunks_returned": 0}

            # Sort by chunk_index
            chunks_with_meta = sorted(
                zip(results["documents"], results["metadatas"]),
                key=lambda x: x[1].get("chunk_index", 0)
            )

            total_chunks = len(chunks_with_meta)
            filename = chunks_with_meta[0][1].get("filename", "Unknown") if chunks_with_meta else "Unknown"

            # Slice if needed
            if end_chunk is not None:
                chunks_with_meta = chunks_with_meta[start_chunk:end_chunk]
            else:
                chunks_with_meta = chunks_with_meta[start_chunk:]

            content = "\n\n".join([c[0] for c in chunks_with_meta])

            return {
                "content": content,
                "total_chunks": total_chunks,
                "filename": filename,
                "chunks_returned": len(chunks_with_meta)
            }

        except Exception as e:
            logger.error(f"Failed to get KB document content: {e}")
            return {"content": "", "total_chunks": 0, "filename": "Unknown", "chunks_returned": 0}

    # -------------------------------------------------------------------------
    # Utility Methods
    # -------------------------------------------------------------------------

    def _format_results(self, results: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Format Chroma query results into a standard format."""
        formatted = []
        for i in range(len(results["ids"][0])):
            formatted.append({
                "id": results["ids"][0][i],
                "content": results["documents"][0][i],
                "metadata": results["metadatas"][0][i],
                "distance": results["distances"][0][i] if results.get("distances") else None
            })
        return formatted

    @staticmethod
    def generate_id(text: str) -> str:
        """Generate a unique ID for a text chunk."""
        return hashlib.md5(text.encode()).hexdigest()[:16]
