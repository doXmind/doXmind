"""TODO tracking tool executor.

This module handles the TodoWrite tool for tracking task progress.
The todo list is maintained in-memory during a single request and emitted as events.
"""

from typing import Any


def is_todo_tool(tool_name: str) -> bool:
    """Check if a tool is the todo tracking tool."""
    return tool_name == "TodoWrite"


def execute_todo_tool(tool_input: dict[str, Any]) -> dict[str, Any]:
    """Execute the TodoWrite tool.

    Args:
        tool_input: Contains 'todos' array with id, content, status, activeForm for each item

    Returns:
        Result dict with success status and count
    """
    todos = tool_input.get("todos", [])

    return {
        "success": True,
        "count": len(todos),
        "todos": todos  # Include raw data for event emission
    }
