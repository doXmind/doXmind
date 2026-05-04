"""Tests for ``services.synthetic_document``.

Covers the open paths (no sidecar / markdown-shape / legacy-shape) for
both PDF and Excel, the round-trip after `write_full`, and the legacy
sidecar migration introduced in slice 4 (#11).
"""

from __future__ import annotations

import json
import logging
import multiprocessing
import re
from dataclasses import replace
from pathlib import Path

import pytest

from services import synthetic_document as sd_module
from services.sidecar_io import (
    SIDECAR_VERSION,
    CorruptSidecarError,
    atomic_write,
    sidecar_path_for,
)
from services.sidecar_lock import _locked_sidecar
from services.synthetic_document import (
    EXCEL_BLOCK_TYPE,
    PDF_BLOCK_TYPE,
    LegacySidecarError,
    ReadOnlyDocumentError,
    SidecarMigrationError,
    SyntheticDocumentFactory,
)


def _legacy_pdf_payload(pdf_path: Path) -> dict:
    return {
        "version": SIDECAR_VERSION,
        "id": "legacy-pdf",
        "source_path": pdf_path.name,
        "updated_at": "2024-01-01T00:00:00Z",
        "pdf_editor": {"version": 1, "edits": {"1:0": {"text": "x"}}},
        "pdf_parsed_cache": {"sourceHash": "abc", "parsed": {"pages": []}},
    }


def _legacy_excel_payload(xlsx_path: Path) -> dict:
    return {
        "version": SIDECAR_VERSION,
        "id": "legacy-excel",
        "source_path": xlsx_path.name,
        "updated_at": "2024-01-01T00:00:00Z",
        "excel_editor": {"version": 1, "sheets": []},
        "excel_parsed_cache": {"sourceHash": "abc", "parsed": {"sheets": []}},
    }


def _write_legacy_pdf_sidecar(pdf_path: Path) -> bytes:
    raw = json.dumps(_legacy_pdf_payload(pdf_path)).encode()
    atomic_write(sidecar_path_for(pdf_path), raw)
    return raw


def _write_legacy_excel_sidecar(xlsx_path: Path) -> bytes:
    raw = json.dumps(_legacy_excel_payload(xlsx_path)).encode()
    atomic_write(sidecar_path_for(xlsx_path), raw)
    return raw


def _make_pdf(tmp_path: Path, name: str = "Application.pdf") -> Path:
    path = tmp_path / name
    path.write_bytes(b"%PDF-1.4\n% doxmind test pdf\n")
    return path


def _make_excel(tmp_path: Path, name: str = "Q3 Forecast.xlsx") -> Path:
    path = tmp_path / name
    path.write_bytes(b"PK\x03\x04 fake xlsx body")
    return path


def _open_pdf_block_id_worker(sidecar_path: str) -> str:
    pdf_path = sd_module._path_for_sidecar(Path(sidecar_path))
    return SyntheticDocumentFactory().open_pdf(pdf_path).block_id


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

    placeholder = f'<!-- pdf-block id="{document.block_id}" src="{pdf_path.name}" -->'
    assert placeholder in document.snapshot.markdown
    assert document.snapshot.extras == {"blocks": {document.block_id: {}}}
    assert document.read_only is False

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

    sidecar_path = sidecar_path_for(pdf_path)
    raw_before = sidecar_path.read_text(encoding="utf-8")

    second = factory.open_pdf(pdf_path)
    raw_after = sidecar_path.read_text(encoding="utf-8")

    assert second.block_id == first.block_id
    assert raw_after == raw_before


# ---------------------------------------------------------------------------
# Excel — symmetric
# ---------------------------------------------------------------------------


def test_open_excel_with_no_sidecar_synthesizes_block(tmp_path):
    xlsx_path = _make_excel(tmp_path)

    document = SyntheticDocumentFactory().open_excel(xlsx_path)

    assert document.block_type == EXCEL_BLOCK_TYPE
    placeholder = f'<!-- excel-block id="{document.block_id}" src="{xlsx_path.name}" -->'
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
    assert pdf_path.read_bytes().startswith(b"%PDF-")


# ---------------------------------------------------------------------------
# Legacy sidecar migration (slice 4, #11)
# ---------------------------------------------------------------------------


def test_open_pdf_migrates_legacy_sidecar_in_place(tmp_path):
    pdf_path = _make_pdf(tmp_path)
    raw_before = _write_legacy_pdf_sidecar(pdf_path)
    sidecar_path = sidecar_path_for(pdf_path)
    bak_path = sidecar_path.parent / f"{sidecar_path.name}.bak"

    document = SyntheticDocumentFactory().open_pdf(pdf_path)

    assert document.block_type == PDF_BLOCK_TYPE
    assert document.read_only is False
    assert bak_path.exists()
    assert bak_path.read_bytes() == raw_before

    on_disk = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert on_disk["version"] == SIDECAR_VERSION
    assert "pdf_editor" not in on_disk
    assert "pdf_parsed_cache" not in on_disk
    slot = on_disk["extras"]["blocks"][document.block_id]
    assert slot["editor"] == {"version": 1, "edits": {"1:0": {"text": "x"}}}
    assert slot["parsedCache"] == {"sourceHash": "abc", "parsed": {"pages": []}}

    # Document carries the migrated state.
    assert document.snapshot.extras["blocks"][document.block_id]["editor"] == slot["editor"]

    # User's PDF binary is untouched.
    assert pdf_path.read_bytes().startswith(b"%PDF-")


def test_open_pdf_concurrent_legacy_migration_race(tmp_path):
    pdf_path = _make_pdf(tmp_path)
    raw_before = _write_legacy_pdf_sidecar(pdf_path)
    sidecar_path = sidecar_path_for(pdf_path)
    bak_path = sidecar_path.parent / f"{sidecar_path.name}.bak"

    with multiprocessing.Pool(processes=4) as pool:
        block_ids = pool.map(_open_pdf_block_id_worker, [str(sidecar_path)] * 4)

    assert len(set(block_ids)) == 1
    block_id = block_ids[0]

    on_disk = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert on_disk["version"] == SIDECAR_VERSION
    assert "pdf_editor" not in on_disk
    assert "pdf_parsed_cache" not in on_disk
    assert block_id in on_disk["extras"]["blocks"]

    assert bak_path.exists()
    assert bak_path.read_bytes() == raw_before


def test_locked_sidecar_creates_and_keeps_lock_file(tmp_path):
    sidecar_path = tmp_path / ".Application.pdf.doxmind"
    lock_path = sidecar_path.parent / f"{sidecar_path.name}.lock"

    assert not lock_path.exists()

    with _locked_sidecar(sidecar_path):
        assert lock_path.exists()

    assert lock_path.exists()


def test_open_pdf_reads_markdown_shape_after_sidecar_changes_shape(tmp_path):
    pdf_path = _make_pdf(tmp_path)
    _write_legacy_pdf_sidecar(pdf_path)
    sidecar_path = sidecar_path_for(pdf_path)
    bak_path = sidecar_path.parent / f"{sidecar_path.name}.bak"
    block_id = "existing-markdown-block"
    markdown_sidecar = {
        "version": SIDECAR_VERSION,
        "id": "already-migrated",
        "html": f'<!-- pdf-block id="{block_id}" src="{pdf_path.name}" -->',
        "markdown_hash": "sha256:already-migrated",
        "updated_at": "2024-01-01T00:00:00Z",
        "extras": {"blocks": {block_id: {"editor": {"version": 2}}}},
    }

    with _locked_sidecar(sidecar_path):
        atomic_write(
            sidecar_path,
            json.dumps(markdown_sidecar, indent=2).encode(),
        )

    document = SyntheticDocumentFactory().open_pdf(pdf_path)

    assert document.block_id == block_id
    assert document.snapshot.extras == markdown_sidecar["extras"]
    assert not bak_path.exists()


def test_legacy_migrate_then_write_round_trip(tmp_path):
    pdf_path = _make_pdf(tmp_path)
    _write_legacy_pdf_sidecar(pdf_path)
    factory = SyntheticDocumentFactory()
    doc = factory.open_pdf(pdf_path)
    new_extras = {
        "blocks": {doc.block_id: {"editor": {"v": 2, "edits": {"3:0": {"text": "edited"}}}}}
    }

    factory.write_full(doc, replace(doc.snapshot, extras=new_extras))
    reopened = factory.open_pdf(pdf_path)

    assert reopened.snapshot.extras == new_extras
    assert reopened.block_id == doc.block_id


def test_open_excel_migrates_legacy_sidecar_in_place(tmp_path):
    xlsx_path = _make_excel(tmp_path)
    raw_before = _write_legacy_excel_sidecar(xlsx_path)
    sidecar_path = sidecar_path_for(xlsx_path)
    bak_path = sidecar_path.parent / f"{sidecar_path.name}.bak"

    document = SyntheticDocumentFactory().open_excel(xlsx_path)

    assert bak_path.exists()
    assert bak_path.read_bytes() == raw_before

    on_disk = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert "excel_editor" not in on_disk
    slot = on_disk["extras"]["blocks"][document.block_id]
    assert slot["editor"] == {"version": 1, "sheets": []}


def test_open_pdf_logs_migration_start_and_success(tmp_path, caplog):
    pdf_path = _make_pdf(tmp_path)
    _write_legacy_pdf_sidecar(pdf_path)
    sidecar_path = sidecar_path_for(pdf_path)
    caplog.set_level(logging.INFO, logger=sd_module.__name__)

    SyntheticDocumentFactory().open_pdf(pdf_path)

    records = [
        record
        for record in caplog.records
        if record.name == sd_module.__name__
        and record.getMessage() in {"migration.start", "migration.success"}
    ]
    assert [record.getMessage() for record in records] == [
        "migration.start",
        "migration.success",
    ]
    assert {record.sidecar_path for record in records} == {str(sidecar_path)}
    assert {record.block_type for record in records} == {PDF_BLOCK_TYPE}


def test_open_pdf_logs_migration_failure(tmp_path, caplog):
    pdf_path = _make_pdf(tmp_path)
    _write_legacy_pdf_sidecar(pdf_path)
    sidecar_path = sidecar_path_for(pdf_path)
    bak_path = sidecar_path.parent / f"{sidecar_path.name}.bak"
    bak_path.write_bytes(b"previous migration backup")
    caplog.set_level(logging.INFO, logger=sd_module.__name__)

    with pytest.raises(SidecarMigrationError):
        SyntheticDocumentFactory().open_pdf(pdf_path)

    records = [
        record
        for record in caplog.records
        if record.name == sd_module.__name__
        and record.getMessage() in {"migration.start", "migration.failure"}
    ]
    assert [record.getMessage() for record in records] == [
        "migration.start",
        "migration.failure",
    ]
    failure = records[1]
    assert failure.sidecar_path == str(sidecar_path)
    assert failure.block_type == PDF_BLOCK_TYPE
    assert "previous migration backup is in place" in failure.reason


def test_migrate_legacy_sidecar_is_noop_on_markdown_shape(tmp_path):
    pdf_path = _make_pdf(tmp_path)
    factory = SyntheticDocumentFactory()
    factory.open_pdf(pdf_path)  # produces markdown-shape sidecar
    sidecar_path = sidecar_path_for(pdf_path)
    raw_before = sidecar_path.read_bytes()
    bak_path = sidecar_path.parent / f"{sidecar_path.name}.bak"

    factory.migrate_legacy_sidecar(sidecar_path, for_path=pdf_path)

    assert sidecar_path.read_bytes() == raw_before
    assert not bak_path.exists()


def test_open_pdf_refuses_to_overwrite_existing_migration_backup(tmp_path):
    pdf_path = _make_pdf(tmp_path)
    raw_before = _write_legacy_pdf_sidecar(pdf_path)
    sidecar_path = sidecar_path_for(pdf_path)
    bak_path = sidecar_path.parent / f"{sidecar_path.name}.bak"
    bak_bytes = b"previous migration backup"
    bak_path.write_bytes(bak_bytes)

    with pytest.raises(SidecarMigrationError) as excinfo:
        SyntheticDocumentFactory().open_pdf(pdf_path)

    assert "previous migration backup is in place" in excinfo.value.reason
    assert sidecar_path.read_bytes() == raw_before
    assert bak_path.read_bytes() == bak_bytes


def test_migrate_legacy_sidecar_requires_for_path_from_production_callers(tmp_path):
    sidecar_path = tmp_path / ".Application.pdf.doxmind"

    with pytest.raises(AssertionError, match="requires for_path"):
        SyntheticDocumentFactory().migrate_legacy_sidecar(sidecar_path)


def test_migrate_legacy_sidecar_aborts_when_bak_write_fails(tmp_path, monkeypatch):
    pdf_path = _make_pdf(tmp_path)
    raw_before = _write_legacy_pdf_sidecar(pdf_path)
    sidecar_path = sidecar_path_for(pdf_path)
    bak_path = sidecar_path.parent / f"{sidecar_path.name}.bak"

    def boom(target: Path, data: bytes) -> None:
        if target == bak_path:
            raise OSError("simulated bak write failure")
        # Any other write would mean migration progressed past the abort line.
        raise AssertionError(f"unexpected atomic_write to {target}")

    monkeypatch.setattr(sd_module, "atomic_write", boom)

    with pytest.raises(OSError, match="simulated bak write failure"):
        SyntheticDocumentFactory().open_pdf(pdf_path)

    # Original sidecar untouched, no bak written.
    assert sidecar_path.read_bytes() == raw_before
    assert not bak_path.exists()


def test_migrate_legacy_sidecar_aborts_after_rewrite_failure(tmp_path, monkeypatch):
    pdf_path = _make_pdf(tmp_path)
    raw_before = _write_legacy_pdf_sidecar(pdf_path)
    sidecar_path = sidecar_path_for(pdf_path)
    bak_path = sidecar_path.parent / f"{sidecar_path.name}.bak"

    real_replace = Path.replace

    def fail_on_sidecar_rewrite(self: Path, target: Path) -> Path:
        if Path(target) == sidecar_path:
            raise OSError("simulated rewrite failure")
        return real_replace(self, target)

    monkeypatch.setattr(Path, "replace", fail_on_sidecar_rewrite)

    with pytest.raises(SidecarMigrationError) as excinfo:
        SyntheticDocumentFactory().open_pdf(pdf_path)

    assert excinfo.value.block_type == PDF_BLOCK_TYPE
    # `.bak` exists with the original content, sidecar is unchanged →
    # the user can recover by renaming `.bak` back.
    assert bak_path.read_bytes() == raw_before
    assert sidecar_path.read_bytes() == raw_before
    assert not [path for path in sidecar_path.parent.iterdir() if ".tmp-" in path.name]


@pytest.mark.parametrize(
    "env_value",
    ["0", "false", "False", "no", "off", "   0   ", "OfF"],
)
def test_open_pdf_with_disabled_migrate_env_opens_legacy_read_only(
    tmp_path,
    monkeypatch,
    env_value,
):
    monkeypatch.setenv("DOXMIND_SIDECAR_MIGRATE", env_value)
    pdf_path = _make_pdf(tmp_path)
    raw_before = _write_legacy_pdf_sidecar(pdf_path)
    sidecar_path = sidecar_path_for(pdf_path)
    bak_path = sidecar_path.parent / f"{sidecar_path.name}.bak"

    factory = SyntheticDocumentFactory()
    document = factory.open_pdf(pdf_path)

    assert document.read_only is True
    assert document.block_type == PDF_BLOCK_TYPE
    slot = document.snapshot.extras["blocks"][document.block_id]
    assert slot["editor"] == {"version": 1, "edits": {"1:0": {"text": "x"}}}
    assert slot["parsedCache"] == {"sourceHash": "abc", "parsed": {"pages": []}}

    # Disk state is untouched.
    assert sidecar_path.read_bytes() == raw_before
    assert not bak_path.exists()

    # Subsequent writes are rejected.
    new_extras = {
        "blocks": {
            document.block_id: {
                "editor": {"version": 1, "edits": {"2:0": {"text": "y"}}},
            }
        }
    }
    with pytest.raises(ReadOnlyDocumentError):
        factory.write_full(document, replace(document.snapshot, extras=new_extras))

    # Confirm the sidecar still hasn't moved.
    assert sidecar_path.read_bytes() == raw_before


@pytest.mark.parametrize(
    "env_value",
    ["1", "true", "yes", "on", "TrUe"],
)
def test_open_pdf_with_enabled_migrate_env_migrates_legacy_sidecar(
    tmp_path,
    monkeypatch,
    env_value,
):
    monkeypatch.setenv("DOXMIND_SIDECAR_MIGRATE", env_value)
    pdf_path = _make_pdf(tmp_path)
    raw_before = _write_legacy_pdf_sidecar(pdf_path)
    sidecar_path = sidecar_path_for(pdf_path)
    bak_path = sidecar_path.parent / f"{sidecar_path.name}.bak"

    document = SyntheticDocumentFactory().open_pdf(pdf_path)

    assert document.read_only is False
    assert bak_path.read_bytes() == raw_before
    on_disk = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert "pdf_editor" not in on_disk
    assert "pdf_parsed_cache" not in on_disk
    assert document.block_id in on_disk["extras"]["blocks"]


@pytest.mark.parametrize("env_value", ["maybe", "", "２"])
def test_open_pdf_with_invalid_migrate_env_raises_value_error(
    tmp_path,
    monkeypatch,
    env_value,
):
    monkeypatch.setenv("DOXMIND_SIDECAR_MIGRATE", env_value)
    pdf_path = _make_pdf(tmp_path)
    raw_before = _write_legacy_pdf_sidecar(pdf_path)
    sidecar_path = sidecar_path_for(pdf_path)
    bak_path = sidecar_path.parent / f"{sidecar_path.name}.bak"

    with pytest.raises(ValueError, match="DOXMIND_SIDECAR_MIGRATE has invalid value"):
        SyntheticDocumentFactory().open_pdf(pdf_path)

    assert sidecar_path.read_bytes() == raw_before
    assert not bak_path.exists()


def test_legacy_error_hierarchy_lets_callers_catch_the_base_class():
    # SidecarMigrationError is-a LegacySidecarError so legacy callers that
    # caught the base class continue to work after slice 4.
    assert issubclass(SidecarMigrationError, LegacySidecarError)


def test_open_pdf_against_corrupt_sidecar_raises_and_writes_forensic_copy(tmp_path):
    pdf_path = _make_pdf(tmp_path)
    sidecar_path = sidecar_path_for(pdf_path)
    corrupt_bytes = b'{"version": 1'
    sidecar_path.write_bytes(corrupt_bytes)

    with pytest.raises(CorruptSidecarError) as excinfo:
        SyntheticDocumentFactory().open_pdf(pdf_path)

    assert excinfo.value.sidecar_path == sidecar_path
    assert excinfo.value.forensic_path is not None
    assert sidecar_path.read_bytes() == corrupt_bytes
    assert excinfo.value.forensic_path.exists()
    assert excinfo.value.forensic_path.read_bytes() == corrupt_bytes
    assert pdf_path.read_bytes().startswith(b"%PDF-")


def test_open_pdf_recovers_after_good_sidecar_is_restored(tmp_path):
    pdf_path = _make_pdf(tmp_path)
    factory = SyntheticDocumentFactory()
    original = factory.open_pdf(pdf_path)
    sidecar_path = sidecar_path_for(pdf_path)
    good_sidecar = sidecar_path.read_bytes()
    corrupt_bytes = b"\xff\xfe"
    sidecar_path.write_bytes(corrupt_bytes)

    with pytest.raises(CorruptSidecarError) as excinfo:
        factory.open_pdf(pdf_path)

    assert excinfo.value.forensic_path is not None
    assert excinfo.value.forensic_path.read_bytes() == corrupt_bytes

    atomic_write(sidecar_path, good_sidecar)

    recovered = factory.open_pdf(pdf_path)

    assert recovered.block_id == original.block_id
    assert recovered.snapshot.extras == original.snapshot.extras
