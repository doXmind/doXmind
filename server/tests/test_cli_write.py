"""S6 (ADR 0010): create + edit markdown via CLI and MCP."""

import json

import pytest
from typer.testing import CliRunner

from cli.__main__ import app
from core.documents import create_document, edit_document, read_document_in_root
from doxmind_mcp import server

runner = CliRunner()


def test_create_document_writes_markdown_shape_sidecar(tmp_path):
    dto = create_document(tmp_path, "note.md", markdown="# Hi\n\nbody\n")
    assert (tmp_path / "note.md").read_text(encoding="utf-8").strip().endswith("body")
    sidecar = tmp_path / ".note.doxmind"
    assert sidecar.exists()
    data = json.loads(sidecar.read_text(encoding="utf-8"))
    assert data["version"] == 2
    assert data["id"] == dto["id"]
    assert {"html", "markdown_hash", "updated_at"} <= set(data)
    # No legacy top-level fields (ADR 0003).
    assert "pdf_editor" not in data and "excel_editor" not in data


def test_create_refuses_overwrite(tmp_path):
    create_document(tmp_path, "note.md", markdown="one")
    with pytest.raises(ValueError):
        create_document(tmp_path, "note.md", markdown="two")


def test_edit_document_replaces_body(tmp_path):
    create_document(tmp_path, "note.md", markdown="original")
    edit_document(tmp_path, "note.md", "rewritten body")
    doc = read_document_in_root(tmp_path, "note.md")
    assert "rewritten body" in doc["markdown"]
    assert doc["sourceState"] == "sidecar_fresh"


def test_cli_new_creates_document(tmp_path):
    res = runner.invoke(
        app, ["new", "ideas/spark.md", "--root", str(tmp_path), "--content", "# Spark\n\nzap"]
    )
    assert res.exit_code == 0, res.output
    assert (tmp_path / "ideas" / "spark.md").exists()


def test_mcp_create_and_edit_confined(tmp_path, monkeypatch):
    monkeypatch.setenv("DOXMIND_WORKSPACE_ROOT", str(tmp_path))
    server.create_document("agent.md", markdown="from agent")
    assert (tmp_path / "agent.md").exists()
    server.edit_document("agent.md", "edited by agent")
    assert "edited by agent" in read_document_in_root(tmp_path, "agent.md")["markdown"]
    with pytest.raises(ValueError):
        server.create_document("../escape.md", markdown="nope")
