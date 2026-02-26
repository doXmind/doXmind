"""Global Agent API - unified agent with full workspace capabilities.

Combines document editing, global search, file management, and community access
into a single streaming endpoint.
"""

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.global_agent import GlobalAgent
from api.chat import _load_conversation_context, _resolve_user_api_settings
from config import get_cors_headers, get_settings
from db.database import Conversation, Message, get_db
from services.auth_service import TokenData, require_auth

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------


class FileContext(BaseModel):
    id: str
    name: str
    content: str


class ImageContext(BaseModel):
    src: str
    alt: str | None = None
    base64: str | None = None
    mediaType: str | None = None


class GlobalAgentRequest(BaseModel):
    message: str
    files: list[FileContext] = []
    images: list[ImageContext] = []
    mode: str = "edit"
    conversationId: str | None = None
    fileId: str | None = None
    webSearchEnabled: bool = False
    dataFileIds: list[str] = []
    isQuickEdit: bool = False


# ---------------------------------------------------------------------------
# Streaming Endpoint
# ---------------------------------------------------------------------------


@router.post("/stream")
async def global_agent_stream(
    request: GlobalAgentRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Stream a global agent response with SSE.

    The global agent has all capabilities: document editing, global search,
    file/folder management, and community access.
    """
    origin = http_request.headers.get("origin")
    user_id = auth.sub

    user_api_key, user_model = await _resolve_user_api_settings(auth, db)

    (
        conversation,
        history,
        kb_attachments,
        data_files_metadata,
        data_files_content,
    ) = await _load_conversation_context(request.conversationId, db)

    # Collectors for persistence
    collected_text = []
    collected_thinking = []
    collected_tool_calls = []
    collected_edits = []
    collected_todos = []
    collected_usage = {"input_tokens": 0, "output_tokens": 0, "cost": None}

    async def generate():
        nonlocal \
            collected_text, \
            collected_thinking, \
            collected_tool_calls, \
            collected_edits, \
            collected_todos, \
            collected_usage

        current_tool = None
        agent = None
        timeout_seconds = settings.streaming_timeout_seconds
        start_time = asyncio.get_event_loop().time()
        heartbeat_interval = 25

        async def _save_and_summarize(is_timeout: bool = False) -> list[bytes]:
            events_to_send = []
            content_text = "".join(collected_text)

            if not content_text and not collected_edits and not collected_tool_calls:
                return events_to_send

            if is_timeout:
                content_text += "\n\n*[Response interrupted: streaming timeout]*"

            actual_model = agent.model if agent else None
            message_id = None

            if conversation:
                msg_kwargs = {
                    "id": str(uuid.uuid4()),
                    "conversation_id": conversation.id,
                    "role": "assistant",
                    "content": content_text,
                    "thinking": "".join(collected_thinking) if collected_thinking else None,
                    "tool_calls": collected_tool_calls if collected_tool_calls else None,
                    "edits": collected_edits if collected_edits else None,
                    "model": actual_model,
                    "input_tokens": collected_usage["input_tokens"] or None,
                    "output_tokens": collected_usage["output_tokens"] or None,
                    "is_byok": user_api_key is not None,
                }
                cost_value = collected_usage.get("cost")
                if cost_value is not None:
                    msg_kwargs["cost"] = cost_value

                try:
                    assistant_message = Message(**msg_kwargs)
                    db.add(assistant_message)
                    await db.commit()
                    message_id = assistant_message.id
                except Exception:
                    try:
                        await db.rollback()
                        msg_kwargs.pop("cost", None)
                        assistant_message = Message(**msg_kwargs)
                        db.add(assistant_message)
                        await db.commit()
                        message_id = assistant_message.id
                    except Exception as save_err:
                        logger.error(f"Failed to save message: {save_err}")

            summary = {
                "type": "summary",
                "messageId": message_id,
                "content": content_text,
                "thinking": "".join(collected_thinking) if collected_thinking else None,
                "toolCalls": collected_tool_calls if collected_tool_calls else None,
                "edits": collected_edits if collected_edits else None,
                "todos": collected_todos if collected_todos else None,
                "model": actual_model,
                "usage": {
                    "input_tokens": collected_usage["input_tokens"],
                    "output_tokens": collected_usage["output_tokens"],
                    "cost": collected_usage.get("cost"),
                },
            }
            events_to_send.append(f"data: {json.dumps(summary, ensure_ascii=False)}\n\n".encode())

            return events_to_send

        try:
            agent = GlobalAgent(
                user_id=user_id,
                mode=request.mode,
                kb_attachments=kb_attachments if kb_attachments else None,
                data_files_metadata=data_files_metadata if data_files_metadata else None,
                web_search_enabled=request.webSearchEnabled,
                db=db,
                api_key=user_api_key,
                model=user_model,
                is_quick_edit=request.isQuickEdit,
            )

            files = [
                {
                    "id": f.id,
                    "name": f.name,
                    "content": f.content[:50000],
                }
                for f in request.files
            ]

            images = []
            for img in request.images:
                if img.base64 and img.mediaType:
                    images.append(
                        {
                            "src": img.src,
                            "alt": img.alt,
                            "base64": img.base64,
                            "mediaType": img.mediaType,
                        }
                    )

            agent_stream = agent.stream(
                message=request.message,
                files=files,
                images=images,
                data_files=data_files_content if data_files_content else None,
                history=history,
                conversation_id=conversation.id if conversation else None,
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
                        heartbeat_data = f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                        yield heartbeat_data.encode("utf-8")

                        elapsed = asyncio.get_event_loop().time() - start_time
                        if elapsed > timeout_seconds:
                            logger.warning(f"Streaming timeout after {elapsed:.1f}s")
                            for chunk in await _save_and_summarize(is_timeout=True):
                                yield chunk
                            error_data = f"data: {json.dumps({'type': 'error', 'content': 'Streaming timeout exceeded'})}\n\n"
                            yield error_data.encode("utf-8")
                            yield b"data: [DONE]\n\n"
                            if pending_task:
                                pending_task.cancel()
                            return
                        continue

                except Exception as e:
                    logger.error(f"Error in stream processing: {e}")
                    if pending_task:
                        pending_task.cancel()
                    raise

                elapsed = asyncio.get_event_loop().time() - start_time
                if elapsed > timeout_seconds:
                    logger.warning(f"Streaming timeout after {elapsed:.1f}s")
                    for chunk in await _save_and_summarize(is_timeout=True):
                        yield chunk
                    error_data = f"data: {json.dumps({'type': 'error', 'content': 'Streaming timeout exceeded'})}\n\n"
                    yield error_data.encode("utf-8")
                    yield b"data: [DONE]\n\n"
                    return

                event_type = event.get("type")

                # Collect data for persistence
                if event_type == "text":
                    collected_text.append(event.get("content", ""))
                elif event_type == "thinking":
                    collected_thinking.append(event.get("content", ""))
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
                elif event_type == "todo_update":
                    collected_todos = event.get("todos", [])
                elif event_type == "edit":
                    collected_edits.append(event.get("edit"))
                elif event_type == "usage":
                    collected_usage["input_tokens"] = event.get("input_tokens", 0)
                    collected_usage["output_tokens"] = event.get("output_tokens", 0)
                    collected_usage["cost"] = event.get("cost")
                    continue

                data = f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                yield data.encode("utf-8")

            # Save and send summary
            for chunk in await _save_and_summarize(is_timeout=False):
                yield chunk

            yield b"data: [DONE]\n\n"

        except TimeoutError:
            logger.error("Global agent streaming timeout")
            try:
                for chunk in await _save_and_summarize(is_timeout=True):
                    yield chunk
            except Exception as save_err:
                logger.error(f"Failed to save on TimeoutError: {save_err}")
            error_data = f"data: {json.dumps({'type': 'error', 'content': 'Request timeout'})}\n\n"
            yield error_data.encode("utf-8")
            yield b"data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"Global agent streaming error: {e}")
            import traceback

            traceback.print_exc()
            try:
                for chunk in await _save_and_summarize(is_timeout=True):
                    yield chunk
            except Exception as save_err:
                logger.error(f"Failed to save on error: {save_err}")
            error_data = f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            yield error_data.encode("utf-8")
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
# Conversation CRUD (optional - for standalone global agent conversations)
# ---------------------------------------------------------------------------


@router.get("/conversations")
async def list_conversations(
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """List global agent conversations for the current user."""
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
