"""Tests for the local Markdown workspace HTTP fallback."""

import json
import shutil
from pathlib import Path

import pytest

from api import workspace as workspace_module
from services.sidecar_io import SIDECAR_VERSION, sidecar_path_for
from services.synthetic_document import (
    PDF_BLOCK_TYPE,
    LegacySidecarError,
    SyntheticDocumentFactory,
)


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


def _make_pdf(tmp_path: Path, name: str = "Application.pdf") -> Path:
    path = tmp_path / name
    path.write_bytes(b"%PDF-1.4\n% doxmind test pdf\n")
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


def _write_legacy_pdf_sidecar(pdf_path: Path) -> Path:
    sidecar_path = sidecar_path_for(pdf_path)
    sidecar_path.write_text(json.dumps(_legacy_pdf_payload(pdf_path)), encoding="utf-8")
    return sidecar_path


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
    assert (tmp_path / "Notes" / "Plan.md").exists()
    assert (tmp_path / "Notes" / ".Plan.doxmind").exists()

    scan = invoke(sync_client, "workspace_scan", {"root": root})
    assert scan["documents"][0]["id"] == "doc-1"
    assert scan["documents"][0]["title"] == "Plan"

    read = invoke(sync_client, "doc_read", {"path": str(tmp_path / "Notes" / "Plan.md")})
    assert read["source"] == "sidecar"
    assert read["html"] == "<p>Hello <strong>world</strong></p>"
    assert read["extras"] == {"databases": {}}


def test_external_markdown_edit_invalidates_sidecar(sync_client, tmp_path):
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
    (tmp_path / "Doc.md").write_text("---\nid: doc-1\ntitle: Doc\n---\n\n# External\n", encoding="utf-8")

    read = invoke(sync_client, "doc_read", {"path": str(tmp_path / "Doc.md")})
    assert read["source"] == "markdown"
    assert "<h1>External</h1>" in read["html"]
    assert read["extras"] is None


def test_markdown_read_preserves_distinct_list_types(sync_client, tmp_path):
    doc = tmp_path / "Lists.md"
    doc.write_text(
        "# Lists\n\n- Bullet\n\n1. Ordered\n\n- [ ] Todo\n- [x] Done\n",
        encoding="utf-8",
    )

    read = invoke(sync_client, "doc_read", {"path": str(doc)})

    assert read["source"] == "markdown"
    assert "<ul>" in read["html"]
    assert "<ol>" in read["html"]
    assert '<ul data-type="taskList">' in read["html"]
    assert '<li data-type="taskItem" data-checked="false"><p>Todo</p></li>' in read["html"]
    assert '<li data-type="taskItem" data-checked="true"><p>Done</p></li>' in read["html"]


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
    assert results[0]["path"] == "Folder/Search.md"
    assert results[0]["matches"][0]["preview"] == "needle line"

    index = invoke(sync_client, "workspace_index_rebuild", {"root": root})
    assert index["ids"] == {"search-doc": "Folder/Search.md"}
    assert json.loads((tmp_path / ".doxmind" / "index.json").read_text()) == index


def test_doc_create_pdf_writes_binary_and_appears_in_scan(sync_client, tmp_path):
    root = str(tmp_path)
    # Tiny but valid PDF header — the create handler enforces the magic
    # bytes, so a placeholder string would be rejected.
    pdf_bytes = b"%PDF-1.4\n% blank doxmind pdf\n%%EOF\n"

    created = invoke(
        sync_client,
        "doc_create_pdf",
        {
            "root": root,
            "path": "Drafts/Blank.pdf",
            "bytes": list(pdf_bytes),
        },
    )
    assert created["path"] == "Drafts/Blank.pdf"
    assert created["documentType"] == "pdf"
    written = (tmp_path / "Drafts" / "Blank.pdf").read_bytes()
    assert written == pdf_bytes

    scan = invoke(sync_client, "workspace_scan", {"root": root})
    pdf_doc = next(d for d in scan["documents"] if d["path"] == "Drafts/Blank.pdf")
    assert pdf_doc["documentType"] == "pdf"


def test_doc_create_pdf_rejects_non_pdf_payload(sync_client, tmp_path):
    response = sync_client.post(
        "/api/workspace/invoke",
        json={
            "command": "doc_create_pdf",
            "payload": {
                "root": str(tmp_path),
                "path": "Bad.pdf",
                "bytes": list(b"not a pdf"),
            },
        },
    )
    assert response.status_code == 400


def test_workspace_pdf_scan_binary_and_editor_state(sync_client, tmp_path):
    root = str(tmp_path)
    pdf_bytes = b"%PDF-1.4\n% doxmind test pdf\n"
    (tmp_path / "Application.pdf").write_bytes(pdf_bytes)
    (tmp_path / "Notes.md").write_text("needle line", encoding="utf-8")

    scan = invoke(sync_client, "workspace_scan", {"root": root})
    pdf_doc = next(doc for doc in scan["documents"] if doc["path"] == "Application.pdf")
    assert pdf_doc["documentType"] == "pdf"
    assert pdf_doc["title"] == "Application"

    results = invoke(sync_client, "workspace_markdown_search", {"root": root, "query": "PDF"})
    assert results == []

    binary = invoke(sync_client, "workspace_read_binary", {"root": root, "path": "Application.pdf"})
    assert bytes(binary) == pdf_bytes

    state = {"version": 1, "edits": {"1:0": {"text": "Edited company name"}}}
    invoke(
        sync_client,
        "workspace_write_pdf_editor_state",
        {"root": root, "path": "Application.pdf", "payload": state},
    )
    assert (tmp_path / ".Application.pdf.doxmind").exists()

    restored = invoke(
        sync_client,
        "workspace_read_pdf_editor_state",
        {"root": root, "path": "Application.pdf"},
    )
    assert restored == state


def test_workspace_maps_sidecar_migration_error_to_structured_422(sync_client, tmp_path):
    pdf_path = _make_pdf(tmp_path)
    sidecar_path = _write_legacy_pdf_sidecar(pdf_path)
    bak_path = sidecar_path.parent / f"{sidecar_path.name}.bak"
    bak_path.write_bytes(b"previous migration backup")

    response = error_response(
        sync_client,
        "workspace_read_pdf_doc_state",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "sidecar_migration_failed",
        "sidecar_path": str(sidecar_path),
        "block_type": PDF_BLOCK_TYPE,
        "reason": (
            f"a previous migration backup is in place at {bak_path}; "
            "investigate before retrying"
        ),
        "recovery": "rename <sidecar>.bak back to <sidecar> to restore the original",
    }


def test_workspace_maps_legacy_sidecar_error_to_structured_422(
    sync_client, tmp_path, monkeypatch
):
    pdf_path = _make_pdf(tmp_path)
    sidecar_path = _write_legacy_pdf_sidecar(pdf_path)

    def raise_legacy_error(
        self,
        sidecar_path: Path,
        *,
        for_path: Path | None = None,
        _locked: bool = False,
    ) -> None:
        raise LegacySidecarError(sidecar_path, PDF_BLOCK_TYPE, "legacy reader failed")

    monkeypatch.setattr(
        SyntheticDocumentFactory,
        "migrate_legacy_sidecar",
        raise_legacy_error,
    )

    response = error_response(
        sync_client,
        "workspace_read_pdf_doc_state",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "legacy_sidecar_unrecoverable",
        "sidecar_path": str(sidecar_path),
        "block_type": PDF_BLOCK_TYPE,
        "reason": "legacy reader failed",
    }


def test_workspace_maps_read_only_document_error_to_structured_409(
    sync_client, tmp_path, monkeypatch
):
    monkeypatch.setenv("DOXMIND_SIDECAR_MIGRATE", "0")
    pdf_path = _make_pdf(tmp_path)
    _write_legacy_pdf_sidecar(pdf_path)

    response = error_response(
        sync_client,
        "workspace_write_pdf_editor_state",
        {
            "root": str(tmp_path),
            "path": pdf_path.name,
            "payload": {"version": 1, "edits": {"1:0": {"text": "blocked"}}},
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "document_read_only",
        "path": str(pdf_path),
        "recovery": (
            "unset DOXMIND_SIDECAR_MIGRATE or set it to 1 to enable migration; "
            "or restore from <sidecar>.bak"
        ),
    }


def test_workspace_maps_corrupt_sidecar_error_to_structured_422(sync_client, tmp_path):
    pdf_path = _make_pdf(tmp_path)
    sidecar_path = sidecar_path_for(pdf_path)
    sidecar_path.write_bytes(b'{"version": 1')

    response = error_response(
        sync_client,
        "workspace_read_pdf_doc_state",
        {"root": str(tmp_path), "path": pdf_path.name},
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "sidecar_corrupt"
    assert detail["sidecar_path"] == str(sidecar_path)
    assert detail["forensic_path"] is not None
    assert Path(detail["forensic_path"]).exists()
    assert detail["reason"]
    assert (
        detail["recovery"]
        == "investigate the forensic copy; restore over the sidecar manually if appropriate"
    )


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
