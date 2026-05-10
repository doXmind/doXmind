"""Tests for the local Markdown workspace HTTP fallback."""

import json
import shutil
from pathlib import Path

import pytest

from api import workspace as workspace_module
from services.sidecar_io import SIDECAR_VERSION, hash_markdown, sidecar_path_for
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
    assert read["sourceState"] == "sidecar_fresh"
    assert read["html"] == "<p>Hello <strong>world</strong></p>"
    assert read["editorHtml"] == "<p>Hello <strong>world</strong></p>"
    assert read["browsingHtml"] == "<p>Hello <strong>world</strong></p>"
    assert read["outline"] == []
    assert read["browsingRendererVersion"] == "browsing-html/v1"
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
    assert read["sourceState"] == "sidecar_stale"
    assert "<h1>External</h1>" in read["html"]
    assert "<h1>External</h1>" in read["editorHtml"]
    assert "<h1>External</h1>" in read["browsingHtml"]
    assert read["outline"] == [{"id": "external", "depth": 1, "text": "External"}]
    assert read["extras"] is None


def test_markdown_read_preserves_distinct_list_types(sync_client, tmp_path):
    doc = tmp_path / "Lists.md"
    doc.write_text(
        "# Lists\n\n- Bullet\n\n1. Ordered\n\n- [ ] Todo\n- [x] Done\n",
        encoding="utf-8",
    )

    read = invoke(sync_client, "doc_read", {"path": str(doc)})

    assert read["source"] == "markdown"
    assert read["sourceState"] == "sidecar_missing"
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

    The next open will trip the Stale-sidecar / Salvage path (ADR 0002)
    because the markdown_hash no longer matches; that's the right behavior
    since at the FS level a Replace is indistinguishable from an external edit.
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


def test_doc_read_includes_empty_correlation_for_plain_markdown(sync_client, tmp_path):
    doc = tmp_path / "Plain.md"
    doc.write_text("# Plain\n\nNo placeholders here.\n", encoding="utf-8")

    read = invoke(sync_client, "doc_read", {"path": str(doc)})

    assert read["correlation"] == {"events": [], "blocking": False}


def test_doc_read_reports_new_event_for_unmatched_pdf_placeholder(sync_client, tmp_path):
    body = (
        "---\nid: doc-1\ntitle: Notes\n---\n\n"
        '<!-- pdf-block id="abc" src="report.pdf" -->\n'
    )
    doc = tmp_path / "Notes.md"
    doc.write_text(body, encoding="utf-8")

    read = invoke(sync_client, "doc_read", {"path": str(doc)})

    correlation = read["correlation"]
    assert correlation is not None
    assert correlation["blocking"] is False
    assert len(correlation["events"]) == 1
    event = correlation["events"][0]
    assert event["kind"] == "new"
    assert event["block_type"] == "pdf-block"
    assert event["id"] == "abc"
    assert event["how_handled"] == "created_empty"


def test_doc_read_reports_orphan_event_for_extras_slot_without_placeholder(
    sync_client, tmp_path
):
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
    sidecar_path_for(doc).write_text(json.dumps(sidecar_payload), encoding="utf-8")

    read = invoke(sync_client, "doc_read", {"path": str(doc)})

    correlation = read["correlation"]
    assert correlation is not None
    assert correlation["blocking"] is False
    orphan_events = [e for e in correlation["events"] if e["kind"] == "orphan"]
    assert len(orphan_events) == 1
    orphan = orphan_events[0]
    assert orphan["block_type"] == "pdf-block"
    assert orphan["id"] == "orphaned"
    assert orphan["how_handled"] == "discarded"
    assert orphan["detail"] == {"slot_key": "blocks/orphaned"}


def test_doc_read_includes_empty_correlation_for_empty_document(sync_client, tmp_path):
    doc = tmp_path / "Empty.md"
    doc.write_text("", encoding="utf-8")

    read = invoke(sync_client, "doc_read", {"path": str(doc)})

    assert read["source"] == "empty"
    assert read["correlation"] == {"events": [], "blocking": False}


def test_doc_read_reports_blocking_duplicate_pdf_placeholders(sync_client, tmp_path):
    body = (
        "---\nid: doc-1\ntitle: Notes\n---\n\n"
        '<!-- pdf-block id="abc" src="report.pdf" -->\n\n'
        '<!-- pdf-block id="abc" src="report.pdf" -->\n'
    )
    doc = tmp_path / "Notes.md"
    doc.write_text(body, encoding="utf-8")

    read = invoke(sync_client, "doc_read", {"path": str(doc)})

    correlation = read["correlation"]
    assert correlation is not None
    assert correlation["blocking"] is True
    duplicate_events = [e for e in correlation["events"] if e["kind"] == "duplicate"]
    assert len(duplicate_events) == 1
    duplicate = duplicate_events[0]
    assert duplicate["block_type"] == "pdf-block"
    assert duplicate["id"] == "abc"
    assert duplicate["how_handled"] == "errored"
    assert duplicate["detail"]["locations"] == [{"line": 1}, {"line": 3}]
