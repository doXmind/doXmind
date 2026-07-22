"""Markdown Page read/write operations for the core facade.

S1 (ADR 0010) wires a single operation — `read_document` — by delegating to the
existing `api.workspace.read_doc` handler, which is already a pure function
(it raises plain `ValueError`, not `HTTPException`). The eventual
direction inverts this dependency: the pure handlers move down into `core` and
`api` calls them. Until then this transitional delegation keeps one
implementation shared by every shell.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from api.workspace import doc_create, read_doc, write_doc_workspace
from core.workspace import resolve_in_root, resolve_root


def read_document(path: str | Path) -> dict[str, Any]:
    """Read a Markdown Page into the editor read DTO.

    Returns the same source-only shape as workspace `doc_read`:
    ``markdown`` / ``meta`` / ``revision`` / ``outline``.
    """
    return read_doc(Path(path).expanduser())


def read_document_in_root(root: str | Path | None, rel_path: str | Path) -> dict[str, Any]:
    """Read a document addressed relative to a confined workspace ``root``.

    The MCP surface uses this so an agent can only read inside the configured
    workspace; the free-path :func:`read_document` stays for the CLI, where the
    human already owns the path they pass.
    """
    return read_doc(resolve_in_root(root, rel_path))


def create_document(
    root: str | Path | None,
    rel_path: str | Path,
    *,
    markdown: str = "",
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create one Markdown Page with frontmatter identity; refuse overwrite."""
    payload: dict[str, Any] = {
        "path": str(rel_path),
        "markdown": markdown,
        "meta": dict(meta or {}),
    }
    return doc_create(str(resolve_root(root)), payload)


def edit_document(
    root: str | Path | None,
    rel_path: str | Path,
    markdown: str,
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Replace the Markdown source of a workspace Page (upsert).

    ``markdown`` is required — the underlying writer rewrites the body wholesale,
    so omitting it would wipe the document.
    """
    payload: dict[str, Any] = {"markdown": markdown}
    if meta is not None:
        payload["meta"] = meta
    return write_doc_workspace(str(resolve_root(root)), str(rel_path), payload)
