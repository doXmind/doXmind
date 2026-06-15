"""Workspace root resolution and path confinement for the core facade.

The workspace command handlers in ``api.workspace`` already confine every
relative path to the configured root: ``validate_relative_path`` rejects
absolute paths and ``..`` segments, and ``ensure_path_within_root`` resolves
symlinks and guards with ``os.path.commonpath``. This module re-exports that
confinement as one shell-agnostic entry point so the CLI and the MCP server —
which accept user/agent-supplied paths — share a single tested guard instead of
each re-deriving it (ADR 0010, S5).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from api.workspace import (
    canonical_workspace_root,
    ensure_path_within_root,
    validate_relative_path,
    workspace_default_root,
    workspace_index_rebuild,
    workspace_markdown_search,
    workspace_scan,
)

WORKSPACE_ROOT_ENV = "DOXMIND_WORKSPACE_ROOT"


def default_root() -> str:
    """The workspace root the shells use when none is supplied.

    ``DOXMIND_WORKSPACE_ROOT`` wins; otherwise fall back to the same default the
    desktop app uses (``~/Documents/doXmind``, created on demand).
    """
    env = os.environ.get(WORKSPACE_ROOT_ENV)
    if env and env.strip():
        return str(canonical_workspace_root(env))
    return workspace_default_root()


def resolve_root(root: str | Path | None) -> Path:
    """Normalise a workspace root to an existing directory."""
    chosen = str(root) if root not in (None, "") else default_root()
    return canonical_workspace_root(chosen)


def resolve_in_root(root: str | Path | None, path: str | Path) -> Path:
    """Confine an arbitrary path to ``root`` and return the absolute target.

    Accepts a workspace-relative path or an absolute path that lives inside the
    workspace. Rejects ``..`` escapes, absolute paths outside the root, and
    symlinks whose nearest existing ancestor resolves outside the root.
    """
    workspace = resolve_root(root)
    relative = validate_relative_path(_as_relative(workspace, path))
    candidate = workspace / relative
    probe = candidate
    while not probe.exists():
        probe = probe.parent
    ensure_path_within_root(workspace, probe.resolve())
    return candidate


def _as_relative(workspace: Path, path: str | Path) -> str:
    p = Path(path).expanduser()
    if not p.is_absolute():
        return str(p)
    try:
        return str(p.resolve().relative_to(workspace))
    except ValueError as err:
        raise ValueError(f"path escapes workspace root: {path}") from err


def list_workspace(root: str | Path | None = None) -> dict[str, Any]:
    """Scan the workspace and return ``{root, documents[]}`` (and refresh the
    on-disk id index as a side effect, matching the desktop app)."""
    return workspace_scan(str(resolve_root(root)))


def search_documents(
    root: str | Path | None = None, query: str = "", limit: int | None = None
) -> list[dict[str, Any]]:
    """Full-text search markdown bodies; returns per-document line matches."""
    return workspace_markdown_search(str(resolve_root(root)), query, limit)


def rebuild_index(root: str | Path | None = None) -> dict[str, Any]:
    """Rebuild and persist the workspace id->path index."""
    return workspace_index_rebuild(str(resolve_root(root)))
