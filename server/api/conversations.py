"""Conversation & Message CRUD endpoints.

Handles conversation lifecycle and message persistence,
split from chat.py to separate CRUD from streaming logic.
"""

import logging
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.files import get_user_id
from db.database import Conversation, Message, get_db
from dependencies import normalize_file_id
from services.auth_service import TokenData, require_auth

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


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
