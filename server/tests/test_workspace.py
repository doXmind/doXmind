"""Tests for the local Markdown workspace HTTP fallback."""

import json
import os
import shutil
from pathlib import Path

import pytest

from api import workspace as workspace_module
from services.legacy_sidecar import SIDECAR_VERSION, hash_markdown, sidecar_path_for

PDF_BLOCK_TYPE = "pdf-block"
EXCEL_BLOCK_TYPE = "excel-block"


def _hard_delete(path: Path) -> None:
    """Test shim for `_move_to_os_trash` — hard-deletes instead of moving to OS Trash so the
    developer's real Trash isn't polluted with fixture files. The contract being verified
    is "the file leaves the workspace"; OS-Trash arrival is exercised manually + in CI smoke."""
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


@pytest.fixture
def patched_os_trash(monkeypatch):
    monkeypatch.setattr(workspace_module, "_move_to_os_trash", _hard_delete)
    yield


def invoke(sync_client, command: str, payload: dict | None = None):
    response = sync_client.post(
        "/api/workspace/invoke",
        json={"command": command, "payload": payload or {}},
    )
    assert response.status_code == 200, response.text
    return response.json()


def error_response(sync_client, command: str, payload: dict | None = None):
    return sync_client.post(
        "/api/workspace/invoke",
        json={"command": command, "payload": payload or {}},
    )


def test_page_relocation_http_boundary_returns_409_for_a_stale_repair_plan(sync_client, tmp_path):
    target = tmp_path / "Target.md"
    daily = tmp_path / "Daily.md"
    target.write_text("---\nid: target-1\n---\n\nTarget\n", encoding="utf-8")
    daily.write_text("---\nid: daily-1\n---\n\n[[Target]]\n", encoding="utf-8")
    target_read = invoke(sync_client, "doc_read", {"root": str(tmp_path), "path": "Target.md"})
    daily_read = invoke(sync_client, "doc_read", {"root": str(tmp_path), "path": "Daily.md"})
    daily.write_text(daily.read_text(encoding="utf-8") + "external\n", encoding="utf-8")

    response = error_response(
        sync_client,
        "workspace_relocate_page",
        {
            "root": str(tmp_path),
            "oldPath": "Target.md",
            "newPath": "Archive/Roadmap.md",
            "expectedRevision": target_read["revision"],
            "checks": [
                {"path": "Daily.md", "expectedRevision": daily_read["revision"]},
                {"path": "Target.md", "expectedRevision": target_read["revision"]},
            ],
            "writes": [
                {
                    "path": "Daily.md",
                    "expectedRevision": daily_read["revision"],
                    "markdown": "[[Archive/Roadmap]]\n",
                }
            ],
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "page_revision_conflict"
    assert target.exists()
    assert not (tmp_path / "Archive").exists()


def test_legacy_structural_http_commands_are_attachment_only(sync_client, tmp_path):
    (tmp_path / "Page.md").write_text("# Page\n", encoding="utf-8")
    (tmp_path / "Notes").mkdir()
    (tmp_path / "Spec.pdf").write_bytes(b"%PDF-1.4\n")

    page_response = error_response(
        sync_client,
        "doc_rename",
        {
            "root": str(tmp_path),
            "oldPath": "Page.md",
            "newPath": "Renamed.md",
        },
    )
    assert page_response.status_code == 400
    assert "workspace_relocate_page" in page_response.json()["detail"]

    folder_response = error_response(
        sync_client,
        "doc_move",
        {
            "root": str(tmp_path),
            "oldPath": "Notes",
            "newPath": "Archive/Notes",
        },
    )
    assert folder_response.status_code == 400
    assert "workspace_relocate_folder" in folder_response.json()["detail"]

    removed_response = error_response(
        sync_client,
        "workspace_rename_folder",
        {
            "root": str(tmp_path),
            "oldPath": "Notes",
            "newPath": "Archive",
        },
    )
    assert removed_response.status_code == 404

    renamed = invoke(
        sync_client,
        "doc_rename",
        {
            "root": str(tmp_path),
            "oldPath": "Spec.pdf",
            "newPath": "Renamed.pdf",
        },
    )
    assert renamed["path"] == "Renamed.pdf"
    assert (tmp_path / "Renamed.pdf").read_bytes() == b"%PDF-1.4\n"


def _make_pdf(tmp_path: Path, name: str = "Application.pdf") -> Path:
    path = tmp_path / name
    path.write_bytes(b"%PDF-1.4\n% doxmind test pdf\n")
    return path


def _make_excel(tmp_path: Path, name: str = "Budget.xlsx") -> Path:
    path = tmp_path / name
    path.write_bytes(b"PK\x03\x04 fake xlsx body")
    return path


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
        "excel_editor": {
            "version": 1,
            "cells": {"Sheet1!0,0": {"value": "changed"}},
        },
        "excel_parsed_cache": {"sourceHash": "abc", "parsed": {"sheets": []}},
    }


def _write_legacy_pdf_sidecar(pdf_path: Path) -> Path:
    sidecar_path = sidecar_path_for(pdf_path)
    sidecar_path.write_text(json.dumps(_legacy_pdf_payload(pdf_path)), encoding="utf-8")
    return sidecar_path


def _write_legacy_excel_sidecar(xlsx_path: Path) -> Path:
    sidecar_path = sidecar_path_for(xlsx_path)
    sidecar_path.write_text(json.dumps(_legacy_excel_payload(xlsx_path)), encoding="utf-8")
    return sidecar_path


def _write_synthetic_sidecar(
    path: Path,
    *,
    block_type: str,
    block_id: str,
    extras: dict,
    html: str | None = None,
) -> Path:
    sidecar_path = sidecar_path_for(path)
    sidecar = {
        "version": SIDECAR_VERSION,
        "id": f"doc-{block_id}",
        "html": html
        if html is not None
        else f'<!-- {block_type} id="{block_id}" src="{path.name}" -->',
        "markdown_hash": "browser-dev-test",
        "updated_at": "2026-01-01T00:00:00Z",
        "extras": extras,
    }
    sidecar_path.write_text(json.dumps(sidecar), encoding="utf-8")
    return sidecar_path


def _workspace_snapshot(root: Path) -> dict[str, tuple[str, bytes | None, int]]:
    return {
        str(path.relative_to(root)): (
            "directory" if path.is_dir() else "file",
            None if path.is_dir() else path.read_bytes(),
            path.stat().st_mtime_ns,
        )
        for path in sorted(root.rglob("*"))
    }


def test_inspect_attachment_finds_legacy_pdf_edits_without_writing(sync_client, tmp_path):
    pdf_path = _make_pdf(tmp_path, "Spec.pdf")
    sidecar_path = _write_legacy_pdf_sidecar(pdf_path)
    original_sidecar = sidecar_path.read_bytes()
    original_mtime = sidecar_path.stat().st_mtime_ns

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert inspection == {
        "documentType": "pdf",
        "recoveryStatus": "available",
        "sidecarStatus": "legacy",
        "sidecarPath": sidecar_path.name,
    }
    assert sidecar_path.read_bytes() == original_sidecar
    assert sidecar_path.stat().st_mtime_ns == original_mtime
    assert not sidecar_path.with_name(f"{sidecar_path.name}.bak").exists()
    assert not sidecar_path.with_name(f"{sidecar_path.name}.lock").exists()
    assert list(tmp_path.glob(f"{sidecar_path.name}.corrupt-*")) == []


def test_inspect_attachment_without_sidecar_stays_untouched(sync_client, tmp_path):
    pdf_path = _make_pdf(tmp_path, "Plain.pdf")
    sidecar_path = sidecar_path_for(pdf_path)

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert inspection == {
        "documentType": "pdf",
        "recoveryStatus": "none",
        "sidecarStatus": "missing",
        "sidecarPath": sidecar_path.name,
    }
    assert not sidecar_path.exists()


@pytest.mark.skipif(os.name == "nt", reason="symbolic-link contract is exercised on Unix")
def test_attachment_recovery_never_follows_a_sidecar_symlink(sync_client, tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    pdf_path = _make_pdf(root, "Linked.pdf")
    external_sidecar = tmp_path / "outside.json"
    external_bytes = json.dumps(_legacy_pdf_payload(pdf_path)).encode()
    external_sidecar.write_bytes(external_bytes)
    sidecar_path = sidecar_path_for(pdf_path)
    sidecar_path.symlink_to(external_sidecar)

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(root), "path": pdf_path.name},
    )
    assert inspection["recoveryStatus"] == "unknown"
    assert inspection["sidecarStatus"] == "unreadable"

    response = error_response(
        sync_client,
        "workspace_read_attachment_recovery",
        {"root": str(root), "path": pdf_path.name},
    )
    assert response.status_code == 400
    assert external_sidecar.read_bytes() == external_bytes


def test_inspect_attachment_reports_unknown_when_only_backup_sidecar_exists(sync_client, tmp_path):
    pdf_path = _make_pdf(tmp_path, "Backup-only.pdf")
    sidecar_path = sidecar_path_for(pdf_path)
    backup_path = sidecar_path.with_name(f"{sidecar_path.name}.bak")
    backup_path.write_bytes(b"opaque legacy backup")
    before = _workspace_snapshot(tmp_path)

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert inspection == {
        "documentType": "pdf",
        "recoveryStatus": "unknown",
        "sidecarStatus": "missing",
        "sidecarPath": sidecar_path.name,
    }
    assert _workspace_snapshot(tmp_path) == before


@pytest.mark.parametrize("sidecar_status", ["legacy", "current"])
def test_inspect_attachment_reports_backup_when_main_sidecar_has_no_edits(
    sync_client, tmp_path, sidecar_status
):
    pdf_path = _make_pdf(tmp_path, f"Backup-{sidecar_status}.pdf")
    sidecar_path = sidecar_path_for(pdf_path)
    if sidecar_status == "legacy":
        payload = _legacy_pdf_payload(pdf_path)
        payload["pdf_editor"] = {"version": 1, "edits": {}}
        sidecar_path.write_text(json.dumps(payload), encoding="utf-8")
    else:
        block_id = "pdf-backup"
        _write_synthetic_sidecar(
            pdf_path,
            block_type=PDF_BLOCK_TYPE,
            block_id=block_id,
            extras={"blocks": {block_id: {}}},
        )
    backup_path = sidecar_path.with_name(f"{sidecar_path.name}.bak")
    backup_path.write_bytes(b"opaque legacy backup")
    before = _workspace_snapshot(tmp_path)

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert inspection["recoveryStatus"] == "unknown"
    assert inspection["sidecarStatus"] == sidecar_status
    assert _workspace_snapshot(tmp_path) == before


def test_inspect_attachment_finds_current_pdf_edits_without_writing(sync_client, tmp_path):
    pdf_path = _make_pdf(tmp_path, "Marked.pdf")
    block_id = "pdf-marked"
    sidecar_path = _write_synthetic_sidecar(
        pdf_path,
        block_type=PDF_BLOCK_TYPE,
        block_id=block_id,
        extras={
            "blocks": {
                block_id: {
                    "editor": {
                        "version": 2,
                        "paragraphEdits": {"p0-b1": {"text": "Changed"}},
                    }
                }
            }
        },
    )
    original_sidecar = sidecar_path.read_bytes()

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert inspection["recoveryStatus"] == "available"
    assert inspection["sidecarStatus"] == "current"
    assert sidecar_path.read_bytes() == original_sidecar


def test_inspect_attachment_proves_valid_current_sidecar_has_no_editor(sync_client, tmp_path):
    excel_path = _make_excel(tmp_path, "Unedited.xlsx")
    block_id = "excel-unedited"
    sidecar_path = _write_synthetic_sidecar(
        excel_path,
        block_type=EXCEL_BLOCK_TYPE,
        block_id=block_id,
        extras={"blocks": {block_id: {}}},
    )
    before = _workspace_snapshot(tmp_path)

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": excel_path.name},
    )

    assert inspection == {
        "documentType": "excel",
        "recoveryStatus": "none",
        "sidecarStatus": "current",
        "sidecarPath": sidecar_path.name,
    }
    assert _workspace_snapshot(tmp_path) == before


def test_inspect_attachment_finds_legacy_excel_edits_without_writing(sync_client, tmp_path):
    excel_path = _make_excel(tmp_path, "Budget.xlsx")
    sidecar_path = _write_legacy_excel_sidecar(excel_path)
    original_sidecar = sidecar_path.read_bytes()

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": excel_path.name},
    )

    assert inspection == {
        "documentType": "excel",
        "recoveryStatus": "available",
        "sidecarStatus": "legacy",
        "sidecarPath": sidecar_path.name,
    }
    assert sidecar_path.read_bytes() == original_sidecar
    assert not sidecar_path.with_name(f"{sidecar_path.name}.bak").exists()


def test_inspect_attachment_reports_unknown_excel_schema_without_writing(sync_client, tmp_path):
    excel_path = _make_excel(tmp_path, "Unknown.xlsx")
    sidecar_path = sidecar_path_for(excel_path)
    sidecar_path.write_text(
        json.dumps(
            {
                "version": 1,
                "excel_editor": {
                    "version": 1,
                    "mysteryEdits": {"Sheet1!0,0": {"value": "changed"}},
                },
            }
        ),
        encoding="utf-8",
    )
    original_sidecar = sidecar_path.read_bytes()
    original_mtime = sidecar_path.stat().st_mtime_ns

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": excel_path.name},
    )

    assert inspection == {
        "documentType": "excel",
        "recoveryStatus": "unknown",
        "sidecarStatus": "unreadable",
        "sidecarPath": sidecar_path.name,
    }
    assert sidecar_path.read_bytes() == original_sidecar
    assert sidecar_path.stat().st_mtime_ns == original_mtime
    assert not sidecar_path.with_name(f"{sidecar_path.name}.bak").exists()
    assert not sidecar_path.with_name(f"{sidecar_path.name}.lock").exists()
    assert list(tmp_path.glob(f"{sidecar_path.name}.corrupt-*")) == []


@pytest.mark.parametrize("field", ["freeTextBoxes", "highlightBoxes"])
def test_inspect_attachment_reports_unknown_pdf_fields_without_writing(
    sync_client, tmp_path, field
):
    pdf_path = _make_pdf(tmp_path, "Unknown.pdf")
    sidecar_path = sidecar_path_for(pdf_path)
    sidecar_path.write_text(
        json.dumps(
            {
                "version": 1,
                "pdf_editor": {
                    "version": 1,
                    field: [{"id": "unrecognized-edit"}],
                },
            }
        ),
        encoding="utf-8",
    )
    before = _workspace_snapshot(tmp_path)

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert inspection == {
        "documentType": "pdf",
        "recoveryStatus": "unknown",
        "sidecarStatus": "unreadable",
        "sidecarPath": sidecar_path.name,
    }
    assert _workspace_snapshot(tmp_path) == before


@pytest.mark.parametrize(
    ("filename", "editor_key", "editor"),
    [
        ("Invalid.pdf", "pdf_editor", "not-an-object"),
        ("Invalid.xlsx", "excel_editor", ["not-an-object"]),
    ],
)
def test_inspect_attachment_reports_non_object_editor_as_unknown_without_writing(
    sync_client, tmp_path, filename, editor_key, editor
):
    attachment_path = (
        _make_pdf(tmp_path, filename)
        if filename.endswith(".pdf")
        else _make_excel(tmp_path, filename)
    )
    sidecar_path = sidecar_path_for(attachment_path)
    sidecar_path.write_text(
        json.dumps({"version": 1, editor_key: editor}),
        encoding="utf-8",
    )
    before = _workspace_snapshot(tmp_path)

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": attachment_path.name},
    )

    assert inspection["recoveryStatus"] == "unknown"
    assert inspection["sidecarStatus"] == "unreadable"
    assert _workspace_snapshot(tmp_path) == before


def test_inspect_attachment_reports_legacy_and_current_editors_as_unknown(sync_client, tmp_path):
    pdf_path = _make_pdf(tmp_path, "Mixed.pdf")
    block_id = "pdf-mixed"
    sidecar_path = sidecar_path_for(pdf_path)
    payload = _legacy_pdf_payload(pdf_path)
    payload.update(
        {
            "html": f'<!-- pdf-block id="{block_id}" src="{pdf_path.name}" -->',
            "extras": {
                "blocks": {
                    block_id: {
                        "editor": {
                            "version": 2,
                            "paragraphEdits": {"p0-b1": {"text": "current"}},
                        }
                    }
                }
            },
        }
    )
    sidecar_path.write_text(json.dumps(payload), encoding="utf-8")
    before = _workspace_snapshot(tmp_path)

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert inspection["recoveryStatus"] == "unknown"
    assert inspection["sidecarStatus"] == "unreadable"
    assert _workspace_snapshot(tmp_path) == before


def test_inspect_attachment_rejects_unsupported_current_sidecar_version(sync_client, tmp_path):
    pdf_path = _make_pdf(tmp_path, "Future.pdf")
    block_id = "pdf-future"
    sidecar_path = _write_synthetic_sidecar(
        pdf_path,
        block_type=PDF_BLOCK_TYPE,
        block_id=block_id,
        extras={"blocks": {block_id: {"editor": {"version": 1, "edits": {"1:0": {"text": "x"}}}}}},
    )
    payload = json.loads(sidecar_path.read_text(encoding="utf-8"))
    payload["version"] = 3
    sidecar_path.write_text(json.dumps(payload), encoding="utf-8")
    before = _workspace_snapshot(tmp_path)

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert inspection["recoveryStatus"] == "unknown"
    assert inspection["sidecarStatus"] == "unreadable"
    assert _workspace_snapshot(tmp_path) == before


@pytest.mark.parametrize(
    "extras",
    [None, [], {}, {"blocks": []}, {"blocks": {"pdf-invalid": []}}],
)
def test_inspect_attachment_rejects_malformed_current_extras_without_writing(
    sync_client, tmp_path, extras
):
    pdf_path = _make_pdf(tmp_path, "Malformed.pdf")
    block_id = "pdf-invalid"
    sidecar_path = sidecar_path_for(pdf_path)
    sidecar_path.write_text(
        json.dumps(
            {
                "version": 2,
                "html": f'<!-- pdf-block id="{block_id}" src="{pdf_path.name}" -->',
                "extras": extras,
            }
        ),
        encoding="utf-8",
    )
    before = _workspace_snapshot(tmp_path)

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert inspection["recoveryStatus"] == "unknown"
    assert inspection["sidecarStatus"] == "unreadable"
    assert _workspace_snapshot(tmp_path) == before


@pytest.mark.parametrize(
    ("html", "blocks"),
    [
        ("<p>No attachment placeholder</p>", {"pdf-one": {}}),
        (
            '<!-- pdf-block id="pdf-one" src="Correlation.pdf" -->',
            {"pdf-other": {"editor": {"version": 1, "edits": {}}}},
        ),
        (
            '<!-- pdf-block id="pdf-one" src="Correlation.pdf" -->\n'
            '<!-- pdf-block id="pdf-two" src="Correlation.pdf" -->',
            {"pdf-one": {}, "pdf-two": {}},
        ),
    ],
)
def test_inspect_attachment_rejects_uncorrelated_current_placeholder_without_writing(
    sync_client, tmp_path, html, blocks
):
    pdf_path = _make_pdf(tmp_path, "Correlation.pdf")
    sidecar_path = sidecar_path_for(pdf_path)
    sidecar_path.write_text(
        json.dumps(
            {
                "version": 2,
                "html": html,
                "extras": {"blocks": blocks},
            }
        ),
        encoding="utf-8",
    )
    before = _workspace_snapshot(tmp_path)

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert inspection["recoveryStatus"] == "unknown"
    assert inspection["sidecarStatus"] == "unreadable"
    assert _workspace_snapshot(tmp_path) == before


def test_inspect_attachment_reports_corrupt_sidecar_without_forensic_write(sync_client, tmp_path):
    pdf_path = _make_pdf(tmp_path, "Broken.pdf")
    sidecar_path = sidecar_path_for(pdf_path)
    corrupt_bytes = b"{not-json"
    sidecar_path.write_bytes(corrupt_bytes)

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert inspection == {
        "documentType": "pdf",
        "recoveryStatus": "unknown",
        "sidecarStatus": "unreadable",
        "sidecarPath": sidecar_path.name,
    }
    assert sidecar_path.read_bytes() == corrupt_bytes
    assert list(tmp_path.glob(f"{sidecar_path.name}.corrupt-*")) == []


def test_inspect_html_attachment_never_requires_recovery(sync_client, tmp_path):
    html_path = tmp_path / "reference.html"
    html_path.write_text("<h1>Reference</h1>", encoding="utf-8")

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": html_path.name},
    )

    assert inspection == {
        "documentType": "html",
        "recoveryStatus": "none",
        "sidecarStatus": "missing",
        "sidecarPath": sidecar_path_for(html_path).name,
    }
    assert not sidecar_path_for(html_path).exists()


def test_inspect_attachment_reports_ambiguous_editor_slots_as_unknown(sync_client, tmp_path):
    pdf_path = _make_pdf(tmp_path, "Ambiguous.pdf")
    sidecar_path = _write_synthetic_sidecar(
        pdf_path,
        block_type=PDF_BLOCK_TYPE,
        block_id="pdf-a",
        html=(
            '<!-- pdf-block id="pdf-a" src="Ambiguous.pdf" -->\n'
            '<!-- pdf-block id="pdf-b" src="Ambiguous.pdf" -->'
        ),
        extras={
            "blocks": {
                "pdf-a": {"editor": {"version": 1, "edits": {}}},
                "pdf-b": {"editor": {"version": 1, "edits": {"1:0": {"text": "x"}}}},
            }
        },
    )
    original_sidecar = sidecar_path.read_bytes()

    inspection = invoke(
        sync_client,
        "workspace_inspect_attachment",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert inspection["recoveryStatus"] == "unknown"
    assert inspection["sidecarStatus"] == "unreadable"
    assert sidecar_path.read_bytes() == original_sidecar


def test_workspace_create_read_and_scan(sync_client, tmp_path):
    root = str(tmp_path)
    created = invoke(
        sync_client,
        "doc_create",
        {
            "root": root,
            "payload": {
                "path": "Notes/Plan.md",
                "html": "<p>Hello <strong>world</strong></p>",
                "markdown": "Hello **world**",
                "meta": {"id": "doc-1", "title": "Plan"},
                "extras": {"databases": {}},
            },
        },
    )

    assert created["path"] == "Notes/Plan.md"
    page_path = tmp_path / "Notes" / "Plan.md"
    assert page_path.read_text(encoding="utf-8") == (
        '---\nid: doc-1\ntitle: "Plan"\n---\n\nHello **world**'
    )
    assert not sidecar_path_for(page_path).exists()

    scan = invoke(sync_client, "workspace_scan", {"root": root})
    assert scan["documents"][0]["id"] == "doc-1"
    assert scan["documents"][0]["title"] == "Plan"
    assert json.loads(workspace_module.workspace_index_path(tmp_path).read_text())["ids"] == {
        "doc-1": "Notes/Plan.md"
    }
    assert not (tmp_path / ".doxmind").exists()

    read = invoke(
        sync_client,
        "doc_read",
        {"root": str(tmp_path), "path": "Notes/Plan.md"},
    )
    assert read["markdown"] == "Hello **world**"
    assert read["outline"] == []
    assert set(read) == {"markdown", "meta", "outline", "revision"}


def test_portable_page_identity_preserves_bom_crlf_and_yaml_comments(sync_client, tmp_path):
    page = tmp_path / "Portable.md"
    original = (
        "\ufeff---\r\n"
        "id: page-1 # portable id\r\n"
        "title: Demo # visible title\r\n"
        "custom: [keep, exact]\r\n"
        "---\r\n\r\n"
        "# Body\r\n"
    ).encode()
    page.write_bytes(original)

    scan = invoke(sync_client, "workspace_scan", {"root": str(tmp_path)})
    assert scan["documents"][0]["id"] == "page-1"
    assert scan["documents"][0]["idSource"] == "frontmatter"
    assert scan["documents"][0]["title"] == "Demo"

    read = invoke(sync_client, "doc_read", {"root": str(tmp_path), "path": page.name})
    assert read["meta"]["id"] == "page-1"
    assert read["meta"]["title"] == "Demo"
    assert read["markdown"] == "# Body\r\n"
    invoke(
        sync_client,
        "doc_write_workspace",
        {
            "root": str(tmp_path),
            "path": page.name,
            "payload": {
                "markdown": "# Saved\r\n",
                "meta": {"favorite": True},
                "expectedRevision": read["revision"],
            },
        },
    )

    saved = page.read_bytes()
    assert saved.startswith(b"\xef\xbb\xbf")
    assert b"id: page-1 # portable id\r\n" in saved
    assert b"title: Demo # visible title\r\n" in saved
    assert b"custom: [keep, exact]\r\n" in saved
    assert saved.endswith(b"favorite: true\r\n---\r\n\r\n# Saved\r\n")


def test_duplicate_authored_page_ids_fall_back_to_distinct_path_identities(sync_client, tmp_path):
    for name in ("A.md", "B.md"):
        (tmp_path / name).write_text(
            f"---\nid: copied-page\n---\n\nneedle {name}\n", encoding="utf-8"
        )

    scan = invoke(sync_client, "workspace_scan", {"root": str(tmp_path)})
    assert [document["idSource"] for document in scan["documents"]] == ["path", "path"]
    assert len({document["id"] for document in scan["documents"]}) == 2
    assert all(document["id"].startswith("path:") for document in scan["documents"])
    index = json.loads(workspace_module.workspace_index_path(tmp_path).read_text())
    assert index["ids"] == {}

    search = invoke(
        sync_client,
        "workspace_markdown_search",
        {"root": str(tmp_path), "query": "needle"},
    )
    assert {result["path"]: result["id"] for result in search} == {
        document["path"]: document["id"] for document in scan["documents"]
    }


def test_external_markdown_edit_is_immediately_authoritative(sync_client, tmp_path):
    root = str(tmp_path)
    invoke(
        sync_client,
        "doc_create",
        {
            "root": root,
            "payload": {
                "path": "Doc.md",
                "html": "<p>old</p>",
                "markdown": "old",
                "meta": {"id": "doc-1", "title": "Doc"},
                "extras": {"databases": {"d1": {"rows": []}}},
            },
        },
    )
    sidecar_path = sidecar_path_for(tmp_path / "Doc.md")
    assert not sidecar_path.exists()
    (tmp_path / "Doc.md").write_text(
        "---\nid: doc-1\ntitle: Doc\n---\n\n# External\n", encoding="utf-8"
    )

    read = invoke(sync_client, "doc_read", {"root": str(tmp_path), "path": "Doc.md"})
    assert read["markdown"] == "# External\n"
    assert read["outline"] == [{"id": "external", "depth": 1, "text": "External"}]
    assert set(read) == {"markdown", "meta", "outline", "revision"}
    assert not sidecar_path.exists()


def test_doc_read_returns_unsafe_html_as_uninterpreted_markdown_source(sync_client, tmp_path):
    doc = tmp_path / "Unsafe.md"
    doc.write_text(
        "\n".join(
            [
                "# Unsafe",
                "",
                '<script>alert("x")</script>',
                '<img src="x" onerror="alert(1)" alt="unsafe">',
                "[bad](javascript:alert(1))",
                "[good](https://example.com)",
            ]
        ),
        encoding="utf-8",
    )

    read = invoke(sync_client, "doc_read", {"root": str(tmp_path), "path": doc.name})

    assert '<script>alert("x")</script>' in read["markdown"]
    assert '<img src="x" onerror="alert(1)" alt="unsafe">' in read["markdown"]
    assert "[bad](javascript:alert(1))" in read["markdown"]
    assert set(read) == {"markdown", "meta", "outline", "revision"}


def test_markdown_read_preserves_distinct_list_types(sync_client, tmp_path):
    doc = tmp_path / "Lists.md"
    doc.write_text(
        "# Lists\n\n- Bullet\n\n1. Ordered\n\n- [ ] Todo\n- [x] Done\n",
        encoding="utf-8",
    )

    read = invoke(sync_client, "doc_read", {"root": str(tmp_path), "path": doc.name})

    assert read["markdown"] == "# Lists\n\n- Bullet\n\n1. Ordered\n\n- [ ] Todo\n- [x] Done\n"
    assert set(read) == {"markdown", "meta", "outline", "revision"}


def test_workspace_folder_and_search(sync_client, tmp_path):
    root = str(tmp_path)
    invoke(sync_client, "workspace_create_folder", {"root": root, "path": "Folder"})
    assert (tmp_path / "Folder").is_dir()

    invoke(
        sync_client,
        "doc_create",
        {
            "root": root,
            "payload": {
                "path": "Folder/Search.md",
                "html": "<p>needle</p>",
                "markdown": "needle line",
                "meta": {"id": "search-doc"},
            },
        },
    )
    results = invoke(sync_client, "workspace_markdown_search", {"root": root, "query": "needle"})
    assert results[0]["id"] == "search-doc"
    assert results[0]["path"] == "Folder/Search.md"
    assert results[0]["name"] == "Search.md"
    assert results[0]["matches"][0]["preview"] == "needle line"

    invoke(sync_client, "workspace_scan", {"root": root})
    from api.workspace import workspace_index_path

    assert json.loads(workspace_index_path(tmp_path).read_text())["ids"] == {
        "search-doc": "Folder/Search.md"
    }
    assert not (tmp_path / ".doxmind").exists()


def test_workspace_scan_order_is_deterministic_across_calls(sync_client, tmp_path):
    """scan must return the same document order on repeated calls even when
    files live in different subfolders. rglob's filesystem order isn't stable
    on macOS/APFS, and sorting by full path would let parent-folder naming
    shift a file's position; sort key is `name.lower()` to keep the listing
    independent of where each file lives."""
    root = str(tmp_path)
    # Mix of subfolders + names whose path-order and name-order diverge:
    # sorting by full path would put "Alpha/Charlie.md" before "Bravo/Alpha.md"
    # because the parent folder name dominates; sorting by file name puts
    # "Alpha.md" first regardless of parent.
    layout = [
        ("Alpha/Charlie.md", "doc-charlie"),
        ("Bravo/Alpha.md", "doc-alpha"),
        ("Charlie/Bravo.md", "doc-bravo"),
        ("Delta/echo.md", "doc-echo"),
        ("delta.md", "doc-delta-root"),
    ]
    for rel_path, doc_id in layout:
        invoke(
            sync_client,
            "doc_create",
            {
                "root": root,
                "payload": {
                    "path": rel_path,
                    "html": "<p>x</p>",
                    "markdown": "x",
                    "meta": {"id": doc_id},
                },
            },
        )

    first = invoke(sync_client, "workspace_scan", {"root": root})
    # The TTL cache would mask determinism issues by returning the same
    # cached dict on the second call; invalidate it so the second scan
    # walks the filesystem again.
    workspace_module._invalidate_scan_cache(root)
    second = invoke(sync_client, "workspace_scan", {"root": root})

    assert json.dumps(first) == json.dumps(second)
    names = [doc["name"] for doc in first["documents"]]
    assert names == sorted(names, key=str.lower)


@pytest.mark.skipif(os.name == "nt", reason="symbolic-link contract is exercised on Unix")
def test_workspace_scan_and_search_skip_symlinks_and_complete_sidecar_family(sync_client, tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "Visible.md").write_text("visible", encoding="utf-8")
    (root / ".Visible.doxmind.bak.md").write_text("secret backup", encoding="utf-8")
    (root / ".Visible.doxmind.lock.markdown").write_text("secret lock", encoding="utf-8")
    external = tmp_path / "Outside.md"
    external.write_text("secret outside", encoding="utf-8")
    (root / "Linked.md").symlink_to(external)

    scan = invoke(sync_client, "workspace_scan", {"root": str(root)})
    assert [document["path"] for document in scan["documents"]] == ["Visible.md"]

    search = invoke(
        sync_client,
        "workspace_markdown_search",
        {"root": str(root), "query": "secret"},
    )
    assert search == []


def test_doc_import_external_copies_md_from_src_path_and_leaves_source_intact(
    sync_client, tmp_path
):
    """Always-copy invariant — the source file in the simulated Downloads
    folder must be byte-identical after the import."""
    root = tmp_path / "workspace"
    root.mkdir()
    downloads = tmp_path / "Downloads"
    downloads.mkdir()
    src = downloads / "Plan.md"
    payload = b"# Plan\n\nbody\n"
    src.write_bytes(payload)
    src_hash_before = src.stat().st_size

    created = invoke(
        sync_client,
        "doc_import_external",
        {
            "root": str(root),
            "srcPath": str(src),
            "destFolder": "",
            "name": "Plan.md",
            "mode": "create",
        },
    )

    assert created["path"] == "Plan.md"
    assert (root / "Plan.md").read_bytes() == payload
    # Source untouched — both presence and bytes.
    assert src.exists()
    assert src.read_bytes() == payload
    assert src.stat().st_size == src_hash_before


def test_doc_import_external_copies_markdown_extension_as_page(sync_client, tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    src = tmp_path / "Knowledge.markdown"
    payload = b"# Knowledge\n\nlinked note\n"
    src.write_bytes(payload)

    created = invoke(
        sync_client,
        "doc_import_external",
        {
            "root": str(root),
            "srcPath": str(src),
            "destFolder": "",
            "name": "Knowledge.markdown",
            "mode": "create",
        },
    )

    assert created["path"] == "Knowledge.markdown"
    assert created["documentType"] == "markdown"
    assert (root / "Knowledge.markdown").read_bytes() == payload
    assert src.read_bytes() == payload


def test_doc_import_external_copies_into_dest_folder(sync_client, tmp_path):
    root = tmp_path / "workspace"
    (root / "Notes").mkdir(parents=True)
    src = tmp_path / "Spec.pdf"
    src.write_bytes(b"%PDF-1.4\nbody\n")

    created = invoke(
        sync_client,
        "doc_import_external",
        {
            "root": str(root),
            "srcPath": str(src),
            "destFolder": "Notes",
            "name": "Spec.pdf",
            "mode": "create",
        },
    )

    assert created["path"] == "Notes/Spec.pdf"
    assert (root / "Notes" / "Spec.pdf").exists()
    assert src.read_bytes() == b"%PDF-1.4\nbody\n"


def test_doc_import_external_accepts_byte_payload_for_browser_dev(sync_client, tmp_path):
    root = tmp_path
    payload = b"PK\x03\x04 dummy xlsx"

    created = invoke(
        sync_client,
        "doc_import_external",
        {
            "root": str(root),
            "bytes": list(payload),
            "destFolder": "",
            "name": "Q3.xlsx",
            "mode": "create",
        },
    )

    assert created["path"] == "Q3.xlsx"
    assert (root / "Q3.xlsx").read_bytes() == payload


def test_doc_import_external_returns_path_identity_for_a_copied_duplicate_id(sync_client, tmp_path):
    root = tmp_path
    duplicate = b"---\nid: copied-id\n---\n\nBody\n"
    (root / "Original.md").write_bytes(duplicate)

    imported = invoke(
        sync_client,
        "doc_import_external",
        {
            "root": str(root),
            "bytes": list(duplicate),
            "destFolder": "",
            "name": "Copy.md",
            "mode": "create",
        },
    )
    scan = invoke(sync_client, "workspace_scan", {"root": str(root)})

    assert imported["idSource"] == "path"
    assert imported["id"].startswith("path:")
    documents = {document["path"]: document for document in scan["documents"]}
    assert documents["Copy.md"]["id"] == imported["id"]
    assert documents["Original.md"]["idSource"] == "path"


def test_doc_import_external_collision_returns_409(sync_client, tmp_path):
    root = tmp_path
    (root / "Plan.md").write_text("existing", encoding="utf-8")
    src = tmp_path / "src" / "Plan.md"
    src.parent.mkdir()
    src.write_text("incoming", encoding="utf-8")

    response = sync_client.post(
        "/api/workspace/invoke",
        json={
            "command": "doc_import_external",
            "payload": {
                "root": str(root),
                "srcPath": str(src),
                "destFolder": "",
                "name": "Plan.md",
                "mode": "create",
            },
        },
    )
    assert response.status_code == 409
    body = response.json()
    assert body["detail"]["code"] == "destination_exists"
    # Source untouched on collision.
    assert src.read_text(encoding="utf-8") == "incoming"
    assert (root / "Plan.md").read_text(encoding="utf-8") == "existing"


def test_doc_import_external_rejects_non_whitelisted_extension(sync_client, tmp_path):
    src = tmp_path / "notes.txt"
    src.write_text("nope", encoding="utf-8")

    response = sync_client.post(
        "/api/workspace/invoke",
        json={
            "command": "doc_import_external",
            "payload": {
                "root": str(tmp_path),
                "srcPath": str(src),
                "destFolder": "",
                "name": "notes.txt",
                "mode": "create",
            },
        },
    )
    assert response.status_code == 400


def test_doc_import_external_rejects_unknown_mode(sync_client, tmp_path):
    src = tmp_path / "Plan.md"
    src.write_text("# Plan\n", encoding="utf-8")

    response = sync_client.post(
        "/api/workspace/invoke",
        json={
            "command": "doc_import_external",
            "payload": {
                "root": str(tmp_path),
                "srcPath": str(src),
                "destFolder": "",
                "name": "Plan.md",
                "mode": "rename-and-pray",
            },
        },
    )
    # Only `create` and `replace` are accepted; anything else surfaces as 400.
    assert response.status_code == 400


def test_doc_import_external_replace_overwrites_user_file_and_leaves_sidecar_intact(
    sync_client, tmp_path
):
    """Sidecar-untouched invariant — `mode: "replace"` rewrites the `.md`/`.pdf`/`.xlsx`
    but the pre-existing `.doxmind` sidecar must be byte-identical afterwards.

    Normal Page open ignores this recovery artifact. It remains byte-identical
    so the explicit legacy-recovery surface can inspect or export it later.
    """
    root = tmp_path / "workspace"
    root.mkdir()
    # Pre-existing destination pair: user file + hidden sidecar.
    dest_md = root / "Plan.md"
    dest_md.write_bytes(b"# Old\n\nold body\n")
    sidecar = root / ".Plan.doxmind"
    sidecar_payload = (
        b'{"version": 1, "id": "fixed-id-123", '
        b'"html": "<p>old html</p>", '
        b'"markdown_hash": "sha256:deadbeef", '
        b'"updated_at": "2026-01-01T00:00:00Z", '
        b'"extras": {"databases": {"x": 1}}}'
    )
    sidecar.write_bytes(sidecar_payload)
    sidecar_mtime_before = sidecar.stat().st_mtime_ns

    # Source file from the user's Downloads.
    downloads = tmp_path / "Downloads"
    downloads.mkdir()
    src = downloads / "Plan.md"
    src_payload = b"# New\n\nfresh body\n"
    src.write_bytes(src_payload)

    created = invoke(
        sync_client,
        "doc_import_external",
        {
            "root": str(root),
            "srcPath": str(src),
            "destFolder": "",
            "name": "Plan.md",
            "mode": "replace",
        },
    )

    assert created["path"] == "Plan.md"
    # User file overwritten with the source bytes.
    assert dest_md.read_bytes() == src_payload
    # Always-copy: source untouched.
    assert src.read_bytes() == src_payload
    # SIDECAR INVARIANT: byte-identical and (best-effort) mtime unchanged.
    # The byte equality is the load-bearing assertion — it's what guarantees
    # the next open hits the Stale-sidecar / Salvage path with the original
    # html/markdown_hash/extras intact.
    assert sidecar.read_bytes() == sidecar_payload
    assert sidecar.stat().st_mtime_ns == sidecar_mtime_before


def test_doc_import_external_replace_via_bytes_leaves_sidecar_intact(sync_client, tmp_path):
    """Replace via the browser-dev `bytes` path; same sidecar invariant."""
    root = tmp_path
    dest = root / "Q3.xlsx"
    dest.write_bytes(b"PK\x03\x04old")
    sidecar = root / ".Q3.doxmind"
    sidecar_payload = b'{"version": 1, "id": "x", "html": ""}'
    sidecar.write_bytes(sidecar_payload)

    new_payload = b"PK\x03\x04new bytes"

    created = invoke(
        sync_client,
        "doc_import_external",
        {
            "root": str(root),
            "bytes": list(new_payload),
            "destFolder": "",
            "name": "Q3.xlsx",
            "mode": "replace",
        },
    )

    assert created["path"] == "Q3.xlsx"
    assert dest.read_bytes() == new_payload
    assert sidecar.read_bytes() == sidecar_payload


def test_doc_import_external_replace_requires_existing_destination(sync_client, tmp_path):
    """Replace presupposes a pre-existing file. If the destination vanished
    between plan and resolve we surface a 400 rather than silently creating —
    that would hide a race with an external delete."""
    src = tmp_path / "Plan.md"
    src.write_text("# Plan\n", encoding="utf-8")

    response = sync_client.post(
        "/api/workspace/invoke",
        json={
            "command": "doc_import_external",
            "payload": {
                "root": str(tmp_path),
                "srcPath": str(src),
                "destFolder": "",
                "name": "Missing.md",
                "mode": "replace",
            },
        },
    )
    assert response.status_code == 400


@pytest.mark.skipif(os.name == "nt", reason="symbolic-link contract is exercised on Unix")
@pytest.mark.parametrize("target_exists,mode", [(False, "create"), (True, "replace")])
def test_doc_import_external_rejects_final_destination_symlinks(
    sync_client, tmp_path, target_exists, mode
):
    root = tmp_path / "workspace"
    root.mkdir()
    outside = tmp_path / "outside.md"
    original = b"outside original"
    if target_exists:
        outside.write_bytes(original)
    destination = root / "Plan.md"
    destination.symlink_to(outside)
    source = tmp_path / "incoming.md"
    source.write_bytes(b"incoming")

    response = error_response(
        sync_client,
        "doc_import_external",
        {
            "root": str(root),
            "srcPath": str(source),
            "destFolder": "",
            "name": destination.name,
            "mode": mode,
        },
    )

    assert response.status_code == 400
    assert destination.is_symlink()
    if target_exists:
        assert outside.read_bytes() == original
    else:
        assert not outside.exists()


def test_doc_delete_pdf_removes_pair_from_workspace(sync_client, tmp_path, patched_os_trash):
    pdf_path = _make_pdf(tmp_path, "Spec.pdf")
    sidecar_path = sidecar_path_for(pdf_path)
    sidecar_path.write_text(json.dumps({"id": "pdf"}), encoding="utf-8")

    result = invoke(
        sync_client,
        "doc_delete",
        {"root": str(tmp_path), "path": "Spec.pdf"},
    )

    assert result == {"path": "Spec.pdf", "sidecarPath": ".Spec.pdf.doxmind"}
    assert not pdf_path.exists()
    assert not sidecar_path.exists()


def test_doc_delete_xlsx_removes_pair_from_workspace(sync_client, tmp_path, patched_os_trash):
    xlsx_path = tmp_path / "Budget.xlsx"
    xlsx_path.write_bytes(b"PK\x03\x04")
    sidecar_path = sidecar_path_for(xlsx_path)
    sidecar_path.write_text(json.dumps({"id": "xlsx"}), encoding="utf-8")

    result = invoke(
        sync_client,
        "doc_delete",
        {"root": str(tmp_path), "path": "Budget.xlsx"},
    )

    assert result == {"path": "Budget.xlsx", "sidecarPath": ".Budget.xlsx.doxmind"}
    assert not xlsx_path.exists()
    assert not sidecar_path.exists()


def test_doc_delete_rejects_unknown_extension(sync_client, tmp_path, patched_os_trash):
    note_path = tmp_path / "notes.txt"
    note_path.write_text("hi", encoding="utf-8")

    response = error_response(
        sync_client,
        "doc_delete",
        {"root": str(tmp_path), "path": "notes.txt"},
    )

    assert response.status_code == 400
    assert "must end in .md" in response.json()["detail"]
    assert note_path.exists()


def test_doc_rename_markdown_fails_closed(sync_client, tmp_path):
    doc = tmp_path / "Untitled-1.md"
    doc.write_text("---\nid: doc-1\ntitle: Untitled-1\n---\n\n# Hi\n", encoding="utf-8")

    response = error_response(
        sync_client,
        "doc_rename",
        {"root": str(tmp_path), "oldPath": "Untitled-1.md", "newPath": "Report.md"},
    )

    assert response.status_code == 400
    assert "workspace_relocate_page" in response.json()["detail"]
    assert doc.exists()
    assert not (tmp_path / "Report.md").exists()


def test_doc_rename_pdf_keeps_extension_and_moves_sidecar(sync_client, tmp_path):
    pdf_path = _make_pdf(tmp_path, "Spec.pdf")
    sidecar_path = sidecar_path_for(pdf_path)
    sidecar_path.write_text(json.dumps({"id": "pdf"}), encoding="utf-8")

    result = invoke(
        sync_client,
        "doc_rename",
        {"root": str(tmp_path), "oldPath": "Spec.pdf", "newPath": "Report.pdf"},
    )

    assert result["path"] == "Report.pdf"
    assert result["documentType"] == "pdf"
    assert not pdf_path.exists()
    assert (tmp_path / "Report.pdf").exists()
    assert not sidecar_path.exists()
    assert sidecar_path_for(tmp_path / "Report.pdf").exists()


def test_doc_rename_xlsx_keeps_extension(sync_client, tmp_path):
    xlsx_path = _make_excel(tmp_path, "Budget.xlsx")

    result = invoke(
        sync_client,
        "doc_rename",
        {"root": str(tmp_path), "oldPath": "Budget.xlsx", "newPath": "Q1.xlsx"},
    )

    assert result["path"] == "Q1.xlsx"
    assert result["documentType"] == "excel"
    assert (tmp_path / "Q1.xlsx").exists()
    assert not xlsx_path.exists()


def test_doc_rename_rejects_type_change(sync_client, tmp_path):
    pdf_path = _make_pdf(tmp_path, "Spec.pdf")

    response = error_response(
        sync_client,
        "doc_rename",
        {"root": str(tmp_path), "oldPath": "Spec.pdf", "newPath": "Spec.md"},
    )

    assert response.status_code == 400
    assert "cannot change document type" in response.json()["detail"]
    assert pdf_path.exists()


def test_doc_read_omits_legacy_sidecar_fields_for_plain_markdown(sync_client, tmp_path):
    doc = tmp_path / "Plain.md"
    doc.write_text("# Plain\n\nNo placeholders here.\n", encoding="utf-8")

    read = invoke(sync_client, "doc_read", {"root": str(tmp_path), "path": doc.name})

    assert {"extras", "source", "sourceState", "correlation"}.isdisjoint(read)


def test_doc_read_treats_attachment_placeholder_as_markdown_source(sync_client, tmp_path):
    body = '---\nid: doc-1\ntitle: Notes\n---\n\n<!-- pdf-block id="abc" src="report.pdf" -->\n'
    doc = tmp_path / "Notes.md"
    doc.write_text(body, encoding="utf-8")

    read = invoke(sync_client, "doc_read", {"root": str(tmp_path), "path": doc.name})

    assert "correlation" not in read
    assert '<!-- pdf-block id="abc" src="report.pdf" -->' in read["markdown"]


def test_doc_read_ignores_legacy_page_sidecar_extras_without_writing(sync_client, tmp_path):
    body = "---\nid: doc-1\ntitle: Notes\n---\n\nNo placeholders.\n"
    doc = tmp_path / "Notes.md"
    doc.write_text(body, encoding="utf-8")
    sidecar_payload = {
        "version": SIDECAR_VERSION,
        "id": "doc-1",
        "html": "<p>No placeholders.</p>",
        "markdown_hash": hash_markdown(body),
        "updated_at": "2026-01-01T00:00:00Z",
        "extras": {"blocks": {"orphaned": {"block_type": "pdf-block", "page": 1}}},
    }
    legacy_sidecar = sidecar_path_for(doc)
    legacy_sidecar.write_text(json.dumps(sidecar_payload), encoding="utf-8")
    original_sidecar = legacy_sidecar.read_bytes()

    read = invoke(sync_client, "doc_read", {"root": str(tmp_path), "path": doc.name})

    assert {"extras", "source", "sourceState", "correlation"}.isdisjoint(read)
    assert legacy_sidecar.read_bytes() == original_sidecar


def test_doc_read_omits_legacy_sidecar_fields_for_empty_document(sync_client, tmp_path):
    doc = tmp_path / "Empty.md"
    doc.write_text("", encoding="utf-8")

    read = invoke(sync_client, "doc_read", {"root": str(tmp_path), "path": doc.name})

    assert {"extras", "source", "sourceState", "correlation"}.isdisjoint(read)


def test_doc_read_leaves_duplicate_attachment_placeholders_in_markdown(sync_client, tmp_path):
    body = (
        "---\nid: doc-1\ntitle: Notes\n---\n\n"
        '<!-- pdf-block id="abc" src="report.pdf" -->\n\n'
        '<!-- pdf-block id="abc" src="report.pdf" -->\n'
    )
    doc = tmp_path / "Notes.md"
    doc.write_text(body, encoding="utf-8")

    read = invoke(sync_client, "doc_read", {"root": str(tmp_path), "path": doc.name})

    assert "correlation" not in read
    assert read["markdown"].count('pdf-block id="abc"') == 2


def _create_markdown(sync_client, root: str, path: str = "Note.md") -> None:
    invoke(
        sync_client,
        "doc_create",
        {
            "root": root,
            "payload": {
                "path": path,
                "html": "<p>hi</p>",
                "markdown": "hi",
                "meta": {"id": "n1", "title": "Note"},
            },
        },
    )


def test_doc_read_envelope_excludes_legacy_sidecar_fields(sync_client, tmp_path):
    root = str(tmp_path)
    _create_markdown(sync_client, root)
    read = invoke(sync_client, "doc_read", {"root": root, "path": "Note.md"})
    assert {"extras", "source", "sourceState", "correlation"}.isdisjoint(read)


def test_workspace_scan_tolerates_one_undecodable_page(sync_client, tmp_path):
    """One Latin-1 file must not hide every healthy Page.

    Parity with `scanDocumentDto` in electron/native-workspace.js: the scan falls
    back to path identity for bytes it cannot decode, while `doc_read` still
    refuses them. Before this, a single such file failed the whole scan and the
    sidebar rendered empty with no explanation.
    """
    (tmp_path / "Good.md").write_text("Body\n", encoding="utf-8")
    (tmp_path / "Legacy.md").write_bytes(bytes([0x72, 0xE9, 0x73, 0x75, 0x6D, 0xE9, 0x0A]))

    scan = invoke(sync_client, "workspace_scan", {"root": str(tmp_path)})
    assert [document["path"] for document in scan["documents"]] == ["Good.md", "Legacy.md"]

    legacy = next(d for d in scan["documents"] if d["path"] == "Legacy.md")
    assert legacy["idSource"] == "path"
    assert legacy["title"] == "Legacy"

    assert invoke(sync_client, "doc_read", {"root": str(tmp_path), "path": "Good.md"})["markdown"] == "Body\n"

    # Byte fidelity still matters where the bytes are actually used.
    with pytest.raises(Exception):
        invoke(sync_client, "doc_read", {"root": str(tmp_path), "path": "Legacy.md"})


def test_workspace_scan_carries_frontmatter_aliases(sync_client, tmp_path):
    """Parity with electron/native-workspace.js: aliases ride the scan.

    Wiki Link resolution runs over the whole workspace, not the open Page, so a
    scan that dropped aliases made `[[Alias]]` resolve only for Pages the session
    had already opened.
    """
    (tmp_path / "Roadmap.md").write_text(
        '---\naliases: ["Plan", "Q3 Plan"]\n---\n\n# Roadmap\n', encoding="utf-8"
    )
    (tmp_path / "Plain.md").write_text("# Plain\n", encoding="utf-8")

    scan = invoke(sync_client, "workspace_scan", {"root": str(tmp_path)})
    roadmap = next(d for d in scan["documents"] if d["path"] == "Roadmap.md")
    assert roadmap["aliases"] == ["Plan", "Q3 Plan"]
    # Absent rather than an empty list, so a Page without aliases keeps its shape.
    assert "aliases" not in next(d for d in scan["documents"] if d["path"] == "Plain.md")


def test_doc_create_overwrites_only_with_the_users_carried_consent(sync_client, tmp_path):
    """Parity with electron/native-workspace.js: the native Save panel collects
    the replace consent, so `doc_create` needs it carried through explicitly."""
    root = str(tmp_path)
    draft = tmp_path / "Draft.md"
    existing = "---\nid: draft-1\ntitle: Old\n---\n\nOld body\n"
    draft.write_text(existing, encoding="utf-8")

    refused = error_response(
        sync_client,
        "doc_create",
        {"root": root, "payload": {"path": "Draft.md", "markdown": "New body"}},
    )
    assert refused.status_code != 200
    assert "document already exists: Draft.md" in refused.text
    assert draft.read_text(encoding="utf-8") == existing

    created = invoke(
        sync_client,
        "doc_create",
        {
            "root": root,
            "payload": {
                "path": "Draft.md",
                "markdown": "New body",
                "meta": {"id": "draft-2"},
                "replaceExisting": True,
            },
        },
    )
    assert created["path"] == "Draft.md"
    assert created["id"] == "draft-2"
    assert draft.read_text(encoding="utf-8") == "---\nid: draft-2\n---\n\nNew body"

    # Consent replaces a file, never a directory.
    (tmp_path / "Folder.md").mkdir()
    directory = error_response(
        sync_client,
        "doc_create",
        {
            "root": root,
            "payload": {"path": "Folder.md", "markdown": "x", "replaceExisting": True},
        },
    )
    assert directory.status_code != 200
    assert "document already exists: Folder.md" in directory.text


def test_case_only_page_rename_is_a_relocation_not_a_collision(sync_client, tmp_path):
    """Parity with electron/native-workspace.js: on a case-insensitive
    filesystem the moved Page itself answers at the destination."""
    root = str(tmp_path)
    source = "---\nid: readme-1\n---\n\nBody\n"
    (tmp_path / "readme.md").write_text(source, encoding="utf-8")
    recovery = b"\x07\x08\x09"
    sidecar_path_for(tmp_path / "readme.md").write_bytes(recovery)
    opened = invoke(sync_client, "doc_read", {"root": root, "path": "readme.md"})

    relocated = invoke(
        sync_client,
        "workspace_relocate_page",
        {
            "root": root,
            "oldPath": "readme.md",
            "newPath": "README.md",
            "expectedRevision": opened["revision"],
            "checks": [{"path": "readme.md", "expectedRevision": opened["revision"]}],
            "writes": [],
        },
    )

    assert relocated["document"]["path"] == "README.md"
    assert (tmp_path / "README.md").read_text(encoding="utf-8") == source
    assert sidecar_path_for(tmp_path / "README.md").read_bytes() == recovery

    # A genuinely occupied destination is still refused.
    (tmp_path / "Other.md").write_text("---\nid: other-1\n---\n\nOther\n", encoding="utf-8")
    moved = invoke(sync_client, "doc_read", {"root": root, "path": "README.md"})
    other = invoke(sync_client, "doc_read", {"root": root, "path": "Other.md"})
    refused = error_response(
        sync_client,
        "workspace_relocate_page",
        {
            "root": root,
            "oldPath": "README.md",
            "newPath": "Other.md",
            "expectedRevision": moved["revision"],
            "checks": [
                {"path": "README.md", "expectedRevision": moved["revision"]},
                {"path": "Other.md", "expectedRevision": other["revision"]},
            ],
            "writes": [],
        },
    )
    assert refused.status_code != 200
    assert "destination already exists: Other.md" in refused.text
    assert (tmp_path / "Other.md").read_text(encoding="utf-8") == "---\nid: other-1\n---\n\nOther\n"


def test_case_only_folder_rename_is_a_relocation_not_a_collision(sync_client, tmp_path):
    """Parity with electron/native-workspace.js for the folder half."""
    root = str(tmp_path)
    (tmp_path / "notes").mkdir()
    plan_source = "---\nid: plan-1\n---\n\n[[Spec]]\n"
    (tmp_path / "notes" / "Plan.md").write_text(plan_source, encoding="utf-8")
    (tmp_path / "notes" / "Spec.md").write_text("---\nid: spec-1\n---\n\nSpec\n", encoding="utf-8")
    plan = invoke(sync_client, "doc_read", {"root": root, "path": "notes/Plan.md"})
    spec = invoke(sync_client, "doc_read", {"root": root, "path": "notes/Spec.md"})

    relocated = invoke(
        sync_client,
        "workspace_relocate_folder",
        {
            "root": root,
            "oldPath": "notes",
            "newPath": "Notes",
            "checks": [
                {"path": "notes/Plan.md", "expectedRevision": plan["revision"]},
                {"path": "notes/Spec.md", "expectedRevision": spec["revision"]},
            ],
            "writes": [],
        },
    )

    assert relocated == {"path": "Notes", "writes": []}
    scan = invoke(sync_client, "workspace_scan", {"root": root})
    assert sorted(document["path"] for document in scan["documents"]) == [
        "Notes/Plan.md",
        "Notes/Spec.md",
    ]
    # A case-only rename resolves the same Pages, so no link may be rewritten.
    assert (tmp_path / "Notes" / "Plan.md").read_text(encoding="utf-8") == plan_source

    # A genuinely occupied destination is still refused.
    (tmp_path / "Archive").mkdir()
    moved = invoke(sync_client, "doc_read", {"root": root, "path": "Notes/Plan.md"})
    moved_spec = invoke(sync_client, "doc_read", {"root": root, "path": "Notes/Spec.md"})
    refused = error_response(
        sync_client,
        "workspace_relocate_folder",
        {
            "root": root,
            "oldPath": "Notes",
            "newPath": "Archive",
            "checks": [
                {"path": "Notes/Plan.md", "expectedRevision": moved["revision"]},
                {"path": "Notes/Spec.md", "expectedRevision": moved_spec["revision"]},
            ],
            "writes": [],
        },
    )
    assert refused.status_code != 200
    assert "destination already exists: Archive" in refused.text
    assert (tmp_path / "Notes").is_dir()


def test_case_only_attachment_rename_is_a_relocation_not_a_collision(sync_client, tmp_path):
    root = str(tmp_path)
    (tmp_path / "spec.pdf").write_bytes(b"%PDF-1.4\n")

    renamed = invoke(
        sync_client, "doc_rename", {"root": root, "oldPath": "spec.pdf", "newPath": "Spec.pdf"}
    )

    assert renamed["path"] == "Spec.pdf"
    scan = invoke(sync_client, "workspace_scan", {"root": root})
    assert [document["path"] for document in scan["documents"]] == ["Spec.pdf"]
