"""Chat streaming endpoints with SSE support.

Handles real-time AI chat streaming and simple chat.
Conversation CRUD operations are in api/conversations.py.
"""

import asyncio
import json
import logging
import os
import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.writing_agent import WritingAgent
from config import get_cors_headers, get_settings
from db.database import Conversation, ConversationAttachment, ConversationDataFile, Message, get_db
from api.files import get_user_id
from dependencies import normalize_file_id, resolve_user_api_key
from exceptions import InternalError
from services.api_key_service import APIKeyService
from services.auth_service import TokenData, optional_auth, require_auth
from services.history_compressor import HistoryCompressor

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class FileContext(BaseModel):
    """File context for chat."""

    id: str
    name: str
    content: str


class ImageContext(BaseModel):
    """Image context for chat (multimodal support)."""

    src: str
    alt: str | None = None
    base64: str | None = None
    mediaType: str | None = None


class ChatRequest(BaseModel):
    """Chat request model."""

    message: str
    files: list[FileContext] = []
    images: list[ImageContext] = []  # Image contexts for multimodal support
    mode: str = "edit"  # "edit" | "analyze"
    conversationId: str | None = None
    fileId: str | None = None  # For associating conversation with a file
    # Web search toggle (web fetch is always enabled)
    webSearchEnabled: bool = True
    # Thinking mode toggle - uses thinking model for deep reasoning
    thinkingEnabled: bool = False
    # Data file IDs to pass to code execution sandbox
    dataFileIds: list[str] = []
    # Quick edit flag - optimizes agent for direct text editing
    isQuickEdit: bool = False


# ============================================================================
# Helper Functions
# ============================================================================


async def _resolve_user_api_settings(
    auth: TokenData | None, db: AsyncSession
) -> tuple[str | None, str | None]:
    """Resolve user's API key and model preference.

    IMPORTANT: User's preferred model is ONLY used when they have provided their own API key.
    If the user has no API key (or removed it), returns (None, None) to use server defaults.

    Returns:
        (api_key, model) tuple:
        - If user has API key: (decrypted_key, preferred_model)
        - Otherwise: (None, None) -> will use config.default_model
    """
    if not auth or not auth.sub or auth.sub == "anonymous":
        return None, None

    api_key_service = APIKeyService(db)
    user_api_settings = await api_key_service.get_user_settings(auth.sub)

    # Only use user's preferred model if they have provided their own API key
    if not api_key_service.has_api_key(user_api_settings):
        return None, None

    api_key = await api_key_service.get_decrypted_key(auth.sub, settings=user_api_settings)
    logger.info(f"Using user's API key with model: {user_api_settings.preferred_model}")
    return api_key, user_api_settings.preferred_model


async def _load_conversation_context(
    conversation_id: str | None, db: AsyncSession, user_id: str | None
) -> tuple[Conversation | None, list, list[dict], list[dict], list[dict]]:
    """Load conversation, history, KB attachments, and data files.

    Returns:
        (conversation, history, kb_attachments, data_files_metadata, data_files_content)
    """
    if not conversation_id:
        return None, [], [], [], []

    # Find conversation by file_id
    normalized_file_id = normalize_file_id(conversation_id)
    if normalized_file_id is None:
        conv_result = await db.execute(
            select(Conversation)
            .where(Conversation.file_id.is_(None))
            .where(Conversation.user_id == user_id)
            .order_by(desc(Conversation.created_at))
            .limit(1)
        )
    else:
        conv_result = await db.execute(
            select(Conversation)
            .where(Conversation.file_id == normalized_file_id)
            .where(Conversation.user_id == user_id)
            .order_by(desc(Conversation.created_at))
            .limit(1)
        )
    conversation = conv_result.scalar_one_or_none()

    if not conversation:
        return None, [], [], [], []

    # Run independent queries in parallel
    async def _load_messages():
        messages_result = await db.execute(
            select(Message.role, Message.content, Message.tool_calls)
            .where(Message.conversation_id == conversation.id)
            .where(Message.deleted_at.is_(None))
            .order_by(desc(Message.created_at))
            .limit(50)
        )
        return list(reversed(messages_result.all()))

    async def _load_kb_attachments():
        kb_result = await db.execute(
            select(ConversationAttachment)
            .where(ConversationAttachment.conversation_id == conversation.id)
            .where(ConversationAttachment.status == "indexed")
        )
        return kb_result.scalars().all()

    async def _load_data_files():
        data_files_result = await db.execute(
            select(ConversationDataFile)
            .where(ConversationDataFile.conversation_id == conversation.id)
            .where(ConversationDataFile.status == "ready")
        )
        return data_files_result.scalars().all()

    messages_raw, attachments_raw, all_data_files = await asyncio.gather(
        _load_messages(),
        _load_kb_attachments(),
        _load_data_files(),
    )

    # Compress history using 3-1-3 rule
    compressor = HistoryCompressor()
    history = compressor.compress(messages_raw)

    # Format KB attachments
    kb_attachments = [
        {
            "id": att.id,
            "filename": att.original_filename,
            "file_type": att.file_type,
            "chunk_count": att.chunk_count,
            "extracted_text": att.extracted_text,
        }
        for att in attachments_raw
    ]
    if kb_attachments:
        logger.info(f"Loaded {len(kb_attachments)} KB attachment(s) for conversation")

    # Format data files metadata
    data_files_metadata = [
        {
            "id": df.id,
            "filename": df.original_filename,
            "file_type": df.file_type,
            "row_count": df.row_count,
            "column_names": df.column_names,
            "storage_path": df.storage_path,
        }
        for df in all_data_files
    ]
    if data_files_metadata:
        logger.info(f"Found {len(data_files_metadata)} data file(s) in conversation")

    # Load data files content for code execution (parallel file reads)
    data_files_content = []
    if all_data_files:

        def _read_file_sync(path: str) -> bytes:
            with open(path, "rb") as f:
                return f.read()

        async def _read_data_file(data_file):
            if data_file.storage_path and os.path.exists(data_file.storage_path):
                content = await asyncio.to_thread(_read_file_sync, data_file.storage_path)
                return {
                    "id": data_file.id,
                    "filename": data_file.original_filename,
                    "mime_type": data_file.mime_type,
                    "content": content,
                    "file_size": data_file.file_size,
                }
            return None

        results = await asyncio.gather(*[_read_data_file(df) for df in all_data_files])
        data_files_content = [r for r in results if r is not None]
        if data_files_content:
            logger.info(f"Loaded {len(data_files_content)} data file(s) content for analysis")

    return conversation, history, kb_attachments, data_files_metadata, data_files_content


# ============================================================================
# Streaming Chat Endpoint
# ============================================================================


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(optional_auth),
):
    """Stream AI chat response with real-time token output.

    The streaming endpoint collects all events and the final response
    is saved to the database by the frontend after streaming completes.
    """
    settings = get_settings()
    origin = http_request.headers.get("origin")

    user_api_key, user_model = await _resolve_user_api_settings(auth, db)

    (
        conversation,
        history,
        kb_attachments,
        data_files_metadata,
        data_files_content,
    ) = await _load_conversation_context(request.conversationId, db, get_user_id(auth) if auth else None)

    # Collector for building the complete response
    collected_text = []
    collected_thinking = []
    collected_tool_calls = []
    collected_edits = []
    collected_todos = []  # Latest todo state from TodoWrite
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
        heartbeat_interval = 25  # Send heartbeat every 25 seconds (Heroku timeout is 55s)

        async def _save_and_summarize(is_timeout: bool = False) -> list[bytes]:
            """Save partial/complete assistant message and build summary event.

            Returns list of SSE-encoded bytes to yield to the client.
            """
            events_to_send = []
            content_text = "".join(collected_text)

            # Don't save empty messages
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
            # Create agent with KB attachments, data files metadata, and web tools
            # Skills are auto-detected by the agent based on context
            # Code execution is always enabled (useful for calculations even without data files)
            # Select model based on thinking toggle (only for server-default users)
            effective_model = user_model
            if not user_model and request.thinkingEnabled:
                effective_model = settings.thinking_model

            agent = WritingAgent(
                mode=request.mode,
                kb_attachments=kb_attachments if kb_attachments else None,
                data_files_metadata=data_files_metadata if data_files_metadata else None,
                web_search_enabled=request.webSearchEnabled,
                db=db,
                api_key=user_api_key,
                model=effective_model,
                is_quick_edit=request.isQuickEdit,
            )

            # Prepare file context
            files = [
                {
                    "id": f.id,
                    "name": f.name,
                    "content": f.content[:50000],  # Limit content size
                }
                for f in request.files
            ]

            # Prepare image context for multimodal support
            logger.info(f"Received {len(request.images)} image(s) in request")
            images = []
            for img in request.images:
                logger.info(
                    f"Image: src_length={len(img.src) if img.src else 0}, base64_length={len(img.base64) if img.base64 else 0}, mediaType={img.mediaType}"
                )
                if img.base64 and img.mediaType:
                    images.append(
                        {
                            "src": img.src,
                            "alt": img.alt,
                            "base64": img.base64,
                            "mediaType": img.mediaType,
                        }
                    )
            logger.info(f"Passing {len(images)} valid image(s) to agent")

            # Stream response with heartbeat support for Heroku
            # Heroku closes connections after 55s of no data, so we send heartbeats every 25s
            agent_stream = agent.stream(
                message=request.message,
                files=files,
                images=images,  # Pass images for multimodal support
                data_files=data_files_content if data_files_content else None,
                history=history,
                conversation_id=conversation.id if conversation else None,
            ).__aiter__()

            # Use a persistent task to avoid cancelling the generator on heartbeat timeout
            pending_task = None

            while True:
                try:
                    # Create a task for __anext__() if we don't have one pending
                    if pending_task is None:
                        pending_task = asyncio.create_task(agent_stream.__anext__())

                    # Wait for the task with heartbeat timeout
                    done, _ = await asyncio.wait({pending_task}, timeout=heartbeat_interval)

                    if pending_task in done:
                        # Task completed, get the result
                        try:
                            event = pending_task.result()
                            pending_task = None  # Reset for next iteration
                        except StopAsyncIteration:
                            # Stream completed
                            break
                    else:
                        # Timeout - send heartbeat but DON'T cancel the task
                        heartbeat_data = f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                        yield heartbeat_data.encode("utf-8")

                        # Check overall timeout
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

                # Check timeout
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
                    continue  # Usage data is included in summary event

                # Yield SSE formatted data with immediate flush
                data = f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                yield data.encode("utf-8")

            # Save assistant message and send summary
            for chunk in await _save_and_summarize(is_timeout=False):
                yield chunk

            yield b"data: [DONE]\n\n"

        except TimeoutError:
            logger.error("Chat streaming timeout")
            try:
                for chunk in await _save_and_summarize(is_timeout=True):
                    yield chunk
            except Exception as save_err:
                logger.error(f"Failed to save on TimeoutError: {save_err}")
            error_data = f"data: {json.dumps({'type': 'error', 'content': 'Request timeout'})}\n\n"
            yield error_data.encode("utf-8")
            yield b"data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"Chat streaming error: {e}")
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


# ============================================================================
# Simple (non-streaming) Chat Endpoint
# ============================================================================


class SimpleChatRequest(BaseModel):
    """Simple chat request without files."""

    message: str
    system: str | None = None
    model: str | None = None


@router.post("/simple")
async def simple_chat(
    request: SimpleChatRequest,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Simple non-streaming chat for quick responses.

    Uses fast_model by default for speed-critical operations like slides generation.
    """
    from services.llm_service import LLMService

    try:
        settings = get_settings()
        # Use fast_model as default for simple chat (quick operations)
        model = request.model or settings.fast_model
        user_id = get_user_id(auth)
        user_api_key = await resolve_user_api_key(user_id, db) if user_id else None
        llm = LLMService(model=model, api_key=user_api_key)
        response = await llm.complete(prompt=request.message, system=request.system)

        # Track usage
        if llm.last_usage:
            import asyncio

            from services.usage_tracker import track_usage

            asyncio.create_task(
                track_usage(
                    service="simple_chat",
                    model=llm.model,
                    user_id=user_id,
                    is_byok=bool(user_api_key),
                    **llm.last_usage,
                )
            )

        return {"response": response}
    except Exception as e:
        logger.error(f"Simple chat error: {e}")
        raise InternalError(message=str(e))
