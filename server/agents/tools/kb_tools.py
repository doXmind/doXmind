"""Knowledge Base tool executors.

This module contains the execution logic for KB tools:
- list_kb_documents
- search_knowledge_base
- read_kb_document

All KB tools are async since they interact with the RAG service.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

# KB tool names for quick lookup
KB_TOOL_NAMES = frozenset(["search_knowledge_base", "read_kb_document", "list_kb_documents"])


def is_kb_tool(tool_name: str) -> bool:
    """Check if a tool is a KB tool that requires async execution."""
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
        doc_list.append(
            f"- **{att['filename']}** ({att['file_type'].upper()}, {att['chunk_count']} sections)"
        )

    return {"result": "Documents in knowledge base:\n" + "\n".join(doc_list)}


async def execute_search_knowledge_base(
    tool_input: dict[str, Any], kb_context: dict[str, Any]
) -> dict[str, Any]:
    """Execute search_knowledge_base tool.

    Searches the conversation's KB for relevant information.
    """
    conversation_id = kb_context.get("conversation_id")
    query = tool_input.get("query", "")
    top_k = min(tool_input.get("top_k", 5), 10)

    if not query:
        return {"error": "Search query is required."}

    # Import here to avoid circular imports
    from services.rag_service import RAGService

    db = kb_context.get("db")
    if not db:
        return {"error": "Database session not available."}

    try:
        rag = RAGService(db, api_key=kb_context.get("api_key"))
        results = await rag.search_kb(conversation_id, query, top_k)

        if not results:
            return {"result": f"No relevant results found for: '{query}'"}

        formatted_results = []
        for i, r in enumerate(results, 1):
            formatted_results.append(
                f"**Result {i}** (from {r['source_file']}, relevance: {r['score']:.2f}):\n{r['content']}"
            )

        return {"result": "\n\n---\n\n".join(formatted_results)}

    except Exception as e:
        logger.error(f"KB search error: {e}")
        return {"error": f"Search failed: {str(e)}"}


async def execute_read_kb_document(
    tool_input: dict[str, Any], kb_context: dict[str, Any]
) -> dict[str, Any]:
    """Execute read_kb_document tool.

    Reads content from a specific document in the KB.
    """
    attachments = kb_context.get("attachments", [])
    document_name = tool_input.get("document_name", "")
    start_section = tool_input.get("start_section", 0)
    num_sections = tool_input.get("num_sections", 5)

    if not document_name:
        return {"error": "Document name is required."}

    # Find attachment by name (exact or partial match)
    attachment = None
    for att in attachments:
        if att["filename"].lower() == document_name.lower():
            attachment = att
            break
        if document_name.lower() in att["filename"].lower():
            attachment = att
            break

    if not attachment:
        available = [att["filename"] for att in attachments]
        return {"error": f"Document '{document_name}' not found. Available: {', '.join(available)}"}

    # Import here to avoid circular imports
    from services.rag_service import RAGService

    db = kb_context.get("db")
    if not db:
        return {"error": "Database session not available."}

    try:
        rag = RAGService(db, api_key=kb_context.get("api_key"))
        result = await rag.get_kb_document_content(
            attachment["id"], start_section, start_section + num_sections
        )

        if not result["content"]:
            return {"result": f"No content found in {document_name}"}

        return {
            "result": (
                f"**{result['filename']}** "
                f"(sections {start_section + 1}-{start_section + result['chunks_returned']} "
                f"of {result['total_chunks']}):\n\n{result['content']}"
            )
        }

    except Exception as e:
        logger.error(f"KB read error: {e}")
        return {"error": f"Failed to read document: {str(e)}"}


# Tool executor registry
_KB_TOOL_EXECUTORS = {
    "list_kb_documents": execute_list_kb_documents,
    "search_knowledge_base": execute_search_knowledge_base,
    "read_kb_document": execute_read_kb_document,
}


async def execute_kb_tool(
    tool_name: str, tool_input: dict[str, Any], kb_context: dict[str, Any] | None
) -> dict[str, Any]:
    """Execute a KB tool asynchronously.

    Args:
        tool_name: Name of the KB tool to execute
        tool_input: Tool input parameters
        kb_context: KB context containing conversation_id and attachments

    Returns:
        Tool result dict with either 'result' or 'error'
    """
    if not kb_context:
        return {"error": "No knowledge base available for this conversation."}

    conversation_id = kb_context.get("conversation_id")
    if not conversation_id:
        return {"error": "No conversation context available."}

    executor = _KB_TOOL_EXECUTORS.get(tool_name)
    if executor is None:
        return {"error": f"Unknown KB tool: {tool_name}"}

    return await executor(tool_input, kb_context)
