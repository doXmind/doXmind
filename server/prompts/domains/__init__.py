"""Domain-specific prompts.

Each module contains prompts for a specific agent or feature:
- writing: Writing Agent for document editing
- review: Text review and suggestions
- edit: Quick edit operations
- autocomplete: Text completion
"""

from .autocomplete import AUTOCOMPLETE_SYSTEM, build_autocomplete_prompt
from .edit import EDIT_ACTIONS, QUICK_EDIT_SYSTEM, build_edit_prompt
from .review import REVIEW_JSON_SCHEMA, REVIEW_SYSTEM_PROMPT
from .writing import build_kb_context, build_writing_prompt

__all__ = [
    "build_writing_prompt",
    "build_kb_context",
    "REVIEW_SYSTEM_PROMPT",
    "REVIEW_JSON_SCHEMA",
    "QUICK_EDIT_SYSTEM",
    "EDIT_ACTIONS",
    "build_edit_prompt",
    "AUTOCOMPLETE_SYSTEM",
    "build_autocomplete_prompt",
]
