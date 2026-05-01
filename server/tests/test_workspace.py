"""Tests for the local Markdown workspace HTTP fallback."""

import json


def invoke(sync_client, command: str, payload: dict | None = None):
    response = sync_client.post(
        "/api/workspace/invoke",
        json={"command": command, "payload": payload or {}},
    )
    assert response.status_code == 200, response.text
    return response.json()


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
