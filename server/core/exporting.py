"""Document export (pdf / html / md) for the core facade (ADR 0010, S8).

Reads a document through the same read model the editor uses, then renders the
requested format: PDF via the html_pdf_export service, HTML as the editor HTML,
and Markdown as the document body.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from core.documents import read_document, read_document_in_root
from services.html_pdf_export import export_html_pdf

_FORMAT_SUFFIX = {"pdf": ".pdf", "html": ".html", "md": ".md", "markdown": ".md"}


def suffix_for(fmt: str) -> str:
    """The file extension for an export format, validating the format."""
    suffix = _FORMAT_SUFFIX.get(fmt.lower())
    if suffix is None:
        raise ValueError(f"unsupported export format: {fmt} (use pdf, html, or md)")
    return suffix


def render_document(doc: dict[str, Any], fmt: str) -> bytes:
    """Render an already-read document DTO to the given format's bytes."""
    fmt = fmt.lower()
    if fmt == "pdf":
        return export_html_pdf(doc.get("html") or "")
    if fmt == "html":
        return (doc.get("html") or "").encode("utf-8")
    if fmt in {"md", "markdown"}:
        return (doc.get("markdown") or "").encode("utf-8")
    raise ValueError(f"unsupported export format: {fmt} (use pdf, html, or md)")


def export_document(path: str | Path, fmt: str) -> bytes:
    """Read a document (free path) and return its exported bytes."""
    return render_document(read_document(path), fmt)


def export_document_in_root(root: str | Path | None, rel_path: str | Path, fmt: str) -> bytes:
    """Read a workspace-confined document and return its exported bytes."""
    return render_document(read_document_in_root(root, rel_path), fmt)
