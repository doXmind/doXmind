"""S1 (ADR 0010): `core.read_document` + `doxmind read`, standalone.

These exercise the whole skeleton — core facade -> CLI -> output — against a
temp workspace, with no HTTP server or desktop app running.
"""

import json
from pathlib import Path

from typer.testing import CliRunner

from cli.__main__ import app
from core.documents import read_document

runner = CliRunner()


def _write_md(tmp_path: Path) -> Path:
    doc = tmp_path / "note.md"
    doc.write_text("# Title\n\nHello world\n", encoding="utf-8")
    return doc


def test_read_document_returns_markdown_and_html(tmp_path):
    doc = _write_md(tmp_path)
    result = read_document(doc)
    assert "Hello world" in result["markdown"]
    assert "Hello world" in result["html"]
    assert result["meta"].get("id")
    # No sidecar on disk for a freshly written .md.
    assert result["sourceState"] == "sidecar_missing"


def test_cli_read_prints_markdown(tmp_path):
    doc = _write_md(tmp_path)
    res = runner.invoke(app, ["read", str(doc)])
    assert res.exit_code == 0, res.output
    assert "Hello world" in res.stdout


def test_cli_read_json(tmp_path):
    doc = _write_md(tmp_path)
    res = runner.invoke(app, ["read", str(doc), "--json"])
    assert res.exit_code == 0, res.output
    data = json.loads(res.stdout)
    assert "Hello world" in data["markdown"]
    assert data["sourceState"] == "sidecar_missing"


def test_cli_read_html(tmp_path):
    doc = _write_md(tmp_path)
    res = runner.invoke(app, ["read", str(doc), "--html"])
    assert res.exit_code == 0, res.output
    assert "Hello world" in res.stdout
    assert "<" in res.stdout
