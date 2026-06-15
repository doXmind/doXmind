"""Document read/write operations for the core facade.

S1 (ADR 0010) wires a single operation — `read_document` — by delegating to the
existing `api.workspace.read_doc` handler, which is already a pure function
(it raises plain `ValueError`/sidecar errors, not `HTTPException`). The eventual
direction inverts this dependency: the pure handlers move down into `core` and
`api` calls them. Until then this transitional delegation keeps one
implementation shared by every shell.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from api.workspace import read_doc
from core.workspace import resolve_in_root


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
