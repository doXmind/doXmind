"""CLI path resolution + escape semantics (deep-review hardening).

read/export/convert resolve a *relative* path against the workspace root and
reject `..` escapes; an *absolute* path is honored as-is because the CLI is a
trusted local tool (a human may read/write any file they own). Path confinement
is the MCP/agent guarantee, not the CLI's.
"""

from typer.testing import CliRunner

from cli.__main__ import app

runner = CliRunner()


def test_read_relative_resolves_against_root(tmp_path):
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes" / "a.md").write_text("# A\n\nrooted body\n", encoding="utf-8")
    res = runner.invoke(app, ["read", "notes/a.md", "--root", str(tmp_path)])
    assert res.exit_code == 0, res.output
    assert "rooted body" in res.stdout


def test_read_rejects_relative_escape(tmp_path):
    res = runner.invoke(app, ["read", "../../etc/passwd", "--root", str(tmp_path)])
    assert res.exit_code != 0


def test_read_absolute_path_honored(tmp_path):
    doc = tmp_path / "abs.md"
    doc.write_text("# Abs\n\nabsolute body\n", encoding="utf-8")
    res = runner.invoke(app, ["read", str(doc)])  # no --root; absolute is allowed
    assert res.exit_code == 0, res.output
    assert "absolute body" in res.stdout


def test_export_out_rejects_relative_escape(tmp_path):
    (tmp_path / "n.md").write_text("# N\n\nbody\n", encoding="utf-8")
    res = runner.invoke(
        app, ["export", "n.md", "--root", str(tmp_path), "--to", "pdf", "--out", "../evil.pdf"]
    )
    assert res.exit_code != 0
    assert not (tmp_path.parent / "evil.pdf").exists()


def test_export_out_absolute_honored(tmp_path):
    (tmp_path / "n.md").write_text("# N\n\nbody\n", encoding="utf-8")
    out = tmp_path / "exports" / "n.pdf"  # absolute path with a fresh parent dir
    res = runner.invoke(
        app, ["export", "n.md", "--root", str(tmp_path), "--to", "pdf", "--out", str(out)]
    )
    assert res.exit_code == 0, res.output
    assert out.read_bytes().startswith(b"%PDF-")


def test_convert_rejects_relative_escape(tmp_path):
    res = runner.invoke(app, ["convert", "../x.pdf", "--root", str(tmp_path)])
    assert res.exit_code != 0
