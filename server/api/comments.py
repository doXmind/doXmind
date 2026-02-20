"""Comments API endpoints: CRUD, reactions, and mentions."""

import logging

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
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
