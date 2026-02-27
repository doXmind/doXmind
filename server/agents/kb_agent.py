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

from openai import AsyncOpenAI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from agents.tools.definitions import to_openai_tools
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

    MAX_ITERATIONS = 20

    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        api_key: str | None = None,
        model: str | None = None,
    ):
        self.db = db
        self.rag = RAGService(db, api_key=api_key)
        self.user_id = user_id
        settings = get_settings()
        self.client = AsyncOpenAI(
            api_key=api_key or settings.openrouter_api_key,
            base_url=settings.openrouter_base_url,
            default_headers=settings.openrouter_headers,
        )
        self.model = model or settings.default_model
        self._provider_sort = settings.openrouter_provider_sort
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

        openai_tools = to_openai_tools(self.tools)

        total_usage = {"input_tokens": 0, "output_tokens": 0, "cost": 0.0}

        for _iteration in range(self.MAX_ITERATIONS):
            # Stream the OpenAI-compatible response
            tool_uses: list[dict[str, Any]] = []
            current_text: str = ""
            tool_call_buffers: dict[int, dict] = {}
            in_reasoning = False

            openai_messages = [{"role": "system", "content": KB_SYSTEM_PROMPT}] + messages

            extra_body = {}
            if self._provider_sort:
                extra_body["provider"] = {"sort": self._provider_sort}

            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=openai_messages,
                tools=openai_tools,
                max_tokens=4096,
                stream=True,
                stream_options={"include_usage": True},
                extra_body=extra_body or None,
            )

            async for chunk in stream:
                # Capture usage from the final chunk
                if chunk.usage:
                    cost = None
                    if hasattr(chunk.usage, "cost"):
                        cost = chunk.usage.cost
                    elif hasattr(chunk.usage, "model_extra") and chunk.usage.model_extra:
                        cost = chunk.usage.model_extra.get("cost")
                    total_usage["input_tokens"] += chunk.usage.prompt_tokens or 0
                    total_usage["output_tokens"] += chunk.usage.completion_tokens or 0
                    total_usage["cost"] += cost or 0

                if not chunk.choices:
                    continue

                choice = chunk.choices[0]
                delta = choice.delta

                # Handle GLM reasoning tokens
                reasoning_text = getattr(delta, "reasoning", None) if delta else None
                if reasoning_text:
                    if not in_reasoning:
                        in_reasoning = True
                    yield {"type": "thinking", "content": reasoning_text}

                # Handle text content
                if delta and delta.content:
                    if in_reasoning:
                        in_reasoning = False
                        yield {"type": "thinking_end"}
                    current_text += delta.content
                    yield {"type": "text", "content": delta.content}

                # Handle tool calls (streamed incrementally)
                if delta and delta.tool_calls:
                    if in_reasoning:
                        in_reasoning = False
                        yield {"type": "thinking_end"}
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index

                        # New tool call starting
                        if idx not in tool_call_buffers:
                            tool_id = tc_delta.id or f"call_{idx}"
                            tool_name = tc_delta.function.name if tc_delta.function else ""
                            tool_call_buffers[idx] = {
                                "id": tool_id,
                                "name": tool_name,
                                "arguments": "",
                            }
                            if tool_name:
                                yield {
                                    "type": "tool_start",
                                    "tool": tool_name,
                                    "tool_id": tool_id,
                                }

                        buf = tool_call_buffers[idx]

                        # Update tool name if provided later
                        if tc_delta.function and tc_delta.function.name and not buf["name"]:
                            buf["name"] = tc_delta.function.name
                            yield {
                                "type": "tool_start",
                                "tool": buf["name"],
                                "tool_id": buf["id"],
                            }

                        # Accumulate arguments
                        if tc_delta.function and tc_delta.function.arguments:
                            buf["arguments"] += tc_delta.function.arguments

            # Build tool_uses from buffers
            for idx in sorted(tool_call_buffers.keys()):
                buf = tool_call_buffers[idx]
                try:
                    tool_input = json.loads(buf["arguments"]) if buf["arguments"] else {}
                except json.JSONDecodeError:
                    tool_input = {}
                tool_uses.append(
                    {
                        "type": "tool_use",
                        "id": buf["id"],
                        "name": buf["name"],
                        "input": tool_input,
                    }
                )

            # If no tool uses, we're done
            if not tool_uses:
                break

            # Add assistant message to history (OpenAI format)
            full_response: dict[str, Any] = {"role": "assistant", "content": current_text or None}
            full_response["tool_calls"] = [
                {
                    "id": tu["id"],
                    "type": "function",
                    "function": {
                        "name": tu["name"],
                        "arguments": json.dumps(tu.get("input", {})),
                    },
                }
                for tu in tool_uses
            ]
            messages.append(full_response)

            # Execute tools and collect results
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

                # OpenAI format: each tool result is a separate message
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_use["id"],
                        "content": result,
                    }
                )

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

        # Yield accumulated usage
        yield {
            "type": "usage",
            "input_tokens": total_usage["input_tokens"],
            "output_tokens": total_usage["output_tokens"],
            "cost": total_usage["cost"] if total_usage["cost"] > 0 else None,
        }

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
        start = int(inp.get("start_section", 0))
        num = min(int(inp.get("num_sections", 3)), 10)

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
