"""Knowledge Base tool executors.

Only handles list_kb_documents. All other KB tools (search, read, outline)
are now handled by the unified tools in document_tools.py.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

# KB tool names for quick lookup
KB_TOOL_NAMES = frozenset(["list_kb_documents"])


def is_kb_tool(tool_name: str) -> bool:
    """Check if a tool is a KB tool."""
    return tool_name in KB_TOOL_NAMES


async def execute_list_kb_documents(
    tool_input: dict[str, Any], kb_context: dict[str, Any]
) -> dict[str, Any]:
    """Execute list_kb_documents tool.

    Lists all documents in the conversation's knowledge base.
    """
    attachments = kb_context.get("attachments", [])

    if not attachments:
        return {"result": "No documents in the knowledge base."}

    doc_list = []
    for att in attachments:
        doc_list.append(f"- **{att['filename']}** ({att['file_type'].upper()})")

    return {"result": "Documents in knowledge base:\n" + "\n".join(doc_list)}


async def execute_kb_tool(
    tool_name: str, tool_input: dict[str, Any], kb_context: dict[str, Any] | None
) -> dict[str, Any]:
    """Execute a KB tool asynchronously."""
    if not kb_context:
        return {"error": "No knowledge base available for this conversation."}

    if tool_name == "list_kb_documents":
        return await execute_list_kb_documents(tool_input, kb_context)

    return {"error": f"Unknown KB tool: {tool_name}"}
