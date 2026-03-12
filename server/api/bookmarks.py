"""Bookmark API endpoints for URL unfurling."""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from services.auth_service import TokenData, require_auth
from services.bookmark_service import BookmarkMetadata, unfurl_url

logger = logging.getLogger(__name__)
router = APIRouter()


class UnfurlRequest(BaseModel):
    url: str


@router.post("/unfurl", response_model=BookmarkMetadata)
async def unfurl_bookmark(
    request: UnfurlRequest,
    token: TokenData = Depends(require_auth),
) -> BookmarkMetadata:
    """Fetch metadata from a URL for bookmark preview."""
    logger.info("Unfurling URL: %s", request.url)
    return await unfurl_url(request.url)
