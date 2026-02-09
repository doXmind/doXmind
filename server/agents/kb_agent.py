"""Knowledge Base Agent for agentic RAG across all user documents.

A lightweight agent with only two tools (search_files, read_file_sections)
that answers questions by searching and reading user's documents.
Uses the same streaming pattern as WritingAgent but stripped of all
editing, skills, and multimodal complexity.
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from anthropic import AsyncAnthropic
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from services.rag.html_utils import strip_html_tags
from services.rag.search import RAGService

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

KB_SYSTEM_PROMPT = """You are a knowledge base assistant that answers questions by searching the user's documents.

## Critical rules

- Your FIRST action must ALWAYS be calling search_files. NEVER respond with text before searching.
- NEVER ask the user clarifying questions. Just search immediately with your best interpretation.
- If the user's question is vague, search with multiple relevant terms to cast a wide net.
- Base your answer ONLY on information found in the documents. Do NOT use general knowledge.

## Workflow

1. Immediately call search_files with relevant query terms extracted from the user's message.
2. If the topic is broad, call search_files multiple times with different angles/keywords.
3. Use read_file_sections to get more context around promising search results.
4. Synthesize what you found into a clear answer, citing source document names.
5. If nothing relevant is found after searching, tell the user no matching content was found.

## Response format

- Respond in the same language as the user's question.
- Cite sources: mention which document each piece of information comes from.
- Keep responses concise but thorough.
- When summarizing multiple documents, organize by topic or document."""

# ---------------------------------------------------------------------------
# Tool Definitions
# ---------------------------------------------------------------------------

SEARCH_FILES_TOOL = {
    "name": "search_files",
    "description": (
        "Search across ALL of the user's documents using semantic and keyword search. "
        "Returns the most relevant text passages from any document. "
        "Use this to find information related to a query across the entire knowledge base. "
        "You can search multiple times with different queries to find all relevant information. "
        "Each result includes the source document name, chunk index, and relevance score."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": (
                    "The search query. Use specific, descriptive phrases. "
                    "For broad topics, search multiple times with different angles."
                ),
            },
            "top_k": {
                "type": "integer",
                "description": "Number of results to return (1-10). Default: 5.",
                "default": 5,
                "minimum": 1,
                "maximum": 10,
            },
        },
        "required": ["query"],
    },
}

READ_FILE_SECTIONS_TOOL = {
    "name": "read_file_sections",
    "description": (
        "Read specific sections (chunks) from a document by file_id. "
        "Use this after search_files to read more context around a relevant result, "
        "or to read the beginning of a document to understand its structure. "
        "Returns consecutive sections from the document."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "file_id": {
                "type": "string",
                "description": "The file_id of the document (from search results metadata).",
            },
            "start_section": {
                "type": "integer",
                "description": "Starting section index (0-based). Default: 0.",
                "default": 0,
                "minimum": 0,
            },
            "num_sections": {
                "type": "integer",
                "description": "Number of sections to read (1-10). Default: 3.",
                "default": 3,
                "minimum": 1,
                "maximum": 10,
            },
        },
        "required": ["file_id"],
    },
}

KB_TOOLS = [SEARCH_FILES_TOOL, READ_FILE_SECTIONS_TOOL]


# ---------------------------------------------------------------------------
# KBAgent
# ---------------------------------------------------------------------------


class KBAgent:
    """Simple agentic RAG agent for answering questions from user's documents."""

    MAX_ITERATIONS = 8

    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        api_key: str | None = None,
        model: str | None = None,
    ):
        self.db = db
        self.rag = RAGService(db)
        self.user_id = user_id
        settings = get_settings()
        self.client = AsyncAnthropic(api_key=api_key or settings.anthropic_api_key)
        self.model = model or settings.default_model or "claude-sonnet-4-5-20250929"
        self.tools = KB_TOOLS

    async def stream(
        self,
        question: str,
        history: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream an agentic RAG response.

        Yields SSE-compatible events:
        - {"type": "text", "content": "..."}
        - {"type": "tool_start", "tool": "search_files", "tool_id": "..."}
        - {"type": "tool_end", "tool": "...", "tool_id": "...", "output": "...", "success": bool}
        - {"type": "sources", "sources": [...]}
        - {"type": "done"}
        """
        messages: list[dict[str, Any]] = list(history or [])
        messages.append({"role": "user", "content": question})

        sources: list[dict[str, Any]] = []

        for _iteration in range(self.MAX_ITERATIONS):
            # Stream the Claude response
            tool_uses: list[dict[str, Any]] = []
            full_response_content: list[dict[str, Any]] = []
            current_tool: dict[str, Any] | None = None
            current_text: str = ""

            async with self.client.messages.stream(
                model=self.model,
                system=KB_SYSTEM_PROMPT,
                messages=messages,
                tools=self.tools,
                max_tokens=4096,
            ) as stream:
                async for event in stream:
                    if event.type == "content_block_start":
                        block = event.content_block
                        if block.type == "text":
                            current_text = ""
                        elif block.type == "tool_use":
                            current_tool = {
                                "id": block.id,
                                "name": block.name,
                                "partial_json": "",
                            }
                            yield {
                                "type": "tool_start",
                                "tool": block.name,
                                "tool_id": block.id,
                            }

                    elif event.type == "content_block_delta":
                        delta = event.delta
                        if delta.type == "text_delta":
                            current_text += delta.text
                            yield {"type": "text", "content": delta.text}
                        elif delta.type == "input_json_delta" and current_tool:
                            current_tool["partial_json"] += delta.partial_json

                    elif event.type == "content_block_stop":
                        if current_tool:
                            try:
                                tool_input = json.loads(current_tool["partial_json"])
                            except json.JSONDecodeError:
                                tool_input = {}
                            tool_use = {
                                "type": "tool_use",
                                "id": current_tool["id"],
                                "name": current_tool["name"],
                                "input": tool_input,
                            }
                            tool_uses.append(tool_use)
                            full_response_content.append(tool_use)
                            current_tool = None
                        elif current_text:
                            full_response_content.append({"type": "text", "text": current_text})
                            current_text = ""

            # If no tool uses, we're done
            if not tool_uses:
                break

            # Add assistant message to history
            messages.append({"role": "assistant", "content": full_response_content})

            # Execute tools and collect results
            tool_results = []
            for tool_use in tool_uses:
                result, tool_sources = await self._execute_tool(tool_use)
                sources.extend(tool_sources)

                yield {
                    "type": "tool_end",
                    "tool": tool_use["name"],
                    "tool_id": tool_use["id"],
                    "output": result[:200] if len(result) > 200 else result,
                    "success": True,
                }

                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use["id"],
                        "content": result,
                    }
                )

            messages.append({"role": "user", "content": tool_results})

        # Emit deduplicated sources
        if sources:
            seen = set()
            unique_sources = []
            for s in sources:
                key = s["file_id"]
                if key not in seen:
                    seen.add(key)
                    unique_sources.append(s)
            yield {"type": "sources", "sources": unique_sources}

        yield {"type": "done"}

    async def _execute_tool(self, tool_use: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
        """Execute a tool and return (result_text, sources_list)."""
        name = tool_use["name"]
        inp = tool_use.get("input", {})

        if name == "search_files":
            return await self._exec_search_files(inp)
        elif name == "read_file_sections":
            return await self._exec_read_file_sections(inp)
        else:
            return f"Unknown tool: {name}", []

    async def _exec_search_files(self, inp: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
        """Execute search_files tool using RAGService.hybrid_search."""
        query = inp.get("query", "")
        top_k = min(inp.get("top_k", 5), 10)

        if not query:
            return "Error: search query is required.", []

        try:
            results = await self.rag.hybrid_search(
                query=query,
                top_k=top_k,
                user_id=self.user_id,
            )

            if not results:
                return f"No relevant results found for: '{query}'", []

            sources = []
            formatted = []
            for i, r in enumerate(results, 1):
                metadata = r.get("metadata", {})
                file_id = metadata.get("file_id", "unknown")
                file_name = metadata.get("name", "Untitled")
                chunk_index = metadata.get("chunk_index", 0)
                score = 1 - r.get("distance", 1)
                content = r.get("content", "")

                # Truncate content for tool result (Claude can read_file_sections for more)
                if len(content) > 800:
                    content = content[:800] + "..."

                formatted.append(
                    f'**Result {i}** (from "{file_name}", file_id={file_id}, '
                    f"section={chunk_index}, relevance={score:.0%}):\n{content}"
                )

                sources.append(
                    {
                        "file_id": file_id,
                        "file_name": file_name,
                        "score": round(score, 2),
                    }
                )

            return "\n\n---\n\n".join(formatted), sources

        except Exception as e:
            logger.error(f"KB agent search error: {e}")
            return f"Search failed: {str(e)}", []

    async def _exec_read_file_sections(
        self, inp: dict[str, Any]
    ) -> tuple[str, list[dict[str, Any]]]:
        """Execute read_file_sections by reading chunks from the vectors table."""
        file_id = inp.get("file_id", "")
        start = inp.get("start_section", 0)
        num = min(inp.get("num_sections", 3), 10)

        if not file_id:
            return "Error: file_id is required.", []

        try:
            result = await self.db.execute(
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
                return f"No sections found for file_id={file_id} at offset {start}.", []

            # Get total chunk count
            count_result = await self.db.execute(
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

            return f"{header}\n\n{content}", [
                {
                    "file_id": file_id,
                    "file_name": file_name,
                    "score": 1.0,
                }
            ]

        except Exception as e:
            logger.error(f"KB agent read error: {e}")
            return f"Failed to read file sections: {str(e)}", []
