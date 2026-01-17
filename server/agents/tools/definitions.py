"""Tool definitions for the writing agent.

This module contains all tool schemas used by Claude API for document editing
and knowledge base operations.
"""


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
# Skill Tools Definition
# ============================================================================

SKILL_TOOLS = [
    {
        "name": "list_skills",
        "description": """List all available writing skills with their templates and knowledge files.
Use this to discover what specialized skills are available.""",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "read_skill_instructions",
        "description": """Read the main instructions from a skill's SKILL.md file.
Instructions contain domain expertise, workflow guidance, and best practices.

IMPORTANT: Always read instructions FIRST before using templates or knowledge.

Use this when:
- Starting ANY task that matches a skill's domain
- You need expert guidance on HOW to approach a writing task
- You want to understand the recommended workflow

Example: Before writing an essay, call read_skill_instructions("essay-writing") to get expert guidance on essay structure, style, and workflow.""",
        "input_schema": {
            "type": "object",
            "properties": {
                "skill_name": {
                    "type": "string",
                    "description": "Name of the skill (e.g., 'essay-writing', 'research-analysis', 'content-writing')",
                },
            },
            "required": ["skill_name"],
        },
    },
    {
        "name": "read_skill_template",
        "description": """Read a template file from a skill.
Templates provide document STRUCTURE - outlines, sections, and fill-in-the-blank frameworks.

Use this when you need:
- Document structure/outline (e.g., essay sections, report format)
- A starting framework to fill in with content
- Standard format for a specific document type

Do NOT use for: citation formats, writing tips, or reference information (use read_skill_knowledge instead).

Example: read_skill_template("essay-writing", "argumentative.md") returns the argumentative essay structure.""",
        "input_schema": {
            "type": "object",
            "properties": {
                "skill_name": {
                    "type": "string",
                    "description": "Name of the skill (e.g., 'essay-writing', 'research-analysis')",
                },
                "template_name": {
                    "type": "string",
                    "description": "Name of the template file (e.g., 'argumentative.md', 'blog_post.md')",
                },
            },
            "required": ["skill_name", "template_name"],
        },
    },
    {
        "name": "read_skill_knowledge",
        "description": """Read a knowledge file from a skill.
Knowledge files contain REFERENCE information - guidelines, rules, and best practices.

Use this when you need:
- Citation format rules (APA, MLA, Chicago, Harvard)
- Academic phrases and transitions
- Writing style guidelines and tips
- Best practices for specific tasks (SEO, headlines, etc.)

Do NOT use for: document structure or outlines (use read_skill_template instead).

Example: read_skill_knowledge("essay-writing", "citation_apa.md") returns APA citation rules.""",
        "input_schema": {
            "type": "object",
            "properties": {
                "skill_name": {
                    "type": "string",
                    "description": "Name of the skill (e.g., 'essay-writing', 'research-analysis')",
                },
                "knowledge_name": {
                    "type": "string",
                    "description": "Name of the knowledge file (e.g., 'citation_apa.md', 'academic_phrases.md')",
                },
            },
            "required": ["skill_name", "knowledge_name"],
        },
    },
]


# ============================================================================
# Tool Names for Quick Lookup
# ============================================================================

DOCUMENT_TOOL_NAMES = {tool["name"] for tool in DOCUMENT_TOOLS}
KB_TOOL_NAMES = {tool["name"] for tool in KB_TOOLS}
SKILL_TOOL_NAMES = {tool["name"] for tool in SKILL_TOOLS}
READONLY_TOOL_NAMES = {tool["name"] for tool in READONLY_TOOLS}


def get_tools_for_mode(
    mode: str,
    has_kb_attachments: bool = False,
    has_skills: bool = False,
    web_search_enabled: bool = False,
    web_search_max_uses: int = 5,
    web_fetch_max_uses: int = 10,
) -> list[dict]:
    """Get the appropriate tools based on mode and feature flags.

    Args:
        mode: "edit" for full editing tools, "analyze" for read-only
        has_kb_attachments: Whether KB attachments exist for this conversation
        has_skills: Whether skills are available
        web_search_enabled: Whether web search tool is enabled
        web_search_max_uses: Max number of web searches per request
        web_fetch_max_uses: Max number of web fetches per request (always enabled)

    Returns:
        List of tool definitions for Claude API
    """
    base_tools = DOCUMENT_TOOLS if mode == "edit" else READONLY_TOOLS
    tools = list(base_tools)  # Make a copy

    if has_kb_attachments:
        tools = tools + KB_TOOLS

    if has_skills:
        tools = tools + SKILL_TOOLS

    # Add web tools (Anthropic server-side tools)
    # Web search is optional (costs $0.01 per search)
    if web_search_enabled:
        tools.append(get_web_search_tool(web_search_max_uses))
    # Web fetch is always enabled (free, only costs tokens)
    tools.append(get_web_fetch_tool(web_fetch_max_uses))

    return tools


# ============================================================================
# Web Tools Definition (Anthropic server-side tools)
# ============================================================================

def get_web_search_tool(max_uses: int = 5) -> dict:
    """Get web search tool definition for Anthropic API.

    This is a server-side tool - Claude decides when to search,
    and the API executes the search automatically.

    Pricing: $10 per 1,000 searches + standard token costs.
    """
    return {
        "type": "web_search_20250305",
        "name": "web_search",
        "max_uses": max_uses
    }


def get_web_fetch_tool(max_uses: int = 10) -> dict:
    """Get web fetch tool definition for Anthropic API.

    This is a server-side tool - Claude decides when to fetch URLs,
    and the API retrieves the content automatically.

    Requires beta header: anthropic-beta: web-fetch-2025-09-10
    No additional cost beyond standard token costs.
    """
    return {
        "type": "web_fetch_20250910",
        "name": "web_fetch",
        "max_uses": max_uses,
        "citations": {"enabled": True}
    }
