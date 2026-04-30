"""Local image upload API endpoints."""

import asyncio
import logging
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import File
from exceptions import BadRequestError, NotFoundError
from services.storage_service import get_storage_service

logger = logging.getLogger(__name__)
router = APIRouter()

# Allowed image types
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"}
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

# Regex to extract image URLs from HTML content. Allows an optional legacy
# user_id segment (pre-slim URLs were /api/images/{user_id}/{filename}) so
# orphan cleanup still finds matches in older documents.
_IMAGE_URL_PATTERN = re.compile(r'/api/images/([^"\')\s]+)')


def extract_image_keys_from_content(content: str) -> list[str]:
    """Extract local storage keys from image URLs found in HTML content.

    Returns storage keys of the form "images/{...}". Defensively skips any
    captured value with path-traversal segments or absolute paths;
    LocalStorageService._resolve also enforces this, but rejecting at
    extraction keeps such inputs out of the orphan-cleanup pipeline entirely.
    """
    keys: list[str] = []
    for captured in _IMAGE_URL_PATTERN.findall(content):
        if captured.startswith("/") or "\\" in captured:
            continue
        if any(segment in {"..", ""} for segment in captured.split("/")):
            continue
        keys.append(f"images/{captured}")
    return keys


async def delete_orphaned_images(
    db: AsyncSession,
    image_keys: list[str],
    exclude_file_ids: list[str] | None = None,
) -> list[str]:
    """Delete local images that are not referenced by any active file.

    For each image key, checks all non-deleted files to see if the image URL
    still appears in any content. Only deletes truly orphaned images.

    Args:
        db: Database session
        image_keys: List of storage keys to potentially delete
        exclude_file_ids: File IDs being deleted (skip these when checking references)

    Returns:
        List of storage keys that were actually deleted
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
        # Convert storage key back to URL pattern for matching
        url = f"/api/{key}"
        if url not in combined_content:
            orphaned_keys.append(key)

    # Batch delete orphaned images from local storage.
    if orphaned_keys:
        storage = get_storage_service()
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, storage.delete_many, orphaned_keys)
        logger.info(f"Deleted {len(orphaned_keys)} orphaned images")

    return orphaned_keys


@router.post("/upload")
async def upload_image(
    file: UploadFile,
):
    """Upload an image file to local storage. Returns the URL to access the image."""
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

    # Generate unique filename and storage key
    filename = f"{uuid.uuid4().hex}{ext}"
    image_key = f"images/{filename}"
    content_type = file.content_type or "application/octet-stream"

    # Save to local storage
    storage = get_storage_service()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, storage.upload, image_key, content, content_type)

    url = f"/api/images/{filename}"
    logger.info(f"Image uploaded: {url} ({len(content)} bytes)")

    return {"url": url, "filename": filename, "size": len(content)}


@router.get("/{filename}")
async def get_image(filename: str):
    """Serve an uploaded image from local storage."""
    # Validate inputs to prevent injection
    if ".." in filename or "/" in filename or "\\" in filename:
        raise BadRequestError(message="Invalid filename")

    image_key = f"images/{filename}"

    storage = get_storage_service()
    loop = asyncio.get_event_loop()
    try:
        data, content_type = await loop.run_in_executor(None, storage.download, image_key)
    except FileNotFoundError:
        raise NotFoundError(message="Image not found")

    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )


@router.delete("/{filename}")
async def delete_image(
    filename: str,
):
    """Delete a single image from local storage."""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise BadRequestError(message="Invalid filename")

    image_key = f"images/{filename}"

    storage = get_storage_service()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, storage.delete, image_key)

    logger.info(f"Image deleted: {image_key}")
    return {"status": "deleted"}


# Backward-compat shims for pre-slim URLs of the form
# /api/images/{user_id}/{filename}. We ignore the leading segment and serve
# from the flat {filename} layout. Without these, every image embedded in a
# document created by an older build returns a routing 400/404.
@router.get("/{user_id}/{filename}")
async def get_image_legacy(user_id: str, filename: str):  # noqa: ARG001
    return await get_image(filename)


@router.delete("/{user_id}/{filename}")
async def delete_image_legacy(user_id: str, filename: str):  # noqa: ARG001
    return await delete_image(filename)
