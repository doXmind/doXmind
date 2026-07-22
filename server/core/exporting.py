"""Document export (html / md) for the core facade (ADR 0010, S8).

Reads canonical Markdown through the Page core, then performs an explicit
export projection. HTML is an output format, never part of the Page read model.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from core.documents import read_document
from core.workspace import resolve_in_root
from services.markdown_export import markdown_to_html

_FORMAT_SUFFIX = {"html": ".html", "md": ".md", "markdown": ".md"}


def suffix_for(fmt: str) -> str:
    """The file extension for an export format, validating the format."""
    suffix = _FORMAT_SUFFIX.get(fmt.lower())
    if suffix is None:
        raise ValueError(f"unsupported export format: {fmt} (use html or md)")
    return suffix


def render_document(doc: dict[str, Any], fmt: str) -> bytes:
    """Render an already-read Page DTO to derived HTML.

    Markdown cannot be reconstructed from the body-only read DTO because doing
    so would discard frontmatter and byte-level source details. Call one of the
    path-based export functions for an exact Markdown copy.
    """
    fmt = fmt.lower()
    markdown = str(doc.get("markdown") or "")
    if fmt == "html":
        return markdown_to_html(markdown).encode("utf-8")
    if fmt in {"md", "markdown"}:
        raise ValueError("Markdown export requires the source Page path")
    raise ValueError(f"unsupported export format: {fmt} (use html or md)")


def export_document(path: str | Path, fmt: str) -> bytes:
    """Read a document (free path) and return its exported bytes."""
    source = Path(path).expanduser()
    document = read_document(source)
    if fmt.lower() in {"md", "markdown"}:
        return source.read_bytes()
    return render_document(document, fmt)


def export_document_in_root(root: str | Path | None, rel_path: str | Path, fmt: str) -> bytes:
    """Read a workspace-confined document and return its exported bytes."""
    source = resolve_in_root(root, rel_path)
    document = read_document(source)
    if fmt.lower() in {"md", "markdown"}:
        return source.read_bytes()
    return render_document(document, fmt)
