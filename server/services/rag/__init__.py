"""RAG (Retrieval-Augmented Generation) package.

Provides vector search capabilities using pgvector:
- Document chunk indexing and search
- Sentence-level indexing for in-document search
- Knowledge base attachment indexing and search
- Hybrid search (semantic + keyword with RRF fusion)

Usage:
    from services.rag import RAGService, init_pgvector
    from services.rag import DEFAULT_STRATEGY_FACTORY, ChunkingStrategyFactory
"""

from services.rag.chunking import (
    DEFAULT_CHUNK_STRATEGY,
    DEFAULT_STRATEGY_FACTORY,
    LEGACY_OVERLAP_STRATEGY,
    LEGACY_SENTENCE_STRATEGY,
    RECURSIVE_MARKDOWN_STRATEGY,
    SEMANTIC_CHUNK_STRATEGY,
    SENTENCE_CHUNK_STRATEGY,
    ChunkingStrategy,
    ChunkingStrategyFactory,
    ChunkingStrategyType,
    MarkdownSentenceChunkingStrategy,
    OverlapChunkingStrategy,
    RecursiveMarkdownChunkingStrategy,
    SemanticChunkingStrategy,
    SentenceChunkingStrategy,
)
from services.rag.embedding import get_embedding, get_embeddings_batch
from services.rag.html_utils import EMBEDDING_DIMENSION, reciprocal_rank_fusion, strip_html_tags
from services.rag.pgvector_init import init_pgvector
from services.rag.search import RAGService

__all__ = [
    # Search service
    "RAGService",
    # Initialization
    "init_pgvector",
    # Embedding
    "get_embedding",
    "get_embeddings_batch",
    # HTML utilities
    "strip_html_tags",
    "reciprocal_rank_fusion",
    "EMBEDDING_DIMENSION",
    # Chunking strategies
    "ChunkingStrategy",
    "OverlapChunkingStrategy",
    "MarkdownSentenceChunkingStrategy",
    "SentenceChunkingStrategy",
    "SemanticChunkingStrategy",
    "RecursiveMarkdownChunkingStrategy",
    # Strategy selection
    "ChunkingStrategyType",
    "ChunkingStrategyFactory",
    # Default instances
    "DEFAULT_CHUNK_STRATEGY",
    "SENTENCE_CHUNK_STRATEGY",
    "LEGACY_SENTENCE_STRATEGY",
    "LEGACY_OVERLAP_STRATEGY",
    "SEMANTIC_CHUNK_STRATEGY",
    "RECURSIVE_MARKDOWN_STRATEGY",
    "DEFAULT_STRATEGY_FACTORY",
]
