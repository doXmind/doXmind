"""Document sharing API endpoints."""

import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import DocumentShare, File, get_db
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
    expires_in_days: Optional[int] = Field(None, ge=1, le=365)  # 1-365 days or None
    content_mode: str = Field("live", pattern="^(live|snapshot)$")


class ShareResponse(BaseModel):
    """Share information response."""

    id: str
    file_id: str
    share_token: str
    share_url: str  # Frontend URL: /shared/{share_token}
    expires_at: Optional[str]
    is_active: bool
    content_mode: str
    view_count: int
    created_at: str


class ShareListResponse(BaseModel):
    """List of shares for a file."""

    shares: list[ShareResponse]
    count: int


class SharedDocumentResponse(BaseModel):
    """Public document view response."""

    name: str
    content: str
    created_at: str
    updated_at: str
    is_snapshot: bool
    owner_name: Optional[str] = None  # Optional, redacted for privacy


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

    # Verify file exists and belongs to user
    query = select(File).where(File.id == share_request.file_id)
    if user_id:
        query = query.where(File.user_id == user_id)
    else:
        query = query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found or you don't have permission",
        )

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

    # Verify ownership
    query = select(File).where(File.id == file_id)
    if user_id:
        query = query.where(File.user_id == user_id)
    else:
        query = query.where(File.user_id.is_(None))

    result = await db.execute(query)
    file = result.scalar_one_or_none()

    if not file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="File not found"
        )

    # Get shares
    query = select(DocumentShare).where(DocumentShare.file_id == file_id)

    if not include_expired:
        # Filter to active and non-expired shares
        now = datetime.now(UTC)
        query = query.where(
            and_(
                DocumentShare.is_active == True,  # noqa: E712
                or_(
                    DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now
                ),
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Share not found"
        )

    # Deactivate (soft delete)
    share.is_active = False
    share.updated_at = datetime.now(UTC)

    await db.commit()

    return {"status": "revoked", "share_id": share_id}


# =============================================================================
# Public Endpoint (Unauthenticated)
# =============================================================================


@router.get("/public/{share_token}", response_model=SharedDocumentResponse)
@limiter.limit("60/minute")  # Rate limit to prevent scraping
async def view_shared_document(
    request: Request,
    share_token: str,
    db: AsyncSession = Depends(get_db),
):
    """View a shared document (public, no authentication required)."""
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Share not found or expired",
        )

    # Update view analytics
    share.view_count += 1
    share.last_viewed_at = now
    await db.commit()

    # Get document content (V1: only support "live" mode)
    result = await db.execute(select(File).where(File.id == share.file_id))
    file = result.scalar_one_or_none()

    if not file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Original document no longer exists",
        )

    return SharedDocumentResponse(
        name=file.name,
        content=file.content,
        created_at=file.created_at.isoformat(),
        updated_at=file.updated_at.isoformat(),
        is_snapshot=False,  # V1: always live
        owner_name=None,  # Privacy: don't expose owner info
    )
