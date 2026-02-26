"""Global Knowledge Base tool executors.

Provides search_files and read_file_sections tools that search across
ALL of a user's documents (not just conversation-scoped KB attachments).

Extracted from KBAgent._exec_search_files and _exec_read_file_sections.
"""

import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from agents.tools.definitions import GLOBAL_KB_TOOL_NAMES
from services.rag.html_utils import strip_html_tags

logger = logging.getLogger(__name__)


def is_global_kb_tool(tool_name: str) -> bool:
    """Check if a tool is a global KB tool."""
    return tool_name in GLOBAL_KB_TOOL_NAMES


async def _exec_search_files(tool_input: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Search across all user documents using hybrid search."""
    from services.rag.search import RAGService

    query = tool_input.get("query", "")
    top_k = min(tool_input.get("top_k", 5), 10)

    if not query:
        return {"error": "Search query is required."}

    db: AsyncSession = ctx["db"]
    user_id: str = ctx["user_id"]

    try:
        rag = RAGService(db, api_key=ctx.get("api_key"))
        results = await rag.hybrid_search(
            query=query,
            top_k=top_k,
            user_id=user_id,
        )

        if not results:
            return {"result": f"No relevant results found for: '{query}'"}

        formatted = []
        for i, r in enumerate(results, 1):
            metadata = r.get("metadata", {})
            file_id = metadata.get("file_id", "unknown")
            file_name = metadata.get("name", "Untitled")
            chunk_index = metadata.get("chunk_index", 0)
            score = 1 - r.get("distance", 1)
            content = r.get("content", "")

            if len(content) > 800:
                content = content[:800] + "..."

            formatted.append(
                f'**Result {i}** (from "{file_name}", file_id={file_id}, '
                f"section={chunk_index}, relevance={score:.0%}):\n{content}"
            )

        return {"result": "\n\n---\n\n".join(formatted)}

    except Exception as e:
        logger.error(f"Global KB search error: {e}")
        return {"error": f"Search failed: {str(e)}"}


async def _exec_read_file_sections(
    tool_input: dict[str, Any], ctx: dict[str, Any]
) -> dict[str, Any]:
    """Read specific sections from a document by file_id."""
    file_id = tool_input.get("file_id", "")
    start = int(tool_input.get("start_section", 0))
    num = min(int(tool_input.get("num_sections", 3)), 10)

    if not file_id:
        return {"error": "file_id is required."}

    db: AsyncSession = ctx["db"]

    try:
        result = await db.execute(
            text("""
                SELECT content, chunk_index, metadata
                FROM vectors
                WHERE file_id = :file_id AND chunk_type = 'document'
                ORDER BY chunk_index
                OFFSET :offset
                LIMIT :limit
            """),
            {"file_id": file_id, "offset": start, "limit": num},
        )
        rows = result.fetchall()

        if not rows:
            return {"result": f"No sections found for file_id={file_id} at offset {start}."}

        count_result = await db.execute(
            text("""
                SELECT COUNT(*) as total FROM vectors
                WHERE file_id = :file_id AND chunk_type = 'document'
            """),
            {"file_id": file_id},
        )
        total = count_result.scalar() or 0

        file_name = "Untitled"
        sections = []
        for row in rows:
            plain = strip_html_tags(row.content)
            sections.append(plain)
            if row.metadata and row.metadata.get("name"):
                file_name = row.metadata["name"]

        content = "\n\n".join(sections)
        header = f"**{file_name}** (sections {start + 1}-{start + len(rows)} of {total}):"

        return {"result": f"{header}\n\n{content}"}

    except Exception as e:
        logger.error(f"Global KB read error: {e}")
        return {"error": f"Failed to read file sections: {str(e)}"}


_GLOBAL_KB_EXECUTORS = {
    "search_files": _exec_search_files,
    "read_file_sections": _exec_read_file_sections,
}


async def execute_global_kb_tool(
    tool_name: str, tool_input: dict[str, Any], global_kb_context: dict[str, Any] | None
) -> dict[str, Any]:
    """Execute a global KB tool.

    Args:
        tool_name: Name of the tool
        tool_input: Tool input parameters
        global_kb_context: {"db": AsyncSession, "user_id": str, "api_key": str | None}
    """
    if not global_kb_context:
        return {"error": "Global KB context not available."}

    executor = _GLOBAL_KB_EXECUTORS.get(tool_name)
    if executor is None:
        return {"error": f"Unknown global KB tool: {tool_name}"}

    return await executor(tool_input, global_kb_context)
