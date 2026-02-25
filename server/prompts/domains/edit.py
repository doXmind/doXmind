"""Quick edit prompts with structured XML format.

Provides prompts for quick text editing operations like:
- Grammar fixing
- Text improvement
- Simplification/expansion
- Tone adjustment
- Translation
"""

# System prompt for quick edit operations
QUICK_EDIT_SYSTEM = """You are doXmind Quick Editor, a professional text editing assistant.

<identity>
- You edit text according to specific instructions
- You output ONLY the edited text
- You preserve the original meaning while improving quality
</identity>

<constraints>
- ONLY output the edited text
- NEVER add explanations, comments, or additional text
- NEVER wrap output in quotes or formatting
- ALWAYS preserve original meaning unless instructed otherwise
- NEVER start with phrases like "Here is..." or "The edited text is..."
- CRITICAL: ALWAYS use the SAME LANGUAGE as the original text (unless explicitly asked to translate)
  - If the input is in Chinese, output in Chinese
  - If the input is in English, output in English
  - If the input is in Spanish, output in Spanish, etc.
</constraints>"""

# Edit action configurations with instructions and temperature
EDIT_ACTIONS: dict[str, dict[str, str | float]] = {
    # Grammar and style
    "fix-grammar": {
        "instruction": "Fix all grammar and spelling errors. Keep the original meaning, style, and language intact.",
        "temperature": 0.2,
    },
    "improve": {
        "instruction": "Improve the writing quality. Make it clearer, more engaging, and better structured while preserving the meaning and language.",
        "temperature": 0.4,
    },
    # Length adjustments
    "simplify": {
        "instruction": "Rewrite using simpler language. Make it easier to understand for a general audience. Keep the same language as the original.",
        "temperature": 0.3,
    },
    "expand": {
        "instruction": "Expand with more details, examples, and explanations. Make it more comprehensive. Keep the same language as the original.",
        "temperature": 0.5,
    },
    "shorten": {
        "instruction": "Condense while keeping key information. Remove redundancy and make it more concise. Keep the same language as the original.",
        "temperature": 0.3,
    },
    # Tone adjustments
    "professional": {
        "instruction": "Rewrite in a professional, formal tone suitable for business communication. Keep the same language as the original.",
        "temperature": 0.3,
    },
    "casual": {
        "instruction": "Rewrite in a casual, friendly tone while maintaining clarity. Keep the same language as the original.",
        "temperature": 0.4,
    },
    "friendly": {
        "instruction": "Rewrite in a warm, friendly tone that feels personable and approachable. Keep the same language as the original.",
        "temperature": 0.4,
    },
    "confident": {
        "instruction": "Rewrite in a confident and assertive tone without being aggressive. Keep the same language as the original.",
        "temperature": 0.3,
    },
    # Translations
    "translate-en": {
        "instruction": "Translate to English. Preserve the meaning and tone.",
        "temperature": 0.2,
    },
    "translate-zh": {
        "instruction": "Translate to Chinese (Simplified). Preserve the meaning and tone.",
        "temperature": 0.2,
    },
    "translate-es": {
        "instruction": "Translate to Spanish. Preserve the meaning and tone.",
        "temperature": 0.2,
    },
    "translate-fr": {
        "instruction": "Translate to French. Preserve the meaning and tone.",
        "temperature": 0.2,
    },
    "translate-de": {
        "instruction": "Translate to German. Preserve the meaning and tone.",
        "temperature": 0.2,
    },
    "translate-ja": {
        "instruction": "Translate to Japanese. Preserve the meaning and tone.",
        "temperature": 0.2,
    },
}

# Default configuration for unknown actions
DEFAULT_EDIT_CONFIG = {
    "instruction": "Improve this text.",
    "temperature": 0.4,
}


def build_edit_prompt(action: str, text: str) -> tuple[str, str, float]:
    """Build edit prompt with system, user message, and temperature.

    Args:
        action: Edit action type (e.g., "fix-grammar", "improve")
        text: Text to edit

    Returns:
        Tuple of (system_prompt, user_prompt, temperature)
    """
    config = EDIT_ACTIONS.get(action, DEFAULT_EDIT_CONFIG)
    instruction = config.get("instruction", DEFAULT_EDIT_CONFIG["instruction"])
    temperature = config.get("temperature", DEFAULT_EDIT_CONFIG["temperature"])

    user_prompt = f"{instruction}\n\n{text}"

    return QUICK_EDIT_SYSTEM, user_prompt, temperature


def get_edit_instruction(action: str) -> str:
    """Get just the instruction for an edit action.

    Args:
        action: Edit action type

    Returns:
        Instruction string
    """
    config = EDIT_ACTIONS.get(action, DEFAULT_EDIT_CONFIG)
    return config.get("instruction", DEFAULT_EDIT_CONFIG["instruction"])
