"""HTML document type — read/write vertical (#139). The .html body IS the
editor HTML: no frontmatter, no markdown conversion."""

from __future__ import annotations

from pathlib import Path

from api.workspace import is_html_file, is_workspace_document_file, read_doc, write_doc


def test_html_extension_detection() -> None:
    assert is_html_file(Path("a.html")) and is_html_file(Path("a.htm"))
    assert is_workspace_document_file(Path("a.html"))
    assert not is_html_file(Path("a.md"))


def test_write_then_read_html_roundtrips(tmp_path: Path) -> None:
    p = tmp_path / "page.html"
    body = "<h1>Hi</h1>\n<p>x</p>"
    # getMarkdown of an html doc is irrelevant and must not land on disk.
    write_doc(p, {"html": body, "markdown": "# Hi\n\nx", "meta": {"id": "h1"}, "extras": {"k": 1}})

    on_disk = p.read_text(encoding="utf-8")
    assert on_disk == body
    assert "# Hi" not in on_disk and "---" not in on_disk

    r = read_doc(p)
    assert r["sourceState"] == "sidecar_fresh"
    assert r["editorHtml"] == body
    assert r["meta"]["id"] == "h1"
    assert r["extras"] == {"k": 1}


def test_external_edit_keeps_extras_and_uses_file_body(tmp_path: Path) -> None:
    p = tmp_path / "page.html"
    write_doc(p, {"html": "<p>old</p>", "markdown": "", "meta": {"id": "h1"}, "extras": {"k": 1}})
    p.write_text("<h1>Edited externally</h1>", encoding="utf-8")

    r = read_doc(p)
    assert r["sourceState"] == "sidecar_stale"
    assert r["editorHtml"] == "<h1>Edited externally</h1>"
    assert r["extras"] == {"k": 1}  # #147: sidecar extras carry through


def test_no_frontmatter_is_parsed_from_html(tmp_path: Path) -> None:
    p = tmp_path / "page.html"
    p.write_text("<h1>Title</h1>\n<p>body</p>\n", encoding="utf-8")
    r = read_doc(p)
    assert r["sourceState"] == "sidecar_missing"
    assert r["editorHtml"] == "<h1>Title</h1>\n<p>body</p>\n"
    assert r["markdown"] == "<h1>Title</h1>\n<p>body</p>\n"
