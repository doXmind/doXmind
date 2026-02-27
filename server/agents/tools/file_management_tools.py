"""File and folder management tool executors.

Provides CRUD operations for files and folders:
- create_file, create_folder, rename_file, move_file, delete_file, list_files

These tools operate directly on the database, reusing validation logic
from the existing file API layer (server/api/files.py).
"""

import logging
import uuid
from typing import Any

from sqlalchemy import func, insert, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from agents.tools.definitions import FILE_MANAGEMENT_TOOL_NAMES
from db.database import File, utcnow

logger = logging.getLogger(__name__)

MAX_FOLDER_DEPTH = 3


def is_file_management_tool(tool_name: str) -> bool:
    """Check if a tool is a file management tool."""
    return tool_name in FILE_MANAGEMENT_TOOL_NAMES


async def _get_folder_depth(db: AsyncSession, folder_id: str | None) -> int:
    """Get the depth of a folder by walking up ancestors."""
    if not folder_id:
        return 0

    result = await db.execute(
        text("""
            WITH RECURSIVE ancestors AS (
                SELECT id, parent_id, 1 AS depth
                FROM files
                WHERE id = :folder_id AND deleted_at IS NULL
                UNION ALL
                SELECT f.id, f.parent_id, a.depth + 1
                FROM files f
                INNER JOIN ancestors a ON f.id = a.parent_id
                WHERE f.deleted_at IS NULL
            )
            SELECT MAX(depth) FROM ancestors
        """),
        {"folder_id": folder_id},
    )
    return result.scalar() or 0


async def _would_create_cycle(db: AsyncSession, folder_id: str, target_parent_id: str) -> bool:
    """Check if moving folder_id under target_parent_id would create a cycle."""
    result = await db.execute(
        text("""
            WITH RECURSIVE ancestors AS (
                SELECT id, parent_id
                FROM files
                WHERE id = :target_id AND deleted_at IS NULL
                UNION ALL
                SELECT f.id, f.parent_id
                FROM files f
                INNER JOIN ancestors a ON f.id = a.parent_id
                WHERE f.deleted_at IS NULL
            )
            SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = :folder_id)
        """),
        {"target_id": target_parent_id, "folder_id": folder_id},
    )
    return bool(result.scalar())


async def _get_max_subtree_depth(db: AsyncSession, folder_id: str) -> int:
    """Get the maximum depth of a folder's subtree."""
    result = await db.execute(
        text("""
            WITH RECURSIVE descendants AS (
                SELECT id, 0 AS depth
                FROM files
                WHERE id = :folder_id AND deleted_at IS NULL
                UNION ALL
                SELECT f.id, d.depth + 1
                FROM files f
                INNER JOIN descendants d ON f.parent_id = d.id
                WHERE f.deleted_at IS NULL AND f.is_folder = true
            )
            SELECT MAX(depth) FROM descendants
        """),
        {"folder_id": folder_id},
    )
    return result.scalar() or 0


async def _exec_create_file(tool_input: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Create a new document."""
    db: AsyncSession = ctx["db"]
    user_id: str = ctx["user_id"]
    name = tool_input.get("name", "Untitled")
    content = tool_input.get("content", "")
    parent_id = tool_input.get("parent_id")

    # Validate parent folder if specified
    if parent_id:
        parent_result = await db.execute(
            select(File).where(
                File.id == parent_id,
                File.deleted_at.is_(None),
            )
        )
        parent = parent_result.scalar_one_or_none()
        if not parent or not parent.is_folder:
            return {"error": f"Parent folder '{parent_id}' not found or is not a folder."}

    import hashlib

    from services.content_sanitizer import sanitize_content

    content = sanitize_content(content) or ""
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

    file_id = str(uuid.uuid4())
    result = await db.execute(
        insert(File)
        .values(
            id=file_id,
            name=name,
            content=content,
            content_hash=content_hash,
            user_id=user_id,
            parent_id=parent_id,
        )
        .returning(File.id, File.name)
    )
    row = result.one()
    await db.commit()

    return {"result": f"Created document '{row.name}' (id={row.id})"}


async def _exec_create_folder(tool_input: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Create a new folder."""
    db: AsyncSession = ctx["db"]
    user_id: str = ctx["user_id"]
    name = tool_input.get("name", "New Folder")
    parent_id = tool_input.get("parent_id")

    # Validate parent and depth
    if parent_id:
        parent_result = await db.execute(
            select(File).where(
                File.id == parent_id,
                File.deleted_at.is_(None),
            )
        )
        parent = parent_result.scalar_one_or_none()
        if not parent or not parent.is_folder:
            return {"error": f"Parent folder '{parent_id}' not found or is not a folder."}

        depth = await _get_folder_depth(db, parent_id)
        if depth + 1 >= MAX_FOLDER_DEPTH:
            return {"error": f"Maximum folder depth ({MAX_FOLDER_DEPTH}) exceeded."}

    # Check duplicate name
    dup_result = await db.execute(
        select(File).where(
            File.name == name,
            File.is_folder.is_(True),
            File.parent_id == parent_id,
            File.user_id == user_id,
            File.deleted_at.is_(None),
        )
    )
    if dup_result.scalar_one_or_none():
        return {"error": f"Folder '{name}' already exists at this location."}

    folder_id = str(uuid.uuid4())
    result = await db.execute(
        insert(File)
        .values(
            id=folder_id,
            name=name,
            content="",
            is_folder=True,
            parent_id=parent_id,
            user_id=user_id,
        )
        .returning(File.id, File.name)
    )
    row = result.one()
    await db.commit()

    return {"result": f"Created folder '{row.name}' (id={row.id})"}


async def _exec_rename_file(tool_input: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Rename a file or folder."""
    db: AsyncSession = ctx["db"]
    user_id: str = ctx["user_id"]
    file_id = tool_input.get("file_id", "")
    new_name = tool_input.get("new_name", "")

    if not file_id or not new_name:
        return {"error": "file_id and new_name are required."}

    result = await db.execute(
        select(File).where(
            File.id == file_id,
            File.user_id == user_id,
            File.deleted_at.is_(None),
        )
    )
    file = result.scalar_one_or_none()
    if not file:
        return {"error": f"File '{file_id}' not found."}

    old_name = file.name
    file.name = new_name
    await db.commit()

    return {"result": f"Renamed '{old_name}' to '{new_name}'"}


async def _exec_move_file(tool_input: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Move a file or folder to a different parent."""
    db: AsyncSession = ctx["db"]
    user_id: str = ctx["user_id"]
    file_id = tool_input.get("file_id", "")
    target_folder_id = tool_input.get("target_folder_id")

    if not file_id:
        return {"error": "file_id is required."}

    result = await db.execute(
        select(File).where(
            File.id == file_id,
            File.user_id == user_id,
            File.deleted_at.is_(None),
        )
    )
    file = result.scalar_one_or_none()
    if not file:
        return {"error": f"File '{file_id}' not found."}

    # Validate target folder
    if target_folder_id:
        target_result = await db.execute(
            select(File).where(
                File.id == target_folder_id,
                File.deleted_at.is_(None),
            )
        )
        target = target_result.scalar_one_or_none()
        if not target or not target.is_folder:
            return {"error": f"Target folder '{target_folder_id}' not found or is not a folder."}

        if file.is_folder:
            if target_folder_id == file_id:
                return {"error": "Cannot move a folder into itself."}
            if await _would_create_cycle(db, file_id, target_folder_id):
                return {"error": "Cannot move: would create a circular folder structure."}

            target_depth = await _get_folder_depth(db, target_folder_id)
            subtree_depth = await _get_max_subtree_depth(db, file_id)
            if target_depth + 1 + subtree_depth >= MAX_FOLDER_DEPTH:
                return {
                    "error": f"Cannot move: would exceed max folder depth ({MAX_FOLDER_DEPTH})."
                }

    file.parent_id = target_folder_id
    await db.commit()

    dest = target_folder_id or "root"
    return {"result": f"Moved '{file.name}' to {dest}"}


async def _exec_delete_file(tool_input: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Soft-delete a file or folder (and descendants if folder)."""
    db: AsyncSession = ctx["db"]
    user_id: str = ctx["user_id"]
    file_id = tool_input.get("file_id", "")

    if not file_id:
        return {"error": "file_id is required."}

    result = await db.execute(
        select(File).where(
            File.id == file_id,
            File.user_id == user_id,
            File.deleted_at.is_(None),
        )
    )
    file = result.scalar_one_or_none()
    if not file:
        return {"error": f"File '{file_id}' not found."}

    now = utcnow()
    name = file.name
    is_folder = file.is_folder

    # Cascade soft-delete descendants if folder
    if is_folder:
        desc_result = await db.execute(
            text("""
                WITH RECURSIVE descendants AS (
                    SELECT id FROM files
                    WHERE parent_id = :folder_id AND deleted_at IS NULL
                    UNION ALL
                    SELECT f.id FROM files f
                    INNER JOIN descendants d ON f.parent_id = d.id
                    WHERE f.deleted_at IS NULL
                )
                SELECT id FROM descendants
            """),
            {"folder_id": file_id},
        )
        descendant_ids = [r[0] for r in desc_result.fetchall()]
        if descendant_ids:
            await db.execute(update(File).where(File.id.in_(descendant_ids)).values(deleted_at=now))

    file.deleted_at = now
    await db.commit()

    item_type = "folder" if is_folder else "document"
    return {"result": f"Deleted {item_type} '{name}' (moved to trash)"}


async def _exec_list_files(tool_input: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """List files and folders in a directory."""
    db: AsyncSession = ctx["db"]
    user_id: str = ctx["user_id"]
    parent_id = tool_input.get("parent_id")

    query = (
        select(
            File.id,
            File.name,
            File.is_folder,
            File.parent_id,
            func.length(File.content).label("content_length"),
            File.updated_at,
        )
        .where(
            File.user_id == user_id,
            File.deleted_at.is_(None),
            File.parent_id == parent_id,
        )
        .order_by(
            File.is_folder.desc(),
            File.updated_at.desc(),
        )
        .limit(50)
    )

    result = await db.execute(query)
    rows = result.all()

    if not rows:
        location = f"folder {parent_id}" if parent_id else "root"
        return {"result": f"No files in {location}."}

    items = []
    for row in rows:
        item_type = "folder" if row.is_folder else "file"
        size = f", {row.content_length} chars" if not row.is_folder else ""
        items.append(f"- [{item_type}] **{row.name}** (id={row.id}{size})")

    location = f"folder {parent_id}" if parent_id else "root"
    return {"result": f"Contents of {location}:\n" + "\n".join(items)}


_FILE_MGMT_EXECUTORS = {
    "create_file": _exec_create_file,
    "create_folder": _exec_create_folder,
    "rename_file": _exec_rename_file,
    "move_file": _exec_move_file,
    "delete_file": _exec_delete_file,
    "list_files": _exec_list_files,
}


async def execute_file_management_tool(
    tool_name: str, tool_input: dict[str, Any], file_mgmt_context: dict[str, Any] | None
) -> dict[str, Any]:
    """Execute a file management tool.

    Args:
        tool_name: Name of the tool
        tool_input: Tool input parameters
        file_mgmt_context: {"db": AsyncSession, "user_id": str}
    """
    if not file_mgmt_context:
        return {"error": "File management context not available."}

    executor = _FILE_MGMT_EXECUTORS.get(tool_name)
    if executor is None:
        return {"error": f"Unknown file management tool: {tool_name}"}

    return await executor(tool_input, file_mgmt_context)
