"""Chat API endpoints with streaming support, message persistence, and user isolation."""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
import json
import logging
import uuid

from agents.writing_agent import WritingAgent
from db.database import get_db, Conversation, Message, ConversationAttachment
from config import get_settings
from services.auth_service import optional_auth, TokenData

logger = logging.getLogger(__name__)
router = APIRouter()


def get_user_id_filter(token: Optional[TokenData]) -> Optional[str]:
    """Get user ID for filtering, handling dev mode and anonymous users."""
    settings = get_settings()

    if settings.debug:
        return None

    if token is None:
        return None

    if token.sub in ("dev-user", "api-key-user", "anonymous"):
        return None

    return token.sub


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
    alt: Optional[str] = None
    base64: Optional[str] = None
    mediaType: Optional[str] = None


class ChatRequest(BaseModel):
    """Chat request model."""
    message: str
    files: List[FileContext] = []
    images: List[ImageContext] = []  # Image contexts for multimodal support
    mode: str = "edit"  # "edit" | "analyze"
    conversationId: Optional[str] = None
    fileId: Optional[str] = None  # For associating conversation with a file


class MessageCreate(BaseModel):
    """Create a new message."""
    conversationId: str
    role: str  # "user" | "assistant"
    content: str
    contexts: Optional[List[dict]] = None  # Attached images and selected text
    thinking: Optional[str] = None
    toolCalls: Optional[List[dict]] = None
    edits: Optional[List[dict]] = None
    model: Optional[str] = None


class MessageResponse(BaseModel):
    """Message response model."""
    id: str
    conversationId: str
    role: str
    content: str
    contexts: Optional[List[dict]] = None
    thinking: Optional[str] = None
    toolCalls: Optional[List[dict]] = None
    edits: Optional[List[dict]] = None
    model: Optional[str] = None
    createdAt: str

    class Config:
        from_attributes = True


class ConversationResponse(BaseModel):
    """Conversation with messages response."""
    id: str
    fileId: Optional[str]
    messages: List[MessageResponse]
    createdAt: str

    class Config:
        from_attributes = True


# ============================================================================
# Conversation & Message CRUD Endpoints
# ============================================================================

@router.get("/conversations/{file_id}")
async def get_conversation(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    token: Optional[TokenData] = Depends(optional_auth)
):
    """Get conversation for a file, or create if not exists."""
    user_id = get_user_id_filter(token)
    normalized_file_id = normalize_file_id(file_id)

    # Find existing conversation for this file
    if normalized_file_id is None:
        query = select(Conversation).where(Conversation.file_id.is_(None))
    else:
        query = select(Conversation).where(Conversation.file_id == normalized_file_id)
    if user_id:
        query = query.where(Conversation.user_id == user_id)
    query = query.order_by(desc(Conversation.created_at)).limit(1)

    result = await db.execute(query)
    conversation = result.scalar_one_or_none()

    if not conversation:
        # Create new conversation
        conversation = Conversation(
            id=str(uuid.uuid4()),
            file_id=normalized_file_id,
            user_id=user_id
        )
        db.add(conversation)
        await db.commit()
        await db.refresh(conversation)

    # Load messages
    messages_result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation.id)
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
                "createdAt": msg.created_at.isoformat()
            }
            for msg in messages
        ]
    }


@router.get("/conversations")
async def list_conversations(
    db: AsyncSession = Depends(get_db),
    token: Optional[TokenData] = Depends(optional_auth)
):
    """List conversations for the current user."""
    user_id = get_user_id_filter(token)

    query = select(Conversation).order_by(desc(Conversation.created_at))
    if user_id:
        query = query.where(Conversation.user_id == user_id)

    result = await db.execute(query)
    conversations = result.scalars().all()

    return [
        {
            "id": conv.id,
            "fileId": conv.file_id,
            "createdAt": conv.created_at.isoformat()
        }
        for conv in conversations
    ]


@router.post("/messages")
async def create_message(
    message: MessageCreate,
    db: AsyncSession = Depends(get_db),
    token: Optional[TokenData] = Depends(optional_auth)
):
    """Create a new message in a conversation."""
    user_id = get_user_id_filter(token)
    normalized_file_id = normalize_file_id(message.conversationId)

    # First try to find by conversation ID (UUID)
    query = select(Conversation).where(Conversation.id == message.conversationId)
    if user_id:
        query = query.where(Conversation.user_id == user_id)
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
        query = query.order_by(desc(Conversation.created_at)).limit(1)

        result = await db.execute(query)
        conversation = result.scalar_one_or_none()

    # If still not found, create a new conversation
    if not conversation:
        conversation = Conversation(
            id=str(uuid.uuid4()),
            file_id=normalized_file_id,
            user_id=user_id
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
        model=message.model
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
        "createdAt": new_message.created_at.isoformat()
    }


@router.delete("/conversations/{file_id}")
async def clear_conversation(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    token: Optional[TokenData] = Depends(optional_auth)
):
    """Clear all messages in a conversation by file_id."""
    user_id = get_user_id_filter(token)
    normalized_file_id = normalize_file_id(file_id)

    # Find conversation by file_id (consistent with GET endpoint)
    if normalized_file_id is None:
        query = select(Conversation).where(Conversation.file_id.is_(None))
    else:
        query = select(Conversation).where(Conversation.file_id == normalized_file_id)
    if user_id:
        query = query.where(Conversation.user_id == user_id)
    query = query.order_by(desc(Conversation.created_at)).limit(1)

    result = await db.execute(query)
    conversation = result.scalar_one_or_none()

    if not conversation:
        return {"success": True, "deleted": 0}

    # Delete all messages in the conversation
    messages_result = await db.execute(
        select(Message).where(Message.conversation_id == conversation.id)
    )
    messages = messages_result.scalars().all()

    for msg in messages:
        await db.delete(msg)

    await db.commit()

    return {"success": True, "deleted": len(messages)}


# ============================================================================
# Streaming Chat Endpoint
# ============================================================================

@router.post("/stream")
async def chat_stream(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    """Stream AI chat response with real-time token output.

    The streaming endpoint collects all events and the final response
    is saved to the database by the frontend after streaming completes.
    """
    settings = get_settings()

    # Load conversation history (last 10 messages) for context
    history = []
    conversation = None
    kb_attachments = []

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
            # Get last 10 messages ordered by created_at
            messages_result = await db.execute(
                select(Message)
                .where(Message.conversation_id == conversation.id)
                .order_by(desc(Message.created_at))
                .limit(10)
            )
            messages = messages_result.scalars().all()
            # Reverse to get chronological order
            messages = list(reversed(messages))

            for msg in messages:
                history.append({
                    "role": msg.role,
                    "content": msg.content or ""
                })

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
                    "chunk_count": att.chunk_count
                }
                for att in attachments
            ]

            if kb_attachments:
                logger.info(f"Loaded {len(kb_attachments)} KB attachment(s) for conversation")

    # Collector for building the complete response
    collected_text = []
    collected_thinking = []
    collected_tool_calls = []
    collected_edits = []

    async def generate():
        nonlocal collected_text, collected_thinking, collected_tool_calls, collected_edits

        current_tool = None

        try:
            # Create agent with KB attachments if available
            agent = WritingAgent(
                mode=request.mode,
                kb_attachments=kb_attachments if kb_attachments else None
            )

            # Prepare file context
            files = [
                {
                    "id": f.id,
                    "name": f.name,
                    "content": f.content[:50000]  # Limit content size
                }
                for f in request.files
            ]

            # Prepare image context for multimodal support
            logger.info(f"Received {len(request.images)} image(s) in request")
            images = []
            for img in request.images:
                logger.info(f"Image: src_length={len(img.src) if img.src else 0}, base64_length={len(img.base64) if img.base64 else 0}, mediaType={img.mediaType}")
                if img.base64 and img.mediaType:
                    images.append({
                        "src": img.src,
                        "alt": img.alt,
                        "base64": img.base64,
                        "mediaType": img.mediaType,
                    })
            logger.info(f"Passing {len(images)} valid image(s) to agent")

            # Stream response - each event is yielded immediately
            async for event in agent.stream(
                message=request.message,
                files=files,
                images=images,  # Pass images for multimodal support
                history=history,
                conversation_id=conversation.id if conversation else None
            ):
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
                        "success": None
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

                # Yield SSE formatted data with immediate flush
                data = f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                yield data.encode('utf-8')

            # Send summary event with collected data for frontend to save
            summary = {
                "type": "summary",
                "content": "".join(collected_text),
                "thinking": "".join(collected_thinking) if collected_thinking else None,
                "toolCalls": collected_tool_calls if collected_tool_calls else None,
                "edits": collected_edits if collected_edits else None,
                "model": settings.default_model
            }
            yield f"data: {json.dumps(summary, ensure_ascii=False)}\n\n".encode('utf-8')

            yield b"data: [DONE]\n\n"

        except Exception as e:
            logger.error(f"Chat streaming error: {e}")
            import traceback
            traceback.print_exc()
            error_data = f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            yield error_data.encode('utf-8')
            yield b"data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Content-Type": "text/event-stream; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
        }
    )


# ============================================================================
# Simple (non-streaming) Chat Endpoint
# ============================================================================

class SimpleChatRequest(BaseModel):
    """Simple chat request without files."""
    message: str
    system: Optional[str] = None


@router.post("/simple")
async def simple_chat(request: SimpleChatRequest):
    """Simple non-streaming chat for quick responses."""
    from services.llm_service import LLMService

    try:
        llm = LLMService()
        response = await llm.complete(
            prompt=request.message,
            system=request.system
        )
        return {"response": response}
    except Exception as e:
        logger.error(f"Simple chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
