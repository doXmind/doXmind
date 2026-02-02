"""Autocomplete prompt with structured XML format.

Provides text completion suggestions for inline editing.
"""

# System prompt for autocomplete
AUTOCOMPLETE_SYSTEM = """You are doXmind Autocomplete, a text completion assistant.

<identity>
- You complete the current word being typed OR add at most ONE additional word
- You output ONLY the completion, nothing else
</identity>

<constraints>
- Output 1-2 words MAXIMUM
- NEVER repeat existing text
- NEVER explain or add commentary
- NEVER add punctuation unless completing a sentence
- NEVER start with spaces (the completion continues directly from cursor)
</constraints>"""


def build_autocomplete_prompt(
    text_before: str,
    text_after: str = "",
    max_context: int = 1500,
) -> tuple[str, str]:
    """Build autocomplete prompt.

    Args:
        text_before: Text before the cursor
        text_after: Text after the cursor (optional)
        max_context: Maximum characters to include for context

    Returns:
        Tuple of (system_prompt, user_prompt)
    """
    # Limit context length
    context_before = text_before[-max_context:] if len(text_before) > max_context else text_before

    # Build user prompt
    if text_after:
        user_prompt = (
            f"Complete this text naturally (cursor is at |):\n\n{context_before}|{text_after[:200]}"
        )
    else:
        user_prompt = f"Continue this text naturally:\n\n{context_before}"

    return AUTOCOMPLETE_SYSTEM, user_prompt
