"""Read-only recovery endpoint for images created by pre-workspace builds.

Current Pages reference ordinary files under their workspace (normally
``./assets``).  This router deliberately has no write or delete endpoint; it
only keeps old ``/api/images/...`` Markdown references recoverable in browser
development until users move those bytes into their workspace.
"""

import mimetypes

from fastapi import APIRouter
from fastapi.responses import Response

from config import get_settings
from exceptions import BadRequestError, NotFoundError

router = APIRouter()


@router.get("/{filename}")
async def get_image(filename: str):
    """Serve one legacy image without creating or modifying local state."""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise BadRequestError(message="Invalid filename")

    root = (get_settings().data_dir / "uploads" / "images").resolve()
    path = (root / filename).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        raise BadRequestError(message="Invalid filename")
    if not path.is_file():
        raise NotFoundError(message="Image not found")

    data = path.read_bytes()
    content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )


# Backward-compat shims for pre-slim URLs of the form
# /api/images/{user_id}/{filename}. We ignore the leading segment and serve
# from the flat {filename} layout. Without these, every image embedded in a
# document created by an older build returns a routing 400/404.
@router.get("/{user_id}/{filename}")
async def get_image_legacy(user_id: str, filename: str):  # noqa: ARG001
    return await get_image(filename)
