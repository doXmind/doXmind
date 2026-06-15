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


def read_document(path: str | Path) -> dict[str, Any]:
    """Read a markdown/HTML document into the editor read DTO.

    Returns the same shape the workspace `doc_read` command produces:
    ``html`` / ``markdown`` / ``meta`` / ``extras`` / ``source`` /
    ``sourceState`` / ``outline`` / ``correlation``.
    """
    return read_doc(Path(path).expanduser())
