"""S8 (ADR 0010): Markdown/HTML export — CLI + MCP."""

from pathlib import Path

import pytest
from typer.testing import CliRunner

from cli.__main__ import app
from core.exporting import export_document
from doxmind_mcp import server

runner = CliRunner()


def _write_md(tmp_path: Path) -> Path:
    doc = tmp_path / "note.md"
    doc.write_text("# Title\n\nHello export\n", encoding="utf-8")
    return doc


def test_export_html_and_md_bytes(tmp_path):
    doc = _write_md(tmp_path)
    assert b"Hello export" in export_document(doc, "html")
    assert b"Hello export" in export_document(doc, "md")


def test_markdown_export_is_the_exact_source_file(tmp_path):
    doc = tmp_path / "lossless.markdown"
    source = (
        b"---\r\n"
        b"id: page-1 # keep comment\r\n"
        b"unknown: [one, two]\r\n"
        b"# commented frontmatter\r\n"
        b"---\r\n\r\n# Body\r\n"
    )
    doc.write_bytes(source)

    assert export_document(doc, "md") == source
    assert export_document(doc, "markdown") == source

    bom_source = b"\xef\xbb\xbf# BOM Page\r\n"
    doc.write_bytes(bom_source)
    assert export_document(doc, "md") == bom_source


def test_export_rejects_pdf(tmp_path):
    doc = _write_md(tmp_path)
    with pytest.raises(ValueError, match="use html or md"):
        export_document(doc, "pdf")


def test_cli_export_writes_file(tmp_path):
    doc = _write_md(tmp_path)
    out = tmp_path / "note.html"
    res = runner.invoke(app, ["export", str(doc), "--to", "html", "--out", str(out)])
    assert res.exit_code == 0, res.output
    assert b"Hello export" in out.read_bytes()


def test_cli_export_refuses_overwriting_source(tmp_path):
    doc = _write_md(tmp_path)
    res = runner.invoke(app, ["export", str(doc), "--to", "md"])
    assert res.exit_code != 0


def test_cli_export_refuses_existing_destination(tmp_path):
    doc = _write_md(tmp_path)
    out = tmp_path / "existing.html"
    out.write_bytes(b"keep me")

    res = runner.invoke(app, ["export", str(doc), "--to", "html", "--out", str(out)])

    assert res.exit_code != 0
    assert out.read_bytes() == b"keep me"


def test_cli_export_refuses_symlink_destination(tmp_path):
    doc = _write_md(tmp_path)
    victim = tmp_path / "victim.html"
    victim.write_bytes(b"keep victim")
    out = tmp_path / "linked.html"
    out.symlink_to(victim)

    res = runner.invoke(app, ["export", str(doc), "--to", "html", "--out", str(out)])

    assert res.exit_code != 0
    assert out.is_symlink()
    assert victim.read_bytes() == b"keep victim"


def test_mcp_export_document_writes_into_workspace(tmp_path, monkeypatch):
    _write_md(tmp_path)
    monkeypatch.setenv("DOXMIND_WORKSPACE_ROOT", str(tmp_path))
    result = server.export_document("note.md", "html")
    assert result["outPath"] == "note.html"
    assert b"Hello export" in (tmp_path / "note.html").read_bytes()
    with pytest.raises(ValueError):
        server.export_document("note.md", "html", "../escape.html")


def test_mcp_markdown_export_requires_a_distinct_target_and_preserves_source(tmp_path, monkeypatch):
    source = b"---\r\nid: note-1\r\nunknown: keep\r\n---\r\n\r\nBody\r\n"
    (tmp_path / "note.md").write_bytes(source)
    monkeypatch.setenv("DOXMIND_WORKSPACE_ROOT", str(tmp_path))

    with pytest.raises(ValueError, match="overwrite the source"):
        server.export_document("note.md", "md")
    assert (tmp_path / "note.md").read_bytes() == source

    result = server.export_document("note.md", "md", "exports/note.markdown")
    assert result == {"outPath": "exports/note.markdown", "bytes": len(source)}
    assert (tmp_path / "exports" / "note.markdown").read_bytes() == source
