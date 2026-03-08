"""Inline AI endpoints for editor-local operations.

This API is optimized for inline ask/edit flows:
- Lightweight tool profiles (no heavy web/code/todo tools by default)
- SSE streaming for low-latency UX
- History persistence is opt-in (default: no chat history write)
"""

import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from agents.writing_agent import WritingAgent
from api.chat import _load_conversation_context, _resolve_user_api_settings
from api.files import get_user_id
from config import get_cors_headers, get_settings
from db.database import Conversation, Message, get_db
from services.auth_service import TokenData, require_auth

logger = logging.getLogger(__name__)
router = APIRouter()


class InlineFileContext(BaseModel):
    id: str
    name: str
    content: str


class InlineSelection(BaseModel):
    text: str
    from_pos: int
    to_pos: int


class InlineAnchor(BaseModel):
    beforeText: str = ""
    afterText: str = ""


class InlineOptions(BaseModel):
    toolProfile: str = "inline_ask"  # inline_ask | inline_edit
    thinkingEnabled: bool = False
    persistHistory: bool = False


class InlineStreamRequest(BaseModel):
    requestId: str | None = None
    intent: str = "ask"  # ask | edit | insert
    instruction: str
    file: InlineFileContext
    selection: InlineSelection | None = None
    anchor: InlineAnchor | None = None
    options: InlineOptions = InlineOptions()
    conversationId: str | None = None


def _build_inline_message(request: InlineStreamRequest) -> str:
    message = request.instruction

    if request.selection and request.selection.text.strip():
        message += (
            "\n\n<selected_content>\n"
            f'<reference index="1">\n{request.selection.text}\n</reference>\n'
            "</selected_content>"
        )
        if request.intent != "ask":
            message += (
                "\n\n<selection_scope_rule>\n"
                "For edits, you MUST modify only the selected_content region. "
                "Do NOT edit any text outside selected_content."
                "\n</selection_scope_rule>"
            )

    if request.anchor:
        message += (
            "\n\n<cursor_anchor>\n"
            f"  <before>{request.anchor.beforeText.strip()}</before>\n"
            f"  <after>{request.anchor.afterText.strip()}</after>\n"
            "</cursor_anchor>\n"
            "Important: use this anchor as the preferred insertion location when adding content."
        )

    return message


@router.post("/stream")
async def inline_stream(
    request: InlineStreamRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    settings = get_settings()
    origin = http_request.headers.get("origin")

    user_api_key, user_model = await _resolve_user_api_settings(auth, db)

    # Pre-flight credit check
    user_id = get_user_id(auth)
    is_byok = user_api_key is not None
    if user_id and not is_byok:
        from services.credit_service import CreditService

        credit_svc = CreditService(db)
        has_credits = await credit_svc.check_credits(user_id)
        if not has_credits:

            async def _no_credits():
                error = {
                    "type": "error",
                    "code": "INSUFFICIENT_CREDITS",
                    "content": "No credits remaining. Please upgrade your plan.",
                }
                yield f"data: {json.dumps(error)}\n\n".encode()
                yield b"data: [DONE]\n\n"

            return StreamingResponse(
                _no_credits(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
                    "Content-Type": "text/event-stream; charset=utf-8",
                    **get_cors_headers(origin),
                },
            )

    history: list[dict[str, Any]] = []
    conversation: Conversation | None = None
    if request.options.persistHistory and request.conversationId:
        (conversation, history, _, _, _) = await _load_conversation_context(
            request.conversationId, db, user_id
        )

    message_for_ai = _build_inline_message(request)
    request_id = request.requestId or str(uuid.uuid4())

    collected_text: list[str] = []
    collected_thinking: list[str] = []
    collected_tool_calls: list[dict[str, Any]] = []
    collected_edits: list[dict[str, Any]] = []
    collected_usage = {"input_tokens": 0, "output_tokens": 0, "cost": None}

    async def generate():
        current_tool: dict[str, Any] | None = None
        agent = None

        try:
            # Respect BYOK preference: if user has own API key/model, use it.
            # Otherwise, thinking mode uses backend-configured thinking model.
            effective_model = user_model
            if not user_model and request.options.thinkingEnabled:
                effective_model = settings.thinking_model

            # Enforce profile by intent so ask-mode can never receive edit tools,
            # even if the client accidentally sends an inconsistent option.
            if request.intent == "ask":
                tool_profile = "inline_ask"
            else:
                tool_profile = "inline_edit"

            agent_mode = "analyze" if request.intent == "ask" else "edit"
            agent = WritingAgent(
                mode=agent_mode,
                db=db,
                api_key=user_api_key,
                model=effective_model,
                is_quick_edit=False,
                tool_profile=tool_profile,
            )

            files = [
                {
                    "id": request.file.id,
                    "name": request.file.name,
                    "content": request.file.content[:50000],
                    "is_current": True,
                }
            ]

            async for event in agent.stream(
                message=message_for_ai,
                files=files,
                images=[],
                data_files=None,
                history=history,
                conversation_id=conversation.id if conversation else None,
            ):
                event_type = event.get("type")

                if event_type == "text":
                    collected_text.append(event.get("content", ""))
                    yield f"data: {json.dumps({'type': 'text', 'content': event.get('content', '')}, ensure_ascii=False)}\n\n".encode()
                elif event_type == "thinking":
                    collected_thinking.append(event.get("content", ""))
                    yield f"data: {json.dumps({'type': 'thinking', 'content': event.get('content', '')}, ensure_ascii=False)}\n\n".encode()
                elif event_type == "thinking_end":
                    yield b'data: {"type":"thinking_end"}\n\n'
                elif event_type == "tool_start":
                    current_tool = {
                        "name": event.get("tool"),
                        "toolId": event.get("tool_id"),
                        "input": "",
                        "output": None,
                        "success": None,
                    }
                elif event_type == "tool_input_delta":
                    if current_tool:
                        current_tool["input"] += event.get("delta", "")
                elif event_type == "tool_end":
                    if current_tool:
                        current_tool["output"] = event.get("output")
                        current_tool["success"] = event.get("success", True)
                        collected_tool_calls.append(current_tool)
                        current_tool = None
                elif event_type == "edit":
                    edit = event.get("edit")
                    # Defense in depth: ignore accidental edit emissions in ask mode.
                    if edit and request.intent != "ask":
                        collected_edits.append(edit)
                        yield f"data: {json.dumps({'type': 'edit', 'edit': edit}, ensure_ascii=False)}\n\n".encode()
                elif event_type == "usage":
                    collected_usage["input_tokens"] = event.get("input_tokens", 0)
                    collected_usage["output_tokens"] = event.get("output_tokens", 0)
                    collected_usage["cost"] = event.get("cost")
                elif event_type == "error":
                    yield f"data: {json.dumps({'type': 'error', 'content': event.get('content', 'Unknown error')}, ensure_ascii=False)}\n\n".encode()

            # Deduct credits (fire-and-forget)
            credits_remaining = None
            if user_id:
                try:
                    from services.credit_service import deduct_credits_for_usage

                    credits_remaining = await deduct_credits_for_usage(
                        user_id=user_id,
                        cost=collected_usage.get("cost"),
                        service="inline",
                        is_byok=is_byok,
                    )
                except Exception as credit_err:
                    logger.warning(f"Credit deduction error: {credit_err}")

            summary = {
                "type": "summary",
                "requestId": request_id,
                "resultType": "edits" if collected_edits else "answer",
                "content": "".join(collected_text),
                "thinking": "".join(collected_thinking) if collected_thinking else None,
                "toolCalls": collected_tool_calls if collected_tool_calls else None,
                "edits": collected_edits if collected_edits else None,
                "model": agent.model if agent else None,
                "usage": collected_usage,
            }
            if credits_remaining is not None:
                summary["credits_remaining"] = credits_remaining

            if request.options.persistHistory and conversation:
                assistant_message = Message(
                    id=str(uuid.uuid4()),
                    conversation_id=conversation.id,
                    role="assistant",
                    content=summary["content"],
                    thinking=summary["thinking"],
                    tool_calls=summary["toolCalls"],
                    edits=summary["edits"],
                    model=summary["model"],
                    input_tokens=collected_usage["input_tokens"] or None,
                    output_tokens=collected_usage["output_tokens"] or None,
                    cost=collected_usage["cost"],
                    is_byok=user_api_key is not None,
                )
                db.add(assistant_message)
                await db.commit()

            yield f"data: {json.dumps(summary, ensure_ascii=False)}\n\n".encode()
            yield b"data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"Inline stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n".encode()
            yield b"data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Content-Type": "text/event-stream; charset=utf-8",
            **get_cors_headers(origin),
        },
    )
