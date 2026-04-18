"""Knowledge Base Agent for agentic search across all user documents.

A lightweight agent with search and read tools that answers questions
by searching and reading user's documents. Uses plain text search
and document section parsing (no embeddings/vectors).
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from agents.tools.definitions import to_openai_tools
from config import get_settings
from services.document_sections import find_sections, generate_outline, parse_sections
from utils.html import strip_html_tags

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

KB_SYSTEM_PROMPT = """You are a knowledge base assistant that answers questions by searching the user's documents.

## Critical rules

- Your FIRST action must ALWAYS be calling search. NEVER respond with text before searching.
- NEVER ask the user clarifying questions. Just search immediately with your best interpretation.
- If the user's question is vague, search with multiple relevant terms to cast a wide net.
- Base your answer ONLY on information found in the documents. Do NOT use general knowledge.

## Workflow

1. Immediately call search with relevant keywords from the user's message.
2. If the topic is broad, call search multiple times with different keywords.
3. Use get_outline to see a document's outline (heading structure with section IDs).
4. Use read_content to read specific sections by ID for detailed content.
5. Synthesize what you found into a clear answer, citing source document names.
6. If nothing relevant is found after searching, tell the user no matching content was found.

## Response format

- Respond in the same language as the user's question.
- Cite sources: mention which document each piece of information comes from.
- Keep responses concise but thorough.
- When summarizing multiple documents, organize by topic or document."""

# ---------------------------------------------------------------------------
# Tool Definitions
# ---------------------------------------------------------------------------

SEARCH_TOOL = {
    "name": "search",
    "description": (
        "Search across ALL of the user's documents by keyword/text matching. "
        "Searches both file names and content. Returns matching excerpts with context. "
        "You can search multiple times with different queries to find all relevant information."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": (
                    "The search query. Use specific keywords or phrases. "
                    "For broad topics, search multiple times with different terms."
                ),
            },
            "top_k": {
                "type": "integer",
                "description": "Maximum number of results to return (1-20). Default: 10.",
                "default": 10,
                "minimum": 1,
                "maximum": 20,
            },
        },
        "required": ["query"],
    },
}

GET_OUTLINE_TOOL = {
    "name": "get_outline",
    "description": (
        "Get the outline (heading structure) of a document by file_id. "
        "Returns section IDs, line ranges, and estimated token counts. "
        "Use this after search to understand a document's structure."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "file_id": {
                "type": "string",
                "description": "The file_id of the document (from search results).",
            },
        },
        "required": ["file_id"],
    },
}

READ_CONTENT_TOOL = {
    "name": "read_content",
    "description": (
        "Read specific sections of a document by section IDs (from get_outline). "
        "Returns content with line numbers. Reading a parent section includes all children."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "file_id": {
                "type": "string",
                "description": "The file_id of the document.",
            },
            "section_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Section IDs to read (e.g., ['s1', 's2.1']).",
            },
        },
        "required": ["file_id", "section_ids"],
    },
}

KB_TOOLS = [SEARCH_TOOL, GET_OUTLINE_TOOL, READ_CONTENT_TOOL]


# ---------------------------------------------------------------------------
# KBAgent
# ---------------------------------------------------------------------------


class KBAgent:
    """Simple agentic search agent for answering questions from user's documents."""

    MAX_ITERATIONS = 20

    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        api_key: str | None = None,
        model: str | None = None,
    ):
        from provider.registry import (
            active_provider_id,
            build_client,
            provider_api_key,
            role_model,
        )

        self.db = db
        self.user_id = user_id
        settings = get_settings()

        pid = active_provider_id()
        if pid is None:
            raise ValueError(
                "No LLM provider configured. Open the Settings page and add an API key."
            )
        effective_key = api_key or provider_api_key(pid) or settings.env_api_key_for(pid)
        if not effective_key:
            raise ValueError(
                f"Active provider '{pid}' has no API key. Open Settings and paste one."
            )
        effective_model = model or role_model("chat", pid)
        if not effective_model:
            raise ValueError(f"Provider '{pid}' has no chat model configured.")
        self.client = build_client(effective_key, pid)
        self.provider_id = pid
        self.model = effective_model
        self._provider_sort = ""
        self.tools = KB_TOOLS

    async def stream(
        self,
        question: str,
        history: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream an agentic search response.

        Yields SSE-compatible events:
        - {"type": "text", "content": "..."}
        - {"type": "tool_start", "tool": "search", "tool_id": "..."}
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

        if name == "search":
            return await self._exec_search(inp)
        elif name == "get_outline":
            return await self._exec_get_outline(inp)
        elif name == "read_content":
            return await self._exec_read_content(inp)
        else:
            return f"Unknown tool: {name}", []

    async def _fetch_file(self, file_id: str) -> dict | None:
        """Fetch a single file by ID."""
        result = await self.db.execute(
            text("""
                SELECT id, name, content FROM files
                WHERE id = :file_id AND deleted_at IS NULL AND is_folder = false
                AND (user_id = :user_id OR user_id IS NULL)
            """),
            {"file_id": file_id, "user_id": self.user_id},
        )
        row = result.fetchone()
        if not row:
            return None
        return {"id": row.id, "name": row.name, "content": row.content or ""}

    async def _exec_search(self, inp: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
        """Execute search tool using text matching."""
        query = inp.get("query", "")
        top_k = min(inp.get("top_k", 10), 20)

        if not query:
            return "Error: search query is required.", []

        try:
            pattern = f"%{query}%"
            result = await self.db.execute(
                text("""
                    SELECT id, name, content FROM files
                    WHERE deleted_at IS NULL AND is_folder = false
                    AND (user_id = :user_id OR user_id IS NULL)
                    AND (name ILIKE :pattern OR content ILIKE :pattern)
                    ORDER BY updated_at DESC
                    LIMIT :limit
                """),
                {"user_id": self.user_id, "pattern": pattern, "limit": top_k},
            )
            rows = result.fetchall()

            if not rows:
                return f"No results found for: '{query}'", []

            sources = []
            formatted = []
            for i, row in enumerate(rows, 1):
                plain = strip_html_tags(row.content or "")

                # Extract snippets around the match
                snippets = self._extract_snippets(plain, query)
                snippet_text = (
                    "\n".join(snippets)
                    if snippets
                    else plain[:300] + ("..." if len(plain) > 300 else "")
                )

                formatted.append(
                    f'**Result {i}** (from "{row.name}", file_id={row.id}):\n{snippet_text}'
                )
                sources.append({"file_id": row.id, "file_name": row.name, "score": 1.0})

            return "\n\n---\n\n".join(formatted), sources

        except Exception as e:
            logger.error(f"KB agent search error: {e}")
            return f"Search failed: {str(e)}", []

    def _extract_snippets(self, text_content: str, query: str, max_snippets: int = 3) -> list[str]:
        """Extract text snippets around query matches."""
        query_lower = query.lower()
        text_lower = text_content.lower()
        snippets = []
        search_start = 0

        while len(snippets) < max_snippets:
            pos = text_lower.find(query_lower, search_start)
            if pos == -1:
                break
            start = max(0, pos - 100)
            end = min(len(text_content), pos + len(query) + 100)
            snippet = text_content[start:end].strip()
            if start > 0:
                snippet = "..." + snippet
            if end < len(text_content):
                snippet = snippet + "..."
            snippets.append(snippet)
            search_start = pos + len(query)

        return snippets

    async def _exec_get_outline(self, inp: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
        """Execute get_outline tool - returns document outline."""
        file_id = inp.get("file_id", "")
        if not file_id:
            return "Error: file_id is required.", []

        try:
            file = await self._fetch_file(file_id)
            if not file:
                return f"File not found: {file_id}", []

            plain = strip_html_tags(file["content"])
            lines = plain.split("\n")
            sections = parse_sections(plain)
            outline = generate_outline(sections, len(lines))

            return f"Document: {file['name']}\n{'=' * 50}\n{outline}", [
                {"file_id": file_id, "file_name": file["name"], "score": 1.0}
            ]

        except Exception as e:
            logger.error(f"KB agent read file error: {e}")
            return f"Failed to read file: {str(e)}", []

    async def _exec_read_content(self, inp: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
        """Execute read_content tool - reads specific sections."""
        file_id = inp.get("file_id", "")
        section_ids = inp.get("section_ids", [])

        if not file_id:
            return "Error: file_id is required.", []
        if not section_ids:
            return "Error: section_ids is required.", []

        try:
            file = await self._fetch_file(file_id)
            if not file:
                return f"File not found: {file_id}", []

            plain = strip_html_tags(file["content"])
            sections = parse_sections(plain)
            matched = find_sections(sections, section_ids)

            if not matched:
                available = [s.section_id for s in sections]
                return f"No sections found for IDs: {section_ids}. Available: {available}", []

            all_lines = plain.split("\n")
            result_parts = []
            for sec in matched:
                sec_lines = all_lines[sec.start_line - 1 : sec.end_line]
                numbered = [f"{sec.start_line + i:4d} | {line}" for i, line in enumerate(sec_lines)]
                header = f"--- {sec.section_id}: {sec.heading_text} [L{sec.start_line}-L{sec.end_line}] ---"
                result_parts.append(header + "\n" + "\n".join(numbered))

            return "\n\n".join(result_parts), [
                {"file_id": file_id, "file_name": file["name"], "score": 1.0}
            ]

        except Exception as e:
            logger.error(f"KB agent read section error: {e}")
            return f"Failed to read file sections: {str(e)}", []
