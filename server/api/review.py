"""AI Text Review API endpoint.

Provides Grammarly-like text analysis using Claude to identify:
- Correctness issues (grammar, spelling, punctuation)
- Clarity issues (conciseness, readability)
- Tone issues (formality, politeness)
- Engagement issues (word choice, variety)
"""

import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import get_settings
from prompts.domains.review import REVIEW_SYSTEM_PROMPT, REVIEW_JSON_SCHEMA
from services.llm_service import LLMService

logger = logging.getLogger(__name__)
router = APIRouter()


class TextReviewRequest(BaseModel):
    """Request for full document review."""
    content: str
    file_id: str
    language: str | None = "en"


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
