"""Version history API endpoints."""

import difflib
import json
import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import File, FileVersion, get_db
from exceptions import DocumentNotFoundError, NotFoundError

logger = logging.getLogger(__name__)
router = APIRouter()


class VersionResponse(BaseModel):
    """Version response model."""

    id: str
    file_id: str
    content: str
    diff: str | None
    edit_type: str | None
    summary: str | None
    created_at: str

    class Config:
        from_attributes = True


class CreateVersionRequest(BaseModel):
    """Create version request model."""

    file_id: str
    content: str
    edit_type: str = "manual"
    summary: str | None = None


@router.get("/{file_id}", response_model=list[VersionResponse])
async def list_versions(file_id: str, limit: int = 50, db: AsyncSession = Depends(get_db)):
    """List versions for a file."""
    result = await db.execute(
        select(FileVersion)
        .where(FileVersion.file_id == file_id)
        .order_by(FileVersion.created_at.desc())
        .limit(limit)
    )
    versions = result.scalars().all()

    return [
        VersionResponse(
            id=v.id,
            file_id=v.file_id,
            content=v.content,
            diff=v.diff,
            edit_type=v.edit_type,
            summary=v.summary,
            created_at=v.created_at.isoformat(),
        )
        for v in versions
    ]


@router.post("/", response_model=VersionResponse)
async def create_version(request: CreateVersionRequest, db: AsyncSession = Depends(get_db)):
    """Create a new version checkpoint."""
    # Get file (must not be in trash)
    result = await db.execute(
        select(File).where(File.id == request.file_id, File.deleted_at.is_(None))
    )
    file = result.scalar_one_or_none()

    if not file:
        raise DocumentNotFoundError(file_id=request.file_id)

    # Get previous version for diff
    prev_result = await db.execute(
        select(FileVersion)
        .where(FileVersion.file_id == request.file_id)
        .order_by(FileVersion.created_at.desc())
        .limit(1)
    )
    prev_version = prev_result.scalar_one_or_none()

    # Calculate diff
    diff_data = None
    if prev_version:
        diff = list(
            difflib.unified_diff(
                prev_version.content.splitlines(keepends=True),
                request.content.splitlines(keepends=True),
                lineterm="",
            )
        )
        if diff:
            diff_data = json.dumps(diff)

    # Create version
    version = FileVersion(
        file_id=request.file_id,
        content=request.content,
        diff=diff_data,
        edit_type=request.edit_type,
        summary=request.summary,
    )
    db.add(version)
    await db.commit()
    await db.refresh(version)

    # Cleanup old versions (keep last 100)
    await _cleanup_old_versions(db, request.file_id, keep=100)

    return VersionResponse(
        id=version.id,
        file_id=version.file_id,
        content=version.content,
        diff=version.diff,
        edit_type=version.edit_type,
        summary=version.summary,
        created_at=version.created_at.isoformat(),
    )


@router.get("/{file_id}/{version_id}", response_model=VersionResponse)
async def get_version(file_id: str, version_id: str, db: AsyncSession = Depends(get_db)):
    """Get a specific version."""
    result = await db.execute(
        select(FileVersion)
        .where(FileVersion.id == version_id)
        .where(FileVersion.file_id == file_id)
    )
    version = result.scalar_one_or_none()

    if not version:
        raise NotFoundError(resource="Version", resource_id=version_id)

    return VersionResponse(
        id=version.id,
        file_id=version.file_id,
        content=version.content,
        diff=version.diff,
        edit_type=version.edit_type,
        summary=version.summary,
        created_at=version.created_at.isoformat(),
    )


@router.post("/{file_id}/{version_id}/restore")
async def restore_version(file_id: str, version_id: str, db: AsyncSession = Depends(get_db)):
    """Restore a file to a specific version."""
    # Get version
    version_result = await db.execute(
        select(FileVersion)
        .where(FileVersion.id == version_id)
        .where(FileVersion.file_id == file_id)
    )
    version = version_result.scalar_one_or_none()

    if not version:
        raise NotFoundError(resource="Version", resource_id=version_id)

    # Get file (must not be in trash)
    file_result = await db.execute(
        select(File).where(File.id == file_id, File.deleted_at.is_(None))
    )
    file = file_result.scalar_one_or_none()

    if not file:
        raise DocumentNotFoundError(file_id=file_id)

    # Update file content
    file.content = version.content
    await db.commit()

    # Create a new version for the restore
    restore_version = FileVersion(
        file_id=file_id,
        content=version.content,
        edit_type="restore",
        summary=f"Restored to version from {version.created_at.isoformat()}",
    )
    db.add(restore_version)
    await db.commit()

    return {"status": "restored", "version_id": version_id}


async def _cleanup_old_versions(db: AsyncSession, file_id: str, keep: int = 100):
    """Remove old versions beyond the keep limit."""
    # Get all version IDs ordered by date
    result = await db.execute(
        select(FileVersion.id)
        .where(FileVersion.file_id == file_id)
        .order_by(FileVersion.created_at.desc())
    )
    version_ids = [v[0] for v in result.all()]

    # Delete versions beyond limit
    if len(version_ids) > keep:
        ids_to_delete = version_ids[keep:]
        for vid in ids_to_delete:
            result = await db.execute(select(FileVersion).where(FileVersion.id == vid))
            version = result.scalar_one_or_none()
            if version:
                await db.delete(version)

        await db.commit()
        logger.info(f"Cleaned up {len(ids_to_delete)} old versions for file {file_id}")
