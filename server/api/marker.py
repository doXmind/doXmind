"""Marker model lifecycle API.

Two endpoints:

    GET  /api/import/marker/status    — current install/download state
    POST /api/import/marker/download  — kick off the (idempotent) download

Frontend flow:

    1. User imports a scanned PDF.
    2. /api/import/ returns 409 ``MARKER_MODELS_REQUIRED``.
    3. Frontend shows a confirm modal ("download ~2GB once?").
    4. On accept, frontend POSTs /marker/download and polls /marker/status
       until ``status === "installed"`` (or ``"error"``).
    5. Retry the original import.
"""

from fastapi import APIRouter

from services import marker_state

router = APIRouter()


@router.get("/status")
async def marker_status() -> dict:
    return marker_state.get_state()


@router.post("/download")
async def marker_download() -> dict:
    return await marker_state.start_download()
