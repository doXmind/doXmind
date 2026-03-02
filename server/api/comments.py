"""Comments API endpoints: CRUD, reactions, and mentions."""

import asyncio
import logging

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import Comment, DocumentShare, File, User, get_db
from middleware.rate_limit import limiter
from services.auth_service import TokenData, optional_auth, require_auth
from services.comment_service import CommentService

logger = logging.getLogger(__name__)
router = APIRouter()


def get_user_id(token: TokenData) -> str | None:
    """Get user ID from token for data isolation."""
    if token.sub in ("dev-user", "api-key-user", "anonymous"):
        return None
    return token.sub


async def _send_comment_notifications(
    share_owner_email: str | None,
    parent_author_email: str | None,
    mention_emails: list[str],
    commenter_name: str,
    comment_content: str,
    doc_name: str,
    share_url: str,
    is_reply: bool,
) -> None:
    """Send comment/reply/mention notification emails (fire-and-forget)."""
    try:
        from services.email_service import get_email_service

        email_service = get_email_service()
        preview = comment_content[:200] + ("..." if len(comment_content) > 200 else "")
        notified_emails: set[str] = set()

        # 1. Send mention notifications first (highest priority)
        for email in mention_emails:
            if email in notified_emails:
                continue
            await email_service.send_mention_notification(
                to_email=email,
                mentioner_name=commenter_name,
                comment_preview=preview,
                doc_name=doc_name,
                share_url=share_url,
            )
            notified_emails.add(email)

        # 2. Send reply notification to parent comment author
        if is_reply and parent_author_email and parent_author_email not in notified_emails:
            await email_service.send_comment_notification(
                to_email=parent_author_email,
                commenter_name=commenter_name,
                comment_preview=preview,
                doc_name=doc_name,
                share_url=share_url,
                is_reply=True,
            )
            notified_emails.add(parent_author_email)

        # 3. Send comment notification to share owner
        if share_owner_email and share_owner_email not in notified_emails:
            await email_service.send_comment_notification(
                to_email=share_owner_email,
                commenter_name=commenter_name,
                comment_preview=preview,
                doc_name=doc_name,
                share_url=share_url,
                is_reply=False,
            )
    except Exception:
        logger.exception("Failed to send comment notification emails")


# =============================================================================
# Request Models
# =============================================================================


class CreateCommentRequest(BaseModel):
    """Request to create a comment."""

    content: str = Field(min_length=1, max_length=5000)
    parent_id: str | None = None
    mentions: list[str] | None = None


class UpdateCommentRequest(BaseModel):
    """Request to update a comment."""

    content: str = Field(min_length=1, max_length=5000)
    mentions: list[str] | None = None


class ReactRequest(BaseModel):
    """Request to add/remove a reaction."""

    emoji: str = Field(min_length=1, max_length=10)


# =============================================================================
# List Comments
# =============================================================================


@router.get("/{share_token}")
@limiter.limit("60/minute")
async def list_comments(
    request: Request,
    share_token: str,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    sort: str = Query("oldest", pattern="^(oldest|newest)$"),
    db: AsyncSession = Depends(get_db),
    token: TokenData | None = Depends(optional_auth),
):
    """Get top-level comments for a shared item."""
    current_user_id = get_user_id(token) if token else None
    service = CommentService(db)

    comments, total = await service.list_comments(
        share_token=share_token,
        parent_id=None,
        limit=limit,
        offset=offset,
        sort=sort,
        current_user_id=current_user_id,
    )

    return {"comments": comments, "total": total, "has_more": offset + limit < total}


@router.get("/{share_token}/{comment_id}/replies")
@limiter.limit("60/minute")
async def list_replies(
    request: Request,
    share_token: str,
    comment_id: str,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    token: TokenData | None = Depends(optional_auth),
):
    """Get replies to a specific comment."""
    current_user_id = get_user_id(token) if token else None
    service = CommentService(db)

    comments, total = await service.list_comments(
        share_token=share_token,
        parent_id=comment_id,
        limit=limit,
        offset=offset,
        current_user_id=current_user_id,
    )

    return {"comments": comments, "total": total, "has_more": offset + limit < total}


# =============================================================================
# Create/Edit/Delete Comments
# =============================================================================


@router.post("/{share_token}")
@limiter.limit("20/minute")
async def create_comment(
    request: Request,
    share_token: str,
    body: CreateCommentRequest,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Create a new comment on a shared item."""
    user_id = get_user_id(token)
    if not user_id:
        return {"error": "Authentication required"}

    service = CommentService(db)
    comment = await service.create_comment(
        share_token=share_token,
        user_id=user_id,
        content=body.content,
        parent_id=body.parent_id,
        mentions=body.mentions,
    )

    # --- Notification logic (fire-and-forget) ---
    # Gather data for notifications
    share_owner_email: str | None = None
    parent_author_email: str | None = None
    mention_emails: list[str] = []

    try:
        # Get share info (owner + file name)
        share_result = await db.execute(
            select(DocumentShare.user_id, DocumentShare.file_id, DocumentShare.share_token).where(
                DocumentShare.share_token == share_token
            )
        )
        share_row = share_result.one_or_none()

        if share_row:
            # Get document name
            file_result = await db.execute(
                select(File.name).where(File.id == share_row.file_id)
            )
            file_row = file_result.one_or_none()
            doc_name = file_row.name if file_row else "Untitled"

            # Get share owner email (skip if commenter is owner)
            if share_row.user_id != user_id:
                owner_result = await db.execute(
                    select(User.email).where(
                        User.id == share_row.user_id, User.email.isnot(None)
                    )
                )
                owner_row = owner_result.one_or_none()
                if owner_row:
                    share_owner_email = owner_row.email

            # Get parent comment author email (for replies)
            if body.parent_id:
                parent_result = await db.execute(
                    select(Comment.user_id).where(Comment.id == body.parent_id)
                )
                parent_row = parent_result.one_or_none()
                if parent_row and parent_row.user_id != user_id:
                    pa_result = await db.execute(
                        select(User.email).where(
                            User.id == parent_row.user_id, User.email.isnot(None)
                        )
                    )
                    pa_row = pa_result.one_or_none()
                    if pa_row:
                        parent_author_email = pa_row.email

            # Get mention emails (exclude commenter)
            if body.mentions:
                mention_ids = [m for m in body.mentions if m != user_id]
                if mention_ids:
                    m_result = await db.execute(
                        select(User.email).where(
                            User.id.in_(mention_ids), User.email.isnot(None)
                        )
                    )
                    mention_emails = [r.email for r in m_result if r.email]

            settings = get_settings()
            share_url = f"{settings.frontend_url}/shared/{share_row.share_token}"

            if share_owner_email or parent_author_email or mention_emails:
                asyncio.create_task(
                    _send_comment_notifications(
                        share_owner_email=share_owner_email,
                        parent_author_email=parent_author_email,
                        mention_emails=mention_emails,
                        commenter_name=token.username or "A doXmind user",
                        comment_content=body.content,
                        doc_name=doc_name,
                        share_url=share_url,
                        is_reply=body.parent_id is not None,
                    )
                )
    except Exception:
        logger.exception("Failed to prepare comment notifications")

    return comment


@router.put("/{share_token}/{comment_id}")
async def update_comment(
    share_token: str,
    comment_id: str,
    body: UpdateCommentRequest,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Edit own comment."""
    user_id = get_user_id(token)
    if not user_id:
        return {"error": "Authentication required"}

    service = CommentService(db)
    comment = await service.update_comment(
        comment_id=comment_id,
        user_id=user_id,
        content=body.content,
        mentions=body.mentions,
    )

    return comment


@router.delete("/{share_token}/{comment_id}")
async def delete_comment(
    share_token: str,
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Delete a comment (soft delete)."""
    user_id = get_user_id(token)
    if not user_id:
        return {"error": "Authentication required"}

    service = CommentService(db)
    await service.delete_comment(
        comment_id=comment_id,
        user_id=user_id,
        share_token=share_token,
    )

    return {"status": "deleted", "comment_id": comment_id}


# =============================================================================
# Reactions
# =============================================================================


@router.post("/{share_token}/{comment_id}/react")
@limiter.limit("60/minute")
async def toggle_reaction(
    request: Request,
    share_token: str,
    comment_id: str,
    body: ReactRequest,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Toggle an emoji reaction on a comment."""
    user_id = get_user_id(token)
    if not user_id:
        return {"error": "Authentication required"}

    service = CommentService(db)
    reacted, reactions = await service.toggle_reaction(
        comment_id=comment_id,
        user_id=user_id,
        emoji=body.emoji,
    )

    return {"reacted": reacted, "reactions": reactions}


# =============================================================================
# Mentions
# =============================================================================


@router.get("/mentions/search")
@limiter.limit("30/minute")
async def search_mentions(
    request: Request,
    q: str = Query(min_length=1, max_length=50),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Search users by partial username for @mention autocomplete."""
    service = CommentService(db)
    users = await service.search_mentions(q, limit=10)

    return {"users": users}
