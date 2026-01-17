"""Quick Edit API endpoints."""

import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import get_settings
from prompts.domains.edit import EDIT_ACTIONS, QUICK_EDIT_SYSTEM, get_edit_instruction
from services.llm_service import LLMService

logger = logging.getLogger(__name__)
router = APIRouter()


class QuickEditRequest(BaseModel):
    """Quick edit request model."""
    text: str
    action: str
    context: str | None = ""


@router.post("/quick")
async def quick_edit(request: QuickEditRequest):
    """Stream quick edit response."""

    # Get instruction and temperature from new prompts module
    instruction = get_edit_instruction(request.action)
    config = EDIT_ACTIONS.get(request.action, {"temperature": 0.4})
    temperature = config.get("temperature", 0.4)

    async def generate():
        try:
            settings = get_settings()
            llm = LLMService(model=settings.fast_model)

            user_prompt = f"{instruction}\n\n{request.text}"

            async for chunk in llm.stream(
                user=user_prompt,
                system=QUICK_EDIT_SYSTEM,
                temperature=temperature
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

            user_prompt = f"Instruction: {request.instruction}\n\nText to edit:\n{request.text}"

            async for chunk in llm.stream(
                user=user_prompt,
                system=QUICK_EDIT_SYSTEM,
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
