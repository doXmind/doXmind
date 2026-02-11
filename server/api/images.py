"""Image upload API endpoints (S3-backed)."""

import asyncio
import logging
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.files import get_user_id
from db.database import File, get_db
from exceptions import BadRequestError, ForbiddenError, NotFoundError
from services.auth_service import TokenData, require_auth
from services.storage_service import get_storage_service

logger = logging.getLogger(__name__)
router = APIRouter()

# Allowed image types
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"}
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

# Regex to extract image URLs from HTML content
_IMAGE_URL_PATTERN = re.compile(r'/api/images/([^/]+)/([^"\')\s]+)')


def extract_image_keys_from_content(content: str) -> list[str]:
    """Extract S3 keys from image URLs found in HTML content.

    Finds all occurrences of /api/images/{user_id}/{filename} and
    returns the corresponding S3 keys as ["images/{user_id}/{filename}", ...].
    """
    matches = _IMAGE_URL_PATTERN.findall(content)
    return [f"images/{user_id}/{filename}" for user_id, filename in matches]


async def delete_orphaned_images(
    db: AsyncSession,
    image_keys: list[str],
    exclude_file_ids: list[str] | None = None,
) -> list[str]:
    """Delete images from S3 that are not referenced by any active file.

    For each image key, checks all non-deleted files to see if the image URL
    still appears in any content. Only deletes truly orphaned images.

    Args:
        db: Database session
        image_keys: List of S3 keys to potentially delete
        exclude_file_ids: File IDs being deleted (skip these when checking references)

    Returns:
        List of S3 keys that were actually deleted
    """
    if not image_keys:
        return []

    # Query all active (non-deleted) file contents
    query = select(File.content).where(
        File.deleted_at.is_(None),
        File.is_folder.is_(False),
    )
    if exclude_file_ids:
        query = query.where(File.id.not_in(exclude_file_ids))

    result = await db.execute(query)
    all_contents = result.scalars().all()

    # Combine all content for search
    combined_content = "\n".join(c for c in all_contents if c)

    # Filter to only truly orphaned keys
    orphaned_keys = []
    for key in image_keys:
        # Convert S3 key back to URL pattern for matching
        url = f"/api/{key}"
        if url not in combined_content:
            orphaned_keys.append(key)

    # Batch delete orphaned images from S3
    if orphaned_keys:
        storage = get_storage_service()
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, storage.delete_many, orphaned_keys)
        logger.info(f"Deleted {len(orphaned_keys)} orphaned images from S3")

    return orphaned_keys


@router.post("/upload")
async def upload_image(
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_auth),
):
    """Upload an image file to S3. Returns the URL to access the image."""
    user_id = get_user_id(token) or "shared"

    # Validate content type
    if file.content_type not in ALLOWED_TYPES:
        raise BadRequestError(
            message=f"Invalid file type: {file.content_type}. Allowed: {', '.join(ALLOWED_TYPES)}"
        )

    # Validate extension
    if file.filename:
        ext = Path(file.filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise BadRequestError(
                message=f"Invalid file extension: {ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
            )
    else:
        ext_map = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/gif": ".gif",
            "image/webp": ".webp",
            "image/svg+xml": ".svg",
        }
        ext = ext_map.get(file.content_type, ".png")

    # Read file content
    content = await file.read()

    # Validate file size
    if len(content) > MAX_FILE_SIZE:
        raise BadRequestError(
            message=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024 * 1024)}MB"
        )

    # Generate unique filename and S3 key
    filename = f"{uuid.uuid4().hex}{ext}"
    s3_key = f"images/{user_id}/{filename}"
    content_type = file.content_type or "application/octet-stream"

    # Upload to S3
    storage = get_storage_service()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, storage.upload, s3_key, content, content_type)

    # Return URL path (proxy approach — same URL format as before)
    url = f"/api/images/{user_id}/{filename}"
    logger.info(f"Image uploaded to S3: {url} ({len(content)} bytes)")

    return {"url": url, "filename": filename, "size": len(content)}


@router.get("/{user_id}/{filename}")
async def get_image(user_id: str, filename: str):
    """Serve an uploaded image from S3."""
    # Validate inputs to prevent injection
    if ".." in filename or "/" in filename or "\\" in filename:
        raise BadRequestError(message="Invalid filename")

    if ".." in user_id or "/" in user_id or "\\" in user_id:
        raise BadRequestError(message="Invalid user ID")

    s3_key = f"images/{user_id}/{filename}"

    storage = get_storage_service()
    loop = asyncio.get_event_loop()
    try:
        data, content_type = await loop.run_in_executor(None, storage.download, s3_key)
    except FileNotFoundError:
        raise NotFoundError(message="Image not found")

    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )


@router.delete("/{user_id}/{filename}")
async def delete_image(
    user_id: str,
    filename: str,
    token: TokenData = Depends(require_auth),
):
    """Delete a single image from S3.

    Called when user explicitly removes an image from the editor.
    Only the image owner can delete.
    """
    if ".." in filename or "/" in filename or "\\" in filename:
        raise BadRequestError(message="Invalid filename")

    if ".." in user_id or "/" in user_id or "\\" in user_id:
        raise BadRequestError(message="Invalid user ID")

    # Authorization: ensure the requesting user matches the image's user_id
    request_user_id = get_user_id(token) or "shared"
    if request_user_id != user_id:
        raise ForbiddenError(message="Not authorized to delete this image")

    s3_key = f"images/{user_id}/{filename}"

    storage = get_storage_service()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, storage.delete, s3_key)

    logger.info(f"Image deleted from S3: {s3_key}")
    return {"status": "deleted"}
