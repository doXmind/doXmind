"""Tool definitions for the writing agent.

This module contains all tool schemas used by Claude API for document editing
and knowledge base operations.
"""

from typing import List

# ============================================================================
# Document Editing Tools Definition
# ============================================================================

DOCUMENT_TOOLS = [
    {
        "name": "view_document",
        "description": "View the current document content with line numbers. Use this to see what's in the document before making edits.",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to view (optional, uses current file if not provided)"
                }
            },
            "required": []
        }
    },
    {
        "name": "str_replace_editor",
        "description": "Replace a specific string in the document with new content. The old_str must match EXACTLY including whitespace. This is the primary editing tool for making precise changes.",
        "input_schema": {
            "type": "object",
            "properties": {
                "old_str": {
                    "type": "string",
                    "description": "The exact string to find and replace (must be unique in document)"
                },
                "new_str": {
                    "type": "string",
                    "description": "The new string to replace it with (use Markdown format)"
                },
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to edit (optional)"
                }
            },
            "required": ["old_str", "new_str"]
        }
    },
    {
        "name": "insert_text",
        "description": "Insert new text after a specific line number in the document.",
        "input_schema": {
            "type": "object",
            "properties": {
                "insert_line": {
                    "type": "integer",
                    "description": "The line number after which to insert (0 = beginning of file)"
                },
                "new_str": {
                    "type": "string",
                    "description": "The text to insert (use Markdown format)"
                },
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to edit (optional)"
                }
            },
            "required": ["insert_line", "new_str"]
        }
    },
    {
        "name": "replace_document",
        "description": "Replace the entire document content. Use this when making major rewrites or creating new content from scratch.",
        "input_schema": {
            "type": "object",
            "properties": {
                "new_content": {
                    "type": "string",
                    "description": "The complete new content for the document (use Markdown format)"
                },
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to edit (optional)"
                }
            },
            "required": ["new_content"]
        }
    },
    {
        "name": "search_in_document",
        "description": "Search for text in the document and return matching lines with context.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The text to search for (case-insensitive)"
                },
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to search (optional)"
                }
            },
            "required": ["query"]
        }
    }
]

# Backward compatibility alias
TOOLS = DOCUMENT_TOOLS

# Read-only tools for analyze mode (view_document and search_in_document)
READONLY_TOOLS = [DOCUMENT_TOOLS[0], DOCUMENT_TOOLS[4]]


# ============================================================================
# Knowledge Base Tools Definition
# ============================================================================

KB_TOOLS = [
    {
        "name": "search_knowledge_base",
        "description": """Search the conversation's knowledge base for relevant information.
Use this when you need to find specific information from attached documents (PDFs, DOCX, PPTX files).
Returns the most relevant excerpts from the documents.""",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query - be specific about what information you need"
                },
                "top_k": {
                    "type": "integer",
                    "description": "Number of results to return (default: 5, max: 10)",
                    "default": 5
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "read_kb_document",
        "description": """Read content from a specific document in the knowledge base.
Use this when you need to read through a document, or when search_knowledge_base found a document you want to explore further.""",
        "input_schema": {
            "type": "object",
            "properties": {
                "document_name": {
                    "type": "string",
                    "description": "The filename of the document to read (e.g., 'research-paper.pdf')"
                },
                "start_section": {
                    "type": "integer",
                    "description": "Starting section/chunk to read from (0-indexed, default: 0)",
                    "default": 0
                },
                "num_sections": {
                    "type": "integer",
                    "description": "Number of sections to read (default: 5)",
                    "default": 5
                }
            },
            "required": ["document_name"]
        }
    },
    {
        "name": "list_kb_documents",
        "description": "List all documents in the conversation's knowledge base. Use this to see what reference materials are available.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    }
]


# ============================================================================
# Tool Names for Quick Lookup
# ============================================================================

DOCUMENT_TOOL_NAMES = {tool["name"] for tool in DOCUMENT_TOOLS}
KB_TOOL_NAMES = {tool["name"] for tool in KB_TOOLS}
READONLY_TOOL_NAMES = {tool["name"] for tool in READONLY_TOOLS}


def get_tools_for_mode(mode: str, has_kb_attachments: bool = False) -> List[dict]:
    """Get the appropriate tools based on mode and KB availability.

    Args:
        mode: "edit" for full editing tools, "analyze" for read-only
        has_kb_attachments: Whether KB attachments exist for this conversation

    Returns:
        List of tool definitions for Claude API
    """
    if mode == "edit":
        base_tools = DOCUMENT_TOOLS
    else:
        base_tools = READONLY_TOOLS

    if has_kb_attachments:
        return base_tools + KB_TOOLS

    return base_tools
