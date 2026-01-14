"""RAG Service using Chroma for vector storage."""

import chromadb
from chromadb.config import Settings
from chromadb.utils.embedding_functions import OpenAIEmbeddingFunction
from typing import List, Optional
import logging
import hashlib

from config import get_settings

logger = logging.getLogger(__name__)

# Global client instance
_chroma_client = None
_collection = None
_embedding_function = None


def _get_embedding_function():
    """Get the OpenAI embedding function, or None to use default Chroma embeddings."""
    global _embedding_function

    if _embedding_function is None:
        settings = get_settings()
        if settings.openai_api_key:
            try:
                _embedding_function = OpenAIEmbeddingFunction(
                    api_key=settings.openai_api_key,
                    model_name="text-embedding-3-small"
                )
                logger.info("Using OpenAI text-embedding-3-small for embeddings")
            except Exception as e:
                logger.warning(f"Failed to initialize OpenAI embeddings: {e}")
                logger.info("Falling back to default Chroma embeddings")
                _embedding_function = None
        else:
            logger.info("No OpenAI API key found, using default Chroma embeddings")
            _embedding_function = None

    return _embedding_function


async def init_vector_store():
    """Initialize the vector store."""
    global _chroma_client, _collection

    settings = get_settings()

    try:
        if settings.use_chroma_server:
            # Use Chroma server (Docker mode)
            _chroma_client = chromadb.HttpClient(
                host=settings.chroma_host,
                port=settings.chroma_port,
                settings=Settings(anonymized_telemetry=False)
            )
            logger.info(f"Connected to Chroma server at {settings.chroma_host}:{settings.chroma_port}")
        else:
            # Use local persistent storage
            _chroma_client = chromadb.PersistentClient(
                path=settings.chroma_persist_dir,
                settings=Settings(anonymized_telemetry=False)
            )
            logger.info(f"Using local Chroma storage at {settings.chroma_persist_dir}")

        # Get the embedding function (OpenAI if available)
        embedding_fn = _get_embedding_function()

        _collection = _chroma_client.get_or_create_collection(
            name="documents",
            metadata={"hnsw:space": "cosine"},
            embedding_function=embedding_fn
        )

        logger.info("Vector store initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize vector store: {e}")
        # Don't raise - allow app to work without vector store
        logger.warning("RAG features will be disabled")


def _ensure_initialized():
    """Ensure vector store is initialized (lazy initialization)."""
    global _chroma_client, _collection

    if _collection is not None:
        return True

    settings = get_settings()

    try:
        if settings.use_chroma_server:
            _chroma_client = chromadb.HttpClient(
                host=settings.chroma_host,
                port=settings.chroma_port,
                settings=Settings(anonymized_telemetry=False)
            )
            logger.info(f"Connected to Chroma server at {settings.chroma_host}:{settings.chroma_port}")
        else:
            _chroma_client = chromadb.PersistentClient(
                path=settings.chroma_persist_dir,
                settings=Settings(anonymized_telemetry=False)
            )
            logger.info(f"Using local Chroma storage at {settings.chroma_persist_dir}")

        embedding_fn = _get_embedding_function()

        _collection = _chroma_client.get_or_create_collection(
            name="documents",
            metadata={"hnsw:space": "cosine"},
            embedding_function=embedding_fn
        )

        logger.info("Vector store initialized successfully (lazy)")
        return True
    except Exception as e:
        logger.error(f"Failed to initialize vector store: {e}")
        return False


class RAGService:
    """RAG service for document retrieval."""

    def __init__(self):
        # Try lazy initialization if not already initialized
        if _collection is None:
            if not _ensure_initialized():
                raise RuntimeError("Vector store not initialized")
        self.collection = _collection

    async def index_file(
        self,
        file_id: str,
        content: str,
        metadata: Optional[dict] = None
    ):
        """Index a file's content."""
        try:
            # Remove existing chunks for this file
            await self.delete_file(file_id)

            # Split content into chunks
            chunks = self._chunk_text(content)

            if not chunks:
                return

            # Generate IDs for chunks
            ids = [f"{file_id}_{i}" for i in range(len(chunks))]

            # Prepare metadata
            metadatas = [
                {
                    **(metadata or {}),
                    "file_id": file_id,
                    "chunk_index": i
                }
                for i in range(len(chunks))
            ]

            # Add to collection
            self.collection.upsert(
                ids=ids,
                documents=chunks,
                metadatas=metadatas
            )

            logger.info(f"Indexed {len(chunks)} chunks for file {file_id}")
        except Exception as e:
            logger.error(f"Failed to index file {file_id}: {e}")
            raise

    async def search(
        self,
        query: str,
        file_ids: Optional[List[str]] = None,
        top_k: int = 5
    ) -> List[dict]:
        """Search for relevant documents."""
        try:
            where_filter = None
            if file_ids:
                where_filter = {"file_id": {"$in": file_ids}}

            results = self.collection.query(
                query_texts=[query],
                n_results=top_k,
                where=where_filter
            )

            # Format results
            formatted = []
            for i in range(len(results["ids"][0])):
                formatted.append({
                    "id": results["ids"][0][i],
                    "content": results["documents"][0][i],
                    "metadata": results["metadatas"][0][i],
                    "distance": results["distances"][0][i] if results.get("distances") else None
                })

            return formatted
        except Exception as e:
            logger.error(f"Search error: {e}")
            return []

    async def delete_file(self, file_id: str):
        """Delete all vectors for a file."""
        try:
            # Get all IDs for this file
            results = self.collection.get(
                where={"file_id": file_id}
            )

            if results["ids"]:
                self.collection.delete(ids=results["ids"])
                logger.info(f"Deleted {len(results['ids'])} chunks for file {file_id}")
        except Exception as e:
            logger.error(f"Failed to delete file {file_id}: {e}")

    def _chunk_text(
        self,
        text: str,
        chunk_size: int = 1000,
        overlap: int = 200
    ) -> List[str]:
        """Split text into overlapping chunks."""
        if not text.strip():
            return []

        chunks = []
        start = 0

        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end]

            # Try to break at sentence boundary
            if end < len(text):
                # Look for sentence endings
                for sep in ["。", ".", "\n\n", "\n"]:
                    last_sep = chunk.rfind(sep)
                    if last_sep > chunk_size // 2:
                        chunk = chunk[:last_sep + 1]
                        end = start + last_sep + 1
                        break

            chunk = chunk.strip()
            if chunk:
                chunks.append(chunk)

            start = end - overlap

        return chunks

    def _chunk_text_sentences(self, text: str) -> List[str]:
        """Split text into sentence-level chunks for in-document search.

        Uses multiple sentence delimiters to handle both Chinese and English text.
        Each sentence becomes its own chunk for precise in-document highlighting.
        """
        import re

        if not text.strip():
            return []

        # Strip HTML tags for cleaner text processing
        clean_text = re.sub(r'<[^>]+>', ' ', text)

        # Split by sentence delimiters (Chinese and English)
        # Handles: 。！？.!? and also paragraph breaks
        sentences = re.split(r'(?<=[。！？.!?])\s*|\n\n+', clean_text)

        chunks = []
        for sentence in sentences:
            sentence = sentence.strip()
            # Only include sentences with meaningful content (more than 5 chars)
            if sentence and len(sentence) > 5:
                chunks.append(sentence)

        return chunks

    async def index_file_sentences(
        self,
        file_id: str,
        content: str,
        metadata: Optional[dict] = None
    ):
        """Index a file's content at sentence level for in-document search.

        Uses a separate collection suffix (_sentences) to avoid conflicts
        with the regular chunk-based index.
        """
        try:
            # Use a different ID prefix for sentence-level chunks
            sentence_prefix = f"{file_id}_sent"

            # Remove existing sentence chunks for this file
            await self._delete_sentence_chunks(file_id)

            # Split content into sentences
            sentences = self._chunk_text_sentences(content)

            if not sentences:
                return

            # Generate IDs for sentence chunks
            ids = [f"{sentence_prefix}_{i}" for i in range(len(sentences))]

            # Prepare metadata
            metadatas = [
                {
                    **(metadata or {}),
                    "file_id": file_id,
                    "chunk_index": i,
                    "chunk_type": "sentence"
                }
                for i in range(len(sentences))
            ]

            # Add to collection
            self.collection.upsert(
                ids=ids,
                documents=sentences,
                metadatas=metadatas
            )

            logger.info(f"Indexed {len(sentences)} sentences for file {file_id}")
        except Exception as e:
            logger.error(f"Failed to index sentences for file {file_id}: {e}")
            raise

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

    async def search_sentences(
        self,
        query: str,
        file_id: str,
        top_k: int = 10,
        min_score: float = 0.7
    ) -> List[dict]:
        """Search for relevant sentences within a specific file.

        This is optimized for in-document search where we need
        sentence-level granularity for precise highlighting.

        Args:
            query: Search query
            file_id: File to search within
            top_k: Maximum number of results
            min_score: Minimum similarity score (0-1). Default 0.5.
                      Chroma uses cosine distance, so score = 1 - distance.
                      0.5 means distance < 0.5 (fairly similar)
                      0.7 means distance < 0.3 (very similar)
        """
        try:
            # Filter to only sentence chunks for this specific file
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

            # Format results and filter by similarity score
            formatted = []
            for i in range(len(results["ids"][0])):
                distance = results["distances"][0][i] if results.get("distances") else 0
                score = 1 - distance  # Convert distance to similarity score

                # Only include results above the minimum score threshold
                if score >= min_score:
                    formatted.append({
                        "id": results["ids"][0][i],
                        "content": results["documents"][0][i],
                        "metadata": results["metadatas"][0][i],
                        "distance": distance
                    })

            logger.info(f"Sentence search: {len(results['ids'][0])} total, {len(formatted)} after filtering (min_score={min_score})")
            return formatted
        except Exception as e:
            logger.error(f"Sentence search error: {e}")
            return []

    def _generate_id(self, text: str) -> str:
        """Generate a unique ID for a text chunk."""
        return hashlib.md5(text.encode()).hexdigest()[:16]

    # =========================================================================
    # Knowledge Base Methods (Conversation-level attachments)
    # =========================================================================

    async def index_kb_attachment(
        self,
        attachment_id: str,
        conversation_id: str,
        content: str,
        filename: str
    ) -> int:
        """Index a knowledge base attachment with conversation scoping.

        Args:
            attachment_id: Unique ID of the attachment
            conversation_id: ID of the conversation this attachment belongs to
            content: Text content to index (usually markdown)
            filename: Original filename for metadata

        Returns:
            Number of chunks indexed
        """
        try:
            # First delete any existing chunks for this attachment
            await self.delete_kb_attachment(attachment_id)

            # Split content into chunks
            chunks = self._chunk_text(content)

            if not chunks:
                return 0

            # Generate IDs with KB prefix
            ids = [f"kb_{attachment_id}_{i}" for i in range(len(chunks))]

            # Prepare metadata with KB-specific fields
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

            # Add to collection
            self.collection.upsert(
                ids=ids,
                documents=chunks,
                metadatas=metadatas
            )

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
    ) -> List[dict]:
        """Search within a conversation's knowledge base attachments.

        Args:
            conversation_id: ID of the conversation to search within
            query: Search query
            top_k: Maximum number of results

        Returns:
            List of search results with content, source info, and scores
        """
        try:
            # Filter to only KB chunks for this conversation
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

            # Format results
            formatted = []
            for i in range(len(results["ids"][0])):
                distance = results["distances"][0][i] if results.get("distances") else 0
                score = 1 - distance  # Convert distance to similarity

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
        """Delete all vector chunks for a KB attachment.

        Args:
            attachment_id: ID of the attachment to delete
        """
        try:
            # Get all IDs for this attachment
            results = self.collection.get(
                where={"attachment_id": attachment_id}
            )

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
    ) -> dict:
        """Get ordered content chunks from a KB attachment.

        Args:
            attachment_id: ID of the attachment
            start_chunk: Starting chunk index
            end_chunk: Ending chunk index (exclusive), None for all

        Returns:
            Dict with content, total_chunks, and metadata
        """
        try:
            results = self.collection.get(
                where={"attachment_id": attachment_id}
            )

            if not results["ids"]:
                return {"content": "", "total_chunks": 0, "filename": "Unknown"}

            # Sort by chunk_index
            chunks_with_meta = list(zip(
                results["documents"],
                results["metadatas"]
            ))
            chunks_with_meta.sort(key=lambda x: x[1].get("chunk_index", 0))

            total_chunks = len(chunks_with_meta)
            filename = chunks_with_meta[0][1].get("filename", "Unknown") if chunks_with_meta else "Unknown"

            # Slice if needed
            if end_chunk is not None:
                chunks_with_meta = chunks_with_meta[start_chunk:end_chunk]
            else:
                chunks_with_meta = chunks_with_meta[start_chunk:]

            # Join content
            content = "\n\n".join([c[0] for c in chunks_with_meta])

            return {
                "content": content,
                "total_chunks": total_chunks,
                "filename": filename,
                "chunks_returned": len(chunks_with_meta)
            }
        except Exception as e:
            logger.error(f"Failed to get KB document content: {e}")
            return {"content": "", "total_chunks": 0, "filename": "Unknown"}
