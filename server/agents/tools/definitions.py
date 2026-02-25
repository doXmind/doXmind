"""Tool definitions for the writing agent.

This module contains all tool schemas used by the API for document editing
and knowledge base operations.

Internal format uses Anthropic-style definitions (name, description, input_schema).
The to_openai_tools() helper converts them to OpenAI function-calling format
before sending to the API.
"""


# ============================================================================
# Document Editing Tools Definition
# ============================================================================

DOCUMENT_TOOLS = [
    {
        "name": "get_document_outline",
        "description": "Get the document's heading structure with section IDs, line ranges, and estimated token counts. Lightweight (~200 tokens). Use this first to understand document structure before reading or editing long documents.",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file (optional, uses current file if not provided)",
                }
            },
            "required": [],
        },
    },
    {
        "name": "read_section",
        "description": "Read specific sections of the document by section ID (from get_document_outline or the outline in context). Returns content with line numbers for editing. Reading a parent section includes all its children.",
        "input_schema": {
            "type": "object",
            "properties": {
                "section_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Section IDs to read (e.g., ['s1', 's2.1'])",
                },
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file (optional)",
                },
            },
            "required": ["section_ids"],
        },
    },
    {
        "name": "view_document",
        "description": "View the ENTIRE document content with line numbers. For long documents (80+ lines), prefer get_document_outline + read_section to reduce token usage.",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to view (optional, uses current file if not provided)",
                }
            },
            "required": [],
        },
    },
    {
        "name": "str_replace_editor",
        "description": (
            "Edit the document by replacing text. Provide old_str (exact text to find) "
            "and new_str (replacement text). old_str must match exactly once in the document. "
            "Include enough surrounding context to ensure uniqueness."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "old_str": {
                    "type": "string",
                    "description": "Exact text to find and replace (must match uniquely in document)",
                },
                "new_str": {
                    "type": "string",
                    "description": "Replacement text (use Markdown format)",
                },
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to edit (optional)",
                },
            },
            "required": ["old_str", "new_str"],
        },
    },
    {
        "name": "replace_document",
        "description": "Replace the entire document content. Use this when making major rewrites or creating new content from scratch.",
        "input_schema": {
            "type": "object",
            "properties": {
                "new_content": {
                    "type": "string",
                    "description": "The complete new content for the document (use Markdown format)",
                },
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to edit (optional)",
                },
            },
            "required": ["new_content"],
        },
    },
    {
        "name": "search_in_document",
        "description": "Search for text in the document and return matching lines with context.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The text to search for (case-insensitive)",
                },
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to search (optional)",
                },
            },
            "required": ["query"],
        },
    },
]

# Backward compatibility alias
TOOLS = DOCUMENT_TOOLS

# Read-only tools for analyze mode
# get_document_outline, read_section, view_document, search_in_document
READONLY_TOOLS = [DOCUMENT_TOOLS[i] for i in (0, 1, 2, 5)]

# Minimal tools for quick edit mode
# str_replace_editor (index 3) + view_document (index 2) for long doc fallback
QUICK_EDIT_TOOLS = [DOCUMENT_TOOLS[i] for i in (3, 2)]


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
                    "description": "The search query - be specific about what information you need",
                },
                "top_k": {
                    "type": "integer",
                    "description": "Number of results to return (default: 5, max: 10)",
                    "default": 5,
                },
            },
            "required": ["query"],
        },
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
                    "description": "The filename of the document to read (e.g., 'research-paper.pdf')",
                },
                "start_section": {
                    "type": "integer",
                    "description": "Starting section/chunk to read from (0-indexed, default: 0)",
                    "default": 0,
                },
                "num_sections": {
                    "type": "integer",
                    "description": "Number of sections to read (default: 5)",
                    "default": 5,
                },
            },
            "required": ["document_name"],
        },
    },
    {
        "name": "list_kb_documents",
        "description": "List all documents in the conversation's knowledge base. Use this to see what reference materials are available.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
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
# Data Files Tools Definition (for code execution analysis)
# ============================================================================

DATA_FILES_TOOLS = [
    {
        "name": "list_data_files",
        "description": """List all data files uploaded to this conversation.
Use this to see what data files (CSV, Excel, JSON, etc.) are available for analysis.
The files can be analyzed using code execution when enabled.""",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    }
]


# ============================================================================
# Legal Research Tools Definition
# ============================================================================

LEGAL_TOOLS = [
    {
        "name": "search_court_opinions",
        "description": """Search CourtListener for court opinions and legal cases.
Returns a list of matching cases with opinion_id for fetching full text.

Use get_court_opinion to read the full opinion text after finding relevant cases.""",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query - legal concepts, case names, or keywords",
                },
                "court": {
                    "type": "string",
                    "description": "Court filter: 'scotus', 'ca1'-'ca11', state abbreviations",
                },
                "filed_after": {
                    "type": "string",
                    "description": "Cases filed after date (YYYY-MM-DD)",
                },
                "filed_before": {
                    "type": "string",
                    "description": "Cases filed before date (YYYY-MM-DD)",
                },
                "cited_gt": {
                    "type": "integer",
                    "description": "Minimum citation count",
                },
                "order_by": {
                    "type": "string",
                    "enum": ["score desc", "dateFiled desc", "citeCount desc"],
                    "description": "Sort order",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_court_opinion",
        "description": """Get the full text of a court opinion by ID.
Use after search_court_opinions to read the complete opinion text for citation or analysis.""",
        "input_schema": {
            "type": "object",
            "properties": {
                "opinion_id": {
                    "type": "integer",
                    "description": "The opinion_id from search results",
                },
            },
            "required": ["opinion_id"],
        },
    },
]


# ============================================================================
# Skill-to-External-Tools Mapping
# ============================================================================
# Maps skill names to their associated external tools.
# Tools are only loaded when the skill's instructions are read.

SKILL_EXTERNAL_TOOLS: dict[str, list[dict]] = {
    "legal": LEGAL_TOOLS,
    # data-analysis tools (CODE_EXECUTION_TOOL, DATA_FILES_TOOLS) are always loaded
}


# ============================================================================
# Tool Names for Quick Lookup
# ============================================================================

DOCUMENT_TOOL_NAMES = {tool["name"] for tool in DOCUMENT_TOOLS}
KB_TOOL_NAMES = {tool["name"] for tool in KB_TOOLS}
SKILL_TOOL_NAMES = {tool["name"] for tool in SKILL_TOOLS}
LEGAL_TOOL_NAMES = {tool["name"] for tool in LEGAL_TOOLS}
DATA_FILES_TOOL_NAMES = {tool["name"] for tool in DATA_FILES_TOOLS}
READONLY_TOOL_NAMES = {tool["name"] for tool in READONLY_TOOLS}


def get_tools_for_mode(
    mode: str,
    has_kb_attachments: bool = False,
    has_skills: bool = False,
    web_search_enabled: bool = False,
    is_quick_edit: bool = False,
) -> list[dict]:
    """Get the appropriate tools based on mode and feature flags.

    Args:
        mode: "edit" for full editing tools, "analyze" for read-only
        has_kb_attachments: Whether KB attachments exist for this conversation
        has_skills: Whether skills are available
        web_search_enabled: Whether Brave web search tool is enabled
        is_quick_edit: Quick edit mode - only str_replace_editor + view_document

    Returns:
        List of tool definitions for the API

    Note:
        External tools (like LEGAL_TOOLS) are loaded dynamically
        when their associated skill is read via SKILL_EXTERNAL_TOOLS mapping.
    """
    # Quick edit: minimal tool set for fast, focused edits
    if is_quick_edit:
        return list(QUICK_EDIT_TOOLS)

    base_tools = DOCUMENT_TOOLS if mode == "edit" else READONLY_TOOLS
    tools = list(base_tools)  # Make a copy

    # Always add TODO tracking tool for task progress visibility
    tools.append(TODO_TOOL)

    if has_kb_attachments:
        tools = tools + KB_TOOLS

    if has_skills:
        tools = tools + SKILL_TOOLS

    # Add web tools (client-side tools via Brave Search / httpx)
    if web_search_enabled:
        tools.append(WEB_SEARCH_TOOL)
    tools.append(WEB_FETCH_TOOL)

    # Always add code execution and data files tools
    tools.append(CODE_EXECUTION_TOOL)
    tools.extend(DATA_FILES_TOOLS)

    return tools


def get_external_tools_for_skill(skill_name: str) -> list[dict]:
    """Get external tools associated with a skill.

    Args:
        skill_name: Name of the skill (e.g., 'legal-writing')

    Returns:
        List of tool definitions, or empty list if none
    """
    return SKILL_EXTERNAL_TOOLS.get(skill_name, [])


# ============================================================================
# TODO Tracking Tool Definition
# ============================================================================

TODO_TOOL = {
    "name": "TodoWrite",
    "description": """Track progress for multi-step tasks (3+ steps). The user sees updates in real-time.

States: pending | in_progress (ONE only) | completed

USAGE PATTERN:
1. Create list: first task "in_progress", others "pending"
2. After EACH task completes: call TodoWrite to update (mark done + start next)
3. Never batch updates - call immediately after each step

Fields:
- content: what to do ("Fix bug")
- activeForm: shown during work ("Fixing bug")
- status: pending/in_progress/completed""",
    "input_schema": {
        "type": "object",
        "properties": {
            "todos": {
                "type": "array",
                "description": "The complete list of todo items (replaces entire list)",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "Unique identifier for the todo"},
                        "content": {
                            "type": "string",
                            "description": "Imperative form: what to do (e.g., 'Run tests')",
                        },
                        "status": {
                            "type": "string",
                            "enum": ["pending", "in_progress", "completed"],
                            "description": "Current status of the task",
                        },
                        "activeForm": {
                            "type": "string",
                            "description": "Present continuous form shown during execution (e.g., 'Running tests')",
                        },
                    },
                    "required": ["id", "content", "status", "activeForm"],
                },
            }
        },
        "required": ["todos"],
    },
}


# ============================================================================
# Web Tools Definition (client-side tools via Brave Search / httpx)
# ============================================================================

WEB_SEARCH_TOOL = {
    "name": "web_search",
    "description": "Search the web for information using Brave Search. Returns titles, URLs, and snippets.",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query to look up on the web",
            }
        },
        "required": ["query"],
    },
}

WEB_FETCH_TOOL = {
    "name": "web_fetch",
    "description": "Fetch and read the content of a web page. Returns the text content extracted from the URL.",
    "input_schema": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL of the web page to fetch",
            }
        },
        "required": ["url"],
    },
}

# ============================================================================
# Code Execution Tool Definition (client-side Python subprocess)
# ============================================================================

CODE_EXECUTION_TOOL = {
    "name": "code_execution",
    "description": "Execute Python code to analyze data, perform calculations, or generate visualizations. "
    "The code runs in a sandboxed subprocess with a 30-second timeout. "
    "All uploaded data files (CSV, Excel, JSON, etc.) are available in the working directory "
    "and can be read directly by filename (e.g., pd.read_csv('order_items.csv')). "
    "Use list_data_files first to see what files are available.",
    "input_schema": {
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "description": "Python code to execute",
            }
        },
        "required": ["code"],
    },
}


# ============================================================================
# Format Conversion: Anthropic → OpenAI function-calling
# ============================================================================


def to_openai_tool(tool: dict) -> dict:
    """Convert a single Anthropic-style tool definition to OpenAI function-calling format.

    Anthropic format: {"name": ..., "description": ..., "input_schema": {...}}
    OpenAI format:    {"type": "function", "function": {"name": ..., "description": ..., "parameters": {...}}}
    """
    return {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": tool.get("input_schema", {"type": "object", "properties": {}}),
        },
    }


def to_openai_tools(tools: list[dict]) -> list[dict]:
    """Convert a list of Anthropic-style tools to OpenAI function-calling format."""
    return [to_openai_tool(t) for t in tools]
