"""Community API endpoints: discovery, forks, bookmarks, user profiles."""

import asyncio
import logging

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import DocumentShare, File, User, get_db
from exceptions import NotFoundError
from middleware.rate_limit import limiter
from services.auth_service import TokenData, optional_auth, require_auth
from services.community_service import CommunityService

logger = logging.getLogger(__name__)
router = APIRouter()


def get_user_id(token: TokenData) -> str | None:
    """Get user ID from token for data isolation."""
    if token.sub in ("dev-user", "api-key-user", "anonymous"):
        return None
    return token.sub


# =============================================================================
# Request/Response Models
# =============================================================================


class PublishRequest(BaseModel):
    """Request to publish a share to the community."""

    title: str | None = None
    description: str | None = Field(None, max_length=500)
    tags: list[str] | None = Field(None, max_length=10)


class ForkRequest(BaseModel):
    """Request to fork a shared document."""

    target_folder_id: str | None = None


class SyncForkRequest(BaseModel):
    """Request to sync a forked document with the original."""

    force: bool = False
    create_backup: bool = False


# =============================================================================
# Tags
# =============================================================================


@router.get("/tags")
@limiter.limit("60/minute")
async def get_popular_tags(
    request: Request,
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Get popular tags from published community shares."""
    service = CommunityService(db)
    tags = await service.get_popular_tags(limit=limit)
    return {"tags": tags}


# =============================================================================
# Recommendations
# =============================================================================


@router.get("/recommendations")
@limiter.limit("30/minute")
async def get_recommendations(
    request: Request,
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Get personalized recommendations for the current user."""
    user_id = get_user_id(token)
    if not user_id:
        return {"items": [], "total": 0, "has_more": False}

    service = CommunityService(db)
    items, total = await service.get_recommendations(
        user_id=user_id,
        limit=limit,
        offset=offset,
    )

    return {
        "items": items,
        "total": total,
        "has_more": offset + limit < total,
    }


# =============================================================================
# Discovery Endpoints
# =============================================================================


@router.get("/discover")
@limiter.limit("60/minute")
async def discover(
    request: Request,
    sort: str = Query("newest", pattern="^(newest|popular|most_viewed)$"),
    tag: str | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    token: TokenData | None = Depends(optional_auth),
):
    """Browse published community shares."""
    current_user_id = get_user_id(token) if token else None
    service = CommunityService(db)

    items, total = await service.discover(
        sort=sort,
        tag=tag,
        search=search,
        limit=limit,
        offset=offset,
        current_user_id=current_user_id,
    )

    return {
        "items": items,
        "total": total,
        "has_more": offset + limit < total,
    }


@router.get("/discover/{share_token}")
@limiter.limit("60/minute")
async def discover_detail(
    request: Request,
    share_token: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData | None = Depends(optional_auth),
):
    """Get detailed community page for a specific published share."""
    current_user_id = get_user_id(token) if token else None
    service = CommunityService(db)

    detail = await service.get_community_detail(share_token, current_user_id)
    if not detail:
        raise NotFoundError(resource="Community item", message="Published share not found")

    return detail


# =============================================================================
# Fork Endpoints
# =============================================================================


@router.post("/{share_token}/fork")
@limiter.limit("10/minute")
async def fork_share(
    request: Request,
    share_token: str,
    body: ForkRequest | None = None,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Fork a shared document/folder to the current user's space."""
    user_id = get_user_id(token)
    if not user_id:
        raise NotFoundError(resource="User", message="Authentication required")

    service = CommunityService(db)
    fork, new_file = await service.fork_share(
        share_token=share_token,
        user_id=user_id,
        target_folder_id=body.target_folder_id if body else None,
    )

    # Send fork notification to document owner
    try:
        share_result = await db.execute(
            select(DocumentShare.user_id, DocumentShare.file_id).where(
                DocumentShare.share_token == share_token
            )
        )
        share_row = share_result.one_or_none()
        if share_row:
            # Get owner email and file name
            owner_result = await db.execute(
                select(User.email).where(
                    User.id == share_row.user_id, User.email.isnot(None)
                )
            )
            file_result = await db.execute(
                select(File.name).where(File.id == share_row.file_id)
            )
            owner_row = owner_result.one_or_none()
            file_row = file_result.one_or_none()

            if owner_row and owner_row.email and file_row:
                settings = get_settings()
                share_url = f"{settings.frontend_url}/community/{share_token}"

                async def _send_fork_email() -> None:
                    try:
                        from services.email_service import get_email_service

                        email_service = get_email_service()
                        await email_service.send_fork_notification(
                            to_email=owner_row.email,
                            forker_name=token.username or "A doXmind user",
                            doc_name=file_row.name,
                            share_url=share_url,
                        )
                    except Exception:
                        logger.exception("Failed to send fork notification email")

                asyncio.create_task(_send_fork_email())
    except Exception:
        logger.exception("Failed to prepare fork notification")

    return {
        "fork_id": fork.id,
        "forked_file_id": new_file.id,
        "forked_file_name": new_file.name,
        "source_share_id": fork.source_share_id,
        "created_at": fork.created_at.isoformat() if fork.created_at else "",
    }


@router.post("/forks/{fork_id}/sync")
@limiter.limit("5/minute")
async def sync_fork(
    request: Request,
    fork_id: str,
    body: SyncForkRequest | None = None,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Sync a forked document with the latest content from the original."""
    user_id = get_user_id(token)
    if not user_id:
        raise NotFoundError(resource="User", message="Authentication required")

    service = CommunityService(db)
    result = await service.sync_fork(
        fork_id,
        user_id,
        force=body.force if body else False,
        create_backup=body.create_backup if body else False,
    )

    return result


@router.delete("/forks/{fork_id}")
async def delete_fork(
    fork_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Delete a fork record (does not delete the forked file)."""
    user_id = get_user_id(token)
    if not user_id:
        raise NotFoundError(resource="User", message="Authentication required")

    service = CommunityService(db)
    await service.delete_fork(fork_id, user_id)

    return {"status": "deleted", "fork_id": fork_id}


@router.get("/forks")
async def list_forks(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """List current user's forks."""
    user_id = get_user_id(token)
    if not user_id:
        return {"forks": []}

    service = CommunityService(db)
    forks = await service.list_user_forks(user_id, limit, offset)

    return {"forks": forks}


# =============================================================================
# Bookmark Endpoints
# =============================================================================


@router.post("/{share_token}/bookmark")
@limiter.limit("30/minute")
async def toggle_bookmark(
    request: Request,
    share_token: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Toggle bookmark on a shared item."""
    user_id = get_user_id(token)
    if not user_id:
        raise NotFoundError(resource="User", message="Authentication required")

    service = CommunityService(db)
    bookmarked, count = await service.toggle_bookmark(share_token, user_id)

    return {"bookmarked": bookmarked, "bookmark_count": count}


@router.get("/bookmarks")
async def list_bookmarks(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """List current user's bookmarks."""
    user_id = get_user_id(token)
    if not user_id:
        return {"items": [], "total": 0}

    service = CommunityService(db)
    items, total = await service.list_user_bookmarks(user_id, limit, offset)

    return {"items": items, "total": total}


# =============================================================================
# User Profile Endpoints
# =============================================================================


@router.get("/users/{user_id}")
@limiter.limit("60/minute")
async def get_user_profile(
    request: Request,
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    """View a user's public profile."""
    service = CommunityService(db)
    profile = await service.get_public_profile(user_id)

    if not profile:
        raise NotFoundError(resource="User", resource_id=user_id)

    return profile


@router.get("/users/{user_id}/published")
@limiter.limit("60/minute")
async def get_user_published(
    request: Request,
    user_id: str,
    sort: str = Query("newest", pattern="^(newest|popular)$"),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """List a user's published shares."""
    service = CommunityService(db)
    items, total = await service.get_user_published(user_id, limit, offset, sort)

    return {"items": items, "total": total, "has_more": offset + limit < total}
