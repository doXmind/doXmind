"""Local Markdown workspace API for plain web development.

The Tauri app calls filesystem commands directly. A regular browser cannot do
that, so this router exposes the same command names over localhost while keeping
the source of truth as `.md` files plus hidden `.doxmind` sidecars.
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.import_file import markdown_to_html

router = APIRouter()

SIDECAR_VERSION = 1
IGNORED_SCAN_DIRS = {".git", "node_modules", "target", ".next", "out", "dist", "build", ".trash"}


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
    if command == "doc_write_workspace":
        return write_doc_workspace(
            str(payload.get("root") or ""),
            str(payload.get("path") or ""),
            payload.get("payload") or {},
        )
    if command == "doc_create":
        return doc_create(str(payload.get("root") or ""), payload.get("payload") or {})
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
    documents: list[dict[str, Any]] = []
    for path in sorted(workspace.rglob("*")):
        if any(part in IGNORED_SCAN_DIRS for part in path.relative_to(workspace).parts[:-1]):
            continue
        if not path.is_file() or is_hidden_sidecar_name(path.name) or not is_markdown_file(path):
            continue
        documents.append(document_dto_for_path(workspace, path))
    return {"root": str(workspace), "documents": documents}


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
    if not path.is_absolute():
        raise ValueError("document path must be absolute")
    raw = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(raw)
    current_hash = hash_markdown(raw)
    sidecar = read_sidecar(sidecar_path_for(path))

    if (
        sidecar
        and sidecar.get("version") == SIDECAR_VERSION
        and sidecar.get("markdown_hash") == current_hash
    ):
        if meta.get("id") != sidecar.get("id"):
            meta["id"] = sidecar.get("id")
        return {
            "html": sidecar.get("html") or "",
            "markdown": body,
            "meta": meta,
            "extras": sidecar.get("extras"),
            "source": "sidecar",
        }

    if not body.strip():
        return {"html": "", "markdown": "", "meta": meta, "extras": None, "source": "empty"}

    return {
        "html": markdown_to_html(body),
        "markdown": body,
        "meta": meta,
        "extras": None,
        "source": "markdown",
    }


def write_doc_workspace(root: str, rel_path: str, payload: dict[str, Any]) -> None:
    workspace = canonical_workspace_root(root)
    ensure_markdown_path(rel_path)
    path = resolve_workspace_path_for_write(workspace, rel_path)
    write_doc(path, payload)


def doc_create(root: str, payload: dict[str, Any]) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    rel_path = str(payload.get("path") or "")
    ensure_markdown_path(rel_path)
    path = resolve_workspace_path_for_write(workspace, rel_path)
    if path.exists():
        raise ValueError(f"document already exists: {rel_path}")
    write_doc(path, payload)
    return document_dto_for_path(workspace, path)


def write_doc(path: Path, payload: dict[str, Any]) -> None:
    meta = dict(payload.get("meta") or {})
    if not str(meta.get("id") or "").strip():
        raise ValueError("document id is required")
    html = str(payload.get("html") or "")
    markdown = str(payload.get("markdown") or "")
    extras = payload.get("extras")
    meta.setdefault("updated", now_iso())
    md_content = build_md_with_frontmatter(meta, markdown)

    atomic_write(path, md_content.encode("utf-8"))
    sidecar = {
        "version": SIDECAR_VERSION,
        "id": meta["id"],
        "html": html,
        "markdown_hash": hash_markdown(md_content),
        "updated_at": now_iso(),
    }
    if extras is not None:
        sidecar["extras"] = extras
    atomic_write(sidecar_path_for(path), json.dumps(sidecar, indent=2, ensure_ascii=False).encode())


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


def workspace_delete_folder(root: str, rel_path: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    source = resolve_existing_workspace_path(workspace, rel_path)
    if not source.is_dir():
        raise ValueError(f"folder is not a directory: {rel_path}")
    trash_path = unique_trash_dir_path(workspace, rel_path)
    trash_path.parent.mkdir(parents=True, exist_ok=True)
    source.rename(trash_path)
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
    raw = path.read_text(encoding="utf-8")
    frontmatter_id, title = parse_frontmatter_scan_fields(raw)
    rel_path = relative_path_string(root, path)
    id_source = "frontmatter" if frontmatter_id else "path"
    doc_id = frontmatter_id or stable_path_id(rel_path)
    return {
        "id": doc_id,
        "idSource": id_source,
        "path": rel_path,
        "name": path.name,
        "title": title,
        "hasSidecar": sidecar_path_for(path).exists(),
    }


def parse_frontmatter(raw: str) -> tuple[dict[str, Any], str]:
    if not raw.startswith("---"):
        return {"id": str(uuid.uuid4())}, raw
    lines = raw.splitlines()
    if not lines or lines[0].strip() != "---":
        return {"id": str(uuid.uuid4())}, raw

    closing_index = None
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            closing_index = index
            break
    if closing_index is None:
        return {"id": str(uuid.uuid4())}, raw

    meta: dict[str, Any] = {}
    for line in lines[1:closing_index]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        if key:
            meta[key] = parse_yaml_scalar(value.strip())

    body_lines = lines[closing_index + 1 :]
    if body_lines and body_lines[0] == "":
        body_lines = body_lines[1:]
    body = "\n".join(body_lines)
    if raw.endswith("\n") and body:
        body += "\n"
    if not meta.get("id"):
        meta["id"] = str(uuid.uuid4())
    return meta, body


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


def parse_yaml_scalar(value: str) -> Any:
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if value in {"null", "Null", "~"}:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value.strip("\"'")


def build_md_with_frontmatter(meta: dict[str, Any], body: str) -> str:
    lines = []
    for key, value in meta.items():
        if value is None:
            continue
        if isinstance(value, bool):
            rendered = "true" if value else "false"
        elif isinstance(value, (int, float)):
            rendered = str(value)
        else:
            rendered = json.dumps(str(value), ensure_ascii=False)
        lines.append(f"{key}: {rendered}")
    trimmed_body = body.rstrip("\n")
    return f"---\n{chr(10).join(lines)}\n---\n\n{trimmed_body}\n"


def read_sidecar(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except json.JSONDecodeError:
        return None


def sidecar_path_for(md_path: Path) -> Path:
    name = md_path.name
    lower = name.lower()
    if lower.endswith(".markdown"):
        stem = name[: -len(".markdown")]
    elif lower.endswith(".md"):
        stem = name[: -len(".md")]
    else:
        stem = name
    return md_path.parent / f".{stem}.doxmind"


def is_hidden_sidecar_name(name: str) -> bool:
    return name.startswith(".") and name.endswith(".doxmind")


def is_markdown_file(path: Path) -> bool:
    return path.suffix.lower() in {".md", ".markdown"}


def relative_path_string(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def stable_path_id(path: str) -> str:
    hash_value = 0xCBF29CE484222325
    for byte in path.encode():
        hash_value ^= byte
        hash_value = (hash_value * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"path:{hash_value:016x}"


def hash_markdown(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def atomic_write(target: Path, data: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.parent / f".{target.name}.tmp-{uuid.uuid4().hex}"
    tmp.write_bytes(data)
    tmp.replace(target)


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
