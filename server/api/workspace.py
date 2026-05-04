"""Local Markdown workspace API for plain web development.

The Tauri app calls filesystem commands directly. A regular browser cannot do
that, so this router exposes the same command names over localhost while keeping
the source of truth as `.md` files plus hidden `.doxmind` sidecars.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.sidecar_io import (
    atomic_write,
    now_iso,
    parse_frontmatter,
    parse_yaml_scalar,
    read_sidecar,
    sidecar_path_for,
)
from services.synthetic_document import SyntheticDocumentFactory

router = APIRouter()


IGNORED_SCAN_DIRS = {".git", "node_modules", "target", ".next", "out", "dist", "build", ".trash"}

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
    """Invoke a local workspace command by its Tauri-compatible name."""
    try:
        return _invoke(request.command, request.payload)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _invoke(command: str, payload: dict[str, Any]) -> Any:
    if command == "workspace_default_root":
        return workspace_default_root()
    if command == "workspace_scan":
        return workspace_scan(str(payload.get("root") or ""))
    if command == "workspace_index_rebuild":
        return workspace_index_rebuild(str(payload.get("root") or ""))
    if command == "workspace_markdown_search":
        return workspace_markdown_search(
            str(payload.get("root") or ""),
            str(payload.get("query") or ""),
            payload.get("limit"),
        )
    if command == "doc_read":
        return read_doc(Path(str(payload.get("path") or "")))
    if command == "workspace_read_binary":
        return read_workspace_binary(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
        )
    if command == "workspace_read_pdf_editor_state":
        return read_pdf_editor_state(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
        )
    if command == "workspace_write_pdf_editor_state":
        return write_pdf_editor_state(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
            payload.get("payload") or {},
        )
    if command == "workspace_read_excel_editor_state":
        return read_excel_editor_state(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
        )
    if command == "workspace_write_excel_editor_state":
        return write_excel_editor_state(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
            payload.get("payload") or {},
        )
    if command == "workspace_read_pdf_doc_state":
        return read_pdf_doc_state(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
        )
    if command == "workspace_write_pdf_parsed_cache":
        return write_pdf_parsed_cache(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
            str(payload.get("sourceHash") or ""),
            payload.get("parsed") or {},
        )
    if command == "workspace_read_excel_doc_state":
        return read_excel_doc_state(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
        )
    if command == "workspace_write_excel_parsed_cache":
        return write_excel_parsed_cache(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
            str(payload.get("sourceHash") or ""),
            payload.get("parsed") or {},
        )
    if command == "doc_write_workspace":
        return write_doc_workspace(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
            payload.get("payload") or {},
        )
    if command == "doc_create":
        return doc_create(str(payload.get("root") or ""), payload.get("payload") or {})
    if command == "doc_create_pdf":
        return doc_create_pdf(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
            payload.get("bytes") or [],
        )
    if command == "doc_create_excel":
        return doc_create_excel(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
            payload.get("bytes") or [],
        )
    if command == "doc_rename":
        return move_document_pair(
            str(payload.get("root") or ""),
            str(payload.get("oldPath") or ""),
            str(payload.get("newPath") or ""),
        )
    if command == "doc_move":
        return move_document_pair(
            str(payload.get("root") or ""),
            str(payload.get("oldPath") or ""),
            str(payload.get("newPath") or ""),
        )
    if command == "doc_delete":
        return doc_delete(str(payload.get("root") or ""), str(payload.get("path") or ""))
    if command == "workspace_create_folder":
        return workspace_create_folder(str(payload.get("root") or ""), str(payload.get("path") or ""))
    if command == "workspace_rename_folder":
        return workspace_rename_folder(
            str(payload.get("root") or ""),
            str(payload.get("oldPath") or ""),
            str(payload.get("newPath") or ""),
        )
    if command == "workspace_delete_folder":
        return workspace_delete_folder(str(payload.get("root") or ""), str(payload.get("path") or ""))

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
    for path in sorted(workspace.rglob("*")):
        if any(part in IGNORED_SCAN_DIRS for part in path.relative_to(workspace).parts[:-1]):
            continue
        if (
            not path.is_file()
            or is_hidden_sidecar_name(path.name)
            or not is_workspace_document_file(path)
        ):
            continue
        documents.append(document_dto_for_path(workspace, path))
    result = {"root": str(workspace), "documents": documents}
    _scan_cache[key] = (now, result)
    return result


def workspace_index_rebuild(root: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    ids: dict[str, str] = {}
    for doc in workspace_scan(root)["documents"]:
        if doc["idSource"] == "frontmatter":
            ids.setdefault(doc["id"], doc["path"])

    index = {"version": 1, "ids": ids}
    index_path = workspace / ".doxmind" / "index.json"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")
    return index


def workspace_markdown_search(root: str, query: str, limit: Any = None) -> list[dict[str, Any]]:
    workspace = canonical_workspace_root(root)
    needle = query.strip().lower()
    if not needle:
        raise ValueError("search query is required")
    max_results = min(int(limit or 50), 200)
    results: list[dict[str, Any]] = []

    for doc in workspace_scan(root)["documents"]:
        if doc.get("documentType") != "markdown":
            continue
        path = workspace / doc["path"]
        raw = path.read_text(encoding="utf-8")
        matches = []
        for line_number, line in enumerate(raw.splitlines(), start=1):
            if needle in line.lower():
                matches.append({"line": line_number, "preview": line.strip()[:240]})
        if matches:
            results.append({"path": doc["path"], "title": doc.get("title"), "matches": matches})
        if len(results) >= max_results:
            break
    return results


def read_doc(path: Path) -> dict[str, Any]:
    from services.markdown_document_state import (
        EmptyDocument,
        MarkdownDocumentState,
        NoSidecar,
        SidecarStale,
        UsedSidecar,
    )

    outcome = MarkdownDocumentState().read(path)
    if isinstance(outcome, UsedSidecar):
        return {
            "html": outcome.html,
            "markdown": outcome.markdown,
            "meta": outcome.meta,
            "extras": outcome.extras,
            "source": "sidecar",
        }
    if isinstance(outcome, EmptyDocument):
        return {"html": "", "markdown": "", "meta": outcome.meta, "extras": None, "source": "empty"}
    if isinstance(outcome, SidecarStale):
        if not outcome.markdown.strip():
            return {
                "html": "",
                "markdown": "",
                "meta": outcome.meta,
                "extras": outcome.salvaged_extras or None,
                "source": "empty",
            }
        return {
            "html": outcome.fresh_html,
            "markdown": outcome.markdown,
            "meta": outcome.meta,
            "extras": outcome.salvaged_extras or None,
            "source": "markdown",
        }
    assert isinstance(outcome, NoSidecar)
    return {
        "html": outcome.html,
        "markdown": outcome.markdown,
        "meta": outcome.meta,
        "extras": None,
        "source": "markdown",
    }


def read_workspace_binary(root: str, rel_path: str) -> list[int]:
    workspace = canonical_workspace_root(root)
    path = resolve_existing_workspace_path(workspace, rel_path)
    if not is_pdf_file(path) and not is_excel_file(path):
        raise ValueError("binary workspace reads are only enabled for PDF and Excel files")
    return list(path.read_bytes())


def read_pdf_editor_state(root: str, rel_path: str) -> dict[str, Any] | None:
    """Deprecated: delegates to ``SyntheticDocumentFactory.open_pdf``.

    Slice 3 of #3 routes the on-disk shape through a markdown-shape
    sidecar; the wire response is preserved. The frontend will switch to
    the unified read/write surface in a later slice and this handler
    will be removed.
    """
    return _read_block_slot_field(root, rel_path, _is_pdf_path, _open_pdf, "editor")


def write_pdf_editor_state(root: str, rel_path: str, payload: dict[str, Any]) -> None:
    """Deprecated: delegates to ``SyntheticDocumentFactory.open_pdf``.

    See :func:`read_pdf_editor_state`.
    """
    _write_block_slot_field(root, rel_path, _is_pdf_path, _open_pdf, "editor", payload)


def read_pdf_doc_state(root: str, rel_path: str) -> dict[str, Any] | None:
    """Deprecated: combined PDF read; delegates to ``SyntheticDocumentFactory``."""
    return _read_block_slot_combined(root, rel_path, _is_pdf_path, _open_pdf)


def write_pdf_parsed_cache(
    root: str, rel_path: str, source_hash: str, parsed: Any
) -> None:
    """Deprecated: delegates to ``SyntheticDocumentFactory.open_pdf``."""
    if not source_hash.strip():
        raise ValueError("sourceHash is required")
    _write_block_slot_field(
        root,
        rel_path,
        _is_pdf_path,
        _open_pdf,
        "parsedCache",
        {"sourceHash": source_hash, "parsed": parsed},
    )


def read_excel_editor_state(root: str, rel_path: str) -> dict[str, Any] | None:
    """Deprecated: delegates to ``SyntheticDocumentFactory.open_excel``."""
    return _read_block_slot_field(root, rel_path, _is_excel_path, _open_excel, "editor")


def write_excel_editor_state(root: str, rel_path: str, payload: dict[str, Any]) -> None:
    """Deprecated: delegates to ``SyntheticDocumentFactory.open_excel``."""
    _write_block_slot_field(root, rel_path, _is_excel_path, _open_excel, "editor", payload)


def read_excel_doc_state(root: str, rel_path: str) -> dict[str, Any] | None:
    """Deprecated: combined Excel read; delegates to ``SyntheticDocumentFactory``."""
    return _read_block_slot_combined(root, rel_path, _is_excel_path, _open_excel)


def write_excel_parsed_cache(
    root: str, rel_path: str, source_hash: str, parsed: Any
) -> None:
    """Deprecated: delegates to ``SyntheticDocumentFactory.open_excel``."""
    if not source_hash.strip():
        raise ValueError("sourceHash is required")
    _write_block_slot_field(
        root,
        rel_path,
        _is_excel_path,
        _open_excel,
        "parsedCache",
        {"sourceHash": source_hash, "parsed": parsed},
    )


def _is_pdf_path(path: Path) -> None:
    if not is_pdf_file(path):
        raise ValueError("PDF editor state is only enabled for PDFs")


def _is_excel_path(path: Path) -> None:
    if not is_excel_file(path):
        raise ValueError("Excel editor state is only enabled for .xlsx/.xlsm files")


def _open_pdf(path: Path):
    return SyntheticDocumentFactory().open_pdf(path)


def _open_excel(path: Path):
    return SyntheticDocumentFactory().open_excel(path)


def _block_slot(document) -> dict[str, Any]:
    extras = document.snapshot.extras or {}
    blocks = extras.get("blocks") if isinstance(extras.get("blocks"), dict) else {}
    slot = blocks.get(document.block_id)
    return slot if isinstance(slot, dict) else {}


def _read_block_slot_field(
    root: str,
    rel_path: str,
    type_check,
    opener,
    slot_field: str,
) -> dict[str, Any] | None:
    workspace = canonical_workspace_root(root)
    path = resolve_existing_workspace_path(workspace, rel_path)
    type_check(path)
    if not sidecar_path_for(path).exists():
        return None
    document = opener(path)
    value = _block_slot(document).get(slot_field)
    return value if isinstance(value, dict) else None


def _read_block_slot_combined(
    root: str,
    rel_path: str,
    type_check,
    opener,
) -> dict[str, Any] | None:
    workspace = canonical_workspace_root(root)
    path = resolve_existing_workspace_path(workspace, rel_path)
    type_check(path)
    if not sidecar_path_for(path).exists():
        return None
    document = opener(path)
    slot = _block_slot(document)
    editor = slot.get("editor")
    cache = slot.get("parsedCache")
    return {
        "editor": editor if isinstance(editor, dict) else None,
        "parsedCache": cache if isinstance(cache, dict) else None,
    }


def _write_block_slot_field(
    root: str,
    rel_path: str,
    type_check,
    opener,
    slot_field: str,
    value: Any,
) -> None:
    from dataclasses import replace as _replace

    workspace = canonical_workspace_root(root)
    path = resolve_existing_workspace_path(workspace, rel_path)
    type_check(path)
    factory = SyntheticDocumentFactory()
    document = opener(path)
    extras = dict(document.snapshot.extras or {})
    blocks_raw = extras.get("blocks")
    blocks = dict(blocks_raw) if isinstance(blocks_raw, dict) else {}
    slot_raw = blocks.get(document.block_id)
    slot = dict(slot_raw) if isinstance(slot_raw, dict) else {}
    slot[slot_field] = value
    blocks[document.block_id] = slot
    extras["blocks"] = blocks
    new_snapshot = _replace(document.snapshot, extras=extras)
    factory.write_full(document, new_snapshot)
    _invalidate_scan_cache(workspace)


def write_doc_workspace(root: str, rel_path: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Persist a markdown document and return its post-write DocReadResult.

    Returning the result eliminates the round-trip the client previously
    needed to refresh state after every save.
    """
    workspace = canonical_workspace_root(root)
    ensure_markdown_path(rel_path)
    path = resolve_workspace_path_for_write(workspace, rel_path)

    # Merge incoming meta with existing sidecar/frontmatter so callers can
    # send partial payloads (the editor only knows about html/markdown).
    incoming_meta = dict(payload.get("meta") or {})
    existing_meta: dict[str, Any] = {}
    existing_extras: Any = None
    if path.exists():
        try:
            raw = path.read_text(encoding="utf-8")
            existing_meta, _ = parse_frontmatter(raw)
        except OSError:
            existing_meta = {}
        sidecar = read_sidecar(sidecar_path_for(path))
        if sidecar:
            if not existing_meta.get("id") and sidecar.get("id"):
                existing_meta["id"] = sidecar["id"]
            existing_extras = sidecar.get("extras")

    merged_meta: dict[str, Any] = {**existing_meta, **incoming_meta}
    if not str(merged_meta.get("id") or "").strip():
        merged_meta["id"] = str(uuid.uuid4())
    name = payload.get("name")
    if name and not merged_meta.get("title"):
        merged_meta["title"] = name
    merged_meta["updated"] = now_iso()

    extras = payload.get("extras")
    if extras is None and "extras" not in payload:
        extras = existing_extras

    final_payload = {
        "html": payload.get("html") or "",
        "markdown": payload.get("markdown") or "",
        "extras": extras,
        "meta": merged_meta,
    }
    write_doc(path, final_payload)
    _invalidate_scan_cache(workspace)

    return {
        "html": final_payload["html"],
        "markdown": final_payload["markdown"],
        "meta": merged_meta,
        "extras": extras,
        "source": "sidecar",
    }


def doc_create(root: str, payload: dict[str, Any]) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    rel_path = str(payload.get("path") or "")
    ensure_markdown_path(rel_path)
    path = resolve_workspace_path_for_write(workspace, rel_path)
    if path.exists():
        raise ValueError(f"document already exists: {rel_path}")
    write_doc(path, payload)
    _invalidate_scan_cache(workspace)
    return document_dto_for_path(workspace, path)


def doc_create_pdf(root: str, rel_path: str, byte_list: Any) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    ensure_pdf_path(rel_path)
    path = resolve_workspace_path_for_write(workspace, rel_path)
    if path.exists():
        raise ValueError(f"document already exists: {rel_path}")
    if not isinstance(byte_list, (list, tuple)):
        raise ValueError("PDF bytes payload must be a list of unsigned bytes")
    try:
        data = bytes(int(b) & 0xFF for b in byte_list)
    except (TypeError, ValueError) as err:
        raise ValueError(f"invalid PDF bytes payload: {err}") from err
    if not data.startswith(b"%PDF-"):
        raise ValueError("payload is not a PDF (missing %PDF- header)")
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(path, data)
    _invalidate_scan_cache(workspace)
    return document_dto_for_path(workspace, path)


def doc_create_excel(root: str, rel_path: str, byte_list: Any) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    ensure_excel_path(rel_path)
    path = resolve_workspace_path_for_write(workspace, rel_path)
    if path.exists():
        raise ValueError(f"document already exists: {rel_path}")
    if not isinstance(byte_list, (list, tuple)):
        raise ValueError("XLSX bytes payload must be a list of unsigned bytes")
    try:
        data = bytes(int(b) & 0xFF for b in byte_list)
    except (TypeError, ValueError) as err:
        raise ValueError(f"invalid XLSX bytes payload: {err}") from err
    if not data.startswith(b"PK\x03\x04"):
        raise ValueError("payload is not an XLSX (missing PK ZIP header)")
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(path, data)
    _invalidate_scan_cache(workspace)
    return document_dto_for_path(workspace, path)


def write_doc(path: Path, payload: dict[str, Any]) -> None:
    from services.markdown_document_state import DocumentSnapshot, MarkdownDocumentState

    snapshot = DocumentSnapshot(
        html=str(payload.get("html") or ""),
        markdown=str(payload.get("markdown") or ""),
        meta=dict(payload.get("meta") or {}),
        extras=payload.get("extras"),
    )
    MarkdownDocumentState().write_full(path, snapshot)


def move_document_pair(root: str, old_path: str, new_path: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    ensure_markdown_path(old_path)
    ensure_markdown_path(new_path)
    source = resolve_existing_workspace_path(workspace, old_path)
    destination = resolve_workspace_path_for_write(workspace, new_path)
    if destination.exists():
        raise ValueError(f"destination already exists: {new_path}")
    destination.parent.mkdir(parents=True, exist_ok=True)

    source_sidecar = sidecar_path_for(source)
    destination_sidecar = sidecar_path_for(destination)
    source.rename(destination)
    if source_sidecar.exists():
        source_sidecar.rename(destination_sidecar)
    _invalidate_scan_cache(workspace)
    return document_dto_for_path(workspace, destination)


def doc_delete(root: str, rel_path: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    ensure_markdown_path(rel_path)
    source = resolve_existing_workspace_path(workspace, rel_path)
    if not source.is_file():
        raise ValueError(f"document is not a file: {rel_path}")

    trash_path = unique_trash_path(workspace, rel_path)
    trash_path.parent.mkdir(parents=True, exist_ok=True)
    source.rename(trash_path)

    sidecar_path = sidecar_path_for(source)
    sidecar_trash_path = None
    if sidecar_path.exists():
        sidecar_trash = sidecar_path_for(trash_path)
        sidecar_path.rename(sidecar_trash)
        sidecar_trash_path = relative_path_string(workspace, sidecar_trash)

    _invalidate_scan_cache(workspace)
    return {
        "path": rel_path,
        "sidecarPath": relative_path_string(workspace, sidecar_path) if sidecar_trash_path else None,
        "trashPath": relative_path_string(workspace, trash_path),
        "sidecarTrashPath": sidecar_trash_path,
    }


def workspace_create_folder(root: str, rel_path: str) -> None:
    workspace = canonical_workspace_root(root)
    destination = resolve_workspace_path_for_write(workspace, rel_path)
    if destination.exists():
        raise ValueError(f"folder already exists: {rel_path}")
    destination.mkdir(parents=True, exist_ok=False)
    _invalidate_scan_cache(workspace)


def workspace_rename_folder(root: str, old_path: str, new_path: str) -> None:
    workspace = canonical_workspace_root(root)
    source = resolve_existing_workspace_path(workspace, old_path)
    if not source.is_dir():
        raise ValueError(f"folder is not a directory: {old_path}")
    destination = resolve_workspace_path_for_write(workspace, new_path)
    if destination.exists():
        raise ValueError(f"destination already exists: {new_path}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    source.rename(destination)
    _invalidate_scan_cache(workspace)


def workspace_delete_folder(root: str, rel_path: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    source = resolve_existing_workspace_path(workspace, rel_path)
    if not source.is_dir():
        raise ValueError(f"folder is not a directory: {rel_path}")
    trash_path = unique_trash_dir_path(workspace, rel_path)
    trash_path.parent.mkdir(parents=True, exist_ok=True)
    source.rename(trash_path)
    _invalidate_scan_cache(workspace)
    return {
        "path": rel_path,
        "sidecarPath": None,
        "trashPath": relative_path_string(workspace, trash_path),
        "sidecarTrashPath": None,
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
    if clean.parts[0] == ".trash":
        raise ValueError("document path may not target workspace trash")
    return clean


def ensure_markdown_path(path: str) -> None:
    if Path(path).suffix.lower() not in {".md", ".markdown"}:
        raise ValueError(f"document path must end in .md or .markdown: {path}")


def ensure_pdf_path(path: str) -> None:
    if Path(path).suffix.lower() != ".pdf":
        raise ValueError(f"document path must end in .pdf: {path}")


def ensure_excel_path(path: str) -> None:
    if Path(path).suffix.lower() not in (".xlsx", ".xlsm"):
        raise ValueError(f"document path must end in .xlsx or .xlsm: {path}")


def resolve_existing_workspace_path(root: Path, rel_path: str) -> Path:
    relative = validate_relative_path(rel_path)
    candidate = root / relative
    resolved = candidate.resolve(strict=True)
    ensure_path_within_root(root, resolved)
    return candidate


def resolve_workspace_path_for_write(root: Path, rel_path: str) -> Path:
    relative = validate_relative_path(rel_path)
    candidate = root / relative
    nearest = candidate if candidate.exists() else candidate.parent
    while not nearest.exists():
        nearest = nearest.parent
    ensure_path_within_root(root, nearest.resolve())
    return candidate


def ensure_path_within_root(root: Path, path: Path) -> None:
    if os.path.commonpath([str(root), str(path)]) != str(root):
        raise ValueError(f"path escapes workspace root: {path}")


def document_dto_for_path(root: Path, path: Path) -> dict[str, Any]:
    rel_path = relative_path_string(root, path)
    if is_pdf_file(path):
        document_type = "pdf"
    elif is_excel_file(path):
        document_type = "excel"
    else:
        document_type = "markdown"
    if document_type == "markdown":
        raw = path.read_text(encoding="utf-8")
        frontmatter_id, title = parse_frontmatter_scan_fields(raw)
        id_source = "frontmatter" if frontmatter_id else "path"
        doc_id = frontmatter_id or stable_path_id(rel_path)
    else:
        id_source = "path"
        doc_id = stable_path_id(rel_path)
        title = path.stem
    return {
        "id": doc_id,
        "idSource": id_source,
        "path": rel_path,
        "name": path.name,
        "title": title,
        "documentType": document_type,
        "hasSidecar": sidecar_path_for(path).exists(),
    }


def parse_frontmatter_scan_fields(raw: str) -> tuple[str | None, str | None]:
    if not raw.startswith("---"):
        return None, None
    lines = raw.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, None
    doc_id = None
    title = None
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        parsed = parse_yaml_scalar(value.strip())
        if key == "id" and isinstance(parsed, str) and parsed:
            doc_id = parsed
        if key == "title" and isinstance(parsed, str) and parsed:
            title = parsed
    return doc_id, title


def is_hidden_sidecar_name(name: str) -> bool:
    return name.startswith(".") and name.endswith(".doxmind")


def is_markdown_file(path: Path) -> bool:
    return path.suffix.lower() in {".md", ".markdown"}


def is_pdf_file(path: Path) -> bool:
    return path.suffix.lower() == ".pdf"


def is_excel_file(path: Path) -> bool:
    return path.suffix.lower() in {".xlsx", ".xlsm"}


def is_workspace_document_file(path: Path) -> bool:
    return is_markdown_file(path) or is_pdf_file(path) or is_excel_file(path)


def relative_path_string(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def stable_path_id(path: str) -> str:
    hash_value = 0xCBF29CE484222325
    for byte in path.encode():
        hash_value ^= byte
        hash_value = (hash_value * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"path:{hash_value:016x}"


def unique_trash_path(root: Path, rel_path: str) -> Path:
    source_rel = validate_relative_path(rel_path)
    base = root / ".trash" / source_rel
    return unique_path(base)


def unique_trash_dir_path(root: Path, rel_path: str) -> Path:
    return unique_path(root / ".trash" / validate_relative_path(rel_path))


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    parent = path.parent
    for index in range(1, 10_000):
        candidate = parent / f"{stem} {index}{suffix}"
        if not candidate.exists():
            return candidate
    raise ValueError(f"could not allocate unique path for {path}")
