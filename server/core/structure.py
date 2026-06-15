"""Structural workspace operations for the core facade (ADR 0010, S7).

Rename / move / delete documents, make folders, and import external files —
each delegating to the confined api.workspace handler. Deletes go to the OS
Trash via send2trash (ADR 0005), never a hard unlink.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from api.workspace import (
    doc_delete,
    doc_import_external,
    doc_move,
    move_document_pair,
    workspace_create_folder,
)
from core.workspace import resolve_root


def rename_document(
    root: str | Path | None, old_path: str | Path, new_path: str | Path
) -> dict[str, Any]:
    """Rename a document in place, carrying its sidecar along."""
    return move_document_pair(str(resolve_root(root)), str(old_path), str(new_path))


def move_document(
    root: str | Path | None, old_path: str | Path, new_path: str | Path
) -> dict[str, Any]:
    """Move a document or folder to a new workspace location."""
    return doc_move(str(resolve_root(root)), str(old_path), str(new_path))


def delete_document(root: str | Path | None, rel_path: str | Path) -> dict[str, Any]:
    """Move a document (and its sidecar) to the OS Trash."""
    return doc_delete(str(resolve_root(root)), str(rel_path))


def create_folder(root: str | Path | None, rel_path: str | Path) -> dict[str, Any]:
    """Create a folder in the workspace."""
    workspace_create_folder(str(resolve_root(root)), str(rel_path))
    return {"path": str(rel_path)}


def import_document(
    root: str | Path | None,
    src_path: str | Path,
    dest_folder: str = "",
    name: str | None = None,
    mode: str = "create",
) -> dict[str, Any]:
    """Copy an external .md/.pdf/.xlsx into the workspace (source left intact)."""
    resolved_name = name or Path(src_path).name
    return doc_import_external(
        str(resolve_root(root)),
        str(src_path),
        None,
        str(dest_folder),
        str(resolved_name),
        str(mode),
    )
