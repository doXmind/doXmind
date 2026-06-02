"""Local Markdown workspace API for plain web development.

The Tauri app calls filesystem commands directly. A regular browser cannot do
that, so this router exposes the same command names over localhost while keeping
the source of truth as `.md` files plus hidden `.doxmind` sidecars.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import time
import uuid
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from send2trash import send2trash

from services.sidecar_io import (
    Corrupt,
    CorruptSidecarError,
    Loaded,
    atomic_write,
    markdown_to_html,
    now_iso,
    parse_frontmatter,
    parse_yaml_scalar,
    read_sidecar,
    sidecar_path_for,
)
from services.synthetic_document import (
    LegacySidecarError,
    ReadOnlyDocumentError,
    SidecarMigrationError,
    SyntheticDocumentFactory,
)

router = APIRouter()


IGNORED_SCAN_DIRS = {".git", "node_modules", "target", ".next", "out", "dist", "build"}

# Per-root TTL cache for `workspace_scan`. Within a single user action the
# adapter often calls scan -> index_rebuild -> search back-to-back, each of
# which previously did its own `rglob("*")` walk. The TTL is short enough
# that external file changes still get picked up promptly; mutating commands
# below explicitly invalidate the entry for their root.
_SCAN_CACHE_TTL_SECONDS = 1.5
_scan_cache: dict[str, tuple[float, dict[str, Any]]] = {}
BROWSING_RENDERER_VERSION = "browsing-html/v1"
VOID_HTML_TAGS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "source",
    "track",
    "wbr",
}
SKIP_HTML_TAGS = {"script", "style", "iframe", "object", "embed"}
SAFE_URL_SCHEMES = {"", "http", "https", "mailto", "tel"}
SAFE_IMAGE_URL_SCHEMES = {"", "http", "https"}
ALLOWED_BROWSING_TAGS: dict[str, set[str]] = {
    "a": {"href", "title"},
    "blockquote": set(),
    "br": set(),
    "code": {"class"},
    "del": set(),
    "div": {"class", "data-code", "data-latex", "data-type"},
    "em": set(),
    "h1": {"id"},
    "h2": {"id"},
    "h3": {"id"},
    "h4": {"id"},
    "h5": {"id"},
    "h6": {"id"},
    "hr": set(),
    "img": {"alt", "height", "src", "title", "width"},
    "li": {"data-checked", "data-type"},
    "ol": set(),
    "p": set(),
    "pre": {"class"},
    "span": {"class", "data-latex", "data-type"},
    "strong": set(),
    "table": set(),
    "tbody": set(),
    "td": set(),
    "th": set(),
    "thead": set(),
    "tr": set(),
    "ul": {"data-type"},
}


def _invalidate_scan_cache(root: str | Path) -> None:
    key = str(Path(root).resolve()) if root else ""
    _scan_cache.pop(key, None)


def _write_forensic_copy(sidecar_path: Path, raw: bytes) -> Path:
    timestamp = now_iso().replace(":", "-")
    forensic_path = sidecar_path.parent / f"{sidecar_path.name}.corrupt-{timestamp}"
    atomic_write(forensic_path, raw)
    return forensic_path


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
    except SidecarMigrationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "sidecar_migration_failed",
                "sidecar_path": str(exc.sidecar_path),
                "block_type": exc.block_type,
                "reason": exc.reason,
                "recovery": "rename <sidecar>.bak back to <sidecar> to restore the original",
            },
        )
    except LegacySidecarError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "legacy_sidecar_unrecoverable",
                "sidecar_path": str(exc.sidecar_path),
                "block_type": exc.block_type,
                "reason": exc.reason,
            },
        )
    except ReadOnlyDocumentError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "document_read_only",
                "path": str(exc.path),
                "recovery": "unset DOXMIND_SIDECAR_MIGRATE or set it to 1 to enable migration; or restore from <sidecar>.bak",
            },
        )
    except CorruptSidecarError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "sidecar_corrupt",
                "sidecar_path": str(exc.sidecar_path),
                "forensic_path": str(exc.forensic_path) if exc.forensic_path else None,
                "reason": exc.reason,
                "recovery": "investigate the forensic copy; restore over the sidecar manually if appropriate",
            },
        )
    except FileExistsError as exc:
        # External-import collisions raise this; #69 will replace the toast
        # with a Replace / Keep both / Skip modal driven by the same backend
        # error code.
        raise HTTPException(
            status_code=409,
            detail={"code": "destination_exists", "message": str(exc)},
        )
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
    if command == "workspace_stat_binary":
        return stat_workspace_binary(
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
    if command == "doc_import_external":
        return doc_import_external(
            str(payload.get("root") or ""),
            payload.get("srcPath"),
            payload.get("bytes"),
            str(payload.get("destFolder") or ""),
            str(payload.get("name") or ""),
            str(payload.get("mode") or "create"),
        )
    if command == "doc_rename":
        return move_document_pair(
            str(payload.get("root") or ""),
            str(payload.get("oldPath") or ""),
            str(payload.get("newPath") or ""),
        )
    if command == "doc_move":
        return doc_move(
            str(payload.get("root") or ""),
            str(payload.get("oldPath") or ""),
            str(payload.get("newPath") or ""),
        )
    if command == "doc_delete":
        return doc_delete(str(payload.get("root") or ""), str(payload.get("path") or ""))
    if command == "workspace_create_folder":
        return workspace_create_folder(
            str(payload.get("root") or ""), str(payload.get("path") or "")
        )
    if command == "workspace_rename_folder":
        return workspace_rename_folder(
            str(payload.get("root") or ""),
            str(payload.get("oldPath") or ""),
            str(payload.get("newPath") or ""),
        )
    if command == "workspace_delete_folder":
        return workspace_delete_folder(
            str(payload.get("root") or ""), str(payload.get("path") or "")
        )

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
    # Sort by lowercased file name so listing order is deterministic across
    # scans (rglob returns filesystem order, which isn't stable on macOS/APFS)
    # and matches the frontend's name-asc sort. Sorting by full path alone
    # would make a file's position depend on its parent folder name; the
    # `as_posix()` tiebreaker is only there to give two files with the same
    # lowercased basename (e.g. `Notes/README.md` vs `Specs/README.md`) a
    # deterministic order — otherwise Timsort's stability would fall back
    # to `rglob`'s unstable filesystem order, defeating this whole sort.
    for path in iter_workspace_document_paths(workspace):
        documents.append(document_dto_for_path(workspace, path))
    result = {"root": str(workspace), "documents": documents}
    write_workspace_index(workspace, workspace_index_from_documents(documents))
    _scan_cache[key] = (now, result)
    return result


def workspace_index_rebuild(root: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    index = workspace_index_from_documents(workspace_scan(root)["documents"])
    write_workspace_index(workspace, index)
    return index


def workspace_index_from_documents(documents: list[dict[str, Any]]) -> dict[str, Any]:
    ids: dict[str, str] = {}
    for doc in documents:
        if doc.get("documentType") == "markdown" and doc.get("idSource") in (
            "frontmatter",
            "sidecar",
        ):
            ids.setdefault(str(doc["id"]), str(doc["path"]))
    return {"version": 1, "ids": ids}


def write_workspace_index(workspace: Path, index: dict[str, Any]) -> None:
    index_path = workspace / ".doxmind" / "index.json"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(index, indent=2, ensure_ascii=False)
    if index_path.exists() and index_path.read_text(encoding="utf-8") == raw:
        return
    index_path.write_text(raw, encoding="utf-8")


def workspace_markdown_search(root: str, query: str, limit: Any = None) -> list[dict[str, Any]]:
    workspace = canonical_workspace_root(root)
    needle = query.strip().lower()
    if not needle:
        raise ValueError("search query is required")
    max_results = min(int(limit or 50), 200)
    results: list[dict[str, Any]] = []

    for path in iter_workspace_document_paths(workspace):
        if not is_markdown_file(path):
            continue
        raw = path.read_text(encoding="utf-8")
        rel_path = relative_path_string(workspace, path)
        matches = []
        for line_number, line in enumerate(raw.splitlines(), start=1):
            if needle in line.lower():
                matches.append({"line": line_number, "preview": line.strip()[:240]})
        if matches:
            frontmatter_id, title = parse_frontmatter_scan_fields(raw)
            # Identity precedence (#148): frontmatter -> sidecar -> path.
            doc_id = frontmatter_id or _sidecar_id_for(path) or stable_path_id(rel_path)
            results.append(
                {
                    "id": doc_id,
                    "path": rel_path,
                    "name": path.name,
                    "title": title or path.stem,
                    "matches": matches,
                }
            )
        if len(results) >= max_results:
            break
    return results


def read_doc(path: Path) -> dict[str, Any]:
    from services.block_correlation import BlockCorrelation, CorrelationReport
    from services.external_ref_blocks import default_external_ref_block_registry
    from services.markdown_document_state import (
        EmptyDocument,
        MarkdownDocumentState,
        NoSidecar,
        SidecarStale,
        UsedSidecar,
    )

    state = MarkdownDocumentState(
        correlator=BlockCorrelation(default_external_ref_block_registry()),
    )
    outcome = state.read(path)
    correlation: CorrelationReport | None = outcome.correlation
    if isinstance(outcome, UsedSidecar):
        return _document_read_response(
            editor_html=outcome.html,
            markdown=outcome.markdown,
            meta=outcome.meta,
            extras=outcome.extras,
            legacy_source="sidecar",
            source_state="sidecar_fresh",
            correlation=correlation,
        )
    if isinstance(outcome, EmptyDocument):
        return _document_read_response(
            editor_html="",
            markdown="",
            meta=outcome.meta,
            extras=None,
            legacy_source="empty",
            source_state="empty",
            correlation=correlation,
        )
    if isinstance(outcome, SidecarStale):
        if not outcome.markdown.strip():
            return _document_read_response(
                editor_html="",
                markdown="",
                meta=outcome.meta,
                extras=outcome.salvaged_extras or None,
                legacy_source="empty",
                source_state="empty",
                correlation=correlation,
            )
        return _document_read_response(
            editor_html=outcome.fresh_html,
            markdown=outcome.markdown,
            meta=outcome.meta,
            extras=outcome.salvaged_extras or None,
            legacy_source="markdown",
            source_state="sidecar_stale",
            correlation=correlation,
            markdown_html=outcome.fresh_html,
        )
    assert isinstance(outcome, NoSidecar)
    return _document_read_response(
        editor_html=outcome.html,
        markdown=outcome.markdown,
        meta=outcome.meta,
        extras=None,
        legacy_source="markdown",
        source_state="sidecar_missing",
        correlation=correlation,
        markdown_html=outcome.html,
    )


def _document_read_response(
    *,
    editor_html: str,
    markdown: str,
    meta: dict[str, Any],
    extras: Any,
    legacy_source: str,
    source_state: str,
    correlation: Any,
    markdown_html: str | None = None,
) -> dict[str, Any]:
    # When upstream (NoSidecar / SidecarStale branches) already produced
    # `markdown_to_html(markdown)` for `editor_html`, hand that HTML over so
    # the browsing sanitizer can reuse it. UsedSidecar passes None — its
    # `editor_html` comes from the cached sidecar (TipTap-serialized HTML),
    # which is not interchangeable with the plain markdown render.
    if not markdown.strip():
        browsing_html = ""
    elif markdown_html is not None:
        browsing_html = _render_browsing_from_html(markdown_html)
    else:
        browsing_html = _render_browsing_markdown(markdown)
    return {
        "html": editor_html,
        "editorHtml": editor_html,
        "browsingHtml": browsing_html,
        "markdown": markdown,
        "meta": meta,
        "extras": extras,
        "source": legacy_source,
        "sourceState": source_state,
        "outline": _outline_from_markdown(markdown),
        "browsingRendererVersion": BROWSING_RENDERER_VERSION,
        "correlation": _serialize_correlation_report(correlation),
    }


class BrowsingHtmlSanitizer(HTMLParser):
    """Small allowlist sanitizer for localhost browser fallback browsing HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        clean_tag = tag.lower()
        if clean_tag in SKIP_HTML_TAGS:
            self.skip_depth += 1
            return
        if self.skip_depth or clean_tag not in ALLOWED_BROWSING_TAGS:
            return
        rendered_attrs = self._render_attrs(clean_tag, attrs)
        self.parts.append(f"<{clean_tag}{rendered_attrs}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        clean_tag = tag.lower()
        if clean_tag in SKIP_HTML_TAGS and self.skip_depth:
            self.skip_depth -= 1
            return
        if self.skip_depth or clean_tag not in ALLOWED_BROWSING_TAGS or clean_tag in VOID_HTML_TAGS:
            return
        self.parts.append(f"</{clean_tag}>")

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.parts.append(_escape_html(data))

    def handle_entityref(self, name: str) -> None:
        if not self.skip_depth:
            self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if not self.skip_depth:
            self.parts.append(f"&#{name};")

    def _render_attrs(self, tag: str, attrs: list[tuple[str, str | None]]) -> str:
        allowed = ALLOWED_BROWSING_TAGS[tag]
        rendered: list[str] = []
        for raw_name, raw_value in attrs:
            name = raw_name.lower()
            value = raw_value or ""
            if name not in allowed and not name.startswith("aria-"):
                continue
            if name in {"href", "src"} and not _is_safe_browsing_url(name, value):
                continue
            rendered.append(f' {name}="{_escape_html(value)}"')
        return "".join(rendered)

    def html(self) -> str:
        return "".join(self.parts)


def _render_browsing_markdown(markdown: str) -> str:
    return _render_browsing_from_html(markdown_to_html(markdown))


def _render_browsing_from_html(html: str) -> str:
    sanitizer = BrowsingHtmlSanitizer()
    sanitizer.feed(html)
    sanitizer.close()
    return sanitizer.html()


def _is_safe_browsing_url(attr_name: str, value: str) -> bool:
    trimmed = value.strip()
    if not trimmed:
        return False
    if attr_name == "src" and trimmed.lower().startswith("data:image/"):
        return True
    try:
        scheme = urlsplit(trimmed).scheme.lower()
    except ValueError:
        return False
    allowed = SAFE_IMAGE_URL_SCHEMES if attr_name == "src" else SAFE_URL_SCHEMES
    return scheme in allowed


def _escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    )


def _outline_from_markdown(markdown: str) -> list[dict[str, Any]]:
    seen: dict[str, int] = {}
    outline: list[dict[str, Any]] = []
    for line in markdown.splitlines():
        match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if not match:
            continue
        depth = len(match.group(1))
        text = re.sub(r"\s+\{#.*?\}\s*$", "", match.group(2)).strip()
        base = _slugify_heading(text)
        count = seen.get(base, 0) + 1
        seen[base] = count
        outline.append(
            {
                "id": base if count == 1 else f"{base}-{count}",
                "depth": depth,
                "text": text,
            }
        )
    return outline


def _slugify_heading(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "section"


def _serialize_correlation_report(report: Any) -> dict[str, Any] | None:
    """Serialize a ``CorrelationReport`` into a JSON-safe dict.

    Returns ``None`` when no correlator ran (the report itself is ``None``).
    An empty report (correlator ran, no events) serializes as
    ``{"events": [], "blocking": False}`` so callers can distinguish
    "correlation didn't run" from "correlation ran cleanly".
    """
    from services.block_correlation import CorrelationReport

    if report is None:
        return None
    if not isinstance(report, CorrelationReport):
        raise TypeError(f"expected CorrelationReport, got {type(report).__name__}")
    return {
        "events": [
            {
                "kind": event.kind,
                "block_type": event.block_type,
                "id": event.id,
                "how_handled": event.how_handled.value,
                "detail": dict(event.detail),
            }
            for event in report.events
        ],
        "blocking": report.blocking,
    }


def read_workspace_binary(root: str, rel_path: str) -> list[int]:
    workspace = canonical_workspace_root(root)
    path = resolve_existing_workspace_path(workspace, rel_path)
    if not is_pdf_file(path) and not is_excel_file(path):
        raise ValueError("binary workspace reads are only enabled for PDF and Excel files")
    return list(path.read_bytes())


def stat_workspace_binary(root: str, rel_path: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    path = resolve_existing_workspace_path(workspace, rel_path)
    if not is_pdf_file(path) and not is_excel_file(path):
        raise ValueError("binary workspace stat is only enabled for PDF and Excel files")
    stat = path.stat()
    return {"mtimeNs": str(stat.st_mtime_ns), "size": stat.st_size}


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


def write_pdf_parsed_cache(root: str, rel_path: str, source_hash: str, parsed: Any) -> None:
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


def write_excel_parsed_cache(root: str, rel_path: str, source_hash: str, parsed: Any) -> None:
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
        sidecar_path = sidecar_path_for(path)
        sidecar = read_sidecar(sidecar_path)
        if isinstance(sidecar, Loaded):
            if not existing_meta.get("id") and sidecar.data.get("id"):
                existing_meta["id"] = sidecar.data["id"]
            existing_extras = sidecar.data.get("extras")
        elif isinstance(sidecar, Corrupt):
            forensic_path = _write_forensic_copy(sidecar_path, sidecar.raw)
            raise CorruptSidecarError(sidecar_path, forensic_path, sidecar.reason)

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

    return _document_read_response(
        editor_html=final_payload["html"],
        markdown=final_payload["markdown"],
        meta=merged_meta,
        extras=extras,
        legacy_source="sidecar",
        source_state="sidecar_fresh",
        correlation=None,
    )


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


# Import-supported extensions for external DnD. Mirrors the frontend D2 module's
# whitelist (`src/lib/external-import-resolver.ts`). Keep the two in sync — the
# frontend rejects out-of-whitelist files before they reach this handler, but
# we re-validate on the backend boundary so a misbehaving caller (or browser
# DataTransfer feeding a `.txt` straight through) can't smuggle a non-document
# file into the workspace.
IMPORT_SUPPORTED_EXTENSIONS = {".md", ".pdf", ".xlsx"}


def doc_import_external(
    root: str,
    src_path: Any,
    byte_list: Any,
    dest_folder: str,
    name: str,
    mode: str,
) -> dict[str, Any]:
    """Copy an external `.md`/`.pdf`/`.xlsx` into the workspace.

    Always-copy semantics: the source on disk (e.g. user's Downloads) is left
    untouched.

    `mode`:
    - ``"create"`` — refuse to overwrite. A name clash raises ``FileExistsError``
      and the FastAPI layer translates it to a 409.
    - ``"replace"`` — overwrite the user file at the destination. The
      pre-existing ``.doxmind`` sidecar is **deliberately left untouched** so
      the next open trips the Stale-sidecar / Salvage path (CONTEXT.md
      "Stale sidecar" definition + ADR 0002). At the FS level a Replace is
      indistinguishable from an external edit, so reusing the same recovery
      path keeps the sidecar contract consistent.
    """
    if mode not in {"create", "replace"}:
        raise ValueError(f"unsupported import mode: {mode}")
    if not name.strip():
        raise ValueError("import name is required")

    workspace = canonical_workspace_root(root)

    # Build the destination path. `dest_folder` is a workspace-relative folder
    # (empty string for root); the resolver below catches any escape attempts.
    dest_folder_clean = dest_folder.strip()
    rel_path = f"{dest_folder_clean}/{name}" if dest_folder_clean else name

    suffix = Path(name).suffix.lower()
    if suffix not in IMPORT_SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"only .md, .pdf, .xlsx are supported for external import: {name}"
        )

    destination = resolve_workspace_path_for_write(workspace, rel_path)
    if mode == "create" and destination.exists():
        # The frontend toast in #67 reads "File already exists; collision
        # handling ships in #69". Keep the message machine-friendly so the
        # frontend can pattern-match if it wants to render a richer toast.
        raise FileExistsError(f"destination already exists: {rel_path}")
    if mode == "replace" and not destination.exists():
        # Replace presupposes a pre-existing destination; if the user file
        # vanished between plan and resolve we surface a recoverable error
        # instead of silently degrading to create — that would mask a race
        # with an external delete.
        raise FileNotFoundError(f"destination does not exist for replace: {rel_path}")

    destination.parent.mkdir(parents=True, exist_ok=True)

    if isinstance(byte_list, (list, tuple)):
        try:
            data = bytes(int(b) & 0xFF for b in byte_list)
        except (TypeError, ValueError) as err:
            raise ValueError(f"invalid bytes payload: {err}") from err
        atomic_write(destination, data)
    elif isinstance(src_path, str) and src_path.strip():
        source = Path(src_path).expanduser()
        if not source.is_file():
            raise ValueError(f"source file does not exist: {src_path}")
        # `shutil.copyfile` is the always-copy primitive: it preserves the
        # source on disk byte-for-byte. We deliberately don't call `copy2` —
        # carrying mtime / metadata across is a UX call we haven't made yet.
        # In replace mode this overwrites only the user file; the hidden
        # sidecar next to it is intentionally NOT touched.
        shutil.copyfile(source, destination)
    else:
        raise ValueError("doc_import_external requires either srcPath or bytes")

    _invalidate_scan_cache(workspace)
    return document_dto_for_path(workspace, destination)


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
    ensure_same_document_extension(old_path, new_path)
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


def move_folder(root: str, old_path: str, new_path: str) -> dict[str, Any]:
    """Move a folder atomically. Pair atomicity (ADR 0005) is preserved by
    relying on the OS's directory rename: every nested `.md` + `.doxmind`
    pair travels with the parent inode, so either the whole subtree moves or
    none of it does."""
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
    return {"kind": "folder", "path": new_path}


def doc_move(root: str, old_path: str, new_path: str) -> dict[str, Any]:
    """Polymorphic move: delegates to `move_document_pair` for documents and
    to `move_folder` for directories. Mirrors the Tauri `doc_move` command so
    the browser-dev fallback honours the same contract."""
    workspace = canonical_workspace_root(root)
    source = resolve_existing_workspace_path(workspace, old_path)
    if source.is_dir():
        return move_folder(root, old_path, new_path)
    payload = move_document_pair(root, old_path, new_path)
    payload = dict(payload)
    payload["kind"] = "document"
    return payload


def doc_delete(root: str, rel_path: str) -> dict[str, Any]:
    workspace = canonical_workspace_root(root)
    source = resolve_existing_workspace_path(workspace, rel_path)
    if not source.is_file():
        raise ValueError(f"document is not a file: {rel_path}")
    if not is_workspace_document_file(source):
        raise ValueError(
            f"document path must end in .md, .markdown, .pdf, .xlsx, or .xlsm: {rel_path}"
        )

    sidecar_path = sidecar_path_for(source)
    sidecar_existed = sidecar_path.exists()
    sidecar_rel: str | None = relative_path_string(workspace, sidecar_path) if sidecar_existed else None

    _move_to_os_trash(source)
    # The primary file has left the workspace — invalidate the scan cache
    # before the sidecar step, otherwise a partial failure below leaves the
    # cache serving a stale entry for a `.md` that's already in OS Trash.
    _invalidate_scan_cache(workspace)
    if sidecar_existed:
        # Sidecar travels into Trash as a separate entry — pair atomicity is
        # captured in the user-facing Confirm copy, not enforced by the OS.
        # If the sidecar move fails the .md is already gone, so surface the
        # error and let the caller know the pair is half-deleted.
        try:
            _move_to_os_trash(sidecar_path)
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                f"document moved to Trash but sidecar move failed: {exc}"
            ) from exc

    return {
        "path": rel_path,
        "sidecarPath": sidecar_rel,
    }


def _move_to_os_trash(path: Path) -> None:
    # send2trash takes a string path on every platform it supports.
    send2trash(str(path))


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
    _move_to_os_trash(source)
    _invalidate_scan_cache(workspace)
    return {
        "path": rel_path,
        "sidecarPath": None,
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


WORKSPACE_DOCUMENT_SUFFIXES = {".md", ".markdown", ".pdf", ".xlsx", ".xlsm"}


def ensure_same_document_extension(old_path: str, new_path: str) -> None:
    """A rename or in-place move may target any document type, but must not
    change the file's type: the destination keeps the source's extension so a
    ``.pdf`` can't silently become a ``.md``. Mirrors the Tauri backend's
    ``ensure_same_document_extension`` so both runtimes honour the contract."""
    old_ext = Path(old_path).suffix.lower()
    new_ext = Path(new_path).suffix.lower()
    for ext, path in ((old_ext, old_path), (new_ext, new_path)):
        if ext not in WORKSPACE_DOCUMENT_SUFFIXES:
            raise ValueError(
                "document path must end in .md, .markdown, .pdf, .xlsx, or .xlsm: "
                f"{path}"
            )
    if old_ext != new_ext:
        raise ValueError(f"cannot change document type on move: {old_path} -> {new_path}")


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


def _sidecar_id_for(path: Path) -> str | None:
    """The id recorded in a document's sidecar, or None if absent/unreadable."""
    sidecar = read_sidecar(sidecar_path_for(path))
    if isinstance(sidecar, Loaded):
        sidecar_id = sidecar.data.get("id")
        if isinstance(sidecar_id, str) and sidecar_id.strip():
            return sidecar_id
    return None


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
        title = title or path.stem  # #148: no authored frontmatter -> title is the filename
        # Identity precedence (#148): legacy frontmatter id -> sidecar id ->
        # path. doXmind no longer writes id into the `.md`, so for its own docs
        # the canonical id lives in the sidecar and must be sourced from there.
        if frontmatter_id:
            id_source = "frontmatter"
            doc_id = frontmatter_id
        elif (sidecar_id := _sidecar_id_for(path)) is not None:
            id_source = "sidecar"
            doc_id = sidecar_id
        else:
            id_source = "path"
            doc_id = stable_path_id(rel_path)
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


def iter_workspace_document_paths(workspace: Path):
    # Sort by lowercased file name so listing/search order is deterministic
    # across scans and matches the frontend's name-asc sort.
    for path in sorted(workspace.rglob("*"), key=lambda p: (p.name.lower(), p.as_posix())):
        if any(part in IGNORED_SCAN_DIRS for part in path.relative_to(workspace).parts[:-1]):
            continue
        if (
            path.is_file()
            and not is_hidden_sidecar_name(path.name)
            and is_workspace_document_file(path)
        ):
            yield path


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
