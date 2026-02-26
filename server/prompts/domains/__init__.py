"""Domain-specific prompts.

Each module contains prompts for a specific agent or feature:
- writing: Writing Agent for document editing
- review: Text review and suggestions
- autocomplete: Text completion
"""

from .autocomplete import (
    AUTOCOMPLETE_SYSTEM_LONG,
    AUTOCOMPLETE_SYSTEM_SHORT,
    build_autocomplete_prompt,
)
from .review import REVIEW_JSON_SCHEMA, REVIEW_SYSTEM_PROMPT
from .writing import build_kb_context, build_writing_prompt

__all__ = [
    "build_writing_prompt",
    "build_kb_context",
    "REVIEW_SYSTEM_PROMPT",
    "REVIEW_JSON_SCHEMA",
    "AUTOCOMPLETE_SYSTEM_SHORT",
    "AUTOCOMPLETE_SYSTEM_LONG",
    "build_autocomplete_prompt",
]
