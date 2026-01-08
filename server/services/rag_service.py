"""RAG Service using Chroma for vector storage."""

import chromadb
from chromadb.config import Settings
from typing import List, Optional
import logging
import hashlib

from config import get_settings

logger = logging.getLogger(__name__)

# Global client instance
_chroma_client = None
_collection = None


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

        _collection = _chroma_client.get_or_create_collection(
            name="documents",
            metadata={"hnsw:space": "cosine"}
        )

        logger.info("Vector store initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize vector store: {e}")
        # Don't raise - allow app to work without vector store
        logger.warning("RAG features will be disabled")


class RAGService:
    """RAG service for document retrieval."""

    def __init__(self):
        if _collection is None:
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

    def _generate_id(self, text: str) -> str:
        """Generate a unique ID for a text chunk."""
        return hashlib.md5(text.encode()).hexdigest()[:16]
