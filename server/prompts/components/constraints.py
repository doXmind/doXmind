"""Common constraint definitions.

Reusable constraint rules that can be included in various prompts.
Use UPPERCASE for NEVER/ALWAYS/CRITICAL emphasis.
"""

# Language handling
LANGUAGE_CONSTRAINT = "ALWAYS respond in the same language as the user's message."

# Output formatting
OUTPUT_ONLY_CONSTRAINT = """- ONLY output the requested content
- NEVER add explanations or commentary
- NEVER wrap output in quotes or formatting"""

# Tool usage
TOOL_USAGE_CONSTRAINT = """- ALWAYS use tools to make changes directly
- NEVER write content in chat expecting copy-paste
- ALWAYS verify tool inputs before execution"""

# Markdown format rules
MARKDOWN_FORMAT_RULES = """All content uses Markdown:
- Headings: #, ##, ###
- Bold/Italic: **bold**, *italic*
- Lists: - item or 1. item
- Tables: | Header | Header |
- Code: triple backticks"""
