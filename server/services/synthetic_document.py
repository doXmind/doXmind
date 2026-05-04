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
hardcoded PDF/Excel block declarations here. Legacy sidecar shapes
(`{pdf_editor, pdf_parsed_cache, excel_editor, excel_parsed_cache}`) are
migrated in place on first open via `migrate_legacy_sidecar`; ADR-0003
explains why migration runs as an explicit step rather than at save time.
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from services.markdown_document_state import DocumentSnapshot
from services.sidecar_io import (
    SIDECAR_VERSION,
    Corrupt,
    CorruptSidecarError,
    Loaded,
    Missing,
    atomic_write,
    build_md_with_frontmatter,
    hash_markdown,
    now_iso,
    read_sidecar,
    sidecar_path_for,
)
from services.sidecar_lock import _locked_sidecar

logger = logging.getLogger(__name__)

PDF_BLOCK_TYPE = "pdf-block"
EXCEL_BLOCK_TYPE = "excel-block"

_MIGRATE_ENV_VAR = "DOXMIND_SIDECAR_MIGRATE"
_MIGRATE_DISABLED_VALUES = frozenset({"0", "false", "no", "off"})

_LEGACY_KEYS_BY_BLOCK_TYPE: dict[str, tuple[str, ...]] = {
    PDF_BLOCK_TYPE: ("pdf_editor", "pdf_parsed_cache"),
    EXCEL_BLOCK_TYPE: ("excel_editor", "excel_parsed_cache"),
}

_LEGACY_EDITOR_KEY = {
    PDF_BLOCK_TYPE: "pdf_editor",
    EXCEL_BLOCK_TYPE: "excel_editor",
}
_LEGACY_PARSED_CACHE_KEY = {
    PDF_BLOCK_TYPE: "pdf_parsed_cache",
    EXCEL_BLOCK_TYPE: "excel_parsed_cache",
}

_PLACEHOLDER_RE = re.compile(
    r"<!--\s*(?P<block>pdf-block|excel-block)\s+id=\"(?P<id>[^\"]+)\"\s+src=\"(?P<src>[^\"]+)\"\s*-->"
)


class LegacySidecarError(Exception):
    """Raised when a legacy sidecar cannot be migrated or read.

    Migration runs automatically on first open when
    `DOXMIND_SIDECAR_MIGRATE` is unset or truthy; this error signals an
    actual failure (rewrite step crashed after the `.bak` was written),
    not the mere presence of legacy shape.
    """

    def __init__(self, sidecar_path: Path, block_type: str, reason: str) -> None:
        super().__init__(f"legacy {block_type} sidecar at {sidecar_path}: {reason}")
        self.sidecar_path = sidecar_path
        self.block_type = block_type
        self.reason = reason


class SidecarMigrationError(LegacySidecarError):
    """Raised when migration fails after `.bak` has been written.

    The original sidecar contents are recoverable from `<sidecar>.bak`.
    """


class ReadOnlyDocumentError(Exception):
    """Raised when a write is attempted on a read-only synthetic Document.

    Triggered when `DOXMIND_SIDECAR_MIGRATE=0` opens a legacy sidecar:
    the Document is synthesized from legacy state in memory but the
    on-disk sidecar must not be modified.
    """

    def __init__(self, path: Path) -> None:
        super().__init__(
            f"document at {path} is read-only ({_MIGRATE_ENV_VAR}=0 against legacy sidecar)"
        )
        self.path = path


@dataclass(frozen=True)
class Document:
    """In-memory representation of a Synthetic Document.

    `path` is the second-class file (`.pdf` / `.xlsx`); the sidecar lives
    at `sidecar_path_for(path)`. `block_id` and `block_type` identify the
    single Custom Block whose state lives in `snapshot.extras["blocks"][block_id]`.

    `read_only` is set when the document was synthesized from a legacy
    sidecar with `DOXMIND_SIDECAR_MIGRATE=0`; subsequent writes raise
    `ReadOnlyDocumentError`.
    """

    path: Path
    block_id: str
    block_type: str
    snapshot: DocumentSnapshot
    read_only: bool = field(default=False)


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
        if document.read_only:
            raise ReadOnlyDocumentError(document.path)
        meta = dict(snapshot.meta)
        if not str(meta.get("id") or "").strip():
            raise ValueError("document id is required")
        meta["updated"] = now_iso()
        new_snapshot = replace(snapshot, meta=meta)
        self._write_sidecar(document.path, new_snapshot)
        return replace(document, snapshot=new_snapshot)

    def migrate_legacy_sidecar(
        self, sidecar_path: Path, *, for_path: Path | None = None, _locked: bool = False
    ) -> None:
        """Rewrite a legacy PDF/Excel sidecar in-place to markdown shape.

        Idempotent: a no-op if the sidecar is already markdown-shape.
        Writes `<sidecar>.bak` with the original bytes before mutating
        the sidecar. If the rewrite fails after `.bak` is written, raises
        `SidecarMigrationError` and leaves both files in place so the
        user can recover by renaming `.bak` back.
        """
        assert for_path is not None, (
            "migrate_legacy_sidecar requires for_path from production callers"
        )
        sidecar_result = read_sidecar(sidecar_path)
        if isinstance(sidecar_result, Missing):
            return
        if isinstance(sidecar_result, Corrupt):
            raise CorruptSidecarError(sidecar_path, None, sidecar_result.reason)
        if not isinstance(sidecar_result, Loaded):
            raise TypeError(f"unexpected sidecar read result: {type(sidecar_result).__name__}")
        sidecar = sidecar_result.data

        block_type = _detect_legacy_block_type(sidecar)
        if block_type is None:
            return
        raw_bytes = sidecar_path.read_bytes()

        if not _locked:
            with _locked_sidecar(sidecar_path):
                self.migrate_legacy_sidecar(sidecar_path, for_path=for_path, _locked=True)
            return

        bak_path = _bak_path(sidecar_path)
        if bak_path.exists():
            raise SidecarMigrationError(
                sidecar_path,
                block_type,
                f"a previous migration backup is in place at {bak_path}; investigate before retrying",
            )

        atomic_write(bak_path, raw_bytes)

        try:
            new_snapshot = _snapshot_from_legacy(for_path, block_type, sidecar)
            self._write_sidecar(for_path, new_snapshot)
        except Exception as exc:
            raise SidecarMigrationError(
                sidecar_path,
                block_type,
                f"rewrite failed after .bak was written: {exc}",
            ) from exc

    def _open(self, path: Path, block_type: str) -> Document:
        if not path.is_absolute():
            raise ValueError("synthetic document path must be absolute")
        sc_path = sidecar_path_for(path)
        sidecar_result = read_sidecar(sc_path)

        if isinstance(sidecar_result, Missing):
            return self._synthesize_new(path, block_type)
        if isinstance(sidecar_result, Corrupt):
            forensic_path = _write_forensic_copy(sc_path, sidecar_result.raw)
            raise CorruptSidecarError(sc_path, forensic_path, sidecar_result.reason)
        if not isinstance(sidecar_result, Loaded):
            raise TypeError(f"unexpected sidecar read result: {type(sidecar_result).__name__}")
        sidecar = sidecar_result.data

        if any(key in sidecar for key in _LEGACY_KEYS_BY_BLOCK_TYPE[block_type]):
            if _migration_disabled():
                return self._synthesize_read_only_from_legacy(path, block_type, sidecar)
            logger.info(
                "migration.start",
                extra={"sidecar_path": str(sc_path), "block_type": block_type},
            )
            try:
                with _locked_sidecar(sc_path):
                    locked_sidecar = read_sidecar(sc_path)
                    if isinstance(locked_sidecar, Missing):
                        raise SidecarMigrationError(
                            sc_path, block_type, "sidecar missing during migration"
                        )
                    if isinstance(locked_sidecar, Corrupt):
                        forensic_path = _write_forensic_copy(sc_path, locked_sidecar.raw)
                        raise CorruptSidecarError(sc_path, forensic_path, locked_sidecar.reason)
                    if not isinstance(locked_sidecar, Loaded):
                        raise TypeError(
                            f"unexpected sidecar read result: {type(locked_sidecar).__name__}"
                        )
                    if not any(
                        key in locked_sidecar.data
                        for key in _LEGACY_KEYS_BY_BLOCK_TYPE[block_type]
                    ):
                        logger.info(
                            "migration.success",
                            extra={
                                "sidecar_path": str(sc_path),
                                "block_type": block_type,
                                "reason": "another process migrated under the lock",
                            },
                        )
                        return self._read_markdown_shape(path, block_type, locked_sidecar.data)

                    self.migrate_legacy_sidecar(sc_path, for_path=path, _locked=True)
                    migrated = read_sidecar(sc_path)
            except Exception as exc:
                logger.exception(
                    "migration.failure",
                    extra={
                        "sidecar_path": str(sc_path),
                        "block_type": block_type,
                        "reason": str(exc),
                    },
                )
                raise
            logger.info(
                "migration.success",
                extra={"sidecar_path": str(sc_path), "block_type": block_type},
            )
            if isinstance(migrated, Missing):
                raise SidecarMigrationError(sc_path, block_type, "sidecar missing after migration")
            if isinstance(migrated, Corrupt):
                forensic_path = _write_forensic_copy(sc_path, migrated.raw)
                raise CorruptSidecarError(sc_path, forensic_path, migrated.reason)
            if not isinstance(migrated, Loaded):
                raise TypeError(f"unexpected sidecar read result: {type(migrated).__name__}")
            return self._read_markdown_shape(path, block_type, migrated.data)

        return self._read_markdown_shape(path, block_type, sidecar)

    def _synthesize_read_only_from_legacy(
        self, path: Path, block_type: str, sidecar: dict[str, Any]
    ) -> Document:
        snapshot = _snapshot_from_legacy(path, block_type, sidecar)
        block_id = next(iter(snapshot.extras["blocks"]))  # type: ignore[index]
        return Document(
            path=path,
            block_id=block_id,
            block_type=block_type,
            snapshot=snapshot,
            read_only=True,
        )

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


def _migration_disabled() -> bool:
    raw = os.environ.get(_MIGRATE_ENV_VAR)
    if raw is None:
        return False
    return raw.strip().lower() in _MIGRATE_DISABLED_VALUES


def _detect_legacy_block_type(sidecar: dict[str, Any]) -> str | None:
    for block_type, keys in _LEGACY_KEYS_BY_BLOCK_TYPE.items():
        if any(key in sidecar for key in keys):
            return block_type
    return None


def _bak_path(sidecar_path: Path) -> Path:
    return sidecar_path.parent / f"{sidecar_path.name}.bak"


def _write_forensic_copy(sidecar_path: Path, raw: bytes) -> Path:
    timestamp = now_iso().replace(":", "-")
    forensic_path = sidecar_path.parent / f"{sidecar_path.name}.corrupt-{timestamp}"
    atomic_write(forensic_path, raw)
    return forensic_path


def _path_for_sidecar(sidecar_path: Path) -> Path:
    name = sidecar_path.name
    if name.startswith(".") and name.endswith(".doxmind"):
        return sidecar_path.parent / name[1 : -len(".doxmind")]
    raise ValueError(f"not a sidecar path: {sidecar_path}")


def _snapshot_from_legacy(path: Path, block_type: str, sidecar: dict[str, Any]) -> DocumentSnapshot:
    block_id = str(uuid.uuid4())
    rel_src = path.name
    body = _placeholder_line(block_type, block_id, rel_src) + "\n"
    existing_id = str(sidecar.get("id") or "").strip() or str(uuid.uuid4())
    meta: dict[str, Any] = {"id": existing_id, "title": path.stem}
    slot: dict[str, Any] = {}
    editor = sidecar.get(_LEGACY_EDITOR_KEY[block_type])
    if isinstance(editor, dict):
        slot["editor"] = editor
    parsed_cache = sidecar.get(_LEGACY_PARSED_CACHE_KEY[block_type])
    if isinstance(parsed_cache, dict):
        slot["parsedCache"] = parsed_cache
    return DocumentSnapshot(
        html=_placeholder_html(block_type, block_id, rel_src),
        markdown=body,
        meta=meta,
        extras={"blocks": {block_id: slot}},
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
