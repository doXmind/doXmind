"""SyntheticDocumentFactory: open a Second-class file as a Document.

A `.pdf` or `.xlsx` file is, in product semantics, equivalent to a
Document with exactly one Custom Block of the matching type (PDF block
or Excel block). This module synthesizes that Document in memory and
persists it as a markdown-shape sidecar (e.g. `.foo.pdf.doxmind` next to
`foo.pdf`); the original binary serves as the body replacement, so it
is never modified by `write_full`.

`open_pdf` / `open_excel` route the disk side through the same wire
format that `MarkdownDocumentState` produces, including version and
markdown-hash checks. ExternalRefBlockRegistry (#4) will replace the
hardcoded PDF/Excel block declarations here. Sidecar migration of the
legacy `{pdf_editor, pdf_parsed_cache, excel_editor, excel_parsed_cache}`
shape lands in slice 4 (#11); this slice raises `LegacySidecarError`,
which becomes the migration trigger when slice 4 lands.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from services.markdown_document_state import DocumentSnapshot
from services.sidecar_io import (
    SIDECAR_VERSION,
    atomic_write,
    build_md_with_frontmatter,
    hash_markdown,
    now_iso,
    read_sidecar,
    sidecar_path_for,
)

PDF_BLOCK_TYPE = "pdf-block"
EXCEL_BLOCK_TYPE = "excel-block"

_LEGACY_KEYS_BY_BLOCK_TYPE: dict[str, tuple[str, ...]] = {
    PDF_BLOCK_TYPE: ("pdf_editor", "pdf_parsed_cache"),
    EXCEL_BLOCK_TYPE: ("excel_editor", "excel_parsed_cache"),
}

_PLACEHOLDER_RE = re.compile(
    r"<!--\s*(?P<block>pdf-block|excel-block)\s+id=\"(?P<id>[^\"]+)\"\s+src=\"(?P<src>[^\"]+)\"\s*-->"
)


class LegacySidecarError(Exception):
    """Raised when a legacy-shape PDF/Excel sidecar is encountered.

    Slice 4 (#11) replaces this branch with the in-place sidecar
    migration; until then, callers must surface the error so the user
    is not silently mutated under.
    """

    def __init__(self, sidecar_path: Path, block_type: str) -> None:
        super().__init__(
            f"legacy {block_type} sidecar shape at {sidecar_path}; "
            "migration is handled by slice 4"
        )
        self.sidecar_path = sidecar_path
        self.block_type = block_type


@dataclass(frozen=True)
class Document:
    """In-memory representation of a Synthetic Document.

    `path` is the second-class file (`.pdf` / `.xlsx`); the sidecar lives
    at `sidecar_path_for(path)`. `block_id` and `block_type` identify the
    single Custom Block whose state lives in `snapshot.extras["blocks"][block_id]`.
    """

    path: Path
    block_id: str
    block_type: str
    snapshot: DocumentSnapshot


class SyntheticDocumentFactory:
    def open_pdf(self, pdf_path: Path) -> Document:
        return self._open(pdf_path, PDF_BLOCK_TYPE)

    def open_excel(self, xlsx_path: Path) -> Document:
        return self._open(xlsx_path, EXCEL_BLOCK_TYPE)

    def write_full(self, document: Document, snapshot: DocumentSnapshot) -> Document:
        """Persist `snapshot` to the Synthetic Document's sidecar.

        Only the sidecar is written; the second-class binary at
        `document.path` is never touched. Returns a new `Document` whose
        `snapshot` reflects what was just written.
        """
        meta = dict(snapshot.meta)
        if not str(meta.get("id") or "").strip():
            raise ValueError("document id is required")
        meta["updated"] = now_iso()
        new_snapshot = replace(snapshot, meta=meta)
        self._write_sidecar(document.path, new_snapshot)
        return replace(document, snapshot=new_snapshot)

    def _open(self, path: Path, block_type: str) -> Document:
        if not path.is_absolute():
            raise ValueError("synthetic document path must be absolute")
        sc_path = sidecar_path_for(path)
        sidecar = read_sidecar(sc_path)

        if sidecar is None:
            return self._synthesize_new(path, block_type)

        if any(key in sidecar for key in _LEGACY_KEYS_BY_BLOCK_TYPE[block_type]):
            raise LegacySidecarError(sc_path, block_type)

        return self._read_markdown_shape(path, block_type, sidecar)

    def _synthesize_new(self, path: Path, block_type: str) -> Document:
        block_id = str(uuid.uuid4())
        rel_src = path.name
        body = _placeholder_line(block_type, block_id, rel_src) + "\n"
        meta: dict[str, Any] = {"id": str(uuid.uuid4()), "title": path.stem}
        snapshot = DocumentSnapshot(
            html=_placeholder_html(block_type, block_id, rel_src),
            markdown=body,
            meta=meta,
            extras={"blocks": {block_id: {}}},
        )
        document = Document(path=path, block_id=block_id, block_type=block_type, snapshot=snapshot)
        return self.write_full(document, snapshot)

    def _read_markdown_shape(
        self, path: Path, block_type: str, sidecar: dict[str, Any]
    ) -> Document:
        if sidecar.get("version") != SIDECAR_VERSION:
            raise ValueError(
                f"sidecar version {sidecar.get('version')!r} for {path} does not match "
                f"current SIDECAR_VERSION={SIDECAR_VERSION}"
            )
        extras = sidecar.get("extras")
        if not isinstance(extras, dict):
            extras = {"blocks": {}}
        blocks = extras.get("blocks") if isinstance(extras.get("blocks"), dict) else {}
        block_id = _first_block_id_in_html(sidecar.get("html") or "", block_type)
        if block_id is None:
            block_id = next(iter(blocks), None)
        if block_id is None:
            raise ValueError(
                f"markdown-shape sidecar at {sidecar_path_for(path)} has no {block_type} placeholder"
            )
        meta: dict[str, Any] = {
            "id": str(sidecar.get("id") or ""),
            "title": path.stem,
        }
        snapshot = DocumentSnapshot(
            html=str(sidecar.get("html") or ""),
            markdown=_placeholder_line(block_type, block_id, path.name) + "\n",
            meta=meta,
            extras=extras,
        )
        return Document(path=path, block_id=block_id, block_type=block_type, snapshot=snapshot)

    def _write_sidecar(self, path: Path, snapshot: DocumentSnapshot) -> None:
        md_content = build_md_with_frontmatter(snapshot.meta, snapshot.markdown)
        sidecar: dict[str, Any] = {
            "version": SIDECAR_VERSION,
            "id": snapshot.meta["id"],
            "html": snapshot.html,
            "markdown_hash": hash_markdown(md_content),
            "updated_at": now_iso(),
        }
        if snapshot.extras is not None:
            sidecar["extras"] = snapshot.extras
        atomic_write(
            sidecar_path_for(path),
            json.dumps(sidecar, indent=2, ensure_ascii=False).encode(),
        )


def _placeholder_line(block_type: str, block_id: str, rel_src: str) -> str:
    return f'<!-- {block_type} id="{block_id}" src="{rel_src}" -->'


def _placeholder_html(block_type: str, block_id: str, rel_src: str) -> str:
    return _placeholder_line(block_type, block_id, rel_src)


def _first_block_id_in_html(html: str, block_type: str) -> str | None:
    for match in _PLACEHOLDER_RE.finditer(html):
        if match.group("block") == block_type:
            return match.group("id")
    return None
