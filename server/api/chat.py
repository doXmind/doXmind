"""Chat API endpoints with streaming support, message persistence, and user isolation."""

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.writing_agent import WritingAgent
from api.files import get_user_id
from config import get_cors_headers, get_settings
from db.database import Conversation, ConversationAttachment, ConversationDataFile, Message, get_db
from services.api_key_service import APIKeyService
from services.auth_service import TokenData, optional_auth, require_auth
from services.history_compressor import HistoryCompressor

logger = logging.getLogger(__name__)
router = APIRouter()


def normalize_file_id(file_id: str | None) -> str | None:
    """Normalize file_id: empty string becomes None."""
    if file_id == "" or file_id is None:
        return None
    return file_id


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
    webSearchEnabled: bool = False
    # Data file IDs to pass to code execution sandbox
    dataFileIds: list[str] = []


class MessageCreate(BaseModel):
    """Create a new message."""

    conversationId: str
    role: str  # "user" | "assistant"
    content: str
    contexts: list[dict] | None = None  # Attached images and selected text
    thinking: str | None = None
    toolCalls: list[dict] | None = None
    edits: list[dict] | None = None
    model: str | None = None


class MessageResponse(BaseModel):
    """Message response model."""

    id: str
    conversationId: str
    role: str
    content: str
    contexts: list[dict] | None = None
    thinking: str | None = None
    toolCalls: list[dict] | None = None
    edits: list[dict] | None = None
    model: str | None = None
    createdAt: str

    class Config:
        from_attributes = True


class ConversationResponse(BaseModel):
    """Conversation with messages response."""

    id: str
    fileId: str | None
    messages: list[MessageResponse]
    createdAt: str

    class Config:
        from_attributes = True


# ============================================================================
# Conversation & Message CRUD Endpoints
# ============================================================================


@router.get("/conversations/{file_id}")
async def get_conversation(
    file_id: str, db: AsyncSession = Depends(get_db), token: TokenData = Depends(require_auth)
):
    """Get conversation for a file, or create if not exists."""
    user_id = get_user_id(token)
    normalized_file_id = normalize_file_id(file_id)

    # Find existing conversation for this file
    if normalized_file_id is None:
        query = select(Conversation).where(Conversation.file_id.is_(None))
    else:
        query = select(Conversation).where(Conversation.file_id == normalized_file_id)
    if user_id:
        query = query.where(Conversation.user_id == user_id)
    else:
        query = query.where(Conversation.user_id.is_(None))
    query = query.order_by(desc(Conversation.created_at)).limit(1)

    result = await db.execute(query)
    conversation = result.scalar_one_or_none()

    if not conversation:
        # Create new conversation
        conversation = Conversation(
            id=str(uuid.uuid4()), file_id=normalized_file_id, user_id=user_id
        )
        db.add(conversation)
        await db.commit()
        await db.refresh(conversation)

    # Load messages (exclude soft-deleted)
    messages_result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .where(Message.deleted_at.is_(None))
        .order_by(Message.created_at)
    )
    messages = messages_result.scalars().all()

    return {
        "id": conversation.id,
        "fileId": conversation.file_id,
        "createdAt": conversation.created_at.isoformat(),
        "messages": [
            {
                "id": msg.id,
                "conversationId": msg.conversation_id,
                "role": msg.role,
                "content": msg.content or "",
                "contexts": msg.contexts,
                "thinking": msg.thinking,
                "toolCalls": msg.tool_calls,
                "edits": msg.edits,
                "model": msg.model,
                "createdAt": msg.created_at.isoformat(),
            }
            for msg in messages
        ],
    }


@router.get("/conversations")
async def list_conversations(
    db: AsyncSession = Depends(get_db), token: TokenData = Depends(require_auth)
):
    """List conversations for the current user."""
    user_id = get_user_id(token)

    query = select(Conversation).order_by(desc(Conversation.created_at))
    if user_id:
        query = query.where(Conversation.user_id == user_id)
    else:
        query = query.where(Conversation.user_id.is_(None))

    result = await db.execute(query)
    conversations = result.scalars().all()

    return [
        {"id": conv.id, "fileId": conv.file_id, "createdAt": conv.created_at.isoformat()}
        for conv in conversations
    ]


@router.post("/messages")
async def create_message(
    message: MessageCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Create a new message in a conversation."""
    user_id = get_user_id(token)
    normalized_file_id = normalize_file_id(message.conversationId)

    # First try to find by conversation ID (UUID)
    query = select(Conversation).where(Conversation.id == message.conversationId)
    if user_id:
        query = query.where(Conversation.user_id == user_id)
    else:
        query = query.where(Conversation.user_id.is_(None))
    query = query.limit(1)

    result = await db.execute(query)
    conversation = result.scalar_one_or_none()

    # If not found by ID, try by file_id (frontend may pass file_id as conversationId)
    if not conversation:
        if normalized_file_id is None:
            query = select(Conversation).where(Conversation.file_id.is_(None))
        else:
            query = select(Conversation).where(Conversation.file_id == normalized_file_id)
        if user_id:
            query = query.where(Conversation.user_id == user_id)
        else:
            query = query.where(Conversation.user_id.is_(None))
        query = query.order_by(desc(Conversation.created_at)).limit(1)

        result = await db.execute(query)
        conversation = result.scalar_one_or_none()

    # If still not found, create a new conversation
    if not conversation:
        conversation = Conversation(
            id=str(uuid.uuid4()), file_id=normalized_file_id, user_id=user_id
        )
        db.add(conversation)
        await db.commit()
        await db.refresh(conversation)

    # Create message using the actual conversation ID (not the passed file_id)
    new_message = Message(
        id=str(uuid.uuid4()),
        conversation_id=conversation.id,
        role=message.role,
        content=message.content,
        contexts=message.contexts,
        thinking=message.thinking,
        tool_calls=message.toolCalls,
        edits=message.edits,
        model=message.model,
    )
    db.add(new_message)
    await db.commit()
    await db.refresh(new_message)

    return {
        "id": new_message.id,
        "conversationId": new_message.conversation_id,
        "role": new_message.role,
        "content": new_message.content,
        "contexts": new_message.contexts,
        "thinking": new_message.thinking,
        "toolCalls": new_message.tool_calls,
        "edits": new_message.edits,
        "model": new_message.model,
        "createdAt": new_message.created_at.isoformat(),
    }


@router.delete("/conversations/{file_id}")
async def clear_conversation(
    file_id: str, db: AsyncSession = Depends(get_db), token: TokenData = Depends(require_auth)
):
    """Clear all messages in a conversation by file_id."""
    user_id = get_user_id(token)
    normalized_file_id = normalize_file_id(file_id)

    # Find conversation by file_id (consistent with GET endpoint)
    if normalized_file_id is None:
        query = select(Conversation).where(Conversation.file_id.is_(None))
    else:
        query = select(Conversation).where(Conversation.file_id == normalized_file_id)
    if user_id:
        query = query.where(Conversation.user_id == user_id)
    else:
        query = query.where(Conversation.user_id.is_(None))
    query = query.order_by(desc(Conversation.created_at)).limit(1)

    result = await db.execute(query)
    conversation = result.scalar_one_or_none()

    if not conversation:
        return {"success": True, "deleted": 0}

    # Soft delete all messages in the conversation (preserve for statistics)
    from db.database import utcnow

    messages_result = await db.execute(
        select(Message).where(
            Message.conversation_id == conversation.id, Message.deleted_at.is_(None)
        )
    )
    messages = messages_result.scalars().all()

    now = utcnow()
    for msg in messages:
        msg.deleted_at = now

    await db.commit()

    return {"success": True, "deleted": len(messages)}


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

    # Resolve user's API key and model preference
    user_api_key = None
    user_model = None

    if auth and auth.sub and auth.sub != "anonymous":
        api_key_service = APIKeyService(db)
        user_api_settings = await api_key_service.get_user_settings(auth.sub)

        if api_key_service.has_api_key(user_api_settings):
            user_api_key = await api_key_service.get_decrypted_key(auth.sub)
            user_model = user_api_settings.preferred_model
            logger.info(f"Using user's API key with model: {user_model}")

    # Load conversation history with 3-1-3 compression
    history = []
    conversation = None
    kb_attachments = []
    data_files_metadata = []
    data_files_content = []

    if request.conversationId:
        # Find conversation by file_id (conversationId from frontend is actually file_id)
        normalized_file_id = normalize_file_id(request.conversationId)
        if normalized_file_id is None:
            conv_result = await db.execute(
                select(Conversation)
                .where(Conversation.file_id.is_(None))
                .order_by(desc(Conversation.created_at))
                .limit(1)
            )
        else:
            conv_result = await db.execute(
                select(Conversation)
                .where(Conversation.file_id == normalized_file_id)
                .order_by(desc(Conversation.created_at))
                .limit(1)
            )
        conversation = conv_result.scalar_one_or_none()

        if conversation:
            # Load up to 50 messages for 3-1-3 compression (exclude soft-deleted)
            messages_result = await db.execute(
                select(Message)
                .where(Message.conversation_id == conversation.id)
                .where(Message.deleted_at.is_(None))
                .order_by(desc(Message.created_at))
                .limit(50)
            )
            messages = messages_result.scalars().all()
            # Reverse to get chronological order
            messages = list(reversed(messages))

            # Compress history using 3-1-3 rule
            compressor = HistoryCompressor()
            history = compressor.compress(messages)

            # Load KB attachments for this conversation
            kb_result = await db.execute(
                select(ConversationAttachment)
                .where(ConversationAttachment.conversation_id == conversation.id)
                .where(ConversationAttachment.status == "indexed")
            )
            attachments = kb_result.scalars().all()

            kb_attachments = [
                {
                    "id": att.id,
                    "filename": att.original_filename,
                    "file_type": att.file_type,
                    "chunk_count": att.chunk_count,
                }
                for att in attachments
            ]

            if kb_attachments:
                logger.info(f"Loaded {len(kb_attachments)} KB attachment(s) for conversation")

            # Load ALL data files metadata for this conversation (so AI knows what's available)
            data_files_result = await db.execute(
                select(ConversationDataFile)
                .where(ConversationDataFile.conversation_id == conversation.id)
                .where(ConversationDataFile.status == "ready")
            )
            all_data_files = data_files_result.scalars().all()

            # Data files metadata (for system prompt - tells AI what files are available)
            data_files_metadata = [
                {
                    "id": df.id,
                    "filename": df.original_filename,
                    "file_type": df.file_type,
                    "row_count": df.row_count,
                    "column_names": df.column_names,
                }
                for df in all_data_files
            ]

            if data_files_metadata:
                logger.info(f"Found {len(data_files_metadata)} data file(s) in conversation")

            # Load data files CONTENT for code execution (all ready files)
            data_files_content = []
            if all_data_files:
                import os

                for data_file in all_data_files:
                    if data_file.storage_path and os.path.exists(data_file.storage_path):
                        with open(data_file.storage_path, "rb") as f:
                            content = f.read()
                        data_files_content.append(
                            {
                                "id": data_file.id,
                                "filename": data_file.original_filename,
                                "mime_type": data_file.mime_type,
                                "content": content,
                                # Claude Files API info for optimized upload
                                "claude_file_id": data_file.claude_file_id,
                                "claude_upload_status": data_file.claude_upload_status or "pending",
                                "file_size": data_file.file_size,
                            }
                        )
                if data_files_content:
                    logger.info(
                        f"Loaded {len(data_files_content)} data file(s) content for analysis"
                    )

    # Collector for building the complete response
    collected_text = []
    collected_thinking = []
    collected_tool_calls = []
    collected_edits = []
    collected_usage = {"input_tokens": 0, "output_tokens": 0}

    async def generate():
        nonlocal \
            collected_text, \
            collected_thinking, \
            collected_tool_calls, \
            collected_edits, \
            collected_usage

        current_tool = None
        timeout_seconds = settings.streaming_timeout_seconds
        start_time = asyncio.get_event_loop().time()
        heartbeat_interval = 25  # Send heartbeat every 25 seconds (Heroku timeout is 55s)

        try:
            # Create agent with KB attachments, data files metadata, and web tools
            # Skills are auto-detected by the agent based on context
            # Code execution is auto-enabled when data files are present
            agent = WritingAgent(
                mode=request.mode,
                kb_attachments=kb_attachments if kb_attachments else None,
                data_files_metadata=data_files_metadata if data_files_metadata else None,
                web_search_enabled=request.webSearchEnabled,
                code_execution_enabled=bool(
                    data_files_content
                ),  # Auto-enable when data files present
                db=db,
                api_key=user_api_key,
                model=user_model,
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
                elif event_type == "edit":
                    collected_edits.append(event.get("edit"))
                elif event_type == "usage":
                    collected_usage["input_tokens"] = event.get("input_tokens", 0)
                    collected_usage["output_tokens"] = event.get("output_tokens", 0)
                    continue  # Don't send usage event to frontend

                # Yield SSE formatted data with immediate flush
                data = f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                yield data.encode("utf-8")

            # Save assistant message to database with token usage
            message_id = None
            if conversation:
                assistant_message = Message(
                    id=str(uuid.uuid4()),
                    conversation_id=conversation.id,
                    role="assistant",
                    content="".join(collected_text),
                    thinking="".join(collected_thinking) if collected_thinking else None,
                    tool_calls=collected_tool_calls if collected_tool_calls else None,
                    edits=collected_edits if collected_edits else None,
                    model=settings.default_model,
                    input_tokens=str(collected_usage["input_tokens"])
                    if collected_usage["input_tokens"]
                    else None,
                    output_tokens=str(collected_usage["output_tokens"])
                    if collected_usage["output_tokens"]
                    else None,
                )
                db.add(assistant_message)
                await db.commit()
                message_id = assistant_message.id

            # Send summary event with collected data
            summary = {
                "type": "summary",
                "messageId": message_id,
                "content": "".join(collected_text),
                "thinking": "".join(collected_thinking) if collected_thinking else None,
                "toolCalls": collected_tool_calls if collected_tool_calls else None,
                "edits": collected_edits if collected_edits else None,
                "model": settings.default_model,
            }
            yield f"data: {json.dumps(summary, ensure_ascii=False)}\n\n".encode()

            yield b"data: [DONE]\n\n"

        except TimeoutError:
            logger.error("Chat streaming timeout")
            error_data = f"data: {json.dumps({'type': 'error', 'content': 'Request timeout'})}\n\n"
            yield error_data.encode("utf-8")
            yield b"data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"Chat streaming error: {e}")
            import traceback

            traceback.print_exc()
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


@router.post("/simple")
async def simple_chat(request: SimpleChatRequest):
    """Simple non-streaming chat for quick responses."""
    from services.llm_service import LLMService

    try:
        llm = LLMService()
        response = await llm.complete(prompt=request.message, system=request.system)
        return {"response": response}
    except Exception as e:
        logger.error(f"Simple chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
