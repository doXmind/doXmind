"""RAG Service - backward compatibility shim.

This module has been split into the services.rag package:
- services/rag/html_utils.py   - HTML utilities and RRF fusion
- services/rag/chunking.py     - All chunking strategies
- services/rag/embedding.py    - Embedding functions
- services/rag/pgvector_init.py - Database initialization
- services/rag/search.py       - RAGService class

All imports from this module are re-exported from services.rag.
"""

from services.rag import *  # noqa: F401, F403
