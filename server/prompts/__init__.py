"""Prompt builders for doXmind agents.

This module provides structured, XML-tagged system prompts following
industry best practices (Cursor, Claude Code style).
"""

from .domains.writing import build_writing_prompt, build_kb_context
from .domains.review import REVIEW_SYSTEM_PROMPT, REVIEW_JSON_SCHEMA
from .domains.edit import QUICK_EDIT_SYSTEM, EDIT_ACTIONS, build_edit_prompt
from .domains.autocomplete import AUTOCOMPLETE_SYSTEM, build_autocomplete_prompt

__all__ = [
    # Writing
    "build_writing_prompt",
    "build_kb_context",
    # Review
    "REVIEW_SYSTEM_PROMPT",
    "REVIEW_JSON_SCHEMA",
    # Edit
    "QUICK_EDIT_SYSTEM",
    "EDIT_ACTIONS",
    "build_edit_prompt",
    # Autocomplete
    "AUTOCOMPLETE_SYSTEM",
    "build_autocomplete_prompt",
]
