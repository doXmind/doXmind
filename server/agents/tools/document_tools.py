"""Document editing tool executors.

This module contains the execution logic for document editing tools:
- get_document_outline
- read_section
- view_document
- str_replace_editor (exact match replace)
- replace_document
- search_in_document
"""

import re
from dataclasses import dataclass
from typing import Any

from services.document_sections import find_sections, generate_outline, parse_sections


@dataclass
class FileContext:
    """Represents a file context passed to tools."""

    id: str
    name: str
    content: str
    is_current: bool = False


def find_target_file(
    files: list[dict[str, Any]], file_id: str | None, current_file_id: str | None
) -> dict[str, Any] | None:
    """Find the target file from the files list.

    Args:
        files: List of file contexts
        file_id: Specific file ID to find (from tool input)
        current_file_id: Fallback current file ID

    Returns:
        Target file dict or None if not found
    """
    target_file_id = file_id or current_file_id

    for f in files:
        if f["id"] == target_file_id:
            return f
        if not target_file_id and f.get("is_current"):
            return f

    # Fallback to first file if nothing matched
    return files[0] if files else None


def execute_get_document_outline(
    tool_input: dict[str, Any], files: list[dict[str, Any]], current_file_id: str | None
) -> dict[str, Any]:
    """Execute get_document_outline tool.

    Returns the heading structure with section IDs and line ranges.
    """
    target_file = find_target_file(files, tool_input.get("file_id"), current_file_id)

    if not target_file:
        return {"result": "No document is currently open."}

    content = target_file.get("content", "")
    lines = content.split("\n")
    sections = parse_sections(content)
    outline = generate_outline(sections, len(lines))

    return {"result": f"Document: {target_file['name']}\n{'=' * 50}\n{outline}"}


def execute_read_section(
    tool_input: dict[str, Any], files: list[dict[str, Any]], current_file_id: str | None
) -> dict[str, Any]:
    """Execute read_section tool.

    Returns content of requested sections with line numbers.
    Reading a parent section includes all its children.
    """
    target_file = find_target_file(files, tool_input.get("file_id"), current_file_id)

    if not target_file:
        return {"result": "No document is currently open."}

    content = target_file.get("content", "")
    sections = parse_sections(content)
    requested_ids = tool_input.get("section_ids", [])

    if not requested_ids:
        return {"error": "section_ids is required."}

    matched = find_sections(sections, requested_ids)

    if not matched:
        available = [s.section_id for s in sections]
        return {"error": f"No sections found for IDs: {requested_ids}. Available: {available}"}

    all_lines = content.split("\n")
    result_parts = []
    for sec in matched:
        sec_lines = all_lines[sec.start_line - 1 : sec.end_line]
        numbered = [f"{sec.start_line + i:4d} | {line}" for i, line in enumerate(sec_lines)]
        header = f"--- {sec.section_id}: {sec.heading_text} [L{sec.start_line}-L{sec.end_line}] ---"
        result_parts.append(header + "\n" + "\n".join(numbered))

    return {"result": "\n\n".join(result_parts)}


def execute_view_document(
    tool_input: dict[str, Any], files: list[dict[str, Any]], current_file_id: str | None
) -> dict[str, Any]:
    """Execute view_document tool.

    Returns the document content with line numbers.
    """
    target_file = find_target_file(files, tool_input.get("file_id"), current_file_id)

    if not target_file:
        return {"result": "No document is currently open."}

    content = target_file.get("content", "")
    lines = content.split("\n")
    numbered_lines = [f"{i + 1:4d} | {line}" for i, line in enumerate(lines)]

    return {"result": f"Document: {target_file['name']}\n{'=' * 50}\n" + "\n".join(numbered_lines)}


# ---------------------------------------------------------------------------
# Exact match helper (Claude Code-style: exact match or fail)
# ---------------------------------------------------------------------------


def _find_exact_match(content: str, target: str, label: str = "old_str") -> str | None:
    """Find target in content using exact matching only.

    Returns None on success (unique match found), or an error message string.
    Like Claude Code: exact match or fail with a clear error for the AI to retry.
    """
    if not target:
        return f"{label} is required."

    count = content.count(target)
    if count == 1:
        return None  # Exact unique match — success

    if count > 1:
        return f"{label} found {count} times. Include more surrounding context to make it unique."

    # Not found — give the AI actionable guidance
    lines = content.split("\n")
    return (
        f"No exact match for {label} in document ({len(lines)} lines). "
        f"The text must match exactly (including whitespace and line breaks). "
        f"Use view_document or read_section to copy the exact text."
    )


# ---------------------------------------------------------------------------
# str_replace_editor executor (replace mode + insert-after mode)
# ---------------------------------------------------------------------------


def execute_str_replace(
    tool_input: dict[str, Any], files: list[dict[str, Any]], current_file_id: str | None
) -> dict[str, Any]:
    """Execute str_replace_editor tool.

    Exact match replacement: old_str + new_str → replace old_str with new_str.
    old_str must match exactly once in the document.
    """
    target_file = find_target_file(files, tool_input.get("file_id"), current_file_id)

    if not target_file:
        return {"error": "No document is currently open."}

    old_str = tool_input.get("old_str", "")
    new_str = tool_input.get("new_str", "")
    content = target_file.get("content", "")

    if not old_str:
        return {"error": "old_str is required."}

    error = _find_exact_match(content, old_str)
    if error:
        return {"error": error}

    return {
        "type": "str_replace",
        "file_id": target_file["id"],
        "file_name": target_file["name"],
        "old_str": old_str,
        "new_str": new_str,
        "success": True,
    }


def _is_untitled(file_name: str) -> bool:
    """Check if a file name is the default untitled name."""
    return file_name.replace(".md", "").strip().lower() == "untitled"


def _extract_leading_h1(content: str) -> tuple[str, str | None]:
    """Extract a leading H1 heading from content.

    Only matches single ``#`` (H1), not ``##`` or deeper headings.

    Returns:
        (content_without_h1, extracted_title) — title is None if no H1 found.
    """
    match = re.match(r"^#\s+(.+?)[ \t]*\n(.*)", content, re.DOTALL)
    if match:
        title = match.group(1).strip()
        rest = match.group(2).lstrip("\n")
        return rest, title
    return content, None


def execute_replace_document(
    tool_input: dict[str, Any], files: list[dict[str, Any]], current_file_id: str | None
) -> dict[str, Any]:
    """Execute replace_document tool.

    Replaces the entire document content.

    For untitled files (``Untitled.md``), if the content starts with an H1 heading,
    it is stripped from content and used as the new ``file_name``. The frontend
    detects the name change and renames the file accordingly.
    """
    target_file = find_target_file(files, tool_input.get("file_id"), current_file_id)

    if not target_file:
        return {"error": "No document is currently open."}

    new_content = tool_input.get("new_content", "")
    file_name = target_file["name"]

    # For untitled files, extract leading H1 as the document name
    if _is_untitled(file_name):
        content_without_h1, extracted_title = _extract_leading_h1(new_content)
        if extracted_title:
            new_content = content_without_h1
            file_name = f"{extracted_title}.md"

    return {
        "type": "replace_all",
        "file_id": target_file["id"],
        "file_name": file_name,
        "new_content": new_content,
        "success": True,
    }


def execute_search_in_document(
    tool_input: dict[str, Any], files: list[dict[str, Any]], current_file_id: str | None
) -> dict[str, Any]:
    """Execute search_in_document tool.

    Searches for text in the document and returns matching lines with context.
    """
    target_file = find_target_file(files, tool_input.get("file_id"), current_file_id)

    if not target_file:
        return {"result": "No document is currently open."}

    query = tool_input.get("query", "").lower()
    content = target_file.get("content", "")
    lines = content.split("\n")

    results = []
    for i, line in enumerate(lines):
        if query in line.lower():
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


# Tool executor registry
_TOOL_EXECUTORS = {
    "get_document_outline": execute_get_document_outline,
    "read_section": execute_read_section,
    "view_document": execute_view_document,
    "str_replace_editor": execute_str_replace,
    "replace_document": execute_replace_document,
    "search_in_document": execute_search_in_document,
}


def execute_document_tool(
    tool_name: str,
    tool_input: dict[str, Any],
    files: list[dict[str, Any]],
    current_file_id: str | None,
) -> dict[str, Any]:
    """Execute a document editing tool.

    Args:
        tool_name: Name of the tool to execute
        tool_input: Tool input parameters
        files: List of file contexts
        current_file_id: Current file ID

    Returns:
        Tool result dict with either 'result', 'error', or edit operation fields
    """
    executor = _TOOL_EXECUTORS.get(tool_name)

    if executor is None:
        return {"error": f"Unknown document tool: {tool_name}"}

    return executor(tool_input, files, current_file_id)


def is_document_tool(tool_name: str) -> bool:
    """Check if a tool is a document editing tool."""
    return tool_name in _TOOL_EXECUTORS
