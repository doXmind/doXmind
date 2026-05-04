"""Tests for ``services.synthetic_document``.

Covers the three open paths (no sidecar / markdown-shape / legacy-shape)
for both PDF and Excel, plus the round-trip: open → write_full → re-open
preserves state.
"""

from __future__ import annotations

import json
import re
from dataclasses import replace
from pathlib import Path

import pytest

from services.sidecar_io import (
    SIDECAR_VERSION,
    atomic_write,
    sidecar_path_for,
)
from services.synthetic_document import (
    EXCEL_BLOCK_TYPE,
    PDF_BLOCK_TYPE,
    LegacySidecarError,
    SyntheticDocumentFactory,
)


def _write_legacy_pdf_sidecar(pdf_path: Path) -> None:
    payload = {
        "version": SIDECAR_VERSION,
        "id": "legacy-pdf",
        "source_path": pdf_path.name,
        "updated_at": "2024-01-01T00:00:00Z",
        "pdf_editor": {"version": 1, "edits": {"1:0": {"text": "x"}}},
        "pdf_parsed_cache": {"sourceHash": "abc", "parsed": {"pages": []}},
    }
    atomic_write(sidecar_path_for(pdf_path), json.dumps(payload).encode())


def _write_legacy_excel_sidecar(xlsx_path: Path) -> None:
    payload = {
        "version": SIDECAR_VERSION,
        "id": "legacy-excel",
        "source_path": xlsx_path.name,
        "updated_at": "2024-01-01T00:00:00Z",
        "excel_editor": {"version": 1, "sheets": []},
        "excel_parsed_cache": {"sourceHash": "abc", "parsed": {"sheets": []}},
    }
    atomic_write(sidecar_path_for(xlsx_path), json.dumps(payload).encode())


def _make_pdf(tmp_path: Path, name: str = "Application.pdf") -> Path:
    path = tmp_path / name
    path.write_bytes(b"%PDF-1.4\n% doxmind test pdf\n")
    return path


def _make_excel(tmp_path: Path, name: str = "Q3 Forecast.xlsx") -> Path:
    path = tmp_path / name
    path.write_bytes(b"PK\x03\x04 fake xlsx body")
    return path


# ---------------------------------------------------------------------------
# PDF — synthesis on no sidecar
# ---------------------------------------------------------------------------


def test_open_pdf_with_no_sidecar_synthesizes_block_and_writes_markdown_shape_sidecar(
    tmp_path,
):
    pdf_path = _make_pdf(tmp_path)

    document = SyntheticDocumentFactory().open_pdf(pdf_path)

    assert document.path == pdf_path
    assert document.block_type == PDF_BLOCK_TYPE
    assert re.fullmatch(r"[0-9a-f-]{36}", document.block_type) is None  # sanity: not a uuid
    assert re.fullmatch(r"[0-9a-f-]{36}", document.block_id), "block id must be uuid v4"

    placeholder = (
        f'<!-- pdf-block id="{document.block_id}" src="{pdf_path.name}" -->'
    )
    assert placeholder in document.snapshot.markdown
    assert document.snapshot.extras == {"blocks": {document.block_id: {}}}

    # PDF binary must NOT be touched.
    assert pdf_path.read_bytes().startswith(b"%PDF-")

    sidecar_path = sidecar_path_for(pdf_path)
    assert sidecar_path.exists()
    on_disk = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert on_disk["version"] == SIDECAR_VERSION
    assert on_disk["id"] == document.snapshot.meta["id"]
    assert "pdf_editor" not in on_disk and "pdf_parsed_cache" not in on_disk
    assert on_disk["extras"] == {"blocks": {document.block_id: {}}}
    assert placeholder in on_disk["html"]


# ---------------------------------------------------------------------------
# PDF — pass-through on existing markdown-shape sidecar
# ---------------------------------------------------------------------------


def test_open_pdf_with_markdown_shape_sidecar_passes_through(tmp_path):
    pdf_path = _make_pdf(tmp_path)
    factory = SyntheticDocumentFactory()
    first = factory.open_pdf(pdf_path)

    # Mutate the sidecar by hand and confirm a re-open does not modify it.
    sidecar_path = sidecar_path_for(pdf_path)
    raw_before = sidecar_path.read_text(encoding="utf-8")

    second = factory.open_pdf(pdf_path)
    raw_after = sidecar_path.read_text(encoding="utf-8")

    assert second.block_id == first.block_id
    assert raw_after == raw_before


# ---------------------------------------------------------------------------
# PDF — legacy-shape sidecar raises
# ---------------------------------------------------------------------------


def test_open_pdf_with_legacy_sidecar_raises(tmp_path):
    pdf_path = _make_pdf(tmp_path)
    _write_legacy_pdf_sidecar(pdf_path)
    sidecar_path = sidecar_path_for(pdf_path)
    raw_before = sidecar_path.read_text(encoding="utf-8")

    with pytest.raises(LegacySidecarError) as excinfo:
        SyntheticDocumentFactory().open_pdf(pdf_path)

    assert excinfo.value.block_type == PDF_BLOCK_TYPE
    assert excinfo.value.sidecar_path == sidecar_path
    # Legacy sidecar must not have been mutated.
    assert sidecar_path.read_text(encoding="utf-8") == raw_before


# ---------------------------------------------------------------------------
# Excel — symmetric three cases
# ---------------------------------------------------------------------------


def test_open_excel_with_no_sidecar_synthesizes_block(tmp_path):
    xlsx_path = _make_excel(tmp_path)

    document = SyntheticDocumentFactory().open_excel(xlsx_path)

    assert document.block_type == EXCEL_BLOCK_TYPE
    placeholder = (
        f'<!-- excel-block id="{document.block_id}" src="{xlsx_path.name}" -->'
    )
    assert placeholder in document.snapshot.markdown
    assert document.snapshot.extras == {"blocks": {document.block_id: {}}}

    sidecar = json.loads(sidecar_path_for(xlsx_path).read_text(encoding="utf-8"))
    assert sidecar["version"] == SIDECAR_VERSION
    assert "excel_editor" not in sidecar and "excel_parsed_cache" not in sidecar


def test_open_excel_with_markdown_shape_sidecar_passes_through(tmp_path):
    xlsx_path = _make_excel(tmp_path)
    factory = SyntheticDocumentFactory()
    first = factory.open_excel(xlsx_path)

    sidecar_path = sidecar_path_for(xlsx_path)
    raw_before = sidecar_path.read_text(encoding="utf-8")

    second = factory.open_excel(xlsx_path)

    assert second.block_id == first.block_id
    assert sidecar_path.read_text(encoding="utf-8") == raw_before


def test_open_excel_with_legacy_sidecar_raises(tmp_path):
    xlsx_path = _make_excel(tmp_path)
    _write_legacy_excel_sidecar(xlsx_path)

    with pytest.raises(LegacySidecarError) as excinfo:
        SyntheticDocumentFactory().open_excel(xlsx_path)

    assert excinfo.value.block_type == EXCEL_BLOCK_TYPE


# ---------------------------------------------------------------------------
# Round-trip: open_pdf → write_full → re-open_pdf returns modified state
# ---------------------------------------------------------------------------


def test_open_pdf_write_full_reopen_round_trips_block_state(tmp_path):
    pdf_path = _make_pdf(tmp_path)
    factory = SyntheticDocumentFactory()
    document = factory.open_pdf(pdf_path)

    new_extras = {
        "blocks": {
            document.block_id: {
                "editor": {"version": 1, "edits": {"1:0": {"text": "Edited"}}},
                "parsedCache": {"sourceHash": "deadbeef", "parsed": {"pages": [1]}},
            }
        }
    }
    new_snapshot = replace(document.snapshot, extras=new_extras)
    factory.write_full(document, new_snapshot)

    reopened = factory.open_pdf(pdf_path)

    assert reopened.block_id == document.block_id
    assert reopened.snapshot.extras == new_extras
    # PDF binary still intact.
    assert pdf_path.read_bytes().startswith(b"%PDF-")
