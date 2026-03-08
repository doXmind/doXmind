"""Document sharing API endpoints."""

import asyncio
import logging
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import (
    DocumentShare,
    File,
    ShareInvite,
    ShareView,
    User,
    UserSubscription,
    get_db,
    utcnow,
)
from exceptions import (
    BadRequestError,
    DocumentNotFoundError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
)
from middleware.rate_limit import limiter
from services.auth_service import TokenData, optional_auth, require_auth

logger = logging.getLogger(__name__)
router = APIRouter()


def get_user_id(token: TokenData) -> str | None:
    """Get user ID from token for data isolation.

    Returns None only for special dev/api-key users (which share data).
    Real users always get their user_id for proper isolation.
    """
    # Special token types share data (no user isolation)
    if token.sub in ("dev-user", "api-key-user", "anonymous"):
        return None

    return token.sub


# Allowed frontend origins for share link generation
_ALLOWED_ORIGINS = {
    "https://app.doxmind.com",
    "https://cn.doxmind.com",
    "http://localhost:3000",
}


def get_frontend_url(request: Request) -> str:
    """Resolve frontend URL from request origin, falling back to config."""
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") in _ALLOWED_ORIGINS:
        return origin.rstrip("/")

    referer = request.headers.get("referer")
    if referer:
        parsed = urlparse(referer)
        base = f"{parsed.scheme}://{parsed.netloc}"
        if base in _ALLOWED_ORIGINS:
            return base

    return get_settings().frontend_url


async def _send_invite_notifications(
    recipient_emails: list[str],
    sender_name: str,
    item_name: str,
    item_type: str,
    share_url: str,
) -> None:
    """Send share notification emails to invited users (fire-and-forget)."""
    try:
        from services.email_service import get_email_service

        email_service = get_email_service()
        for email in recipient_emails:
            await email_service.send_share_notification(
                to_email=email,
                sender_name=sender_name,
                item_name=item_name,
                item_type=item_type,
                share_url=share_url,
            )
    except Exception:
        logger.exception("Failed to send share notification emails")


# =============================================================================
# Request/Response Models
# =============================================================================


class CreateShareRequest(BaseModel):
    """Request to create a document share."""

    file_id: str
    expires_in_days: int | None = Field(None, ge=1, le=365)  # 1-365 days or None
    content_mode: str = Field("live", pattern="^(live|snapshot)$")
    visibility: str = Field("public", pattern="^(public|private)$")
    allow_fork: bool = True
    # Public mode — community metadata (auto-published)
    title: str | None = None
    description: str | None = Field(None, max_length=500)
    tags: list[str] | None = Field(None, max_length=10)
    # Private mode — invite list
    invited_user_ids: list[str] | None = None
    invited_emails: list[str] | None = None


class ShareResponse(BaseModel):
    """Share information response."""

    id: str
    file_id: str
    file_name: str | None = None
    share_token: str
    share_url: str  # Frontend URL: /shared/{share_token} or /community/{share_token}
    expires_at: str | None
    is_active: bool
    is_published: bool
    visibility: str = "public"
    allow_fork: bool = True
    title: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    content_mode: str
    view_count: int
    created_at: str


class ShareListResponse(BaseModel):
    """List of shares for a file."""

    shares: list[ShareResponse]
    count: int
    total: int | None = None


class SharedDocumentResponse(BaseModel):
    """Public document view response (legacy, kept for compatibility)."""

    name: str
    content: str
    created_at: str
    updated_at: str
    is_snapshot: bool
    owner_name: str | None = None  # Optional, redacted for privacy


class SharedFolderItem(BaseModel):
    """An item in a shared folder listing."""

    id: str
    name: str
    is_folder: bool
    icon: str | None = None
    updated_at: str
    created_at: str


class SharedItemResponse(BaseModel):
    """Unified public response for shared items (document or folder)."""

    name: str
    is_folder: bool
    created_at: str
    updated_at: str
    is_snapshot: bool
    visibility: str | None = None
    owner_name: str | None = None
    owner_avatar_url: str | None = None
    owner_avatar_frame: str | None = None
    # Document fields (present when is_folder=False)
    content: str | None = None
    # Folder fields (present when is_folder=True)
    items: list[SharedFolderItem] | None = None
    breadcrumbs: list[SharedFolderItem] | None = None
    root_folder_name: str | None = None


# =============================================================================
# Authenticated Endpoints (Document Owners)
# =============================================================================


@router.post("/", response_model=ShareResponse)
@limiter.limit("10/minute")  # Prevent abuse
async def create_share(
    request: Request,
    share_request: CreateShareRequest,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Create a shareable link for a document (owner only).

    visibility="public" auto-publishes to community.
    visibility="private" creates invite-only share with specified users.
    """
    user_id = get_user_id(token)

    # Verify file exists, belongs to user, and is not in trash
    query = select(File).where(File.id == share_request.file_id, File.deleted_at.is_(None))
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise DocumentNotFoundError(file_id=share_request.file_id)

    # Folder shares only support "live" mode (snapshot would be complex)
    if file.is_folder and share_request.content_mode != "live":
        raise BadRequestError(message="Folder shares only support 'live' content mode")

    # Generate cryptographically secure token
    share_token = secrets.token_urlsafe(32)

    # Calculate expiration
    expires_at = None
    if share_request.expires_in_days:
        expires_at = datetime.now(UTC) + timedelta(days=share_request.expires_in_days)

    # Build share object
    share = DocumentShare(
        file_id=file.id,
        user_id=user_id,
        share_token=share_token,
        expires_at=expires_at,
        content_mode=share_request.content_mode,
        visibility=share_request.visibility,
        allow_fork=share_request.allow_fork,
    )

    if share_request.visibility == "public":
        # Auto-publish to community
        share.is_published = True
        share.published_at = utcnow()
        share.title = share_request.title or file.name
        share.description = share_request.description
        if share_request.tags:
            normalized = list(
                dict.fromkeys(t.strip().lower() for t in share_request.tags if t.strip())
            )
            share.tags = normalized[:10] if normalized else None
    else:
        # Private share — not published
        share.is_published = False

    db.add(share)
    await db.flush()  # Get share.id before creating invites

    # Create invites for private shares
    if share_request.visibility == "private":
        invited_ids = set(share_request.invited_user_ids or [])

        # Resolve emails to user IDs
        if share_request.invited_emails:
            email_result = await db.execute(
                select(User.id).where(
                    User.email.in_(share_request.invited_emails),
                    User.is_active == True,  # noqa: E712
                )
            )
            for row in email_result:
                invited_ids.add(row.id)

        # Create invite records (skip self-invites)
        for uid in invited_ids:
            if uid == user_id:
                continue
            invite = ShareInvite(
                share_id=share.id,
                user_id=uid,
                invited_by=user_id,
            )
            db.add(invite)

        # Collect recipient emails for notification
        notif_ids = invited_ids - {user_id}
        if notif_ids:
            _notif_q = await db.execute(
                select(User.email).where(User.id.in_(notif_ids), User.email.isnot(None))
            )
            _recipient_emails = [r.email for r in _notif_q if r.email]
        else:
            _recipient_emails = []

    await db.commit()
    await db.refresh(share)

    frontend_url = get_frontend_url(request)
    if share.visibility == "public":
        share_url = f"{frontend_url}/community/{share_token}"
    else:
        share_url = f"{frontend_url}/shared/{share_token}"

    # Send email notifications for private share invites
    sender_name = token.username or "A doXmind user"
    if share_request.visibility == "private" and _recipient_emails:
        asyncio.create_task(
            _send_invite_notifications(
                recipient_emails=_recipient_emails,
                sender_name=sender_name,
                item_name=file.name,
                item_type="folder" if file.is_folder else "file",
                share_url=share_url,
            )
        )

    # In-app notifications for private share invites
    if share_request.visibility == "private":
        from services.notification_service import create_notification

        notif_ids = invited_ids - {user_id}
        for uid in notif_ids:
            asyncio.create_task(
                create_notification(
                    user_id=uid,
                    type="share_invite",
                    title=sender_name,
                    message=f'{sender_name} shared "{file.name}" with you',
                    link=f"/shared/{share_token}",
                    actor_id=user_id,
                    actor_name=sender_name,
                )
            )

    return ShareResponse(
        id=share.id,
        file_id=share.file_id,
        share_token=share.share_token,
        share_url=share_url,
        expires_at=share.expires_at.isoformat() if share.expires_at else None,
        is_active=share.is_active,
        is_published=share.is_published,
        visibility=share.visibility,
        allow_fork=share.allow_fork,
        title=share.title,
        description=share.description,
        tags=share.tags,
        content_mode=share.content_mode,
        view_count=share.view_count,
        created_at=share.created_at.isoformat(),
    )


@router.get("/file/{file_id}", response_model=ShareListResponse)
async def list_file_shares(
    request: Request,
    file_id: str,
    include_expired: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """List all shares for a specific file (owner only)."""
    user_id = get_user_id(token)

    # Verify ownership (exclude trash)
    query = select(File).where(File.id == file_id, File.deleted_at.is_(None))
    query = query.where(File.user_id == user_id) if user_id else query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise DocumentNotFoundError(file_id=file_id)

    # Get shares
    query = select(DocumentShare).where(DocumentShare.file_id == file_id)

    if not include_expired:
        # Filter to active and non-expired shares
        now = datetime.now(UTC)
        query = query.where(
            and_(
                DocumentShare.is_active == True,  # noqa: E712
                or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
            )
        )

    query = query.order_by(DocumentShare.created_at.desc())

    result = await db.execute(query)
    shares = result.scalars().all()

    frontend_url = get_frontend_url(request)
    share_responses = [
        ShareResponse(
            id=s.id,
            file_id=s.file_id,
            share_token=s.share_token,
            share_url=(
                f"{frontend_url}/community/{s.share_token}"
                if s.visibility == "public"
                else f"{frontend_url}/shared/{s.share_token}"
            ),
            expires_at=s.expires_at.isoformat() if s.expires_at else None,
            is_active=s.is_active,
            is_published=s.is_published,
            visibility=s.visibility or "public",
            allow_fork=s.allow_fork,
            content_mode=s.content_mode,
            view_count=s.view_count,
            created_at=s.created_at.isoformat(),
        )
        for s in shares
    ]

    return ShareListResponse(shares=share_responses, count=len(share_responses))


@router.get("/my", response_model=ShareListResponse)
async def list_my_shares(
    request: Request,
    offset: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """List all shares created by the current user."""
    user_id = get_user_id(token)

    now = datetime.now(UTC)
    where_clause = [
        DocumentShare.user_id == user_id if user_id else DocumentShare.user_id.is_(None),
        DocumentShare.is_active == True,  # noqa: E712
        or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
    ]

    # Total count (before pagination)
    count_result = await db.execute(
        select(func.count()).select_from(DocumentShare).where(*where_clause)
    )
    total_count = count_result.scalar() or 0

    query = (
        select(DocumentShare)
        .where(*where_clause)
        .order_by(DocumentShare.created_at.desc())
        .offset(offset)
        .limit(limit)
    )

    result = await db.execute(query)
    shares = result.scalars().all()

    # Load file names for each share
    file_ids = [s.file_id for s in shares]
    file_names: dict[str, str] = {}
    if file_ids:
        file_result = await db.execute(select(File.id, File.name).where(File.id.in_(file_ids)))
        file_names = {row.id: row.name for row in file_result}

    frontend_url = get_frontend_url(request)
    share_responses = [
        ShareResponse(
            id=s.id,
            file_id=s.file_id,
            file_name=file_names.get(s.file_id, "Unknown"),
            share_token=s.share_token,
            share_url=(
                f"{frontend_url}/community/{s.share_token}"
                if s.visibility == "public"
                else f"{frontend_url}/shared/{s.share_token}"
            ),
            expires_at=s.expires_at.isoformat() if s.expires_at else None,
            is_active=s.is_active,
            is_published=s.is_published,
            visibility=s.visibility or "public",
            title=s.title,
            description=s.description,
            tags=s.tags,
            allow_fork=s.allow_fork,
            content_mode=s.content_mode,
            view_count=s.view_count,
            created_at=s.created_at.isoformat(),
        )
        for s in shares
    ]

    return ShareListResponse(shares=share_responses, count=len(share_responses), total=total_count)


# =============================================================================
# User Search for Invites (must be before /{share_id} routes)
# =============================================================================


@router.get("/search-users")
async def search_users_for_invite(
    q: str = Query(..., min_length=1, max_length=100),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Search users by username or email for invite autocomplete."""
    search_term = f"%{q}%"

    result = await db.execute(
        select(
            User.id, User.username, User.email, User.avatar_url,
            User.avatar_frame.label("user_avatar_frame"),
            UserSubscription.plan.label("user_plan"),
        )
        .outerjoin(UserSubscription, UserSubscription.user_id == User.id)
        .where(
            User.is_active == True,  # noqa: E712
            or_(
                User.username.ilike(search_term),
                User.email.ilike(search_term),
            ),
        )
        .limit(10)
    )
    rows = result.all()

    # Exclude self
    current_user_id = get_user_id(token)
    users = [
        {
            "id": row.id,
            "username": row.username,
            "email": row.email,
            "avatar_url": row.avatar_url,
            "avatar_frame": row.user_avatar_frame,
            "plan": row.user_plan or "free",
        }
        for row in rows
        if row.id != current_user_id
    ]

    return {"users": users}


# =============================================================================
# Shared With Me (must be before /{share_id} routes)
# =============================================================================


@router.get("/shared-with-me")
async def list_shared_with_me(
    request: Request,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """List private shares where the current user has been invited."""
    user_id = get_user_id(token)
    if not user_id:
        return {"shares": [], "count": 0}

    now = datetime.now(UTC)

    query = (
        select(
            DocumentShare.id,
            DocumentShare.share_token,
            DocumentShare.title,
            DocumentShare.created_at,
            DocumentShare.updated_at,
            DocumentShare.view_count,
            File.name.label("file_name"),
            File.is_folder,
            User.id.label("owner_id"),
            User.username.label("owner_name"),
            User.avatar_url.label("owner_avatar_url"),
            User.avatar_frame.label("owner_avatar_frame"),
            ShareInvite.created_at.label("invited_at"),
        )
        .join(ShareInvite, ShareInvite.share_id == DocumentShare.id)
        .join(File, DocumentShare.file_id == File.id)
        .join(User, DocumentShare.user_id == User.id)
        .where(
            ShareInvite.user_id == user_id,
            DocumentShare.is_active == True,  # noqa: E712
            DocumentShare.visibility == "private",
            or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
        )
        .order_by(ShareInvite.created_at.desc())
        .limit(50)
    )

    result = await db.execute(query)
    rows = result.all()

    frontend_url = get_frontend_url(request)
    shares = [
        {
            "share_id": row.id,
            "share_token": row.share_token,
            "title": row.title or row.file_name,
            "share_url": f"{frontend_url}/shared/{row.share_token}",
            "is_folder": row.is_folder,
            "view_count": row.view_count,
            "owner": {
                "id": row.owner_id,
                "username": row.owner_name,
                "avatar_url": row.owner_avatar_url,
                "avatar_frame": row.owner_avatar_frame,
            },
            "invited_at": row.invited_at.isoformat() if row.invited_at else "",
            "created_at": row.created_at.isoformat() if row.created_at else "",
            "updated_at": row.updated_at.isoformat() if row.updated_at else "",
        }
        for row in rows
    ]

    return {"shares": shares, "count": len(shares)}


@router.delete("/{share_id}")
async def revoke_share(
    share_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Revoke a share (deactivate, owner only)."""
    user_id = get_user_id(token)

    # Get share and verify ownership
    query = select(DocumentShare).where(DocumentShare.id == share_id)
    if user_id:
        query = query.where(DocumentShare.user_id == user_id)
    else:
        query = query.where(DocumentShare.user_id.is_(None))

    result = await db.execute(query)
    share = result.scalar_one_or_none()

    if not share:
        raise NotFoundError(resource="Share", resource_id=share_id)

    # Deactivate (soft delete)
    share.is_active = False
    share.updated_at = datetime.now(UTC)

    await db.commit()

    return {"status": "revoked", "share_id": share_id}


# =============================================================================
# Community Publishing
# =============================================================================


class PublishRequest(BaseModel):
    """Request to publish a share to the community."""

    title: str | None = None
    description: str | None = Field(None, max_length=500)
    tags: list[str] | None = Field(None, max_length=10)


@router.post("/{share_id}/publish")
@limiter.limit("10/minute")
async def publish_share(
    request: Request,
    share_id: str,
    body: PublishRequest,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Publish a share to the community discovery page."""
    from services.community_service import CommunityService

    user_id = get_user_id(token)
    if not user_id:
        raise BadRequestError(message="Authentication required")

    service = CommunityService(db)
    share = await service.publish_share(
        share_id=share_id,
        user_id=user_id,
        title=body.title,
        description=body.description,
        tags=body.tags,
    )

    frontend_url = get_frontend_url(request)
    share_url = f"{frontend_url}/community/{share.share_token}"

    # Notify followers of the new publication (fire-and-forget)
    asyncio.create_task(
        _notify_followers_of_publish(
            publisher_id=user_id,
            publisher_name=token.username or "A doXmind user",
            share_title=share.title or "Untitled",
            share_url=share_url,
        )
    )

    return {
        "id": share.id,
        "file_id": share.file_id,
        "share_token": share.share_token,
        "share_url": share_url,
        "is_published": share.is_published,
        "visibility": share.visibility,
        "title": share.title,
        "description": share.description,
        "tags": share.tags,
        "published_at": share.published_at.isoformat() if share.published_at else None,
    }


@router.post("/{share_id}/unpublish")
@limiter.limit("10/minute")
async def unpublish_share(
    request: Request,
    share_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Remove a share from the community discovery page."""
    from services.community_service import CommunityService

    user_id = get_user_id(token)
    if not user_id:
        raise BadRequestError(message="Authentication required")

    service = CommunityService(db)
    share = await service.unpublish_share(share_id=share_id, user_id=user_id)

    return {"status": "unpublished", "share_id": share.id, "is_published": False}


class UpdateShareMetadataRequest(BaseModel):
    """Request to update metadata on a published share."""

    title: str | None = None
    description: str | None = Field(None, max_length=500)
    tags: list[str] | None = Field(None, max_length=10)
    allow_fork: bool | None = None


@router.patch("/{share_id}/metadata")
@limiter.limit("20/minute")
async def update_share_metadata(
    request: Request,
    share_id: str,
    body: UpdateShareMetadataRequest,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Update title, description, and tags on a published share."""
    from services.community_service import CommunityService

    user_id = get_user_id(token)
    if not user_id:
        raise BadRequestError(message="Authentication required")

    service = CommunityService(db)
    share = await service.update_share_metadata(
        share_id=share_id,
        user_id=user_id,
        title=body.title,
        description=body.description,
        tags=body.tags,
        allow_fork=body.allow_fork,
    )

    return {
        "id": share.id,
        "share_token": share.share_token,
        "title": share.title,
        "description": share.description,
        "tags": share.tags,
        "allow_fork": share.allow_fork,
        "updated_at": share.updated_at.isoformat() if share.updated_at else None,
    }


# =============================================================================
# Shared Folder Helpers
# =============================================================================


async def is_descendant_of(db: AsyncSession, file_id: str, ancestor_id: str) -> bool:
    """Check if file_id is a descendant of ancestor_id in the folder tree."""
    current_id = file_id
    visited: set[str] = set()
    while current_id is not None:
        if current_id == ancestor_id:
            return True
        if current_id in visited:
            return False  # Cycle detection
        visited.add(current_id)
        result = await db.execute(select(File.parent_id).where(File.id == current_id))
        parent = result.scalar_one_or_none()
        current_id = parent
    return False


async def get_breadcrumbs(db: AsyncSession, file_id: str, root_id: str) -> list[SharedFolderItem]:
    """Build breadcrumb trail from shared root down to file_id."""
    chain: list[SharedFolderItem] = []
    current_id = file_id

    while current_id is not None and current_id != root_id:
        result = await db.execute(
            select(
                File.id,
                File.name,
                File.is_folder,
                File.icon,
                File.parent_id,
                File.updated_at,
                File.created_at,
            ).where(File.id == current_id)
        )
        row = result.one_or_none()
        if not row:
            break
        chain.append(
            SharedFolderItem(
                id=row.id,
                name=row.name,
                is_folder=row.is_folder,
                icon=row.icon,
                updated_at=row.updated_at.isoformat(),
                created_at=row.created_at.isoformat(),
            )
        )
        current_id = row.parent_id

    chain.reverse()  # Root-first order
    return chain


# =============================================================================
# Public Endpoint (Unauthenticated)
# =============================================================================


@router.get("/public/{share_token}", response_model=SharedItemResponse)
@limiter.limit("60/minute")  # Rate limit to prevent scraping
async def view_shared_item(
    request: Request,
    share_token: str,
    path: str | None = Query(None, description="Subfolder or file ID within shared folder"),
    db: AsyncSession = Depends(get_db),
    token: TokenData | None = Depends(optional_auth),
):
    """View a shared item - document or folder.

    Public shares are accessible without authentication.
    Private shares require authentication and an invite.
    For folder shares, use the `path` query parameter to navigate into subfolders
    or view individual files within the shared tree.
    """
    now = datetime.now(UTC)

    # Find active, non-expired share
    query = select(DocumentShare).where(
        and_(
            DocumentShare.share_token == share_token,
            DocumentShare.is_active == True,  # noqa: E712
            or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
        )
    )

    result = await db.execute(query)
    share = result.scalar_one_or_none()

    if not share:
        raise NotFoundError(resource="Share", message="Share not found or expired")

    # Access control for private shares
    if share.visibility == "private":
        if not token:
            raise UnauthorizedError(message="Authentication required")
        viewer_id = token.sub
        # Owner can always access
        if viewer_id != share.user_id:
            invite_result = await db.execute(
                select(ShareInvite.id).where(
                    ShareInvite.share_id == share.id,
                    ShareInvite.user_id == viewer_id,
                )
            )
            if not invite_result.scalar_one_or_none():
                raise ForbiddenError(message="You do not have access to this share")

    # Update view analytics
    share.view_count += 1
    share.last_viewed_at = now

    # Record per-user view for authenticated users (for recommendations)
    viewer_id = token.sub if token else None
    if viewer_id and viewer_id != share.user_id:
        existing_view = await db.execute(
            select(ShareView).where(ShareView.user_id == viewer_id, ShareView.share_id == share.id)
        )
        view_record = existing_view.scalar_one_or_none()
        if view_record:
            view_record.created_at = now
        else:
            db.add(ShareView(share_id=share.id, user_id=viewer_id))

    await db.commit()

    # Load the shared root item
    result = await db.execute(select(File).where(File.id == share.file_id))
    root_file = result.scalar_one_or_none()

    if not root_file:
        raise DocumentNotFoundError(file_id=share.file_id)

    # Look up owner display name and avatar
    owner_name = None
    owner_avatar_url = None
    owner_avatar_frame = None
    if share.user_id:
        result = await db.execute(
            select(User.username, User.avatar_url, User.avatar_frame).where(
                User.id == share.user_id
            )
        )
        row = result.one_or_none()
        if row:
            owner_name = row.username
            owner_avatar_url = row.avatar_url
            owner_avatar_frame = row.avatar_frame

    # Determine the target item (root or navigated-to child)
    target_file = root_file
    if path:
        # Navigating within a shared folder — validate ancestry
        if not root_file.is_folder:
            raise BadRequestError(message="Cannot use path parameter on a document share")

        result = await db.execute(select(File).where(File.id == path, File.deleted_at.is_(None)))
        target_file = result.scalar_one_or_none()

        if not target_file:
            raise NotFoundError(resource="File", message="Item not found in shared folder")

        # Security: verify the target is a descendant of the shared root
        if target_file.id != root_file.id and not await is_descendant_of(
            db, target_file.id, root_file.id
        ):
            raise NotFoundError(resource="File", message="Item not found in shared folder")

    # Return folder listing or document content
    if target_file.is_folder:
        # Query children of this folder
        children_query = (
            select(File)
            .where(
                File.parent_id == target_file.id,
                File.deleted_at.is_(None),
            )
            .order_by(File.is_folder.desc(), File.position.asc(), File.updated_at.desc())
        )
        result = await db.execute(children_query)
        children = result.scalars().all()

        items = [
            SharedFolderItem(
                id=child.id,
                name=child.name,
                is_folder=child.is_folder,
                icon=child.icon,
                updated_at=child.updated_at.isoformat(),
                created_at=child.created_at.isoformat(),
            )
            for child in children
        ]

        # Build breadcrumbs (from root to current folder, excluding root itself)
        breadcrumbs = []
        if target_file.id != root_file.id:
            breadcrumbs = await get_breadcrumbs(db, target_file.id, root_file.id)

        return SharedItemResponse(
            name=target_file.name,
            is_folder=True,
            created_at=target_file.created_at.isoformat(),
            updated_at=target_file.updated_at.isoformat(),
            is_snapshot=False,
            visibility=share.visibility,
            owner_name=owner_name,
            owner_avatar_url=owner_avatar_url,
            owner_avatar_frame=owner_avatar_frame,
            items=items,
            breadcrumbs=breadcrumbs,
            root_folder_name=root_file.name if target_file.id != root_file.id else None,
        )
    else:
        # Document view
        # Build breadcrumbs if this document is inside a shared folder
        breadcrumbs = []
        if path and root_file.is_folder:
            breadcrumbs = await get_breadcrumbs(db, target_file.id, root_file.id)

        return SharedItemResponse(
            name=target_file.name,
            is_folder=False,
            content=target_file.content,
            created_at=target_file.created_at.isoformat(),
            updated_at=target_file.updated_at.isoformat(),
            is_snapshot=False,
            visibility=share.visibility,
            owner_name=owner_name,
            owner_avatar_url=owner_avatar_url,
            owner_avatar_frame=owner_avatar_frame,
            breadcrumbs=breadcrumbs if breadcrumbs else None,
            root_folder_name=root_file.name if path and root_file.is_folder else None,
        )


# =============================================================================
# Invite Management (Phase 2B)
# =============================================================================


class InviteRequest(BaseModel):
    """Request to invite users to a private share."""

    user_ids: list[str] | None = None
    emails: list[str] | None = None


class InviteResponse(BaseModel):
    """Single invite entry."""

    id: str
    user_id: str
    username: str | None = None
    email: str | None = None
    avatar_url: str | None = None
    created_at: str


@router.post("/{share_id}/invite")
@limiter.limit("20/minute")
async def invite_users(
    request: Request,
    share_id: str,
    body: InviteRequest,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Invite users to a private share (owner only)."""
    user_id = get_user_id(token)

    # Verify ownership
    result = await db.execute(
        select(DocumentShare).where(DocumentShare.id == share_id, DocumentShare.user_id == user_id)
    )
    share = result.scalar_one_or_none()
    if not share:
        raise NotFoundError(resource="Share", resource_id=share_id)

    if share.visibility != "private":
        raise BadRequestError(message="Invites are only supported for private shares")

    # Load file info for notification email
    file_result = await db.execute(
        select(File.name, File.is_folder).where(File.id == share.file_id)
    )
    file_info = file_result.one_or_none()

    invited_ids = set(body.user_ids or [])

    # Resolve emails to user IDs
    if body.emails:
        email_result = await db.execute(
            select(User.id).where(
                User.email.in_(body.emails),
                User.is_active == True,  # noqa: E712
            )
        )
        for row in email_result:
            invited_ids.add(row.id)

    # Get existing invites to avoid duplicates
    existing_result = await db.execute(
        select(ShareInvite.user_id).where(ShareInvite.share_id == share_id)
    )
    existing_ids = {row.user_id for row in existing_result}

    added = 0
    for uid in invited_ids:
        if uid == user_id or uid in existing_ids:
            continue
        invite = ShareInvite(
            share_id=share_id,
            user_id=uid,
            invited_by=user_id,
        )
        db.add(invite)
        added += 1

    # Collect emails of newly invited users
    new_invite_ids = invited_ids - existing_ids - {user_id}
    recipient_emails: list[str] = []
    if new_invite_ids:
        _notif_q = await db.execute(
            select(User.email).where(User.id.in_(new_invite_ids), User.email.isnot(None))
        )
        recipient_emails = [r.email for r in _notif_q if r.email]

    await db.commit()

    # Send email notifications to newly invited users
    sender_name = token.username or "A doXmind user"
    if recipient_emails and file_info:
        frontend_url = get_frontend_url(request)
        share_url = f"{frontend_url}/shared/{share.share_token}"
        asyncio.create_task(
            _send_invite_notifications(
                recipient_emails=recipient_emails,
                sender_name=sender_name,
                item_name=file_info.name,
                item_type="folder" if file_info.is_folder else "file",
                share_url=share_url,
            )
        )

    # In-app notifications for newly invited users
    if new_invite_ids and file_info:
        from services.notification_service import create_notification

        for uid in new_invite_ids:
            asyncio.create_task(
                create_notification(
                    user_id=uid,
                    type="share_invite",
                    title=sender_name,
                    message=f'{sender_name} shared "{file_info.name}" with you',
                    link=f"/shared/{share.share_token}",
                    actor_id=user_id,
                    actor_name=sender_name,
                )
            )

    return {"status": "ok", "added": added}


@router.delete("/{share_id}/invite/{invite_user_id}")
async def remove_invite(
    share_id: str,
    invite_user_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Remove a user's access from a private share (owner only)."""
    user_id = get_user_id(token)

    # Verify ownership
    result = await db.execute(
        select(DocumentShare).where(DocumentShare.id == share_id, DocumentShare.user_id == user_id)
    )
    if not result.scalar_one_or_none():
        raise NotFoundError(resource="Share", resource_id=share_id)

    # Delete invite
    invite_result = await db.execute(
        select(ShareInvite).where(
            ShareInvite.share_id == share_id,
            ShareInvite.user_id == invite_user_id,
        )
    )
    invite = invite_result.scalar_one_or_none()
    if not invite:
        raise NotFoundError(resource="Invite", message="Invite not found")

    await db.delete(invite)
    await db.commit()
    return {"status": "removed"}


@router.get("/{share_id}/invites")
async def list_invites(
    share_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """List invited users for a share (owner only)."""
    user_id = get_user_id(token)

    # Verify ownership
    result = await db.execute(
        select(DocumentShare).where(DocumentShare.id == share_id, DocumentShare.user_id == user_id)
    )
    if not result.scalar_one_or_none():
        raise NotFoundError(resource="Share", resource_id=share_id)

    # Get invites with user info
    query = (
        select(
            ShareInvite.id,
            ShareInvite.user_id,
            ShareInvite.created_at,
            User.username,
            User.email,
            User.avatar_url,
        )
        .join(User, ShareInvite.user_id == User.id)
        .where(ShareInvite.share_id == share_id)
        .order_by(ShareInvite.created_at.desc())
    )

    result = await db.execute(query)
    rows = result.all()

    invites = [
        InviteResponse(
            id=row.id,
            user_id=row.user_id,
            username=row.username,
            email=row.email,
            avatar_url=row.avatar_url,
            created_at=row.created_at.isoformat() if row.created_at else "",
        )
        for row in rows
    ]

    return {"invites": invites, "count": len(invites)}


# =============================================================================
# Follow Notification Helpers
# =============================================================================


async def _notify_followers_of_publish(
    publisher_id: str,
    publisher_name: str,
    share_title: str,
    share_url: str,
) -> None:
    """Send email and in-app notifications to all followers when a user publishes."""
    try:
        from db.database import UserFollow, async_session

        async with async_session() as session:
            # Get all followers' emails and IDs
            result = await session.execute(
                select(User.id, User.email)
                .join(UserFollow, UserFollow.follower_id == User.id)
                .where(
                    UserFollow.following_id == publisher_id,
                )
            )
            followers = result.all()

            if not followers:
                return

            # Extract share_token from share_url for the link
            share_token = share_url.rsplit("/", 1)[-1] if share_url else ""

            # Create in-app notifications for all followers
            from services.notification_service import NotificationService

            notif_service = NotificationService(session)
            for row in followers:
                await notif_service.create(
                    user_id=row.id,
                    type="publication",
                    title=publisher_name,
                    message=f'{publisher_name} published "{share_title}"',
                    link=f"/community/{share_token}",
                    actor_id=publisher_id,
                    actor_name=publisher_name,
                )

            emails = [row.email for row in followers if row.email]
            if not emails:
                return

            from services.email_service import get_email_service

            email_service = get_email_service()
            for email in emails:
                try:
                    await email_service.send_new_publication_notification(
                        to_email=email,
                        author_name=publisher_name,
                        doc_title=share_title,
                        share_url=share_url,
                    )
                except Exception:
                    logger.exception(f"Failed to send publish notification to {email}")
    except Exception:
        logger.exception("Failed to send follower publish notifications")
