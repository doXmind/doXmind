"""S8 (ADR 0010): export — doxmind export (CLI) + export_document (MCP)."""

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


def test_export_pdf_has_header(tmp_path):
    doc = _write_md(tmp_path)
    assert export_document(doc, "pdf").startswith(b"%PDF-")


def test_cli_export_writes_file(tmp_path):
    doc = _write_md(tmp_path)
    out = tmp_path / "note.pdf"
    res = runner.invoke(app, ["export", str(doc), "--to", "pdf", "--out", str(out)])
    assert res.exit_code == 0, res.output
    assert out.read_bytes().startswith(b"%PDF-")


def test_cli_export_refuses_overwriting_source(tmp_path):
    doc = _write_md(tmp_path)
    res = runner.invoke(app, ["export", str(doc), "--to", "md"])
    assert res.exit_code != 0


def test_mcp_export_document_writes_into_workspace(tmp_path, monkeypatch):
    _write_md(tmp_path)
    monkeypatch.setenv("DOXMIND_WORKSPACE_ROOT", str(tmp_path))
    result = server.export_document("note.md", "pdf")
    assert result["outPath"] == "note.pdf"
    assert (tmp_path / "note.pdf").read_bytes().startswith(b"%PDF-")
    with pytest.raises(ValueError):
        server.export_document("note.md", "pdf", "../escape.pdf")
