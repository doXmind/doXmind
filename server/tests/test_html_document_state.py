"""Tests for first-class HTML documents (issue #139).

doXmind renders an HTML file faithfully (real HTML + CSS) and edits its text
content in place. The whole document is the unit of state: the editor sends
the full document and it is written back verbatim — a lossless round-trip.
"""

from pathlib import Path

from api import workspace as w
from services.html_document_state import HtmlDocumentSnapshot, HtmlDocumentState
from services.sidecar_io import sidecar_path_for

FULL_DOC = (
    '<!doctype html>\n<html lang="en">\n<head>\n<title>My Title</title>\n'
    "<style>x{}</style>\n</head>\n"
    '<body class="doc">\n<h1>Hello</h1>\n<p>World</p>\n</body>\n</html>\n'
)


def test_detection_and_dto(tmp_path: Path):
    path = tmp_path / "Page.html"
    path.write_text(FULL_DOC, encoding="utf-8")
    assert w.is_html_file(path)
    assert w.is_workspace_document_file(path)
    dto = w.document_dto_for_path(tmp_path, path)
    assert dto["documentType"] == "html"
    assert dto["title"] == "Page"


def test_htm_extension_detected(tmp_path: Path):
    path = tmp_path / "Page.htm"
    path.write_text("<body><p>x</p></body>", encoding="utf-8")
    assert w.document_dto_for_path(tmp_path, path)["documentType"] == "html"


def test_open_returns_full_document_and_outline(tmp_path: Path):
    path = tmp_path / "Page.html"
    path.write_text(FULL_DOC, encoding="utf-8")
    result = w.read_doc(path.resolve())
    assert result["sourceState"] == "sidecar_missing"
    # The whole document is handed to the editor, head included.
    assert result["editorHtml"] == FULL_DOC
    assert "<title>My Title</title>" in result["editorHtml"]
    assert result["outline"] == [{"id": "hello", "depth": 1, "text": "Hello"}]
    assert result["extras"] is None


def test_save_writes_document_verbatim(tmp_path: Path):
    path = tmp_path / "Page.html"
    path.write_text(FULL_DOC, encoding="utf-8")
    doc_id = w.read_doc(path.resolve())["meta"]["id"]

    edited = FULL_DOC.replace("<p>World</p>", "<p>World edited</p>")
    w.write_doc_workspace(
        str(tmp_path.resolve()),
        "Page.html",
        {"html": edited, "markdown": "", "meta": {"id": doc_id}},
    )

    disk = path.read_text(encoding="utf-8")
    assert disk == edited
    # Everything outside the edited text survives because we write verbatim.
    assert "<title>My Title</title>" in disk
    assert "<style>x{}</style>" in disk
    assert 'body class="doc"' in disk


def test_reopen_after_save_is_fresh_and_id_stable(tmp_path: Path):
    path = tmp_path / "Page.html"
    path.write_text(FULL_DOC, encoding="utf-8")
    doc_id = w.read_doc(path.resolve())["meta"]["id"]
    edited = FULL_DOC.replace("Hello", "Edited")
    w.write_doc_workspace(
        str(tmp_path.resolve()),
        "Page.html",
        {"html": edited, "markdown": "", "meta": {"id": doc_id}},
    )
    reopened = w.read_doc(path.resolve())
    assert reopened["sourceState"] == "sidecar_fresh"
    assert reopened["meta"]["id"] == doc_id
    assert reopened["editorHtml"] == edited
    assert sidecar_path_for(path).exists()


def test_external_edit_marks_sidecar_stale(tmp_path: Path):
    path = tmp_path / "Page.html"
    path.write_text(FULL_DOC, encoding="utf-8")
    doc_id = w.read_doc(path.resolve())["meta"]["id"]
    w.write_doc_workspace(
        str(tmp_path.resolve()),
        "Page.html",
        {"html": FULL_DOC, "markdown": "", "meta": {"id": doc_id}},
    )
    assert w.read_doc(path.resolve())["sourceState"] == "sidecar_fresh"

    # Edit the .html on disk out-of-band.
    path.write_text(FULL_DOC.replace("World", "EXTERNAL"), encoding="utf-8")
    stale = w.read_doc(path.resolve())
    assert stale["sourceState"] == "sidecar_stale"
    assert "EXTERNAL" in stale["editorHtml"]


def test_empty_html_is_empty_state(tmp_path: Path):
    path = tmp_path / "empty.html"
    path.write_text("   \n  ", encoding="utf-8")
    assert w.read_doc(path.resolve())["sourceState"] == "empty"


def test_scan_includes_html(tmp_path: Path):
    (tmp_path / "a.html").write_text(FULL_DOC, encoding="utf-8")
    (tmp_path / "b.htm").write_text("<body><p>x</p></body>", encoding="utf-8")
    names = {d["name"] for d in w.workspace_scan(str(tmp_path.resolve()))["documents"]}
    assert {"a.html", "b.htm"} <= names


def test_state_read_requires_absolute_path(tmp_path: Path):
    path = tmp_path / "Page.html"
    path.write_text(FULL_DOC, encoding="utf-8")
    state = HtmlDocumentState()
    try:
        state.read(Path("Page.html"))
    except ValueError as exc:
        assert "absolute" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected ValueError for relative path")

    outcome = state.read(path.resolve())
    assert outcome.editor_html == FULL_DOC


def test_write_requires_id(tmp_path: Path):
    path = tmp_path / "Page.html"
    state = HtmlDocumentState()
    try:
        state.write_full(path, HtmlDocumentSnapshot(html="<p>x</p>", meta={}))
    except ValueError as exc:
        assert "id" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected ValueError when id is missing")
