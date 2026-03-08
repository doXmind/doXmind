"""Knowledge Base Agent API - Global document Q&A with agentic RAG."""

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.kb_agent import KBAgent
from config import get_cors_headers, get_settings
from db.database import Conversation, Message, get_db
from services.api_key_service import APIKeyService
from services.auth_service import TokenData, require_auth

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------


class KBAgentRequest(BaseModel):
    question: str
    conversationId: str | None = None


class ConversationItem(BaseModel):
    id: str
    created_at: str
    last_message: str | None = None


class MessageItem(BaseModel):
    id: str
    role: str
    content: str | None = None
    tool_calls: list | None = None
    created_at: str


# ---------------------------------------------------------------------------
# Streaming Endpoint
# ---------------------------------------------------------------------------


@router.post("/stream")
async def kb_agent_stream(
    request: KBAgentRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Stream a KB agent response with SSE."""
    origin = http_request.headers.get("origin")
    user_id = auth.sub

    # Resolve user's API key and model preference
    user_api_key = None
    user_model = None
    if user_id and user_id != "anonymous":
        api_key_service = APIKeyService(db)
        user_api_settings = await api_key_service.get_user_settings(user_id)
        if api_key_service.has_api_key(user_api_settings):
            user_api_key = await api_key_service.get_decrypted_key(user_id)
            user_model = user_api_settings.preferred_model

    is_byok = user_api_key is not None

    # Pre-flight credit check
    if not is_byok:
        from services.credit_service import CreditService

        credit_svc = CreditService(db)
        has_credits = await credit_svc.check_credits(user_id)
        if not has_credits:
            async def _no_credits():
                error = {"type": "error", "code": "INSUFFICIENT_CREDITS",
                         "content": "No credits remaining. Please upgrade your plan."}
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

    # Load or create conversation (KB agent convos have file_id=None)
    conversation = None
    history: list[dict] = []

    if request.conversationId:
        conv_result = await db.execute(
            select(Conversation).where(
                Conversation.id == request.conversationId,
                Conversation.user_id == user_id,
            )
        )
        conversation = conv_result.scalar_one_or_none()

    if not conversation:
        conversation = Conversation(
            id=str(uuid.uuid4()),
            user_id=user_id,
            file_id=None,  # KB agent conversations are not tied to a file
        )
        db.add(conversation)
        await db.commit()

    # Load last N messages as history
    if conversation:
        msg_result = await db.execute(
            select(Message)
            .where(
                Message.conversation_id == conversation.id,
                Message.deleted_at.is_(None),
            )
            .order_by(desc(Message.created_at))
            .limit(20)
        )
        messages = list(reversed(msg_result.scalars().all()))
        for msg in messages:
            if msg.role == "user":
                history.append({"role": "user", "content": msg.content or ""})
            elif msg.role == "assistant":
                history.append({"role": "assistant", "content": msg.content or ""})

    # Save user message
    user_message = Message(
        id=str(uuid.uuid4()),
        conversation_id=conversation.id,
        role="user",
        content=request.question,
    )
    db.add(user_message)
    await db.commit()

    # Collectors for persistence
    collected_text: list[str] = []
    collected_tool_calls: list[dict] = []
    collected_sources: list[dict] = []
    collected_usage: dict = {"input_tokens": 0, "output_tokens": 0, "cost": None}

    async def generate():
        nonlocal collected_text, collected_tool_calls, collected_sources, collected_usage

        heartbeat_interval = 25
        start_time = asyncio.get_event_loop().time()
        timeout_seconds = settings.streaming_timeout_seconds

        try:
            agent = KBAgent(
                db=db,
                user_id=user_id,
                api_key=user_api_key,
                model=user_model,
            )

            agent_stream = agent.stream(
                question=request.question,
                history=history,
            ).__aiter__()

            pending_task = None

            while True:
                try:
                    if pending_task is None:
                        pending_task = asyncio.create_task(agent_stream.__anext__())

                    done, _ = await asyncio.wait({pending_task}, timeout=heartbeat_interval)

                    if pending_task in done:
                        try:
                            event = pending_task.result()
                            pending_task = None
                        except StopAsyncIteration:
                            break
                    else:
                        # Send heartbeat
                        yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n".encode()
                        elapsed = asyncio.get_event_loop().time() - start_time
                        if elapsed > timeout_seconds:
                            yield f"data: {json.dumps({'type': 'error', 'content': 'Streaming timeout'})}\n\n".encode()
                            yield b"data: [DONE]\n\n"
                            if pending_task:
                                pending_task.cancel()
                            return
                        continue

                except Exception as e:
                    logger.error(f"KB agent stream error: {e}")
                    if pending_task:
                        pending_task.cancel()
                    raise

                event_type = event.get("type")

                # Collect for persistence
                if event_type == "text":
                    collected_text.append(event.get("content", ""))
                elif event_type == "tool_start":
                    collected_tool_calls.append(
                        {
                            "name": event.get("tool"),
                            "toolId": event.get("tool_id"),
                            "output": None,
                            "success": None,
                        }
                    )
                elif event_type == "tool_end":
                    if collected_tool_calls:
                        collected_tool_calls[-1]["output"] = event.get("output")
                        collected_tool_calls[-1]["success"] = event.get("success")
                elif event_type == "sources":
                    collected_sources = event.get("sources", [])
                elif event_type == "usage":
                    collected_usage["input_tokens"] = event.get("input_tokens", 0)
                    collected_usage["output_tokens"] = event.get("output_tokens", 0)
                    collected_usage["cost"] = event.get("cost")
                    continue  # Don't send usage event to client

                # Send event to client
                data = f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                yield data.encode("utf-8")

            # Save assistant message with usage data
            msg_kwargs = {
                "id": str(uuid.uuid4()),
                "conversation_id": conversation.id,
                "role": "assistant",
                "content": "".join(collected_text),
                "tool_calls": collected_tool_calls if collected_tool_calls else None,
                "model": agent.model,
                "input_tokens": collected_usage["input_tokens"] or None,
                "output_tokens": collected_usage["output_tokens"] or None,
                "is_byok": user_api_key is not None,
            }
            cost_value = collected_usage.get("cost")
            if cost_value is not None:
                msg_kwargs["cost"] = cost_value
            assistant_message = Message(**msg_kwargs)
            db.add(assistant_message)
            await db.commit()

            # Deduct credits (fire-and-forget)
            credits_remaining = None
            try:
                from services.credit_service import deduct_credits_for_usage

                credits_remaining = await deduct_credits_for_usage(
                    user_id=user_id,
                    cost=collected_usage.get("cost"),
                    service="kb_agent",
                    is_byok=is_byok,
                )
            except Exception as credit_err:
                logger.warning(f"Credit deduction error: {credit_err}")

            # Send summary with conversation ID
            summary = {
                "type": "summary",
                "conversationId": conversation.id,
                "messageId": assistant_message.id,
                "content": "".join(collected_text),
                "sources": collected_sources,
            }
            if credits_remaining is not None:
                summary["credits_remaining"] = credits_remaining
            yield f"data: {json.dumps(summary, ensure_ascii=False)}\n\n".encode()
            yield b"data: [DONE]\n\n"

        except Exception as e:
            logger.error(f"KB agent streaming error: {e}")
            import traceback

            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n".encode()
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


# ---------------------------------------------------------------------------
# Conversation CRUD
# ---------------------------------------------------------------------------


@router.get("/conversations")
async def list_conversations(
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """List KB agent conversations for the current user."""
    result = await db.execute(
        select(Conversation)
        .where(
            Conversation.user_id == auth.sub,
            Conversation.file_id.is_(None),
        )
        .order_by(desc(Conversation.created_at))
        .limit(50)
    )
    conversations = result.scalars().all()

    items = []
    for conv in conversations:
        # Get the first user message as preview
        msg_result = await db.execute(
            select(Message)
            .where(Message.conversation_id == conv.id, Message.role == "user")
            .order_by(Message.created_at)
            .limit(1)
        )
        first_msg = msg_result.scalar_one_or_none()

        items.append(
            {
                "id": conv.id,
                "created_at": conv.created_at.isoformat() if conv.created_at else None,
                "last_message": (
                    first_msg.content[:100] if first_msg and first_msg.content else None
                ),
            }
        )

    return {"conversations": items}


@router.get("/conversations/{conversation_id}/messages")
async def get_conversation_messages(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Get messages for a KB agent conversation."""
    # Verify ownership
    conv_result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == auth.sub,
        )
    )
    conversation = conv_result.scalar_one_or_none()
    if not conversation:
        return {"messages": []}

    msg_result = await db.execute(
        select(Message)
        .where(
            Message.conversation_id == conversation_id,
            Message.deleted_at.is_(None),
        )
        .order_by(Message.created_at)
    )
    messages = msg_result.scalars().all()

    return {
        "messages": [
            {
                "id": msg.id,
                "role": msg.role,
                "content": msg.content,
                "tool_calls": msg.tool_calls,
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
            }
            for msg in messages
        ]
    }


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Delete a KB agent conversation."""
    conv_result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == auth.sub,
            Conversation.file_id.is_(None),
        )
    )
    conversation = conv_result.scalar_one_or_none()
    if not conversation:
        return {"deleted": False}

    await db.delete(conversation)
    await db.commit()
    return {"deleted": True}
