"""Local migration endpoints for moving the SQLite library to disk workspace."""

from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from config import get_settings
from db.database import DatabaseBlock, File, get_db
from exceptions import BadRequestError, InternalError
from utils.markdown_converter import html_to_markdown

logger = logging.getLogger(__name__)
router = APIRouter()

_INVALID_FS_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_IMAGE_URL_RE = re.compile(r'/api/images/(?P<path>[^"\'\s)]+)')
_DATABASE_ID_RE = re.compile(
    r'(?:data-database-id="([a-f0-9-]+)"|<!-- database:([a-f0-9-]+) -->)'
)


class ExportWorkspaceRequest(BaseModel):
    """Request body for exporting the current SQLite library to markdown files."""

    output_root: str = Field(..., min_length=1)
    overwrite: bool = False


class ExportWorkspaceSummary(BaseModel):
    """Summary of the local SQLite-to-workspace export."""

    output_root: str
    folders_exported: int
    documents_exported: int
    sidecars_written: int
    empty_documents: int
    fallback_html: int
    images_copied: int
    images_missing: int
    databases_embedded: int
    skipped_trash: int
    written_markdown: list[str]
    missing_images: list[str]


def _sanitize(name: str, *, is_folder: bool) -> str:
    cleaned = _INVALID_FS_CHARS.sub("_", name).strip().rstrip(".")
    if not is_folder and cleaned.lower().endswith(".md"):
        cleaned = cleaned[:-3].rstrip()
    return cleaned or "untitled"


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()


def _yaml_escape(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value)
    if any(ch in text for ch in ":#\"\n") or text.strip() != text:
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text


def _frontmatter(file: File) -> str:
    fields: list[tuple[str, Any]] = [("id", file.id)]
    if file.name:
        fields.append(("title", file.name))
    if file.icon:
        fields.append(("icon", file.icon))
    if file.is_favorite:
        fields.append(("favorite", True))
    if file.cover_image_url:
        fields.append(("cover", file.cover_image_url))
    created = _iso(file.created_at)
    updated = _iso(file.updated_at)
    if created:
        fields.append(("created", created))
    if updated:
        fields.append(("updated", updated))
    body = "\n".join(f"{key}: {_yaml_escape(value)}" for key, value in fields)
    return f"---\n{body}\n---\n\n"


def _build_tree(files: list[File]) -> dict[str | None, list[File]]:
    active_ids = {file.id for file in files}
    children: dict[str | None, list[File]] = defaultdict(list)
    for file in files:
        parent_id = file.parent_id if file.parent_id in active_ids else None
        children[parent_id].append(file)
    for siblings in children.values():
        siblings.sort(
            key=lambda f: (
                not bool(f.is_folder),
                f.position if f.position is not None else 0,
                f.name or "",
            )
        )
    return children


def _unique_path(parent: Path, base: str, ext: str) -> Path:
    candidate = parent / f"{base}{ext}"
    n = 2
    while candidate.exists():
        candidate = parent / f"{base} ({n}){ext}"
        n += 1
    return candidate


def _sidecar_path_for(markdown_path: Path) -> Path:
    stem = markdown_path.name
    lower = stem.lower()
    if lower.endswith(".markdown"):
        stem = stem[: -len(".markdown")]
    elif lower.endswith(".md"):
        stem = stem[: -len(".md")]
    return markdown_path.with_name(f".{stem}.doxmind")


def _hash_markdown(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _extract_database_ids(*contents: str | None) -> set[str]:
    ids: set[str] = set()
    for content in contents:
        if not content:
            continue
        for match in _DATABASE_ID_RE.finditer(content):
            ids.add(match.group(1) or match.group(2))
    return ids


def _database_to_dict(database: DatabaseBlock) -> dict[str, Any]:
    return {
        "id": database.id,
        "title": database.title,
        "icon": database.icon,
        "properties_schema": database.properties_schema or [],
        "rows": [
            {
                "id": row.id,
                "database_id": row.database_id,
                "properties": row.properties or {},
                "position": row.position,
                "page_file_id": row.page_file_id,
                "created_at": _iso(row.created_at),
                "updated_at": _iso(row.updated_at),
            }
            for row in (database.rows or [])
        ],
        "views": [
            {
                "id": view.id,
                "database_id": view.database_id,
                "name": view.name,
                "type": view.type,
                "config": view.config or {},
                "position": view.position,
                "created_at": _iso(view.created_at),
                "updated_at": _iso(view.updated_at),
            }
            for view in (database.views or [])
        ],
        "created_at": _iso(database.created_at),
        "updated_at": _iso(database.updated_at),
    }


def _rewrite_images(
    markdown: str,
    image_roots: list[Path],
    assets_dir: Path,
    seen: set[Path],
) -> tuple[str, int, list[str]]:
    copied = 0
    missing: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        nonlocal copied
        image_path = match.group("path")
        parts = [part for part in image_path.split("/") if part and part not in {".", ".."}]
        filename = parts[-1] if parts else "image"
        candidates: list[Path] = []
        for root in image_roots:
            if parts:
                candidates.append(root.joinpath(*parts))
                candidates.append(root / filename)
        src = next((candidate for candidate in candidates if candidate.exists()), None)
        if src is None:
            missing.append(str(candidates[0] if candidates else image_path))
            return match.group(0)
        dest = assets_dir / filename
        if dest not in seen:
            assets_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            seen.add(dest)
            copied += 1
        return f"./assets/{filename}"

    return _IMAGE_URL_RE.sub(_replace, markdown), copied, missing


def _write_sidecar(
    markdown_path: Path,
    file: File,
    markdown_content: str,
    databases: dict[str, dict[str, Any]],
) -> bool:
    html = file.content or ""
    if not html and not markdown_content.strip() and not databases:
        return False

    database_ids = _extract_database_ids(file.content, file.content_markdown, markdown_content)
    embedded = {db_id: databases[db_id] for db_id in sorted(database_ids) if db_id in databases}
    extras = {"databases": embedded} if embedded else {"databases": {}}
    sidecar = {
        "version": 1,
        "id": file.id,
        "html": html,
        "markdown_hash": _hash_markdown(markdown_content),
        "updated_at": _iso(file.updated_at) or datetime.now(UTC).isoformat(),
        "extras": extras,
    }
    _sidecar_path_for(markdown_path).write_text(
        json.dumps(sidecar, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return True


async def _load_databases(db: AsyncSession) -> dict[str, dict[str, Any]]:
    result = await db.execute(
        select(DatabaseBlock).options(
            selectinload(DatabaseBlock.rows),
            selectinload(DatabaseBlock.views),
        )
    )
    return {database.id: _database_to_dict(database) for database in result.scalars().all()}


@router.post("/export-library", response_model=ExportWorkspaceSummary)
async def export_library_to_workspace(
    body: ExportWorkspaceRequest,
    db: AsyncSession = Depends(get_db),
):
    """Export the current local SQLite library to a markdown workspace."""

    out_dir = Path(body.output_root).expanduser().resolve()
    if out_dir.exists() and not out_dir.is_dir():
        raise BadRequestError(message=f"Output root is not a directory: {out_dir}")
    if out_dir.exists() and any(out_dir.iterdir()) and not body.overwrite:
        raise BadRequestError(
            message=f"Refusing to write into non-empty output root: {out_dir}",
            details={"output_root": str(out_dir), "hint": "Pass overwrite=true to export anyway."},
        )

    try:
        out_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise BadRequestError(message=f"Could not create output root: {out_dir}") from exc

    result = await db.execute(select(File).order_by(File.position.asc(), File.name.asc()))
    all_files = result.scalars().all()
    files = [file for file in all_files if file.deleted_at is None]
    skipped_trash = len(all_files) - len(files)
    tree = _build_tree(files)
    databases = await _load_databases(db)
    settings = get_settings()
    image_roots = [
        settings.local_storage_path / "images",
        settings.data_dir / "storage" / "images",
    ]

    stats = {
        "folders_exported": 0,
        "documents_exported": 0,
        "sidecars_written": 0,
        "empty_documents": 0,
        "fallback_html": 0,
        "images_copied": 0,
        "images_missing": 0,
        "databases_embedded": 0,
    }
    seen_assets: set[Path] = set()
    missing_images: list[str] = []
    written_markdown: list[str] = []

    def walk(parent_id: str | None, parent_path: Path) -> None:
        for file in tree.get(parent_id, []):
            base = _sanitize(file.name or "untitled", is_folder=bool(file.is_folder))
            if file.is_folder:
                folder_path = _unique_path(parent_path, base, "")
                folder_path.mkdir(parents=True, exist_ok=True)
                stats["folders_exported"] += 1
                walk(file.id, folder_path)
                continue

            markdown_body = file.content_markdown
            if not markdown_body:
                if file.content:
                    markdown_body = html_to_markdown(file.content)
                    stats["fallback_html"] += 1
                else:
                    markdown_body = ""
                    stats["empty_documents"] += 1

            assets_dir = parent_path / "assets"
            markdown_body, copied, missing = _rewrite_images(
                markdown_body,
                image_roots,
                assets_dir,
                seen_assets,
            )
            stats["images_copied"] += copied
            stats["images_missing"] += len(missing)
            missing_images.extend(missing)

            markdown_path = _unique_path(parent_path, base, ".md")
            markdown_content = _frontmatter(file) + markdown_body
            markdown_path.write_text(markdown_content, encoding="utf-8")
            stats["documents_exported"] += 1
            written_markdown.append(str(markdown_path.relative_to(out_dir)))

            database_ids = _extract_database_ids(file.content, file.content_markdown, markdown_body)
            stats["databases_embedded"] += len(database_ids.intersection(databases))
            if _write_sidecar(markdown_path, file, markdown_content, databases):
                stats["sidecars_written"] += 1

    try:
        walk(None, out_dir)
    except OSError as exc:
        logger.error("Workspace export failed: %s", exc, exc_info=True)
        raise InternalError(message=f"Workspace export failed: {exc}") from exc

    return ExportWorkspaceSummary(
        output_root=str(out_dir),
        skipped_trash=skipped_trash,
        written_markdown=written_markdown,
        missing_images=missing_images[:50],
        **stats,
    )
