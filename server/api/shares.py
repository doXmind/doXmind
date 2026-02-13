"""Document sharing API endpoints."""

import logging
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import DocumentShare, File, User, get_db
from exceptions import BadRequestError, DocumentNotFoundError, NotFoundError
from middleware.rate_limit import limiter
from services.auth_service import TokenData, require_auth

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


# =============================================================================
# Request/Response Models
# =============================================================================


class CreateShareRequest(BaseModel):
    """Request to create a document share."""

    file_id: str
    expires_in_days: int | None = Field(None, ge=1, le=365)  # 1-365 days or None
    content_mode: str = Field("live", pattern="^(live|snapshot)$")


class ShareResponse(BaseModel):
    """Share information response."""

    id: str
    file_id: str
    share_token: str
    share_url: str  # Frontend URL: /shared/{share_token}
    expires_at: str | None
    is_active: bool
    content_mode: str
    view_count: int
    created_at: str


class ShareListResponse(BaseModel):
    """List of shares for a file."""

    shares: list[ShareResponse]
    count: int


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
    owner_name: str | None = None
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
    """Create a shareable link for a document (owner only)."""
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

    # Create share (V1: only support "live" mode)
    share = DocumentShare(
        file_id=file.id,
        user_id=user_id,
        share_token=share_token,
        expires_at=expires_at,
        content_mode=share_request.content_mode,
    )

    db.add(share)
    await db.commit()
    await db.refresh(share)

    settings = get_settings()
    share_url = f"{settings.frontend_url}/shared/{share_token}"

    return ShareResponse(
        id=share.id,
        file_id=share.file_id,
        share_token=share.share_token,
        share_url=share_url,
        expires_at=share.expires_at.isoformat() if share.expires_at else None,
        is_active=share.is_active,
        content_mode=share.content_mode,
        view_count=share.view_count,
        created_at=share.created_at.isoformat(),
    )


@router.get("/file/{file_id}", response_model=ShareListResponse)
async def list_file_shares(
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

    settings = get_settings()
    share_responses = [
        ShareResponse(
            id=s.id,
            file_id=s.file_id,
            share_token=s.share_token,
            share_url=f"{settings.frontend_url}/shared/{s.share_token}",
            expires_at=s.expires_at.isoformat() if s.expires_at else None,
            is_active=s.is_active,
            content_mode=s.content_mode,
            view_count=s.view_count,
            created_at=s.created_at.isoformat(),
        )
        for s in shares
    ]

    return ShareListResponse(shares=share_responses, count=len(share_responses))


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
):
    """View a shared item - document or folder (public, no authentication required).

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

    # Update view analytics
    share.view_count += 1
    share.last_viewed_at = now
    await db.commit()

    # Load the shared root item
    result = await db.execute(select(File).where(File.id == share.file_id))
    root_file = result.scalar_one_or_none()

    if not root_file:
        raise DocumentNotFoundError(file_id=share.file_id)

    # Look up owner display name
    owner_name = None
    if share.user_id:
        result = await db.execute(select(User.username).where(User.id == share.user_id))
        owner_name = result.scalar_one_or_none()

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
            owner_name=owner_name,
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
            owner_name=owner_name,
            breadcrumbs=breadcrumbs if breadcrumbs else None,
            root_folder_name=root_file.name if path and root_file.is_folder else None,
        )
