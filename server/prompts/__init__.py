"""Prompt builders for doXmind agents.

This module provides structured, XML-tagged system prompts following
industry best practices (Cursor, Claude Code style).
"""

from .domains.autocomplete import (
    AUTOCOMPLETE_SYSTEM_LONG,
    AUTOCOMPLETE_SYSTEM_SHORT,
    build_autocomplete_prompt,
)
from .domains.review import REVIEW_JSON_SCHEMA, REVIEW_SYSTEM_PROMPT
from .domains.writing import build_kb_context, build_writing_prompt

__all__ = [
    # Writing
    "build_writing_prompt",
    "build_kb_context",
    # Review
    "REVIEW_SYSTEM_PROMPT",
    "REVIEW_JSON_SCHEMA",
    # Autocomplete
    "AUTOCOMPLETE_SYSTEM_SHORT",
    "AUTOCOMPLETE_SYSTEM_LONG",
    "build_autocomplete_prompt",
]
