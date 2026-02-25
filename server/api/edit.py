"""Edit API endpoints.

Quick edit has been migrated to the chat system (see use-chat.ts sendQuickEditMessage).
This file retains only the custom edit endpoint.
"""

import json
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import get_cors_headers, get_settings
from prompts.domains.edit import QUICK_EDIT_SYSTEM
from services.auth_service import TokenData, require_auth
from services.llm_service import LLMService

logger = logging.getLogger(__name__)
router = APIRouter()


class CustomEditRequest(BaseModel):
    """Custom edit request with user-defined instruction."""

    text: str
    instruction: str


@router.post("/custom")
async def custom_edit(
    request: CustomEditRequest,
    http_request: Request,
    token: TokenData = Depends(require_auth),
):
    """Stream custom edit based on user instruction."""
    origin = http_request.headers.get("origin")

    async def generate():
        try:
            settings = get_settings()
            llm = LLMService(model=settings.fast_model)

            user_prompt = f"Instruction: {request.instruction}\n\nText to edit:\n{request.text}"

            async for chunk in llm.stream(
                user=user_prompt, system=QUICK_EDIT_SYSTEM, temperature=0.5
            ):
                yield f"data: {json.dumps({'text': chunk})}\n\n"

            # Track usage
            if llm.last_usage:
                import asyncio

                from services.usage_tracker import track_usage

                asyncio.create_task(
                    track_usage(
                        service="custom_edit",
                        model=llm.model,
                        user_id=token.sub,
                        **llm.last_usage,
                    )
                )

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
            **get_cors_headers(origin),
        },
    )
