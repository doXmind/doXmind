"""Review system prompt with structured XML format.

Provides Grammarly-like text analysis using Claude to identify:
- Correctness issues (grammar, spelling, punctuation)
- Clarity issues (conciseness, readability)
- Tone issues (formality, politeness)
- Engagement issues (word choice, variety)
"""

# Review system prompt with XML tags
REVIEW_SYSTEM_PROMPT = """You are doXmind Review Assistant, an expert writing analyst.

<identity>
- Professional editor analyzing text for quality improvements
- Provide precise, actionable suggestions with exact text positions
- Focus on meaningful improvements, not minor stylistic preferences
</identity>

<review_categories>
1. CORRECTNESS (category: "correctness")
   Grammar errors, spelling mistakes, punctuation issues

2. CLARITY (category: "clarity")
   Unclear sentences, wordiness, readability issues, passive voice

3. TONE (category: "tone")
   Formality mismatches, politeness issues, confidence problems

4. ENGAGEMENT (category: "engagement")
   Word variety, sentence variety, reader engagement, word choice
</review_categories>

<output_format>
For each issue found, provide:
- category: One of "correctness", "clarity", "tone", "engagement"
- type: Brief snake_case identifier (e.g., "spelling_error", "passive_voice")
- original_text: EXACT text to highlight (copy precisely as it appears)
- replacement: Suggested replacement text
- explanation: Brief, helpful explanation
- start_offset: Character position where original_text starts (0-indexed)
- end_offset: Character position where original_text ends
</output_format>

<constraints>
- original_text MUST be an exact substring in the document
- start_offset and end_offset MUST be accurate character positions
- ONLY suggest changes where confident the replacement is better
- LIMIT to 10-15 most important suggestions maximum
- ALWAYS verify original_text exists at specified offset
- NEVER suggest changes for minor stylistic preferences
- Focus on the most impactful improvements
</constraints>"""

# JSON schema for structured output
REVIEW_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "enum": ["correctness", "clarity", "tone", "engagement"],
                    },
                    "type": {"type": "string"},
                    "original_text": {"type": "string"},
                    "replacement": {"type": "string"},
                    "explanation": {"type": "string"},
                    "start_offset": {"type": "integer"},
                    "end_offset": {"type": "integer"},
                },
                "required": [
                    "category",
                    "type",
                    "original_text",
                    "replacement",
                    "explanation",
                    "start_offset",
                    "end_offset",
                ],
                "additionalProperties": False,
            },
        },
        "summary": {"type": "string"},
    },
    "required": ["suggestions", "summary"],
    "additionalProperties": False,
}


def build_review_user_prompt(content: str) -> str:
    """Build the user prompt for review requests.

    Args:
        content: Document content to review

    Returns:
        Formatted user prompt
    """
    return f"""Please review this document and provide improvement suggestions.

Document to review (total {len(content)} characters):
---
{content}
---

Analyze the entire document and return your suggestions. Remember to:
1. Copy original_text exactly as it appears
2. Calculate accurate start_offset and end_offset positions
3. Focus on the most impactful improvements"""
