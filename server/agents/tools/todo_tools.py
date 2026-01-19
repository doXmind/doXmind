"""TODO tracking tool executor.

This module handles the update_todo tool for tracking task progress.
The todo list is maintained in-memory during a single request and emitted as events.
"""

from typing import Any


def is_todo_tool(tool_name: str) -> bool:
    """Check if a tool is the todo tracking tool."""
    return tool_name == "update_todo"


def execute_todo_tool(tool_input: dict[str, Any]) -> dict[str, Any]:
    """Execute the update_todo tool.

    Args:
        tool_input: Contains 'todos' array with id, content, status for each item

    Returns:
        Result dict with the todo list for confirmation
    """
    todos = tool_input.get("todos", [])

    if not todos:
        return {"result": "Todo list cleared."}

    # Format for display
    status_icons = {
        "pending": "○",
        "in_progress": "◐",
        "completed": "●",
        "failed": "✗"
    }

    formatted = []
    for todo in todos:
        icon = status_icons.get(todo.get("status", "pending"), "○")
        content = todo.get("content", "")
        formatted.append(f"{icon} {content}")

    return {
        "result": "Todo list updated:\n" + "\n".join(formatted),
        "todos": todos  # Include raw data for event emission
    }
