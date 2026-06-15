"""S7 (ADR 0010): structural ops — rename/move/delete/mkdir/import."""

import shutil
import tempfile
from pathlib import Path

import pytest
from typer.testing import CliRunner

import api.workspace as workspace_module
from cli.__main__ import app
from core.documents import create_document
from core.structure import create_folder, delete_document, import_document, move_document
from doxmind_mcp import server

runner = CliRunner()


def _hard_delete(path: Path) -> None:
    """Stand in for the OS-Trash move so the dev's real Trash isn't polluted."""
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


@pytest.fixture
def patched_trash(monkeypatch):
    monkeypatch.setattr(workspace_module, "_move_to_os_trash", _hard_delete)


def test_create_folder(tmp_path):
    create_folder(tmp_path, "notes")
    assert (tmp_path / "notes").is_dir()


def test_move_document_carries_sidecar(tmp_path):
    create_document(tmp_path, "a.md", markdown="body")
    move_document(tmp_path, "a.md", "b.md")
    assert (tmp_path / "b.md").exists() and not (tmp_path / "a.md").exists()
    assert (tmp_path / ".b.doxmind").exists() and not (tmp_path / ".a.doxmind").exists()


def test_delete_document_leaves_workspace(tmp_path, patched_trash):
    create_document(tmp_path, "gone.md", markdown="bye")
    result = delete_document(tmp_path, "gone.md")
    assert result["path"] == "gone.md"
    assert not (tmp_path / "gone.md").exists()
    assert not (tmp_path / ".gone.doxmind").exists()


def test_import_document_copies_and_keeps_source(tmp_path):
    src_dir = Path(tempfile.mkdtemp())
    try:
        source = src_dir / "external.md"
        source.write_text("# External\n\nimported\n", encoding="utf-8")
        dto = import_document(tmp_path, source, dest_folder="inbox")
        assert (tmp_path / "inbox" / "external.md").exists()
        assert source.exists()  # source untouched
        assert dto["path"].endswith("external.md")
    finally:
        shutil.rmtree(src_dir)


def test_cli_mkdir_mv_rm(tmp_path, patched_trash):
    create_document(tmp_path, "x.md", markdown="x")
    assert runner.invoke(app, ["mkdir", "sub", "--root", str(tmp_path)]).exit_code == 0
    mv = runner.invoke(app, ["mv", "x.md", "sub/x.md", "--root", str(tmp_path), "--yes"])
    assert mv.exit_code == 0, mv.output
    assert (tmp_path / "sub" / "x.md").exists()
    rm = runner.invoke(app, ["rm", "sub/x.md", "--root", str(tmp_path), "--yes"])
    assert rm.exit_code == 0, rm.output
    assert not (tmp_path / "sub" / "x.md").exists()


def test_cli_rm_aborts_without_confirmation(tmp_path, patched_trash):
    create_document(tmp_path, "keep.md", markdown="keep")
    res = runner.invoke(app, ["rm", "keep.md", "--root", str(tmp_path)], input="n\n")
    assert res.exit_code != 0
    assert (tmp_path / "keep.md").exists()


def test_mcp_structure_tools_confined(tmp_path, monkeypatch, patched_trash):
    monkeypatch.setenv("DOXMIND_WORKSPACE_ROOT", str(tmp_path))
    server.create_folder("agentdir")
    assert (tmp_path / "agentdir").is_dir()
    create_document(tmp_path, "doc.md", markdown="hi")
    server.rename_document("doc.md", "renamed.md")
    assert (tmp_path / "renamed.md").exists()
    server.delete_document("renamed.md")
    assert not (tmp_path / "renamed.md").exists()
    with pytest.raises(ValueError):
        server.delete_document("../escape.md")


def test_import_document_replace_preserves_sidecar(tmp_path):
    create_document(tmp_path, "existing.md", markdown="old body")
    sidecar = tmp_path / ".existing.doxmind"
    sidecar_bytes = sidecar.read_bytes()

    src_dir = Path(tempfile.mkdtemp())
    try:
        source = src_dir / "fresh.md"
        source.write_text("# Fresh\n\nnew body\n", encoding="utf-8")
        import_document(tmp_path, source, name="existing.md", mode="replace")
        assert "new body" in (tmp_path / "existing.md").read_text(encoding="utf-8")
        assert source.exists()  # source untouched
        # Replace leaves the sidecar intact so the next open trips the stale path.
        assert sidecar.read_bytes() == sidecar_bytes
    finally:
        shutil.rmtree(src_dir)


def test_move_partial_failure_surfaces_error(tmp_path, monkeypatch):
    create_document(tmp_path, "a.md", markdown="body")
    orig_rename = Path.rename

    def flaky_rename(self, target):
        if str(self).endswith(".doxmind"):
            raise OSError("simulated sidecar rename failure")
        return orig_rename(self, target)

    monkeypatch.setattr(Path, "rename", flaky_rename)
    with pytest.raises(RuntimeError):
        move_document(tmp_path, "a.md", "b.md")
    # The document moved even though the sidecar rename failed; the error makes
    # that half-moved state explicit instead of returning silently.
    assert (tmp_path / "b.md").exists()
    assert not (tmp_path / "a.md").exists()


def test_mcp_import_confines_source_to_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("DOXMIND_WORKSPACE_ROOT", str(tmp_path))
    create_document(tmp_path, "src.md", markdown="inside")
    # In-workspace copy is allowed.
    server.import_document("src.md", dest_folder="copies")
    assert (tmp_path / "copies" / "src.md").exists()
    # An external/absolute source is rejected (no arbitrary filesystem read).
    with pytest.raises(ValueError):
        server.import_document("/etc/hosts")
    with pytest.raises(ValueError):
        server.import_document("../escape.md")
