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
from typing import Optional, List
import json
import logging
import re

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
6. For each suggestion, verify the original_text exists at the specified offset

Respond with valid JSON in this exact format:
{
  "suggestions": [
    {
      "category": "correctness",
      "type": "spelling_error",
      "original_text": "teh",
      "replacement": "the",
      "explanation": "Common typo correction",
      "start_offset": 10,
      "end_offset": 13
    }
  ],
  "summary": "Brief overall assessment of the document quality"
}"""


@router.post("")
async def review_text(request: TextReviewRequest):
    """Stream text review suggestions from Claude."""

    async def generate():
        try:
            settings = get_settings()
            llm = LLMService(model=settings.default_model)

            # Prepare the document for review
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

Analyze the entire document and return JSON with your suggestions. Remember to:
1. Copy original_text exactly as it appears
2. Calculate accurate start_offset and end_offset positions
3. Focus on the most impactful improvements"""

            full_response = ""

            # Stream the response
            async for chunk in llm.stream(
                user=user_prompt,
                system=REVIEW_SYSTEM_PROMPT,
                temperature=0.2,  # Lower temperature for more consistent analysis
                max_tokens=4096
            ):
                full_response += chunk
                # Send progress chunks
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"

            # Parse and validate the JSON response
            try:
                # Extract JSON from response (handle markdown code blocks)
                json_str = full_response.strip()

                # Try to extract JSON from code blocks
                if "```json" in json_str:
                    match = re.search(r'```json\s*([\s\S]*?)\s*```', json_str)
                    if match:
                        json_str = match.group(1)
                elif "```" in json_str:
                    match = re.search(r'```\s*([\s\S]*?)\s*```', json_str)
                    if match:
                        json_str = match.group(1)

                # Try to find JSON object if still not valid
                if not json_str.startswith('{'):
                    match = re.search(r'\{[\s\S]*\}', json_str)
                    if match:
                        json_str = match.group(0)

                parsed = json.loads(json_str.strip())

                # Validate and clean suggestions
                validated_suggestions = []
                for s in parsed.get("suggestions", []):
                    # Verify original_text exists in content at the specified position
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

            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse review response: {e}")
                logger.debug(f"Raw response: {full_response[:500]}...")
                yield f"data: {json.dumps({'error': 'Failed to parse AI response', 'raw': full_response[:200]})}\n\n"

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
