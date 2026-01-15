"""Document editing tool executors.

This module contains the execution logic for document editing tools:
- view_document
- str_replace_editor
- insert_text
- replace_document
- search_in_document
"""

from typing import List, Optional, Dict, Any
from dataclasses import dataclass


@dataclass
class FileContext:
    """Represents a file context passed to tools."""
    id: str
    name: str
    content: str
    is_current: bool = False


def find_target_file(
    files: List[Dict[str, Any]],
    file_id: Optional[str],
    current_file_id: Optional[str]
) -> Optional[Dict[str, Any]]:
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


def execute_view_document(
    tool_input: Dict[str, Any],
    files: List[Dict[str, Any]],
    current_file_id: Optional[str]
) -> Dict[str, Any]:
    """Execute view_document tool.

    Returns the document content with line numbers.
    """
    target_file = find_target_file(files, tool_input.get("file_id"), current_file_id)

    if not target_file:
        return {"result": "No document is currently open."}

    content = target_file.get("content", "")
    lines = content.split("\n")
    numbered_lines = [f"{i+1:4d} | {line}" for i, line in enumerate(lines)]

    return {
        "result": f"Document: {target_file['name']}\n{'='*50}\n" + "\n".join(numbered_lines)
    }


def execute_str_replace(
    tool_input: Dict[str, Any],
    files: List[Dict[str, Any]],
    current_file_id: Optional[str]
) -> Dict[str, Any]:
    """Execute str_replace_editor tool.

    Replaces a specific string in the document.
    Returns an edit operation dict on success.
    """
    target_file = find_target_file(files, tool_input.get("file_id"), current_file_id)

    if not target_file:
        return {"error": "No document is currently open."}

    old_str = tool_input.get("old_str", "")
    new_str = tool_input.get("new_str", "")
    content = target_file.get("content", "")

    count = content.count(old_str)
    if count == 0:
        return {
            "error": "String not found in document. Make sure it matches exactly including whitespace."
        }
    if count > 1:
        return {
            "error": f"String found {count} times. Please provide a more unique string to replace."
        }

    return {
        "type": "str_replace",
        "file_id": target_file["id"],
        "file_name": target_file["name"],
        "old_str": old_str,
        "new_str": new_str,
        "success": True
    }


def execute_insert_text(
    tool_input: Dict[str, Any],
    files: List[Dict[str, Any]],
    current_file_id: Optional[str]
) -> Dict[str, Any]:
    """Execute insert_text tool.

    Inserts text after a specific line number.
    Returns an edit operation dict on success.
    """
    target_file = find_target_file(files, tool_input.get("file_id"), current_file_id)

    if not target_file:
        return {"error": "No document is currently open."}

    insert_line = tool_input.get("insert_line", 0)
    new_str = tool_input.get("new_str", "")
    content = target_file.get("content", "")
    lines = content.split("\n")

    if insert_line < 0 or insert_line > len(lines):
        return {"error": f"Line number {insert_line} is out of range (0-{len(lines)})"}

    return {
        "type": "insert",
        "file_id": target_file["id"],
        "file_name": target_file["name"],
        "insert_line": insert_line,
        "new_str": new_str,
        "success": True
    }


def execute_replace_document(
    tool_input: Dict[str, Any],
    files: List[Dict[str, Any]],
    current_file_id: Optional[str]
) -> Dict[str, Any]:
    """Execute replace_document tool.

    Replaces the entire document content.
    Returns an edit operation dict on success.
    """
    target_file = find_target_file(files, tool_input.get("file_id"), current_file_id)

    if not target_file:
        return {"error": "No document is currently open."}

    new_content = tool_input.get("new_content", "")

    return {
        "type": "replace_all",
        "file_id": target_file["id"],
        "file_name": target_file["name"],
        "new_content": new_content,
        "success": True
    }


def execute_search_in_document(
    tool_input: Dict[str, Any],
    files: List[Dict[str, Any]],
    current_file_id: Optional[str]
) -> Dict[str, Any]:
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
                context_lines.append(f"{prefix} {j+1:4d} | {lines[j]}")
            results.append("\n".join(context_lines))

    if results:
        return {"result": f"Found {len(results)} match(es):\n\n" + "\n\n".join(results[:10])}

    return {"result": f"No matches found for '{query}'"}


# Tool executor registry
_TOOL_EXECUTORS = {
    "view_document": execute_view_document,
    "str_replace_editor": execute_str_replace,
    "insert_text": execute_insert_text,
    "replace_document": execute_replace_document,
    "search_in_document": execute_search_in_document,
}


def execute_document_tool(
    tool_name: str,
    tool_input: Dict[str, Any],
    files: List[Dict[str, Any]],
    current_file_id: Optional[str]
) -> Dict[str, Any]:
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
