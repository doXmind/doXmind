"""Quick Edit API endpoints."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import json
import logging

from services.llm_service import LLMService
from config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Edit action prompts
EDIT_PROMPTS = {
    "fix-grammar": "Fix all grammar and spelling errors in the following text. Keep the original meaning and style. Only output the corrected text, nothing else:",
    "improve": "Improve the writing quality of the following text. Make it clearer and more engaging while preserving the original meaning. Only output the improved text:",
    "simplify": "Rewrite the following text using simpler language. Make it easier to understand while keeping the meaning. Only output the simplified text:",
    "expand": "Expand the following text with more details and explanations. Add relevant information to make it more comprehensive. Only output the expanded text:",
    "shorten": "Condense the following text while keeping the key information. Make it more concise. Only output the shortened text:",
    # Translate options
    "translate-en": "Translate the following text to English. Only output the translation:",
    "translate-zh": "Translate the following text to Chinese. Only output the translation:",
    "translate-es": "Translate the following text to Spanish. Only output the translation:",
    "translate-fr": "Translate the following text to French. Only output the translation:",
    "translate-de": "Translate the following text to German. Only output the translation:",
    "translate-ja": "Translate the following text to Japanese. Only output the translation:",
    # Tone options
    "professional": "Rewrite the following text in a more professional and formal tone. Only output the rewritten text:",
    "casual": "Rewrite the following text in a more casual and relaxed tone. Only output the rewritten text:",
    "friendly": "Rewrite the following text in a warm, friendly, and approachable tone. Only output the rewritten text:",
    "confident": "Rewrite the following text in a more confident and assertive tone. Only output the rewritten text:",
}


class QuickEditRequest(BaseModel):
    """Quick edit request model."""
    text: str
    action: str
    context: Optional[str] = ""


@router.post("/quick")
async def quick_edit(request: QuickEditRequest):
    """Stream quick edit response."""

    prompt = EDIT_PROMPTS.get(
        request.action,
        "Improve the following text. Only output the improved text:"
    )

    async def generate():
        try:
            settings = get_settings()
            llm = LLMService(model=settings.fast_model)

            system = """You are a professional text editor assistant. Your job is to edit text according to the user's instructions.
IMPORTANT: Only output the edited text. Do not add any explanations, comments, or additional text.
Do not wrap the output in quotes or any other formatting."""

            user_prompt = f"{prompt}\n\n{request.text}"

            async for chunk in llm.stream(
                user=user_prompt,
                system=system,
                temperature=0.3  # Lower temperature for more consistent edits
            ):
                yield f"data: {json.dumps({'text': chunk})}\n\n"

            yield "data: [DONE]\n\n"

        except Exception as e:
            logger.error(f"Quick edit error: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


class CustomEditRequest(BaseModel):
    """Custom edit request with user-defined instruction."""
    text: str
    instruction: str


@router.post("/custom")
async def custom_edit(request: CustomEditRequest):
    """Stream custom edit based on user instruction."""

    async def generate():
        try:
            settings = get_settings()
            llm = LLMService(model=settings.fast_model)

            system = """You are a professional text editor assistant. Edit the text according to the user's instruction.
IMPORTANT: Only output the edited text. Do not add any explanations or comments."""

            user_prompt = f"Instruction: {request.instruction}\n\nText to edit:\n{request.text}"

            async for chunk in llm.stream(
                user=user_prompt,
                system=system,
                temperature=0.5
            ):
                yield f"data: {json.dumps({'text': chunk})}\n\n"

            yield "data: [DONE]\n\n"

        except Exception as e:
            logger.error(f"Custom edit error: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )
