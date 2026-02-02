"""Data Files tool executors.

This module contains the execution logic for data files tools:
- list_data_files: List all data files in the conversation

Data files are used for code execution analysis (CSV, Excel, JSON, etc.)
Unlike KB files, they are NOT vectorized - just passed to the code sandbox.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Data files tool names for quick lookup
DATA_FILES_TOOL_NAMES = frozenset(["list_data_files"])


def is_data_files_tool(tool_name: str) -> bool:
    """Check if a tool is a data files tool."""
    return tool_name in DATA_FILES_TOOL_NAMES


def execute_list_data_files(
    tool_input: dict[str, Any], data_files_context: dict[str, Any]
) -> dict[str, Any]:
    """Execute list_data_files tool.

    Lists all data files in the conversation with their metadata.
    """
    data_files = data_files_context.get("data_files", [])

    if not data_files:
        return {
            "result": "No data files uploaded. The user can upload CSV, Excel, JSON, or TXT files for analysis."
        }

    file_list = []
    for f in data_files:
        filename = f.get("filename", "unknown")
        file_type = f.get("file_type", "").upper()
        row_count = f.get("row_count", 0)
        column_names = f.get("column_names", [])

        info = f"- **{filename}** ({file_type})"
        if row_count and row_count > 0:
            info += f" - {row_count:,} rows"
        if column_names:
            cols = ", ".join(column_names[:5])
            if len(column_names) > 5:
                cols += f"... +{len(column_names) - 5} more"
            info += f"\n  Columns: {cols}"

        file_list.append(info)

    return {"result": "Data files available for analysis:\n" + "\n".join(file_list)}


# Tool executor registry
_DATA_FILES_TOOL_EXECUTORS = {
    "list_data_files": execute_list_data_files,
}


def execute_data_files_tool(
    tool_name: str, tool_input: dict[str, Any], data_files_context: dict[str, Any] | None
) -> dict[str, Any]:
    """Execute a data files tool.

    Args:
        tool_name: Name of the data files tool to execute
        tool_input: Tool input parameters
        data_files_context: Context containing data files metadata

    Returns:
        Tool result dict with either 'result' or 'error'
    """
    if not data_files_context:
        return {
            "result": "No data files uploaded yet. The user can upload CSV, Excel, JSON, or TXT files."
        }

    executor = _DATA_FILES_TOOL_EXECUTORS.get(tool_name)
    if executor is None:
        return {"error": f"Unknown data files tool: {tool_name}"}

    return executor(tool_input, data_files_context)
