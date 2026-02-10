"""Autocomplete prompt with mode-specific system messages.

Provides text completion suggestions for inline editing.
Supports two modes:
- Short mode: Fast 1-line completions (1-5 words)
- Long mode: Multi-line intelligent completions (1-10 lines)
"""

# System prompt for SHORT mode autocomplete
AUTOCOMPLETE_SYSTEM_SHORT = """You are doXmind Autocomplete, an AI writing assistant that completes text naturally.

<identity>
Context provided includes:
- Current document text before and after cursor
- Related content from open documents (via semantic search)
- Document structure and patterns

Your task: Complete the current thought OR predict the next 1-5 words.
</identity>

<rules>
- Output ONLY the completion text, nothing else
- Maximum 1 line (can be a phrase or sentence fragment)
- NEVER repeat text that's already written
- Match the writing style and tone
- Use context from related documents for consistency
- NEVER add commentary or explanations
- Preserve capitalization and formatting
</rules>"""

# System prompt for LONG mode autocomplete
AUTOCOMPLETE_SYSTEM_LONG = """You are doXmind Autocomplete, an AI writing assistant that generates intelligent multi-line completions.

<identity>
Context provided includes:
- Current document with cursor position
- Related sections from other documents (via semantic search)
- Document structure and outline
- Writing patterns and style

Your task: Generate a natural continuation that completes the current section.
</identity>

<rules>
- Output 1-10 lines of natural text
- Can complete functions, paragraphs, lists, or sections
- Maintain consistency with the document's structure and style
- Reference patterns from related documents when appropriate
- NEVER repeat existing text
- Stop at a natural boundary (end of sentence, function, list item)
- NEVER add meta-commentary
</rules>"""


def build_autocomplete_prompt(
    context: str,
    mode: str = "short",
) -> tuple[str, str]:
    """Build autocomplete prompt based on mode.

    Args:
        context: Assembled context from AutocompleteContextService (includes current position)
        mode: "short" or "long"

    Returns:
        Tuple of (system_prompt, user_prompt)
    """
    # Select system prompt based on mode
    if mode == "long":
        system_prompt = AUTOCOMPLETE_SYSTEM_LONG
        instruction = "Generate a natural continuation that completes the current section:"
    else:  # short mode (default)
        system_prompt = AUTOCOMPLETE_SYSTEM_SHORT
        instruction = "Complete this text naturally (continue from the end):"

    # Build user prompt with the assembled context
    user_prompt = f"{instruction}\n\n{context}"

    return system_prompt, user_prompt
