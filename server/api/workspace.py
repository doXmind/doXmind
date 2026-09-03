"""Local Markdown workspace API for plain web development.

The Electron app calls filesystem commands directly. A regular browser cannot
do that, so this router exposes the same command names over localhost. Markdown
Pages are single-file sources of truth; legacy sidecars left by older versions
are preserved and moved alongside their file, never read or written.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import time
import uuid
from collections import Counter
from contextlib import suppress
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from send2trash import send2trash

from config import get_settings
from services.legacy_sidecar import sidecar_path_for
from services.markdown_page_store import (
    MarkdownPageStore,
    PageRevisionConflictError,
    project_page_meta,
)
from services.markdown_source import (
    atomic_write,
    extract_frontmatter_block,
    parse_frontmatter,
    parse_yaml_scalar,
    portable_page_id_from_token,
)

router = APIRouter()


IGNORED_SCAN_DIRS = {
    ".doxmind",
    ".git",
    "node_modules",
    "target",
    ".next",
    "out",
    "dist",
    "build",
}
IMAGE_ASSET_MIME = {
    ".apng": "image/apng",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".avif": "image/avif",
}
MAX_IMAGE_ASSET_BYTES = 20 * 1024 * 1024

# Per-root TTL cache for `workspace_scan`. Within a single user action the
# adapter often calls scan -> index_rebuild -> search back-to-back, each of
# which previously did its own `rglob("*")` walk. The TTL is short enough
# that external file changes still get picked up promptly; mutating commands
# below explicitly invalidate the entry for their root.
_SCAN_CACHE_TTL_SECONDS = 1.5
_scan_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _invalidate_scan_cache(root: str | Path) -> None:
    key = str(Path(root).resolve()) if root else ""
    _scan_cache.pop(key, None)


class WorkspaceInvokeRequest(BaseModel):
    command: str
    payload: dict[str, Any] = Field(default_factory=dict)


@router.post("/invoke")
async def invoke_workspace(request: WorkspaceInvokeRequest):
    """Invoke a local workspace command by its shell-agnostic name."""
    try:
        return _invoke(request.command, request.payload)
    except HTTPException:
        raise
    except FileExistsError as exc:
        # External-import collisions raise this; #69 will replace the toast
        # with a Replace / Keep both / Skip modal driven by the same backend
        # error code.
        raise HTTPException(
            status_code=409,
            detail={"code": "destination_exists", "message": str(exc)},
        )
    except PageRevisionConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "page_revision_conflict",
                "path": str(exc.path),
                "expectedRevision": exc.expected,
                "actualRevision": exc.actual,
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _invoke(command: str, payload: dict[str, Any]) -> Any:
    if command == "workspace_scan":
        return workspace_scan(str(payload.get("root") or ""))
    if command == "workspace_markdown_search":
        return workspace_markdown_search(
            str(payload.get("root") or ""),
            str(payload.get("query") or ""),
            payload.get("limit"),
        )
    if command == "doc_read":
        return read_doc_workspace(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
        )
    if command == "workspace_read_asset":
        return read_workspace_asset(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
        )
    if command == "doc_write_workspace":
        return write_doc_workspace(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
            payload.get("payload") or {},
        )
    if command == "doc_create":
        return doc_create(str(payload.get("root") or ""), payload.get("payload") or {})
    if command == "doc_import_external":
        return doc_import_external(
            str(payload.get("root") or ""),
            payload.get("srcPath"),
            payload.get("bytes"),
            str(payload.get("destFolder") or ""),
            str(payload.get("name") or ""),
            str(payload.get("mode") or "create"),
        )
    if command == "doc_rename":
        return move_attachment_pair(
            str(payload.get("root") or ""),
            str(payload.get("oldPath") or ""),
            str(payload.get("newPath") or ""),
        )
    if command == "doc_move":
        document = move_attachment_pair(
            str(payload.get("root") or ""),
            str(payload.get("oldPath") or ""),
            str(payload.get("newPath") or ""),
        )
        return {"kind": "document", **document}
    if command == "workspace_relocate_page":
        return workspace_relocate_page(
            str(payload.get("root") or ""),
            str(payload.get("oldPath") or ""),
            str(payload.get("newPath") or ""),
            payload.get("expectedRevision"),
            payload.get("checks", []),
            payload.get("movedMarkdown"),
            payload.get("writes", []),
        )
    if command == "workspace_relocate_folder":
        return workspace_relocate_folder(
            str(payload.get("root") or ""),
            str(payload.get("oldPath") or ""),
            str(payload.get("newPath") or ""),
            payload.get("checks", []),
            payload.get("writes", []),
        )
    if command == "doc_delete":
        return doc_delete(str(payload.get("root") or ""), str(payload.get("path") or ""))
    if command == "workspace_create_folder":
        return workspace_create_folder(
            str(payload.get("root") or ""), str(payload.get("path") or "")
        )
    if command == "workspace_delete_folder":
        return workspace_delete_folder(
            str(payload.get("root") or ""), str(payload.get("path") or "")
        )
    raise HTTPException(status_code=404, detail=f"unsupported workspace command: {command}")


def workspace_default_root() -> str:
    root = Path.home() / "Documents" / "doXmind"
    root.mkdir(parents=True, exist_ok=True)
    return str(root.resolve())


def workspace_scan(root: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    key = str(workspace)
    now = time.monotonic()
    cached = _scan_cache.get(key)
    if cached is not None and now - cached[0] < _SCAN_CACHE_TTL_SECONDS:
        return cached[1]

    documents: list[dict[str, Any]] = []
    # Sort by lowercased file name so listing order is deterministic across
    # scans (rglob returns filesystem order, which isn't stable on macOS/APFS)
    # and matches the frontend's name-asc sort. Sorting by full path alone
    # would make a file's position depend on its parent folder name; the
    # `as_posix()` tiebreaker is only there to give two files with the same
    # lowercased basename (e.g. `Notes/README.md` vs `Specs/README.md`) a
    # deterministic order — otherwise Timsort's stability would fall back
    # to `rglob`'s unstable filesystem order, defeating this whole sort.
    for path in iter_workspace_document_paths(workspace):
        documents.append(scan_document_dto(workspace, path))
    resolve_duplicate_page_ids(documents)
    result = {"root": str(workspace), "documents": documents}
    write_workspace_index(workspace, workspace_index_from_documents(documents))
    _scan_cache[key] = (now, result)
    return result


def resolve_duplicate_page_ids(documents: list[dict[str, Any]]) -> None:
    counts = Counter(
        str(document["id"])
        for document in documents
        if document.get("documentType") == "markdown" and document.get("idSource") == "frontmatter"
    )
    for document in documents:
        if document.get("idSource") == "frontmatter" and counts[str(document["id"])] > 1:
            document["id"] = stable_path_id(str(document["path"]))
            document["idSource"] = "path"


def workspace_index_rebuild(root: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    index = workspace_index_from_documents(workspace_scan(root)["documents"])
    write_workspace_index(workspace, index)
    return index


def workspace_index_from_documents(documents: list[dict[str, Any]]) -> dict[str, Any]:
    ids: dict[str, str] = {}
    for doc in documents:
        if doc.get("documentType") == "markdown" and doc.get("idSource") == "frontmatter":
            ids.setdefault(str(doc["id"]), str(doc["path"]))
    return {"version": 1, "ids": ids}


def write_workspace_index(workspace: Path, index: dict[str, Any]) -> None:
    index_path = workspace_index_path(workspace)
    raw = json.dumps(index, indent=2, ensure_ascii=False)
    if index_path.exists() and index_path.read_text(encoding="utf-8") == raw:
        return
    atomic_write(index_path, raw.encode("utf-8"))


def workspace_index_path(workspace: Path) -> Path:
    """Return the app-private cache path for a canonical workspace root.

    The index is derived state. Keeping it under DATA_DIR means even a read-only
    scan never adds doXmind-owned files to the user's Markdown tree.
    """

    canonical = workspace.resolve()
    workspace_key = hashlib.sha256(canonical.as_posix().encode("utf-8")).hexdigest()
    return get_settings().data_dir / "workspaces" / workspace_key / "index.json"


def workspace_markdown_search(root: str, query: str, limit: Any = None) -> list[dict[str, Any]]:
    workspace = canonical_workspace_root(root)
    needle = query.strip().lower()
    if not needle:
        raise ValueError("search query is required")
    max_results = min(int(limit or 50), 200)
    results: list[dict[str, Any]] = []
    scan_by_path = {
        str(document["path"]): document for document in workspace_scan(str(workspace))["documents"]
    }

    for path in iter_workspace_document_paths(workspace):
        if not is_markdown_file(path):
            continue
        raw = path.read_text(encoding="utf-8")
        rel_path = relative_path_string(workspace, path)
        matches = []
        for line_number, line in enumerate(raw.splitlines(), start=1):
            if needle in line.lower():
                matches.append({"line": line_number, "preview": line.strip()[:240]})
        if matches:
            scanned = scan_by_path[rel_path]
            results.append(
                {
                    "id": scanned["id"],
                    "path": rel_path,
                    "name": path.name,
                    "title": scanned.get("title") or path.stem,
                    "matches": matches,
                }
            )
        if len(results) >= max_results:
            break
    return results


def read_doc(path: Path) -> dict[str, Any]:
    ensure_markdown_path(str(path))
    page = MarkdownPageStore().read(path)
    return _page_read_response(
        markdown=page.markdown,
        meta=page.meta,
        revision=page.revision,
    )


def read_workspace_asset(root: str, rel_path: str) -> dict[str, str]:
    workspace = canonical_workspace_root(root)
    relative = validate_relative_path(rel_path)
    normalized_path = relative.as_posix()
    mime = IMAGE_ASSET_MIME.get(relative.suffix.lower())
    if mime is None:
        raise ValueError(f"unsupported local image type: {rel_path}")
    current = workspace
    for part in relative.parts:
        current /= part
        try:
            metadata = current.lstat()
        except FileNotFoundError as error:
            raise ValueError(f"workspace path does not exist: {rel_path}") from error
        if stat.S_ISLNK(metadata.st_mode):
            raise ValueError(f"symbolic-link image assets are not allowed: {rel_path}")
    source = resolve_existing_workspace_path(workspace, normalized_path)
    metadata = source.stat()
    if not source.is_file():
        raise ValueError(f"image asset is not a file: {rel_path}")
    if metadata.st_size <= 0 or metadata.st_size > MAX_IMAGE_ASSET_BYTES:
        raise ValueError(f"image asset must be between 1 byte and {MAX_IMAGE_ASSET_BYTES} bytes")
    content = source.read_bytes()
    if not _image_bytes_match_mime(content, mime):
        raise ValueError(f"image asset content does not match image type: {rel_path}")
    return {
        "path": normalized_path,
        "mime": mime,
        "base64": base64.b64encode(content).decode("ascii"),
    }


def _image_bytes_match_mime(content: bytes, mime: str) -> bool:
    if mime in {"image/png", "image/apng"}:
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if mime == "image/jpeg":
        return content.startswith(b"\xff\xd8\xff")
    if mime == "image/gif":
        return content.startswith((b"GIF87a", b"GIF89a"))
    if mime == "image/bmp":
        return content.startswith(b"BM")
    if mime == "image/x-icon":
        return content.startswith(b"\x00\x00\x01\x00")
    if mime == "image/webp":
        return len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    if mime == "image/avif":
        return (
            len(content) >= 12 and content[4:8] == b"ftyp" and content[8:12] in {b"avif", b"avis"}
        )
    return False


def read_doc_workspace(root: str, rel_path: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    ensure_markdown_path(rel_path)
    return read_doc(resolve_existing_workspace_path(workspace, rel_path))


def _page_read_response(
    *,
    markdown: str,
    meta: dict[str, Any],
    revision: str | None = None,
) -> dict[str, Any]:
    """Serialize the active Page wire shape from Markdown source only."""
    return {
        "markdown": markdown,
        "meta": meta,
        "outline": _outline_from_markdown(markdown),
        "revision": revision,
    }


def _outline_from_markdown(markdown: str) -> list[dict[str, Any]]:
    seen: dict[str, int] = {}
    outline: list[dict[str, Any]] = []
    for line in markdown.splitlines():
        match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if not match:
            continue
        depth = len(match.group(1))
        text = re.sub(r"\s+\{#.*?\}\s*$", "", match.group(2)).strip()
        base = _slugify_heading(text)
        count = seen.get(base, 0) + 1
        seen[base] = count
        outline.append(
            {
                "id": base if count == 1 else f"{base}-{count}",
                "depth": depth,
                "text": text,
            }
        )
    return outline


def _slugify_heading(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "section"


def write_doc_workspace(root: str, rel_path: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Persist a Markdown Page and return its post-write read model.

    Returning the result eliminates the round-trip the client previously
    needed to refresh state after every save.
    """
    workspace = canonical_workspace_root(root)
    ensure_markdown_path(rel_path)
    path = resolve_workspace_path_for_write(workspace, rel_path)

    store = MarkdownPageStore()
    incoming_meta = dict(payload.get("meta") or {})
    existing_markdown = ""
    if path.exists():
        existing = store.read(path)
        existing_markdown = existing.markdown
        # Identity of an existing Page belongs to its exact on-disk
        # frontmatter. A path-derived UI id must never replace a numeric,
        # object, empty, or otherwise hand-authored source token while
        # applying an unrelated metadata patch such as `favorite`.
        incoming_meta.pop("id", None)

    markdown_value = payload.get("markdown")
    markdown = existing_markdown if markdown_value is None else str(markdown_value)
    if path.exists():
        store.write(
            path,
            markdown,
            incoming_meta or None,
            str(payload["expectedRevision"])
            if payload.get("expectedRevision") is not None
            else None,
        )
    else:
        requested_id = incoming_meta.get("id")
        page_id = (
            requested_id.strip()
            if isinstance(requested_id, str) and requested_id.strip()
            else str(uuid.uuid4())
        )
        store.create(path, page_id, markdown, incoming_meta)
    _invalidate_scan_cache(workspace)

    persisted = store.read(path)

    return _page_read_response(
        markdown=markdown,
        meta=persisted.meta,
        revision=persisted.revision,
    )


def doc_create(root: str, payload: dict[str, Any]) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    rel_path = str(payload.get("path") or "")
    ensure_markdown_path(rel_path)
    path = resolve_workspace_path_for_write(workspace, rel_path)
    # Creation refuses to overwrite unless the caller already collected the
    # user's consent for this exact destination — the native Save panel asks
    # "replace?" itself and only returns a path once the user said yes. Every
    # other create path keeps the default refusal.
    replace_existing = payload.get("replaceExisting") is True
    occupied = path.exists()
    if occupied and not (replace_existing and path.is_file()):
        raise ValueError(f"document already exists: {rel_path}")
    meta = dict(payload.get("meta") or {})
    requested_id = meta.get("id")
    page_id = (
        requested_id.strip()
        if isinstance(requested_id, str) and requested_id.strip()
        else str(uuid.uuid4())
    )
    markdown = str(payload.get("markdown") or "")
    if occupied:
        # MarkdownPageStore.create refuses an occupied path, so render the new
        # Page outside the workspace first and commit it with a single atomic
        # replace: a crash before that leaves the user's existing file intact.
        with tempfile.TemporaryDirectory() as staging_root:
            staging = Path(staging_root) / path.name
            MarkdownPageStore().create(staging, page_id, markdown, meta)
            atomic_write(path, staging.read_bytes())
    else:
        MarkdownPageStore().create(path, page_id, markdown, meta)
    _invalidate_scan_cache(workspace)
    return next(
        document
        for document in workspace_scan(str(workspace))["documents"]
        if document["path"] == rel_path
    )


# Import-supported extensions for external DnD. Mirrors the frontend D2 module's
# whitelist (`src/lib/external-import-resolver.ts`). Keep the two in sync — the
# frontend rejects out-of-whitelist files before they reach this handler, but
# we re-validate on the backend boundary so a misbehaving caller (or browser
# DataTransfer feeding a `.txt` straight through) can't smuggle a non-document
# file into the workspace.
IMPORT_SUPPORTED_EXTENSIONS = {".md", ".markdown", ".pdf", ".xlsx", ".csv"}


def doc_import_external(
    root: str,
    src_path: Any,
    byte_list: Any,
    dest_folder: str,
    name: str,
    mode: str,
) -> dict[str, Any]:
    """Copy an external `.md`/`.markdown`/`.pdf`/`.xlsx`/`.csv` into the workspace.

    Always-copy semantics: the source on disk (e.g. user's Downloads) is left
    untouched.

    `mode`:
    - ``"create"`` — refuse to overwrite. A name clash raises ``FileExistsError``
      and the FastAPI layer translates it to a 409.
    - ``"replace"`` — overwrite the user file at the destination. Any
      pre-existing ``.doxmind`` artifact is deliberately left byte-identical.
      Normal Page open ignores it; nothing reads or rewrites it.
    """
    if mode not in {"create", "replace"}:
        raise ValueError(f"unsupported import mode: {mode}")
    if not name.strip():
        raise ValueError("import name is required")

    workspace = canonical_workspace_root(root)

    # Build the destination path. `dest_folder` is a workspace-relative folder
    # (empty string for root); the resolver below catches any escape attempts.
    dest_folder_clean = dest_folder.strip()
    rel_path = f"{dest_folder_clean}/{name}" if dest_folder_clean else name

    suffix = Path(name).suffix.lower()
    if suffix not in IMPORT_SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"only .md, .markdown, .pdf, .xlsx, .csv are supported for external import: {name}"
        )

    destination = resolve_workspace_path_for_write(workspace, rel_path)
    if mode == "create" and destination.exists():
        # The frontend toast in #67 reads "File already exists; collision
        # handling ships in #69". Keep the message machine-friendly so the
        # frontend can pattern-match if it wants to render a richer toast.
        raise FileExistsError(f"destination already exists: {rel_path}")
    if mode == "replace" and not destination.exists():
        # Replace presupposes a pre-existing destination; if the user file
        # vanished between plan and resolve we surface a recoverable error
        # instead of silently degrading to create — that would mask a race
        # with an external delete.
        raise FileNotFoundError(f"destination does not exist for replace: {rel_path}")

    destination.parent.mkdir(parents=True, exist_ok=True)

    if isinstance(byte_list, (list, tuple)):
        try:
            data = bytes(int(b) & 0xFF for b in byte_list)
        except (TypeError, ValueError) as err:
            raise ValueError(f"invalid bytes payload: {err}") from err
        atomic_write(destination, data)
    elif isinstance(src_path, str) and src_path.strip():
        source = Path(src_path).expanduser()
        if not source.is_file():
            raise ValueError(f"source file does not exist: {src_path}")
        # `shutil.copyfile` is the always-copy primitive: it preserves the
        # source on disk byte-for-byte. We deliberately don't call `copy2` —
        # carrying mtime / metadata across is a UX call we haven't made yet.
        # In replace mode this overwrites only the user file; the hidden
        # sidecar next to it is intentionally NOT touched.
        shutil.copyfile(source, destination)
    else:
        raise ValueError("doc_import_external requires either srcPath or bytes")

    _invalidate_scan_cache(workspace)
    imported_path = relative_path_string(workspace, destination)
    return next(
        document
        for document in workspace_scan(str(workspace))["documents"]
        if document["path"] == imported_path
    )


def _existing_legacy_sidecar_family(document_path: Path) -> list[Path]:
    """Return existing recovery artifacts for ``document_path`` in stable order."""
    sidecar = sidecar_path_for(document_path)
    candidates = [
        sidecar,
        sidecar.with_name(f"{sidecar.name}.bak"),
        sidecar.with_name(f"{sidecar.name}.lock"),
    ]
    corrupt_prefix = f"{sidecar.name}.corrupt-"
    if sidecar.parent.is_dir():
        candidates.extend(
            sorted(
                (
                    candidate
                    for candidate in sidecar.parent.iterdir()
                    if candidate.name.startswith(corrupt_prefix)
                ),
                key=lambda candidate: candidate.name,
            )
        )
    return [candidate for candidate in candidates if candidate.exists() or candidate.is_symlink()]


def _is_same_filesystem_entry(left: Path, right: Path) -> bool:
    """Whether two paths name one on-disk entry.

    A case-only rename on a case-insensitive filesystem finds the moved entry
    itself waiting at the destination; identity is what separates that from a
    genuine collision. Mirrors ``isSameFilesystemEntry`` in the Electron core.
    """
    try:
        left_stat = left.lstat()
        right_stat = right.lstat()
    except OSError:
        return False
    return (left_stat.st_dev, left_stat.st_ino) == (right_stat.st_dev, right_stat.st_ino)


def _foreign_sidecar_family(destination: Path, source_artifacts: list[Path]) -> list[Path]:
    """Recovery artifacts already at ``destination`` that are not the source's own.

    ``Path.exists`` is case-insensitive on macOS and Windows, so during a
    case-only rename the source's ``.readme.doxmind`` answers for
    ``.README.doxmind``. Only a genuinely different entry blocks the move.
    """
    return [
        artifact
        for artifact in _existing_legacy_sidecar_family(destination)
        if not any(_is_same_filesystem_entry(artifact, member) for member in source_artifacts)
    ]


def _move_document_family(root: str, old_path: str, new_path: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    ensure_same_document_extension(old_path, new_path)
    source = resolve_existing_workspace_path(workspace, old_path)
    destination = resolve_workspace_path_for_write(workspace, new_path)
    if destination.exists() and not _is_same_filesystem_entry(source, destination):
        raise ValueError(f"destination already exists: {new_path}")

    source_sidecar = sidecar_path_for(source)
    source_artifacts = _existing_legacy_sidecar_family(source)
    destination_sidecar = sidecar_path_for(destination)
    destination_artifacts = _foreign_sidecar_family(destination, source_artifacts)
    if destination_artifacts:
        raise ValueError(
            "destination sidecar already exists: "
            f"{relative_path_string(workspace, destination_artifacts[0])}"
        )

    artifact_moves = [
        (
            source_artifact,
            destination_sidecar.with_name(
                f"{destination_sidecar.name}{source_artifact.name[len(source_sidecar.name) :]}"
            ),
        )
        for source_artifact in source_artifacts
    ]
    destination.parent.mkdir(parents=True, exist_ok=True)
    page_move_attempted = False
    attempted_artifact_moves: list[tuple[Path, Path]] = []
    try:
        page_move_attempted = True
        source.rename(destination)
        for source_artifact, destination_artifact in artifact_moves:
            attempted_artifact_moves.append((source_artifact, destination_artifact))
            source_artifact.rename(destination_artifact)
        result = document_dto_for_path(workspace, destination)
    except Exception as exc:  # noqa: BLE001
        rollback_errors: list[str] = []
        for source_artifact, destination_artifact in reversed(attempted_artifact_moves):
            source_exists = source_artifact.exists() or source_artifact.is_symlink()
            destination_exists = destination_artifact.exists() or destination_artifact.is_symlink()
            if destination_exists and not source_exists:
                try:
                    destination_artifact.rename(source_artifact)
                except Exception as rollback_exc:  # noqa: BLE001
                    rollback_errors.append(f"{destination_artifact.name}: {rollback_exc}")
            elif destination_exists and source_exists:
                rollback_errors.append(
                    f"{destination_artifact.name}: source and destination both exist"
                )

        if page_move_attempted:
            source_exists = source.exists() or source.is_symlink()
            destination_exists = destination.exists() or destination.is_symlink()
            if destination_exists and not source_exists:
                try:
                    destination.rename(source)
                except Exception as rollback_exc:  # noqa: BLE001
                    rollback_errors.append(f"{destination.name}: {rollback_exc}")
            elif destination_exists and source_exists:
                rollback_errors.append(f"{destination.name}: source and destination both exist")

        _invalidate_scan_cache(workspace)
        rollback_status = (
            "completed" if not rollback_errors else f"incomplete ({'; '.join(rollback_errors)})"
        )
        raise RuntimeError(f"document move failed; rollback {rollback_status}: {exc}") from exc

    _invalidate_scan_cache(workspace)
    return result


def move_attachment_pair(root: str, old_path: str, new_path: str) -> dict[str, Any]:
    """Legacy structural command restricted to non-Markdown Attachments."""
    workspace = canonical_workspace_root(root)
    source = resolve_existing_workspace_path(workspace, old_path)
    if source.is_dir():
        raise ValueError("Folder rename/move must use workspace_relocate_folder")
    if is_markdown_file(source):
        raise ValueError("Page rename/move must use workspace_relocate_page")
    return _move_document_family(root, old_path, new_path)


def _workspace_markdown_relpaths(workspace: Path) -> set[str]:
    return {
        relative_path_string(workspace, path)
        for path in iter_workspace_document_paths(workspace)
        if is_markdown_file(path)
    }


def _ensure_complete_relocation_topology(
    workspace: Path,
    checked_pages: dict[str, dict[str, Any]],
    operation: str,
) -> None:
    current_pages = _workspace_markdown_relpaths(workspace)
    checked_paths = set(checked_pages)
    unplanned = sorted(current_pages - checked_paths)
    missing = sorted(checked_paths - current_pages)
    if unplanned or missing:
        details = []
        if unplanned:
            details.append(f"unplanned Pages {', '.join(unplanned)}")
        if missing:
            details.append(f"missing Pages {', '.join(missing)}")
        raise ValueError(f"{operation} topology changed: {'; '.join(details)}")


def _prepare_relocation_checks(
    workspace: Path,
    checks_value: Any,
    operation: str,
    store: MarkdownPageStore,
) -> dict[str, dict[str, Any]]:
    if not isinstance(checks_value, list):
        raise ValueError(f"{operation} checks must be an array")
    checked_pages: dict[str, dict[str, Any]] = {}
    for value in checks_value:
        if not isinstance(value, dict):
            raise ValueError(f"invalid {operation} check")
        rel_path = validate_relative_path(str(value.get("path") or "")).as_posix()
        ensure_markdown_path(rel_path)
        if rel_path in checked_pages:
            raise ValueError(f"duplicate {operation} check: {rel_path}")
        expected_revision = value.get("expectedRevision")
        if not isinstance(expected_revision, str) or not expected_revision:
            raise ValueError(f"{operation} check requires a revision: {rel_path}")
        page_path = resolve_existing_workspace_path(workspace, rel_path)
        if not page_path.is_file():
            raise ValueError(f"Page is not a file: {rel_path}")
        before_bytes = page_path.read_bytes()
        revision = f"sha256:{hashlib.sha256(before_bytes).hexdigest()}"
        if revision != expected_revision:
            raise PageRevisionConflictError(page_path, expected_revision, revision)
        store.read(page_path)
        checked_pages[rel_path] = {
            "path": page_path,
            "bytes": before_bytes,
            "revision": revision,
        }
    _ensure_complete_relocation_topology(workspace, checked_pages, operation)
    return checked_pages


def _revalidate_relocation_checks(
    workspace: Path,
    checked_pages: dict[str, dict[str, Any]],
    operation: str,
) -> None:
    _ensure_complete_relocation_topology(workspace, checked_pages, operation)
    for checked in checked_pages.values():
        current_bytes = checked["path"].read_bytes()
        if current_bytes == checked["bytes"]:
            continue
        actual_revision = f"sha256:{hashlib.sha256(current_bytes).hexdigest()}"
        raise PageRevisionConflictError(checked["path"], checked["revision"], actual_revision)


def workspace_relocate_page(
    root: str,
    old_path: str,
    new_path: str,
    expected_revision: Any,
    checks_value: Any,
    moved_markdown: Any,
    writes_value: Any,
) -> dict[str, Any]:
    """Relocate one Page and commit all source-preserving link repairs together."""
    workspace = canonical_workspace_root(root)
    ensure_markdown_path(old_path)
    ensure_markdown_path(new_path)
    normalized_old = validate_relative_path(old_path).as_posix()
    normalized_new = validate_relative_path(new_path).as_posix()
    if normalized_old == normalized_new:
        raise ValueError("Page relocation requires a new path")
    if not isinstance(expected_revision, str) or not expected_revision:
        raise ValueError("Page relocation requires the moved Page revision")
    if moved_markdown is not None and not isinstance(moved_markdown, str):
        raise ValueError("Page relocation movedMarkdown must be Markdown")
    if not isinstance(writes_value, list):
        raise ValueError("Page relocation writes must be an array")

    store = MarkdownPageStore()
    checked_pages = _prepare_relocation_checks(workspace, checks_value, "Page relocation", store)
    source_check = checked_pages.get(normalized_old)
    if source_check is None or source_check["revision"] != expected_revision:
        raise ValueError(
            f"Page relocation moved source is missing its matching topology check: {normalized_old}"
        )

    source = source_check["path"]
    if not source.is_file():
        raise ValueError(f"Page is not a file: {old_path}")
    source_bytes = source_check["bytes"]
    source_revision = source_check["revision"]
    # Validate UTF-8 and the post-move DTO inputs before any path changes.
    document_dto_for_path(workspace, source)

    destination = resolve_workspace_path_for_write(workspace, normalized_new)
    if (destination.exists() or destination.is_symlink()) and not _is_same_filesystem_entry(
        source, destination
    ):
        raise ValueError(f"destination already exists: {new_path}")

    source_sidecar = sidecar_path_for(source)
    destination_sidecar = sidecar_path_for(destination)
    source_artifacts = _existing_legacy_sidecar_family(source)
    destination_artifacts = _foreign_sidecar_family(destination, source_artifacts)
    for artifact in [*source_artifacts, *destination_artifacts]:
        if artifact.is_symlink():
            raise ValueError(f"legacy sidecar family contains a symbolic link: {artifact}")
        if not artifact.is_file():
            raise ValueError(f"legacy sidecar family member is not a file: {artifact}")
    if destination_artifacts:
        raise ValueError(
            "destination sidecar family already exists: "
            + ", ".join(relative_path_string(workspace, path) for path in destination_artifacts)
        )

    seen_paths: set[str] = set()
    write_plans: list[dict[str, Any]] = []
    for value in writes_value:
        if not isinstance(value, dict):
            raise ValueError("invalid Page relocation write")
        rel_path = validate_relative_path(str(value.get("path") or "")).as_posix()
        ensure_markdown_path(rel_path)
        if rel_path in seen_paths:
            raise ValueError(f"duplicate Page relocation write: {rel_path}")
        seen_paths.add(rel_path)
        if rel_path in {normalized_old, normalized_new}:
            raise ValueError(f"moved Page repairs must use movedMarkdown: {normalized_new}")
        write_revision = value.get("expectedRevision")
        markdown = value.get("markdown")
        if not isinstance(write_revision, str) or not write_revision:
            raise ValueError(f"Page relocation write requires a revision: {rel_path}")
        if not isinstance(markdown, str):
            raise ValueError(f"Page relocation write requires Markdown: {rel_path}")
        checked = checked_pages.get(rel_path)
        if checked is None or checked["revision"] != write_revision:
            raise ValueError(
                f"Page relocation write is missing its matching topology check: {rel_path}"
            )
        page_path = checked["path"]
        before_bytes = checked["bytes"]
        write_plans.append(
            {
                "path": page_path,
                "rel_path": rel_path,
                "before_bytes": before_bytes,
                "expected_revision": write_revision,
                "markdown": markdown,
            }
        )

    artifact_moves = [
        (
            artifact,
            destination_sidecar.with_name(
                f"{destination_sidecar.name}{artifact.name[len(source_sidecar.name) :]}"
            ),
        )
        for artifact in source_artifacts
    ]
    _revalidate_relocation_checks(workspace, checked_pages, "Page relocation")
    missing_directories: list[Path] = []
    current = destination.parent
    while current != workspace and not current.exists():
        missing_directories.append(current)
        current = current.parent
    destination.parent.mkdir(parents=True, exist_ok=True)

    moved: list[tuple[Path, Path]] = []
    written: list[dict[str, Any]] = []
    try:
        source.rename(destination)
        moved.append((source, destination))
        for artifact_source, artifact_destination in artifact_moves:
            artifact_source.rename(artifact_destination)
            moved.append((artifact_source, artifact_destination))

        if moved_markdown is None:
            moved_revision = source_revision
        else:
            moved_revision = store.write(
                destination,
                moved_markdown,
                expected_revision=source_revision,
            )
            written.append(
                {
                    "path": destination,
                    "rel_path": normalized_new,
                    "before_bytes": source_bytes,
                    "output_revision": moved_revision,
                }
            )

        write_results: list[dict[str, str]] = []
        for plan in write_plans:
            revision = store.write(
                plan["path"],
                plan["markdown"],
                expected_revision=plan["expected_revision"],
            )
            written.append({**plan, "output_revision": revision})
            write_results.append({"path": plan["rel_path"], "revision": revision})

        document = document_dto_for_path(workspace, destination)
        _invalidate_scan_cache(workspace)
        return {
            "document": document,
            "revision": moved_revision,
            "writes": write_results,
        }
    except Exception as exc:  # noqa: BLE001
        rollback_errors: list[str] = []
        for write in reversed(written):
            page_path = write["path"]
            try:
                current_bytes = page_path.read_bytes()
                current_revision = f"sha256:{hashlib.sha256(current_bytes).hexdigest()}"
                if current_revision != write["output_revision"]:
                    rollback_errors.append(f"{write['rel_path']}: changed during relocation")
                    continue
                atomic_write(page_path, write["before_bytes"])
            except Exception as rollback_exc:  # noqa: BLE001
                rollback_errors.append(f"{write['rel_path']}: {rollback_exc}")

        for move_source, move_destination in reversed(moved):
            source_exists = move_source.exists() or move_source.is_symlink()
            destination_exists = move_destination.exists() or move_destination.is_symlink()
            if destination_exists and not source_exists:
                try:
                    move_destination.rename(move_source)
                except Exception as rollback_exc:  # noqa: BLE001
                    rollback_errors.append(f"{move_destination.name}: {rollback_exc}")
            elif destination_exists and source_exists:
                rollback_errors.append(
                    f"{move_destination.name}: source and destination both exist"
                )

        if not rollback_errors:
            for directory in missing_directories:
                with suppress(OSError):
                    directory.rmdir()
        _invalidate_scan_cache(workspace)
        if rollback_errors:
            raise RuntimeError(
                f"page_relocation_rollback_incomplete: {exc}; {'; '.join(rollback_errors)}"
            ) from exc
        raise RuntimeError(f"Page relocation failed and was rolled back: {exc}") from exc


def workspace_relocate_folder(
    root: str,
    old_path: str,
    new_path: str,
    checks_value: Any,
    writes_value: Any,
) -> dict[str, Any]:
    """Relocate one folder and commit all affected Markdown link repairs together."""
    workspace = canonical_workspace_root(root)
    old_relative = validate_relative_path(old_path)
    new_relative = validate_relative_path(new_path)
    normalized_old = old_relative.as_posix()
    normalized_new = new_relative.as_posix()
    if normalized_old == normalized_new:
        raise ValueError("Folder relocation requires a new path")
    if normalized_new.startswith(f"{normalized_old}/"):
        raise ValueError("Folder cannot be relocated inside itself")
    source = resolve_existing_workspace_path(workspace, normalized_old)
    if not source.is_dir():
        raise ValueError(f"folder is not a directory: {old_path}")
    destination = resolve_workspace_path_for_write(workspace, normalized_new)
    if (destination.exists() or destination.is_symlink()) and not _is_same_filesystem_entry(
        source, destination
    ):
        raise ValueError(f"destination already exists: {new_path}")
    if not isinstance(writes_value, list):
        raise ValueError("Folder relocation writes must be an array")

    store = MarkdownPageStore()
    checked_pages = _prepare_relocation_checks(workspace, checks_value, "Folder relocation", store)

    seen_sources: set[str] = set()
    seen_destinations: set[str] = set()
    write_plans: list[dict[str, Any]] = []
    for value in writes_value:
        if not isinstance(value, dict):
            raise ValueError("invalid Folder relocation write")
        source_path = validate_relative_path(str(value.get("sourcePath") or "")).as_posix()
        destination_path = validate_relative_path(
            str(value.get("destinationPath") or "")
        ).as_posix()
        ensure_markdown_path(source_path)
        ensure_markdown_path(destination_path)
        if source_path in seen_sources:
            raise ValueError(f"duplicate Folder relocation write: {source_path}")
        if destination_path in seen_destinations:
            raise ValueError(f"duplicate Folder relocation destination: {destination_path}")
        seen_sources.add(source_path)
        seen_destinations.add(destination_path)
        expected_revision = value.get("expectedRevision")
        markdown = value.get("markdown")
        if not isinstance(expected_revision, str) or not expected_revision:
            raise ValueError(f"Folder relocation write requires a revision: {source_path}")
        if not isinstance(markdown, str):
            raise ValueError(f"Folder relocation write requires Markdown: {source_path}")
        checked = checked_pages.get(source_path)
        if checked is None or checked["revision"] != expected_revision:
            raise ValueError(
                f"Folder relocation write is missing its matching topology check: {source_path}"
            )
        source_relative = Path(source_path)
        moved_source = source_relative == old_relative or old_relative in source_relative.parents
        expected_destination = (
            (new_relative / source_relative.relative_to(old_relative)).as_posix()
            if moved_source
            else source_path
        )
        if destination_path != expected_destination:
            raise ValueError(
                "Folder relocation write path mismatch: "
                f"{source_path} -> {destination_path}, expected {expected_destination}"
            )
        after_path = workspace / Path(destination_path) if moved_source else checked["path"]
        write_plans.append(
            {
                "source_path": source_path,
                "destination_path": destination_path,
                "after_path": after_path,
                "before_bytes": checked["bytes"],
                "expected_revision": expected_revision,
                "markdown": markdown,
            }
        )

    _revalidate_relocation_checks(workspace, checked_pages, "Folder relocation")
    missing_directories: list[Path] = []
    current = destination.parent
    while current != workspace and not current.exists():
        missing_directories.append(current)
        current = current.parent
    destination.parent.mkdir(parents=True, exist_ok=True)

    moved = False
    written: list[dict[str, Any]] = []
    try:
        source.rename(destination)
        moved = True
        write_results: list[dict[str, str]] = []
        for plan in write_plans:
            revision = store.write(
                plan["after_path"],
                plan["markdown"],
                expected_revision=plan["expected_revision"],
            )
            written.append({**plan, "output_revision": revision})
            write_results.append({"path": plan["destination_path"], "revision": revision})
        _invalidate_scan_cache(workspace)
        return {"path": normalized_new, "writes": write_results}
    except Exception as exc:  # noqa: BLE001
        rollback_errors: list[str] = []
        for write in reversed(written):
            page_path = write["after_path"]
            try:
                current_bytes = page_path.read_bytes()
                current_revision = f"sha256:{hashlib.sha256(current_bytes).hexdigest()}"
                if current_revision != write["output_revision"]:
                    rollback_errors.append(
                        f"{write['destination_path']}: changed during relocation"
                    )
                    continue
                atomic_write(page_path, write["before_bytes"])
            except Exception as rollback_exc:  # noqa: BLE001
                rollback_errors.append(f"{write['destination_path']}: {rollback_exc}")

        if moved:
            try:
                destination.rename(source)
            except Exception as rollback_exc:  # noqa: BLE001
                rollback_errors.append(f"{normalized_new}: {rollback_exc}")
        if not rollback_errors:
            for directory in missing_directories:
                with suppress(OSError):
                    directory.rmdir()
        _invalidate_scan_cache(workspace)
        if rollback_errors:
            raise RuntimeError(
                f"folder_relocation_rollback_incomplete: {exc}; {'; '.join(rollback_errors)}"
            ) from exc
        raise RuntimeError(f"Folder relocation failed and was rolled back: {exc}") from exc


def doc_delete(root: str, rel_path: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    source = resolve_existing_workspace_path(workspace, rel_path)
    if not source.is_file():
        raise ValueError(f"document is not a file: {rel_path}")
    if not is_workspace_document_file(source):
        raise ValueError(
            f"document path must end in .md, .markdown, .pdf, .xlsx, .xlsm, or .csv: {rel_path}"
        )

    sidecar_path = sidecar_path_for(source)
    legacy_artifacts = _existing_legacy_sidecar_family(source)
    sidecar_existed = sidecar_path in legacy_artifacts
    sidecar_rel: str | None = (
        relative_path_string(workspace, sidecar_path) if sidecar_existed else None
    )

    _move_to_os_trash(source)
    # The primary file has left the workspace — invalidate the scan cache
    # before the sidecar step, otherwise a partial failure below leaves the
    # cache serving a stale entry for a `.md` that's already in OS Trash.
    _invalidate_scan_cache(workspace)
    artifact_errors: list[str] = []
    for legacy_artifact in legacy_artifacts:
        try:
            _move_to_os_trash(legacy_artifact)
        except Exception as exc:  # noqa: BLE001
            artifact_errors.append(f"{legacy_artifact.name}: {exc}")

    if artifact_errors:
        raise RuntimeError(
            "document moved to Trash but legacy recovery artifact move failed: "
            f"{'; '.join(artifact_errors)}"
        )

    return {
        "path": rel_path,
        "sidecarPath": sidecar_rel,
    }


def _move_to_os_trash(path: Path) -> None:
    # send2trash takes a string path on every platform it supports.
    send2trash(str(path))


def workspace_create_folder(root: str, rel_path: str) -> None:
    workspace = canonical_workspace_root(root)
    destination = resolve_workspace_path_for_write(workspace, rel_path)
    if destination.exists():
        raise ValueError(f"folder already exists: {rel_path}")
    destination.mkdir(parents=True, exist_ok=False)
    _invalidate_scan_cache(workspace)


def workspace_delete_folder(root: str, rel_path: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    source = resolve_existing_workspace_path(workspace, rel_path)
    if not source.is_dir():
        raise ValueError(f"folder is not a directory: {rel_path}")
    _move_to_os_trash(source)
    _invalidate_scan_cache(workspace)
    return {
        "path": rel_path,
        "sidecarPath": None,
    }


def canonical_workspace_root(root: str) -> Path:
    if not root.strip():
        raise ValueError("workspace root is required")
    path = Path(root).expanduser().resolve()
    if not path.is_dir():
        raise ValueError(f"workspace root is not a directory: {path}")
    return path


def validate_relative_path(path: str) -> Path:
    if not path.strip():
        raise ValueError("document path is required")
    input_path = Path(path)
    if input_path.is_absolute():
        raise ValueError(f"document path must be relative: {path}")
    clean = Path()
    for part in input_path.parts:
        if part in {"", "."}:
            continue
        if part == "..":
            raise ValueError(f"document path escapes workspace root: {path}")
        clean = clean / part
    if not clean.parts:
        raise ValueError("document path is required")
    return clean


def ensure_markdown_path(path: str) -> None:
    if Path(path).suffix.lower() not in {".md", ".markdown"}:
        raise ValueError(f"document path must end in .md or .markdown: {path}")


WORKSPACE_DOCUMENT_SUFFIXES = {
    ".md",
    ".markdown",
    ".pdf",
    ".xlsx",
    ".xlsm",
    ".csv",
    ".html",
    ".htm",
}


def ensure_same_document_extension(old_path: str, new_path: str) -> None:
    """A rename or in-place move may target any document type, but must not
    change the file's type: the destination keeps the source's extension so a
    ``.pdf`` can't silently become a ``.md``. This browser-development adapter
    mirrors the Electron core's extension contract."""
    old_ext = Path(old_path).suffix.lower()
    new_ext = Path(new_path).suffix.lower()
    for ext, path in ((old_ext, old_path), (new_ext, new_path)):
        if ext not in WORKSPACE_DOCUMENT_SUFFIXES:
            raise ValueError(
                "document path must end in .md, .markdown, .pdf, .xlsx, .xlsm, "
                f".csv, .html, or .htm: {path}"
            )
    if old_ext != new_ext:
        raise ValueError(f"cannot change document type on move: {old_path} -> {new_path}")


def resolve_existing_workspace_path(root: Path, rel_path: str) -> Path:
    relative = validate_relative_path(rel_path)
    candidate = root / relative
    try:
        metadata = candidate.lstat()
    except FileNotFoundError as error:
        raise ValueError(f"workspace path does not exist: {rel_path}") from error
    if stat.S_ISLNK(metadata.st_mode):
        raise ValueError(f"symbolic link operations are not allowed: {rel_path}")
    resolved = candidate.resolve(strict=True)
    ensure_path_within_root(root, resolved)
    return candidate


def resolve_workspace_path_for_write(root: Path, rel_path: str) -> Path:
    relative = validate_relative_path(rel_path)
    candidate = root / relative
    try:
        candidate_metadata = candidate.lstat()
    except FileNotFoundError:
        candidate_metadata = None
    if candidate_metadata is not None and stat.S_ISLNK(candidate_metadata.st_mode):
        raise ValueError(f"symbolic link writes are not allowed: {rel_path}")

    nearest = candidate if candidate_metadata is not None else candidate.parent
    while True:
        try:
            nearest_metadata = nearest.lstat()
            break
        except FileNotFoundError:
            parent = nearest.parent
            if parent == nearest:
                raise ValueError(f"document path escapes workspace root: {rel_path}")
            nearest = parent
    if stat.S_ISLNK(nearest_metadata.st_mode):
        raise ValueError(f"symbolic link writes are not allowed: {rel_path}")
    ensure_path_within_root(root, nearest.resolve())
    return candidate


def ensure_path_within_root(root: Path, path: Path) -> None:
    if os.path.commonpath([str(root), str(path)]) != str(root):
        raise ValueError(f"path escapes workspace root: {path}")


def scan_document_dto(root: Path, path: Path) -> dict[str, Any]:
    """One undecodable Page must not hide every healthy Page in the workspace.

    Mirrors `scanDocumentDto` in electron/native-workspace.js: the scan falls back
    to path identity for a file it cannot decode, and `doc_read` still refuses the
    bytes when the user opens it. Without this, a single Latin-1 Markdown file
    left behind by an older editor failed the whole scan and the sidebar rendered
    empty.
    """
    try:
        return document_dto_for_path(root, path)
    except UnicodeDecodeError:
        rel_path = relative_path_string(root, path)
        return {
            "id": stable_path_id(rel_path),
            "idSource": "path",
            "path": rel_path,
            "name": path.name,
            "title": path.stem,
            "documentType": "markdown",
        }


def document_dto_for_path(root: Path, path: Path) -> dict[str, Any]:
    rel_path = relative_path_string(root, path)
    if is_pdf_file(path):
        document_type = "pdf"
    elif is_excel_file(path):
        document_type = "excel"
    elif is_html_file(path):
        document_type = "html"
    else:
        document_type = "markdown"
    if document_type == "markdown":
        raw = path.read_text(encoding="utf-8")
        frontmatter_id, title = parse_frontmatter_scan_fields(raw)
        scan_meta, _ = parse_frontmatter(raw)
        scan_meta = project_page_meta(scan_meta)
        title = title or path.stem  # #148: no authored frontmatter -> title is the filename
        # Identity is portable: frontmatter for doXmind-created Pages, path for
        # external Markdown that has no id. A legacy Page sidecar never wins.
        if frontmatter_id:
            id_source = "frontmatter"
            doc_id = frontmatter_id
        else:
            id_source = "path"
            doc_id = stable_path_id(rel_path)
    else:
        id_source = "path"
        doc_id = stable_path_id(rel_path)
        title = path.stem
        scan_meta = {}
    dto = {
        "id": doc_id,
        "idSource": id_source,
        "path": rel_path,
        "name": path.name,
        "title": title,
        "documentType": document_type,
    }
    for key in ("icon", "cover", "cover_position", "favorite"):
        value = scan_meta.get(key)
        if value is not None:
            dto[key if key != "cover_position" else "coverPosition"] = value
    # Aliases ride the scan because they are how a Wiki Link resolves. Resolution runs
    # against the whole workspace, not the open Page, so leaving them behind meant
    # `[[Alias]]` could only ever work for a Page the session had already opened.
    aliases = scan_meta.get("aliases")
    if isinstance(aliases, list) and all(isinstance(value, str) for value in aliases):
        dto["aliases"] = aliases
    return dto


def iter_workspace_document_paths(workspace: Path):
    # Prune generated and legacy cache directories before descent. Path.rglob
    # can only filter after it has enumerated a subtree, which means a normal
    # scan would still touch every entry under an old `.doxmind/` directory.
    documents: list[Path] = []
    for current_root, directory_names, filenames in os.walk(
        workspace, topdown=True, followlinks=False
    ):
        directory_names[:] = [name for name in directory_names if name not in IGNORED_SCAN_DIRS]
        current = Path(current_root)
        for filename in filenames:
            path = current / filename
            if (
                not path.is_symlink()
                and not is_hidden_sidecar_name(filename)
                and is_workspace_document_file(path)
            ):
                documents.append(path)

    # Sort by lowercased file name so listing/search order is deterministic
    # across scans and matches the frontend's name-asc sort.
    yield from sorted(documents, key=lambda path: (path.name.lower(), path.as_posix()))


def parse_frontmatter_scan_fields(raw: str) -> tuple[str | None, str | None]:
    head = extract_frontmatter_block(raw)
    if head is None:
        return None, None
    source = head.removeprefix("\ufeff")
    lines = source.splitlines()
    if not lines or lines[0] != "---":
        return None, None
    doc_id = None
    title = None
    for line in lines[1:]:
        if line == "---":
            break
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        token = value.strip()
        parsed = parse_yaml_scalar(token)
        if key == "id" and token:
            doc_id = portable_page_id_from_token(token)
        if key == "title" and isinstance(parsed, str) and parsed:
            title = parsed
    return doc_id, title


def is_hidden_sidecar_name(name: str) -> bool:
    if not name.startswith("."):
        return False
    marker = ".doxmind"
    marker_index = name.find(marker, 1)
    if marker_index <= 1:
        return False
    tail_index = marker_index + len(marker)
    return tail_index == len(name) or name[tail_index] == "."


def is_markdown_file(path: Path) -> bool:
    return path.suffix.lower() in {".md", ".markdown"}


def is_pdf_file(path: Path) -> bool:
    return path.suffix.lower() == ".pdf"


def is_excel_file(path: Path) -> bool:
    return path.suffix.lower() in {".xlsx", ".xlsm", ".csv"}


def is_html_file(path: Path) -> bool:
    # HTML is a read-only Attachment; its bytes never enter the Markdown Page editor.
    return path.suffix.lower() in {".html", ".htm"}


def is_workspace_document_file(path: Path) -> bool:
    return is_markdown_file(path) or is_pdf_file(path) or is_excel_file(path) or is_html_file(path)


def relative_path_string(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def stable_path_id(path: str) -> str:
    hash_value = 0xCBF29CE484222325
    for byte in path.encode():
        hash_value ^= byte
        hash_value = (hash_value * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"path:{hash_value:016x}"
