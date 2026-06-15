"""Document read/write operations for the core facade.

S1 (ADR 0010) wires a single operation — `read_document` — by delegating to the
existing `api.workspace.read_doc` handler, which is already a pure function
(it raises plain `ValueError`/sidecar errors, not `HTTPException`). The eventual
direction inverts this dependency: the pure handlers move down into `core` and
`api` calls them. Until then this transitional delegation keeps one
implementation shared by every shell.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from api.workspace import doc_create, read_doc, write_doc_workspace
from core.workspace import resolve_in_root, resolve_root
from services.sidecar_io import markdown_to_html


def read_document(path: str | Path) -> dict[str, Any]:
    """Read a markdown/HTML document into the editor read DTO.

    Returns the same shape the workspace `doc_read` command produces:
    ``html`` / ``markdown`` / ``meta`` / ``extras`` / ``source`` /
    ``sourceState`` / ``outline`` / ``correlation``.
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
    html: str | None = None,
    meta: dict[str, Any] | None = None,
    extras: Any = None,
) -> dict[str, Any]:
    """Create a new markdown document in the workspace; refuses to overwrite.

    Identity lives in the sidecar (ADR 0002), so a missing id is generated here.
    When no editor ``html`` is supplied it is rendered from the markdown so the
    document opens correctly in the editor.
    """
    meta = dict(meta or {})
    if not str(meta.get("id") or "").strip():
        meta["id"] = str(uuid.uuid4())
    if html is None:
        html = markdown_to_html(markdown) if markdown else ""
    payload: dict[str, Any] = {
        "path": str(rel_path),
        "markdown": markdown,
        "html": html,
        "meta": meta,
    }
    if extras is not None:
        payload["extras"] = extras
    return doc_create(str(resolve_root(root)), payload)


def edit_document(
    root: str | Path | None,
    rel_path: str | Path,
    markdown: str,
    *,
    html: str | None = None,
    meta: dict[str, Any] | None = None,
    extras: Any = None,
) -> dict[str, Any]:
    """Replace the markdown body of a workspace document (upsert).

    ``markdown`` is required — the underlying writer rewrites the body wholesale,
    so omitting it would wipe the document. When ``html`` is omitted it is
    rendered from the markdown.
    """
    if html is None:
        html = markdown_to_html(markdown) if markdown else ""
    payload: dict[str, Any] = {"markdown": markdown, "html": html}
    if meta is not None:
        payload["meta"] = meta
    if extras is not None:
        payload["extras"] = extras
    return write_doc_workspace(str(resolve_root(root)), str(rel_path), payload)
