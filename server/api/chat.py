"""Chat streaming endpoints with SSE support.

Handles real-time AI chat streaming and simple chat.
Conversation CRUD operations are in api/conversations.py.
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

from agents.writing_agent import WritingAgent
from config import get_cors_headers, get_settings
from db.database import Conversation, ConversationAttachment, ConversationDataFile, Message, get_db
from dependencies import normalize_file_id
from exceptions import InternalError
from services.api_key_service import APIKeyService
from services.auth_service import TokenData, optional_auth
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
    webSearchEnabled: bool = False
    # Data file IDs to pass to code execution sandbox
    dataFileIds: list[str] = []


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
    collected_todos = []  # Latest todo state from TodoWrite
    collected_usage = {"input_tokens": 0, "output_tokens": 0}

    async def generate():
        nonlocal \
            collected_text, \
            collected_thinking, \
            collected_tool_calls, \
            collected_edits, \
            collected_todos, \
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
                elif event_type == "todo_update":
                    collected_todos = event.get("todos", [])
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
                "todos": collected_todos if collected_todos else None,
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
        raise InternalError(message=str(e))
