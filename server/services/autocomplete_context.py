"""Autocomplete context assembly service.

Provides methods for assembling context from multiple sources
(current file, RAG-retrieved chunks, file structure) for autocomplete
suggestions in both short and long modes.
"""

import logging
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import File
from services.rag.search import RAGService
from services.token_utils import count_tokens, truncate_to_token_limit

logger = logging.getLogger(__name__)


@dataclass
class ShortContextParams:
    """Parameters for short mode context assembly."""

    current_text_before: str
    current_text_after: str
    file_id: str
    open_file_ids: list[str]
    max_tokens: int = 4000


@dataclass
class LongContextParams:
    """Parameters for long mode context assembly."""

    current_text_before: str
    current_text_after: str
    file_id: str
    open_file_ids: list[str]
    user_id: str | None = None
    max_tokens: int = 20000


class AutocompleteContextService:
    """Service for assembling autocomplete context from multiple sources."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.rag = RAGService(db)
        self.settings = get_settings()

    async def get_rag_chunks(
        self,
        query: str,
        file_ids: list[str],
        top_k: int = 5,
        user_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Retrieve relevant chunks from specified files using RAG.

        Args:
            query: Query text (typically last 500 chars of current context)
            file_ids: List of file IDs to search within
            top_k: Number of chunks to retrieve
            user_id: Optional user ID for filtering

        Returns:
            List of chunk dictionaries with content and metadata
        """
        if not file_ids or not query:
            return []

        try:
            # Use hybrid search for better relevance
            results = await self.rag.hybrid_search(
                query=query,
                file_ids=file_ids,
                top_k=top_k,
                user_id=user_id,
            )

            # Filter out very low relevance results (distance > 0.6)
            filtered = [r for r in results if r.get("distance", 1.0) < 0.6]

            logger.info(
                f"RAG retrieved {len(filtered)}/{len(results)} relevant chunks from {len(file_ids)} files"
            )
            return filtered

        except Exception as e:
            logger.error(f"RAG retrieval failed: {e}")
            return []

    async def get_open_files_context(
        self,
        file_ids: list[str],
        max_chars: int = 1000,
        user_id: str | None = None,
    ) -> str:
        """Get brief context from open files (first/last 200 chars of each).

        Args:
            file_ids: List of file IDs to fetch
            max_chars: Maximum total characters to return
            user_id: Optional user ID for filtering

        Returns:
            Formatted string with file names and content snippets
        """
        if not file_ids:
            return ""

        try:
            # Fetch file metadata and content (exclude trash)
            query = select(File).where(File.id.in_(file_ids), File.deleted_at.is_(None))

            if user_id:
                query = query.where(File.user_id == user_id)

            result = await self.db.execute(query)
            files = result.scalars().all()

            if not files:
                return ""

            context_parts = []
            total_chars = 0

            for file in files:
                if not file.content or file.is_folder:
                    continue

                # Get first 200 and last 200 chars
                content = file.content.strip()
                if len(content) > 400:
                    snippet = f"{content[:200]}...\n\n...{content[-200:]}"
                else:
                    snippet = content

                file_context = f"## {file.name}\n{snippet}\n"
                context_parts.append(file_context)
                total_chars += len(file_context)

                if total_chars >= max_chars:
                    break

            result_context = "\n".join(context_parts)
            if total_chars > max_chars:
                result_context = result_context[:max_chars]

            logger.info(
                f"Assembled open files context: {total_chars} chars from {len(files)} files"
            )
            return result_context

        except Exception as e:
            logger.error(f"Failed to get open files context: {e}")
            return ""

    async def get_file_structure_context(
        self,
        file_id: str,
        content: str = "",
        max_chars: int = 500,
    ) -> str:
        """Extract file structure (headers, function definitions) for context.

        Args:
            file_id: File ID
            content: File content (if already available)
            max_chars: Maximum characters to return

        Returns:
            Formatted outline of file structure
        """
        try:
            # Get content if not provided (exclude trash)
            if not content:
                result = await self.db.execute(
                    select(File).where(File.id == file_id, File.deleted_at.is_(None))
                )
                file = result.scalar_one_or_none()
                if not file or not file.content:
                    return ""
                content = file.content

            # Extract markdown headers
            headers = re.findall(r"^(#{1,6})\s+(.+)$", content, re.MULTILINE)

            if not headers:
                return ""

            # Format as outline
            outline_parts = []
            for level, title in headers:
                indent = "  " * (len(level) - 1)
                outline_parts.append(f"{indent}- {title}")

            outline = "\n".join(outline_parts)

            if len(outline) > max_chars:
                outline = outline[:max_chars] + "..."

            logger.info(f"Extracted file structure: {len(headers)} headers")
            return f"Document outline:\n{outline}\n"

        except Exception as e:
            logger.error(f"Failed to extract file structure: {e}")
            return ""

    async def assemble_short_context(
        self,
        params: ShortContextParams,
        user_id: str | None = None,
    ) -> str:
        """Assemble context for short mode autocomplete.

        Priority order:
        1. Current file prefix (1500 chars) + suffix (200 chars)
        2. Top 3-5 RAG chunks from open files (500 chars each)
        3. File names of open files (for reference)

        Args:
            params: Short context parameters
            user_id: Optional user ID for filtering

        Returns:
            Assembled context string (up to max_tokens)
        """
        context_parts = []
        budget_used = 0

        # 1. Current file context (highest priority)
        prefix = params.current_text_before[-1500:] if params.current_text_before else ""
        suffix = params.current_text_after[:200] if params.current_text_after else ""

        current_context = prefix
        if suffix:
            current_context += f"\n[... cursor position ...]\n{suffix}"

        context_parts.append(current_context)
        budget_used += count_tokens(current_context)

        # 2. RAG chunks from open files (if there are any other than current)
        other_files = [fid for fid in params.open_file_ids if fid != params.file_id]
        if other_files and budget_used < params.max_tokens * 0.7:
            # Use last 500 chars as query
            query = params.current_text_before[-500:] if params.current_text_before else ""

            if query:
                rag_chunks = await self.get_rag_chunks(
                    query=query,
                    file_ids=other_files,
                    top_k=3,
                    user_id=user_id,
                )

                if rag_chunks:
                    rag_context_parts = [
                        "\n--- Related context from other files ---",
                    ]

                    for _i, chunk in enumerate(rag_chunks[:3]):
                        chunk_text = chunk.get("content", "")
                        file_id = chunk.get("metadata", {}).get("file_id", "")

                        # Truncate each chunk to 500 chars
                        if len(chunk_text) > 500:
                            chunk_text = chunk_text[:500] + "..."

                        rag_context_parts.append(f"\n[File {file_id[:8]}...]\n{chunk_text}")

                        budget_used += count_tokens(chunk_text)
                        if budget_used >= params.max_tokens * 0.9:
                            break

                    if len(rag_context_parts) > 1:
                        context_parts.extend(rag_context_parts)

        # 3. Combine and truncate to token budget
        combined = "\n\n".join(context_parts)
        final_context = truncate_to_token_limit(combined, params.max_tokens)

        tokens = count_tokens(final_context)
        logger.info(
            f"Short context assembled: {tokens}/{params.max_tokens} tokens, "
            f"{len(other_files)} open files checked"
        )

        return final_context

    async def assemble_long_context(
        self,
        params: LongContextParams,
        user_id: str | None = None,
    ) -> str:
        """Assemble context for long mode autocomplete.

        Priority order:
        1. Current file prefix (4000 chars) + suffix (1000 chars)
        2. Top 10 RAG chunks from all user documents (1000 chars each)
        3. File structure context (headings, outline)
        4. Open files list (for reference)

        Args:
            params: Long context parameters
            user_id: Optional user ID for filtering

        Returns:
            Assembled context string (up to max_tokens)
        """
        context_parts = []
        budget_used = 0

        # 1. Current file context (highest priority)
        prefix = params.current_text_before[-4000:] if params.current_text_before else ""
        suffix = params.current_text_after[:1000] if params.current_text_after else ""

        current_context = prefix
        if suffix:
            current_context += f"\n[... cursor position ...]\n{suffix}"

        context_parts.append(current_context)
        budget_used += count_tokens(current_context)

        # 2. File structure context (headers/outline)
        if params.file_id and budget_used < params.max_tokens * 0.3:
            structure = await self.get_file_structure_context(
                file_id=params.file_id,
                content=params.current_text_before + params.current_text_after,
                max_chars=500,
            )
            if structure:
                context_parts.insert(0, structure)  # Add at beginning for better context
                budget_used += count_tokens(structure)

        # 3. RAG chunks from ALL files (not just open ones)
        # This is the key difference from short mode - we search globally
        if budget_used < params.max_tokens * 0.5:
            query = params.current_text_before[-500:] if params.current_text_before else ""

            if query:
                # Don't filter by file_ids - search all user's documents
                rag_chunks = await self.get_rag_chunks(
                    query=query,
                    file_ids=[],  # Empty list means search all
                    top_k=10,
                    user_id=user_id,
                )

                if rag_chunks:
                    rag_context_parts = [
                        "\n--- Related content from your documents ---",
                    ]

                    for chunk in rag_chunks[:10]:
                        chunk_text = chunk.get("content", "")

                        # Truncate each chunk to 1000 chars for long mode
                        if len(chunk_text) > 1000:
                            chunk_text = chunk_text[:1000] + "..."

                        rag_context_parts.append(f"\n{chunk_text}")

                        budget_used += count_tokens(chunk_text)
                        if budget_used >= params.max_tokens * 0.9:
                            break

                    if len(rag_context_parts) > 1:
                        context_parts.extend(rag_context_parts)

        # 4. Combine and truncate to token budget
        combined = "\n\n".join(context_parts)
        final_context = truncate_to_token_limit(combined, params.max_tokens)

        tokens = count_tokens(final_context)
        logger.info(
            f"Long context assembled: {tokens}/{params.max_tokens} tokens, "
            f"RAG search across all documents"
        )

        return final_context
