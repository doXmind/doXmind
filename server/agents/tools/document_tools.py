"""Document tool executors — unified read/search across all sources.

Handles three data sources through unified tools:
- Current editor document (in-memory files list)
- Any user document by file_id (fetched from DB)
- KB attachments by kb_document name (from context dict)

Editing tools (str_replace_editor, replace_document) operate on in-memory files only.
"""

import logging
import re
from difflib import SequenceMatcher
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from services.document_sections import find_sections, generate_outline, parse_sections
from utils.html import strip_html_tags
from utils.markdown_validator import validate_markdown

logger = logging.getLogger(__name__)

# Regex for database block markers (<!-- database:uuid -->)
_DATABASE_MARKER_RE = re.compile(r"<!-- database:[a-f0-9-]+ -->")


def _reinject_database_markers(old_str: str, new_str: str) -> str:
    """Re-inject database markers that were dropped by the agent.

    Compares markers in old_str vs new_str.  Any marker present in old_str
    but missing from new_str is appended to new_str so it is never lost.
    """
    old_markers = _DATABASE_MARKER_RE.findall(old_str)
    if not old_markers:
        return new_str
    new_marker_set = set(_DATABASE_MARKER_RE.findall(new_str))
    # Deduplicate old_markers to avoid appending the same marker multiple times
    missing = list(dict.fromkeys(m for m in old_markers if m not in new_marker_set))
    if not missing:
        return new_str
    for marker in missing:
        new_str = new_str.rstrip() + "\n\n" + marker + "\n"
    return new_str


# Tool name sets for routing
UNIFIED_TOOL_NAMES = frozenset(["get_outline", "read_content", "search"])
EDIT_TOOL_NAMES = frozenset(["str_replace_editor", "replace_document"])

# Max lines returned by read_content when no section_ids specified.
# Beyond this, return truncated content + outline so the agent uses section_ids.
_MAX_FULL_READ_LINES = 300


def find_target_file(
    files: list[dict[str, Any]], file_id: str | None, current_file_id: str | None
) -> dict[str, Any] | None:
    """Find the target file from the in-memory files list.

    Returns None when a specific file_id was requested but not found,
    so callers can fall back to DB fetch or return a clear error.
    """
    target_file_id = file_id or current_file_id

    for f in files:
        if f["id"] == target_file_id:
            return f
        if not target_file_id and f.get("is_current"):
            return f

    # Only fallback to first file when no specific file_id was requested.
    if not file_id:
        return files[0] if files else None
    return None


# =============================================================================
# Helpers for KB and Global KB data sources
# =============================================================================


def _find_attachment(kb_context: dict[str, Any] | None, document_name: str) -> dict | None:
    """Find KB attachment by name (exact or partial match)."""
    if not kb_context:
        return None
    attachments = kb_context.get("attachments", [])
    for att in attachments:
        if att["filename"].lower() == document_name.lower():
            return att
    for att in attachments:
        if document_name.lower() in att["filename"].lower():
            return att
    return None


async def _fetch_file_from_db(db: AsyncSession, file_id: str, user_id: str) -> dict | None:
    """Fetch a file from the database by ID (strict tenant isolation)."""
    result = await db.execute(
        text("""
            SELECT id, name, content FROM files
            WHERE id = :file_id AND deleted_at IS NULL AND is_folder = false
            AND user_id = :user_id
        """),
        {"file_id": file_id, "user_id": user_id},
    )
    row = result.fetchone()
    if not row:
        return None
    return {"id": row.id, "name": row.name, "content": row.content or ""}


def _extract_snippets(plain_text: str, query: str, max_snippets: int = 3) -> list[str]:
    """Extract text snippets around query matches with surrounding context."""
    query_lower = query.lower()
    text_lower = plain_text.lower()
    snippets = []
    search_start = 0

    while len(snippets) < max_snippets:
        pos = text_lower.find(query_lower, search_start)
        if pos == -1:
            break

        start = max(0, pos - 100)
        end = min(len(plain_text), pos + len(query) + 100)

        snippet = plain_text[start:end].strip()
        if start > 0:
            snippet = "..." + snippet
        if end < len(plain_text):
            snippet = snippet + "..."

        snippets.append(snippet)
        search_start = pos + len(query)

    return snippets


# =============================================================================
# Content resolution — unified source routing
# =============================================================================


async def _resolve_content(
    tool_input: dict[str, Any],
    files: list[dict[str, Any]],
    current_file_id: str | None,
    kb_context: dict[str, Any] | None,
    global_kb_context: dict[str, Any] | None,
) -> tuple[str, str, str | None]:
    """Resolve document content from the appropriate source.

    Returns:
        (content, doc_name, error_message)
        If error_message is not None, content and doc_name are empty.
    """
    kb_document = tool_input.get("kb_document")
    file_id = tool_input.get("file_id")

    # --- KB attachment ---
    if kb_document:
        if not kb_context:
            return "", "", "No knowledge base available in this conversation."
        att = _find_attachment(kb_context, kb_document)
        if not att:
            available = [a["filename"] for a in kb_context.get("attachments", [])]
            return (
                "",
                "",
                f"KB document '{kb_document}' not found. Available: {', '.join(available)}",
            )
        extracted = att.get("extracted_text", "") or ""
        if not extracted:
            return "", "", f"No content found in {kb_document}"
        return extracted, att["filename"], None

    # --- Specific file_id ---
    if file_id:
        # Try in-memory first (only use if content is non-empty)
        target = find_target_file(files, file_id, None)
        if target and target.get("content", "").strip():
            return target["content"], target["name"], None
        # In-memory file has no content (lazy-loaded) or not found — fetch from DB
        if global_kb_context:
            db_file = await _fetch_file_from_db(
                global_kb_context["db"], file_id, global_kb_context["user_id"]
            )
            if db_file:
                return strip_html_tags(db_file["content"]), db_file["name"], None
        if target:
            return target.get("content", ""), target["name"], None
        return "", "", f"File '{file_id}' not found in current context."

    # --- Current document (default) ---
    target = find_target_file(files, None, current_file_id)
    if not target:
        return "", "", "No document is currently open."
    return target.get("content", ""), target["name"], None


# =============================================================================
# Unified tool executors (async)
# =============================================================================


async def execute_get_outline(
    tool_input: dict[str, Any],
    files: list[dict[str, Any]],
    current_file_id: str | None,
    kb_context: dict[str, Any] | None = None,
    global_kb_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute get_outline tool — returns heading structure with section IDs."""
    content, doc_name, error = await _resolve_content(
        tool_input, files, current_file_id, kb_context, global_kb_context
    )
    if error:
        return {"error": error}

    lines = content.split("\n")
    sections = parse_sections(content)
    outline = generate_outline(sections, len(lines))

    return {"result": f"Document: {doc_name}\n{'=' * 50}\n{outline}"}


async def execute_read_content(
    tool_input: dict[str, Any],
    files: list[dict[str, Any]],
    current_file_id: str | None,
    kb_context: dict[str, Any] | None = None,
    global_kb_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute read_content tool — returns full document or specific sections."""
    content, doc_name, error = await _resolve_content(
        tool_input, files, current_file_id, kb_context, global_kb_context
    )
    if error:
        return {"error": error}

    section_ids = tool_input.get("section_ids")

    if section_ids:
        # Read specific sections
        sections = parse_sections(content)
        matched = find_sections(sections, section_ids)

        if not matched:
            available = [s.section_id for s in sections]
            return {"error": f"No sections found for IDs: {section_ids}. Available: {available}"}

        all_lines = content.split("\n")
        result_parts = []
        for sec in matched:
            sec_lines = all_lines[sec.start_line - 1 : sec.end_line]
            numbered = [f"{sec.start_line + i:4d} | {line}" for i, line in enumerate(sec_lines)]
            header = (
                f"--- {sec.section_id}: {sec.heading_text} [L{sec.start_line}-L{sec.end_line}] ---"
            )
            result_parts.append(header + "\n" + "\n".join(numbered))

        return {"result": "\n\n".join(result_parts)}
    else:
        # Full document with line numbers, capped at _MAX_FULL_READ_LINES
        lines = content.split("\n")
        total = len(lines)

        if total <= _MAX_FULL_READ_LINES:
            numbered_lines = [f"{i + 1:4d} | {line}" for i, line in enumerate(lines)]
            return {"result": f"Document: {doc_name}\n{'=' * 50}\n" + "\n".join(numbered_lines)}

        # Document too long — return first N lines + outline for navigation
        truncated = [f"{i + 1:4d} | {line}" for i, line in enumerate(lines[:_MAX_FULL_READ_LINES])]
        sections = parse_sections(content)
        outline = generate_outline(sections, total)

        return {
            "result": (
                f"Document: {doc_name} ({total} lines — showing first {_MAX_FULL_READ_LINES})\n"
                f"{'=' * 50}\n"
                + "\n".join(truncated)
                + f"\n\n... truncated ({total - _MAX_FULL_READ_LINES} more lines) ...\n\n"
                f"<document_outline>\n{outline}\n</document_outline>\n"
                f"Use read_content(section_ids=[...]) to read specific sections."
            )
        }


async def execute_search(
    tool_input: dict[str, Any],
    files: list[dict[str, Any]],
    current_file_id: str | None,
    kb_context: dict[str, Any] | None = None,
    global_kb_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute search tool — searches across document, all files, or KB."""
    query = tool_input.get("query", "")
    if not query:
        return {"error": "Search query is required."}

    scope = tool_input.get("scope", "document")

    # --- scope="all": search across all user documents ---
    if scope == "all":
        if not global_kb_context:
            return {"error": "Global search is not available in this mode."}

        db: AsyncSession = global_kb_context["db"]
        user_id: str = global_kb_context["user_id"]
        top_k = min(tool_input.get("top_k", 10), 20)

        try:
            pattern = f"%{query}%"
            result = await db.execute(
                text("""
                    SELECT id, name, content FROM files
                    WHERE deleted_at IS NULL AND is_folder = false
                    AND (user_id = :user_id OR user_id IS NULL)
                    AND (name ILIKE :pattern OR content ILIKE :pattern)
                    ORDER BY updated_at DESC
                    LIMIT :limit
                """),
                {"user_id": user_id, "pattern": pattern, "limit": top_k},
            )
            rows = result.fetchall()

            if not rows:
                return {"result": f"No results found for: '{query}'"}

            formatted = []
            for i, row in enumerate(rows, 1):
                plain = strip_html_tags(row.content or "")
                snippets = _extract_snippets(plain, query)
                snippet_text = (
                    "\n".join(snippets)
                    if snippets
                    else plain[:300] + ("..." if len(plain) > 300 else "")
                )
                formatted.append(
                    f'**Result {i}** (from "{row.name}", file_id={row.id}):\n{snippet_text}'
                )

            return {"result": "\n\n---\n\n".join(formatted)}

        except Exception as e:
            logger.error(f"Global search error: {e}")
            return {"error": f"Search failed: {str(e)}"}

    # --- scope="kb": search KB attachments ---
    if scope == "kb":
        if not kb_context:
            return {"error": "No knowledge base available in this conversation."}

        attachments = kb_context.get("attachments", [])
        if not attachments:
            return {"result": "No documents in the knowledge base to search."}

        top_k = min(tool_input.get("top_k", 5), 10)
        results = []

        for att in attachments:
            extracted = att.get("extracted_text", "") or ""
            if not extracted or query.lower() not in extracted.lower():
                continue
            snippets = _extract_snippets(extracted, query)
            if snippets:
                results.append({"filename": att["filename"], "snippets": snippets})

        if not results:
            return {"result": f"No relevant results found for: '{query}'"}

        formatted = []
        count = 0
        for r in results:
            if count >= top_k:
                break
            for snippet in r["snippets"]:
                if count >= top_k:
                    break
                count += 1
                formatted.append(f"**Result {count}** (from {r['filename']}):\n{snippet}")

        return {"result": "\n\n---\n\n".join(formatted)}

    # --- scope="document" (default): search in current/specified file ---
    target_file = find_target_file(files, tool_input.get("file_id"), current_file_id)
    if not target_file:
        if tool_input.get("file_id"):
            return {
                "error": f"File '{tool_input['file_id']}' is not loaded. "
                "Use read_content(file_id=...) to read it, or search(scope='all') "
                "for cross-document search."
            }
        return {"result": "No document is currently open."}

    content = target_file.get("content", "")
    # If content is HTML, extract data-code/data-latex attributes (mermaid, math)
    # so their content is searchable, then strip tags for cleaner results
    if "<" in content and ("data-code=" in content or "data-latex=" in content):
        content = strip_html_tags(content)
    lines = content.split("\n")
    query_lower = query.lower()

    results = []
    for i, line in enumerate(lines):
        if query_lower in line.lower():
            context_start = max(0, i - 1)
            context_end = min(len(lines), i + 2)
            context_lines = []
            for j in range(context_start, context_end):
                prefix = ">>>" if j == i else "   "
                context_lines.append(f"{prefix} {j + 1:4d} | {lines[j]}")
            results.append("\n".join(context_lines))

    if results:
        return {"result": f"Found {len(results)} match(es):\n\n" + "\n\n".join(results[:10])}

    return {"result": f"No matches found for '{query}'"}


# =============================================================================
# Unified tool dispatcher
# =============================================================================

_UNIFIED_EXECUTORS = {
    "get_outline": execute_get_outline,
    "read_content": execute_read_content,
    "search": execute_search,
}


async def execute_unified_tool(
    tool_name: str,
    tool_input: dict[str, Any],
    files: list[dict[str, Any]],
    current_file_id: str | None,
    kb_context: dict[str, Any] | None = None,
    global_kb_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute a unified read/search tool."""
    executor = _UNIFIED_EXECUTORS.get(tool_name)
    if executor is None:
        return {"error": f"Unknown unified tool: {tool_name}"}
    return await executor(tool_input, files, current_file_id, kb_context, global_kb_context)


# =============================================================================
# Edit tool executors (synchronous, operate on in-memory files only)
# =============================================================================


def _find_exact_match(content: str, target: str, label: str = "old_str") -> str | None:
    """Find target in content using exact matching only.

    Returns None on success (unique match found), or an error message string.
    """
    if not target:
        return f"{label} is required."

    count = content.count(target)
    if count == 1:
        return None

    if count > 1:
        return f"{label} found {count} times. Include more surrounding context to make it unique."

    lines = content.split("\n")
    return (
        f"No exact match for {label} in document ({len(lines)} lines). "
        f"The text must match exactly (including whitespace and line breaks). "
        f"Use read_content to copy the exact text."
    )


# --- Whitespace normalization fallback ---

_HORIZONTAL_WS = re.compile(r"[\t \u00a0]+")
_FENCE_RE = re.compile(r"^(`{3,}|~{3,})")


def _normalize_whitespace(text: str) -> tuple[str, list[int]]:
    """Normalize whitespace, returning (normalized_text, position_map).

    position_map[i] = index in the *original* text for position i in the normalized text.

    Rules applied **outside** fenced code blocks only:
    - Replace \\u00a0 (nbsp) with regular space
    - Collapse runs of spaces/tabs to a single space per line
    - Strip trailing whitespace per line
    - Normalize \\r\\n to \\n
    Newlines and blank lines are preserved (structurally meaningful in markdown).
    """
    # Normalize \r\n first and build an index map from post-crlf positions to original
    crlf_text = text.replace("\r\n", "\n")
    # Build mapping from crlf_text positions back to original text positions
    crlf_map: list[int] = []
    orig_i = 0
    for _ch in crlf_text:
        crlf_map.append(orig_i)
        if (
            orig_i < len(text)
            and text[orig_i] == "\r"
            and orig_i + 1 < len(text)
            and text[orig_i + 1] == "\n"
        ):
            orig_i += 2  # skip \r\n -> mapped to single \n
        else:
            orig_i += 1

    lines = crlf_text.split("\n")
    normalized_parts: list[str] = []
    position_map: list[int] = []

    in_code_block = False
    fence_marker = ""
    line_start = 0  # offset in crlf_text

    for line_idx, line in enumerate(lines):
        # Check for fence open/close
        stripped = line.lstrip()
        fence_match = _FENCE_RE.match(stripped)
        if fence_match:
            if not in_code_block:
                in_code_block = True
                fence_marker = fence_match.group(1)[0]  # ` or ~
            elif stripped.startswith(fence_marker) and stripped.rstrip() == fence_match.group(1):
                in_code_block = False
                fence_marker = ""

        if in_code_block:
            # Preserve code block content exactly
            for j, _ch in enumerate(line):
                normalized_parts.append(line[j])
                position_map.append(crlf_map[line_start + j])
        else:
            # Normalize this line: collapse horizontal whitespace, strip trailing
            j = 0
            while j < len(line):
                ch = line[j]
                if ch in (" ", "\t", "\u00a0"):
                    # Collapse run of horizontal whitespace to single space
                    normalized_parts.append(" ")
                    position_map.append(crlf_map[line_start + j])
                    while j + 1 < len(line) and line[j + 1] in (" ", "\t", "\u00a0"):
                        j += 1
                else:
                    normalized_parts.append(ch)
                    position_map.append(crlf_map[line_start + j])
                j += 1

            # Strip trailing whitespace from normalized line
            while normalized_parts and normalized_parts[-1] == " ":
                normalized_parts.pop()
                position_map.pop()

        # Add newline separator (except after last line)
        if line_idx < len(lines) - 1:
            normalized_parts.append("\n")
            # Map the \n to the position of the \n in crlf_text
            nl_pos = line_start + len(line)
            position_map.append(crlf_map[nl_pos] if nl_pos < len(crlf_map) else len(text))

        line_start += len(line) + 1  # +1 for the \n

    return "".join(normalized_parts), position_map


def _find_normalized_match(content: str, target: str) -> tuple[str, int] | None:
    """Try whitespace-normalized matching when exact match fails.

    Returns (original_text_from_document, offset_in_original) or None.
    The returned old_str is the ORIGINAL document text so that
    content.replace(old_str, new_str, 1) works correctly.
    """
    if not target:
        return None

    norm_content, content_map = _normalize_whitespace(content)
    norm_target, _ = _normalize_whitespace(target)

    if not norm_target:
        return None

    count = norm_content.count(norm_target)
    if count != 1:
        return None  # Not unique even after normalization

    norm_offset = norm_content.index(norm_target)

    # Map back to original positions
    if norm_offset >= len(content_map) or norm_offset + len(norm_target) - 1 >= len(content_map):
        return None

    orig_start = content_map[norm_offset]
    orig_end_mapped = content_map[norm_offset + len(norm_target) - 1]

    # Extend orig_end to include the full original character (plus any trailing
    # whitespace that was collapsed into the last mapped position)
    orig_end = orig_end_mapped + 1

    original_text = content[orig_start:orig_end]

    # Verify roundtrip: the extracted original text must normalize to norm_target
    verify_norm, _ = _normalize_whitespace(original_text)
    if verify_norm != norm_target:
        return None  # Mapping error, bail out

    # Also verify uniqueness in the original content
    if content.count(original_text) != 1:
        return None

    return (original_text, orig_start)


# --- Similar text hints ---

_MAX_DOC_SIZE_FOR_HINTS = 200_000
_MIN_TARGET_SIZE_FOR_HINTS = 10
_SIMILARITY_THRESHOLD = 0.6


def _find_similar_text(content: str, target: str, max_hint_len: int = 200) -> str | None:
    """Find the most similar substring in content to target.

    Uses windowed n-gram pre-filtering + SequenceMatcher for performance.
    Returns a hint string or None.
    """
    if len(content) > _MAX_DOC_SIZE_FOR_HINTS or len(target) < _MIN_TARGET_SIZE_FOR_HINTS:
        return None

    window_size = min(int(len(target) * 1.5), len(content))
    if window_size < 1:
        return None
    step = max(int(len(target) * 0.5), 1)

    # Build target 3-grams for quick filtering
    target_lower = target.lower()
    target_ngrams: set[str] = set()
    for i in range(len(target_lower) - 2):
        target_ngrams.add(target_lower[i : i + 3])

    if not target_ngrams:
        return None

    # Score windows by n-gram overlap
    candidates: list[tuple[float, int, str]] = []
    max_windows = 500
    for window_count, i in enumerate(range(0, len(content) - window_size + 1, step)):
        if window_count >= max_windows:
            break
        window = content[i : i + window_size]
        window_lower = window.lower()
        window_ngrams: set[str] = set()
        for j in range(len(window_lower) - 2):
            window_ngrams.add(window_lower[j : j + 3])

        overlap = len(target_ngrams & window_ngrams) / len(target_ngrams)
        if overlap > 0.3:
            candidates.append((overlap, i, window))

    if not candidates:
        return None

    # Sort by overlap, take top 3
    candidates.sort(key=lambda x: x[0], reverse=True)
    candidates = candidates[:3]

    # Run SequenceMatcher on top candidates
    best_ratio = 0.0
    best_text = ""
    for _, _offset, window in candidates:
        ratio = SequenceMatcher(None, target, window).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_text = window

    if best_ratio < _SIMILARITY_THRESHOLD:
        return None

    hint = best_text.strip()
    if len(hint) > max_hint_len:
        hint = hint[:max_hint_len] + "..."

    return f"Did you mean:\n```\n{hint}\n```"


def execute_str_replace(
    tool_input: dict[str, Any], files: list[dict[str, Any]], current_file_id: str | None
) -> dict[str, Any]:
    """Execute str_replace_editor tool."""
    target_file = find_target_file(files, tool_input.get("file_id"), current_file_id)

    if not target_file:
        if tool_input.get("file_id"):
            return {
                "error": f"Cannot edit file '{tool_input['file_id']}': "
                "only the currently open document can be edited."
            }
        return {"error": "No document is currently open."}

    old_str = tool_input.get("old_str", "")
    new_str = tool_input.get("new_str", "")
    content = target_file.get("content", "")

    if not old_str:
        return {"error": "old_str is required."}

    # Safety net: re-inject database markers the agent may have dropped
    new_str = _reinject_database_markers(old_str, new_str)

    error = _find_exact_match(content, old_str)
    if error:
        # Fallback 1: whitespace-normalized matching
        normalized = _find_normalized_match(content, old_str)
        if normalized:
            original_text, orig_offset = normalized
            result = {
                "type": "str_replace",
                "file_id": target_file["id"],
                "file_name": target_file["name"],
                "old_str": original_text,  # ORIGINAL document text
                "new_str": new_str,
                "offset": orig_offset,
                "success": True,
                "normalization_note": (
                    "Matched via whitespace normalization. "
                    "Use read_content to copy exact text next time."
                ),
            }
            warnings = validate_markdown(new_str)
            if warnings:
                result["markdown_warnings"] = "\n".join(warnings)
            return result

        # Fallback 2: enhanced error with similar text hint
        hint = _find_similar_text(content, old_str)
        if hint:
            error += f"\n\n{hint}"
        return {"error": error}

    result = {
        "type": "str_replace",
        "file_id": target_file["id"],
        "file_name": target_file["name"],
        "old_str": old_str,
        "new_str": new_str,
        "offset": content.index(old_str),
        "success": True,
    }

    warnings = validate_markdown(new_str)
    if warnings:
        result["markdown_warnings"] = "\n".join(warnings)

    return result


def execute_replace_document(
    tool_input: dict[str, Any], files: list[dict[str, Any]], current_file_id: str | None
) -> dict[str, Any]:
    """Execute replace_document tool."""
    target_file = find_target_file(files, tool_input.get("file_id"), current_file_id)

    if not target_file:
        if tool_input.get("file_id"):
            return {
                "error": f"Cannot edit file '{tool_input['file_id']}': "
                "only the currently open document can be edited."
            }
        return {"error": "No document is currently open."}

    new_content = tool_input.get("new_content", "")

    # Safety net: re-inject database markers the agent may have dropped
    original_content = target_file.get("content", "")
    new_content = _reinject_database_markers(original_content, new_content)

    result = {
        "type": "replace_all",
        "file_id": target_file["id"],
        "file_name": target_file["name"],
        "new_content": new_content,
        "success": True,
    }

    warnings = validate_markdown(new_content)
    if warnings:
        result["markdown_warnings"] = "\n".join(warnings)

    return result


# Edit tool registry
_EDIT_EXECUTORS = {
    "str_replace_editor": execute_str_replace,
    "replace_document": execute_replace_document,
}


def execute_edit_tool(
    tool_name: str,
    tool_input: dict[str, Any],
    files: list[dict[str, Any]],
    current_file_id: str | None,
) -> dict[str, Any]:
    """Execute an edit tool (synchronous)."""
    executor = _EDIT_EXECUTORS.get(tool_name)
    if executor is None:
        return {"error": f"Unknown edit tool: {tool_name}"}
    return executor(tool_input, files, current_file_id)
