"""Local image upload API endpoints."""

import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, UploadFile
from fastapi.responses import Response

from exceptions import BadRequestError, NotFoundError
from services.storage_service import get_storage_service

logger = logging.getLogger(__name__)
router = APIRouter()

# Allowed image types
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"}
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

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
