"""AI Text Review API endpoint.

Provides Grammarly-like text analysis using Claude to identify:
- Correctness issues (grammar, spelling, punctuation)
- Clarity issues (conciseness, readability)
- Tone issues (formality, politeness)
- Engagement issues (word choice, variety)
"""

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import json
import logging

from services.llm_service import LLMService
from config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter()


class TextReviewRequest(BaseModel):
    """Request for full document review."""
    content: str
    file_id: str
    language: Optional[str] = "en"


REVIEW_SYSTEM_PROMPT = """You are an expert writing assistant that analyzes text for improvements.
Review the document and identify suggestions in these categories:

1. CORRECTNESS (category: "correctness"): Grammar errors, spelling mistakes, punctuation issues
2. CLARITY (category: "clarity"): Unclear sentences, wordiness, readability issues, passive voice
3. TONE (category: "tone"): Formality mismatches, politeness issues, confidence problems
4. ENGAGEMENT (category: "engagement"): Word variety, sentence variety, reader engagement, word choice

For each issue found, you must provide:
- category: One of "correctness", "clarity", "tone", or "engagement"
- type: A brief snake_case identifier for the issue type (e.g., "spelling_error", "passive_voice", "wordy_phrase")
- original_text: The EXACT text to highlight (copy it precisely as it appears)
- replacement: The suggested replacement text
- explanation: A brief, helpful explanation of why this change improves the writing
- start_offset: The character position where original_text starts (0-indexed from document start)
- end_offset: The character position where original_text ends

CRITICAL RULES:
1. The original_text MUST be an exact substring that exists in the document
2. start_offset and end_offset MUST be accurate character positions
3. Only suggest changes where you are confident the replacement is better
4. Focus on meaningful improvements, not minor stylistic preferences
5. Limit to the most important 10-15 suggestions maximum
6. For each suggestion, verify the original_text exists at the specified offset"""


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
                        "enum": ["correctness", "clarity", "tone", "engagement"]
                    },
                    "type": {"type": "string"},
                    "original_text": {"type": "string"},
                    "replacement": {"type": "string"},
                    "explanation": {"type": "string"},
                    "start_offset": {"type": "integer"},
                    "end_offset": {"type": "integer"}
                },
                "required": ["category", "type", "original_text", "replacement", "explanation", "start_offset", "end_offset"],
                "additionalProperties": False
            }
        },
        "summary": {"type": "string"}
    },
    "required": ["suggestions", "summary"],
    "additionalProperties": False
}


@router.post("")
async def review_text(request: TextReviewRequest):
    """Stream text review suggestions from Claude."""

    async def generate():
        try:
            settings = get_settings()
            llm = LLMService(model=settings.default_model)

            content = request.content

            # Skip very short documents
            if len(content.strip()) < 20:
                yield f"data: {json.dumps({'result': {'suggestions': [], 'summary': 'Document too short for review.'}})}\n\n"
                yield "data: [DONE]\n\n"
                return

            user_prompt = f"""Please review this document and provide improvement suggestions.

Document to review (total {len(content)} characters):
---
{content}
---

Analyze the entire document and return your suggestions. Remember to:
1. Copy original_text exactly as it appears
2. Calculate accurate start_offset and end_offset positions
3. Focus on the most impactful improvements"""

            # Send progress indicator
            yield f"data: {json.dumps({'status': 'analyzing'})}\n\n"

            # Use JSON mode for guaranteed valid JSON
            parsed = await llm.json_complete(
                prompt=user_prompt,
                json_schema=REVIEW_JSON_SCHEMA,
                system=REVIEW_SYSTEM_PROMPT,
                temperature=0.2,
                max_tokens=4096
            )

            # Validate and clean suggestions
            validated_suggestions = []
            for s in parsed.get("suggestions", []):
                original = s.get("original_text", "")
                start = s.get("start_offset", 0)
                end = s.get("end_offset", 0)

                # Check if the text at position matches
                if start >= 0 and end <= len(content) and start < end:
                    actual_text = content[start:end]
                    if actual_text == original:
                        validated_suggestions.append(s)
                    else:
                        # Try to find the actual position
                        found_pos = content.find(original)
                        if found_pos >= 0:
                            s["start_offset"] = found_pos
                            s["end_offset"] = found_pos + len(original)
                            validated_suggestions.append(s)
                            logger.debug(f"Corrected position for '{original}': {start} -> {found_pos}")
                else:
                    # Invalid position, try to find the text
                    found_pos = content.find(original)
                    if found_pos >= 0:
                        s["start_offset"] = found_pos
                        s["end_offset"] = found_pos + len(original)
                        validated_suggestions.append(s)

            result = {
                "suggestions": validated_suggestions,
                "summary": parsed.get("summary", "Review complete.")
            }

            yield f"data: {json.dumps({'result': result})}\n\n"
            logger.info(f"Review complete: {len(validated_suggestions)} suggestions for file {request.file_id}")

            yield "data: [DONE]\n\n"

        except Exception as e:
            logger.error(f"Review error: {e}", exc_info=True)
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
