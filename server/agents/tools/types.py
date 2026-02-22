"""Shared types for agent tools.

Standard tool result format:
- Success: {"result": "..."} — text result for the LLM
- Error: {"error": "..."} — error message for the LLM
- Edit: {"type": "str_replace"|"replace_all", "success": True, ...} — edit operation
- Meta: {"success": True, ...} — meta-tools like TodoWrite
"""

from typing import Any, TypedDict


class ToolResult(TypedDict, total=False):
    """Standard tool result format returned by all tool executors."""

    result: str
    error: str
    success: bool
    type: str
    # Additional fields used by specific tools
    return_code: int  # code_execution
    count: int  # todo_tools
    todos: list[dict[str, Any]]  # todo_tools
