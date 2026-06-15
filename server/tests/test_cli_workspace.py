"""S3 (ADR 0010): the CLI read surface — ls, search, index rebuild."""

import json
from pathlib import Path

from typer.testing import CliRunner

from cli.__main__ import app

runner = CliRunner()


def _workspace(tmp_path: Path) -> Path:
    (tmp_path / "alpha.md").write_text("# Alpha\n\nhello world\n", encoding="utf-8")
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "beta.md").write_text("# Beta\n\ngoodbye world\n", encoding="utf-8")
    return tmp_path


def test_ls_lists_documents(tmp_path):
    _workspace(tmp_path)
    res = runner.invoke(app, ["ls", "--root", str(tmp_path)])
    assert res.exit_code == 0, res.output
    assert "alpha.md" in res.stdout
    assert "beta.md" in res.stdout


def test_ls_json(tmp_path):
    _workspace(tmp_path)
    res = runner.invoke(app, ["ls", "--root", str(tmp_path), "--json"])
    assert res.exit_code == 0, res.output
    data = json.loads(res.stdout)
    paths = {d["path"] for d in data["documents"]}
    assert any(p.endswith("alpha.md") for p in paths)


def test_search_finds_match(tmp_path):
    _workspace(tmp_path)
    res = runner.invoke(app, ["search", "goodbye", "--root", str(tmp_path)])
    assert res.exit_code == 0, res.output
    assert "beta.md" in res.stdout
    assert "alpha.md" not in res.stdout


def test_search_root_from_env(tmp_path, monkeypatch):
    _workspace(tmp_path)
    monkeypatch.setenv("DOXMIND_WORKSPACE_ROOT", str(tmp_path))
    res = runner.invoke(app, ["search", "hello"])
    assert res.exit_code == 0, res.output
    assert "alpha.md" in res.stdout


def test_index_rebuild(tmp_path):
    _workspace(tmp_path)
    res = runner.invoke(app, ["index", "rebuild", "--root", str(tmp_path)])
    assert res.exit_code == 0, res.output
    assert "rebuilt index" in res.stdout
