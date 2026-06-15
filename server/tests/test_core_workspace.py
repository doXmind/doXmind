"""S5 (ADR 0010): workspace-root confinement shared by the CLI and MCP shells.

The confinement primitives live in ``api.workspace``; these tests pin the core
entry point that re-exports them, focusing on escape attempts.
"""

import os

import pytest

from core.documents import read_document_in_root
from core.workspace import resolve_in_root, resolve_root


def test_resolve_in_root_accepts_relative(tmp_path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "note.md").write_text("hi", encoding="utf-8")
    resolved = resolve_in_root(tmp_path, "sub/note.md")
    assert resolved == tmp_path / "sub" / "note.md"


def test_resolve_in_root_accepts_absolute_inside_root(tmp_path):
    (tmp_path / "note.md").write_text("hi", encoding="utf-8")
    resolved = resolve_in_root(tmp_path, str(tmp_path / "note.md"))
    assert resolved == tmp_path / "note.md"


def test_resolve_in_root_rejects_dotdot_escape(tmp_path):
    with pytest.raises(ValueError):
        resolve_in_root(tmp_path, "../outside.md")


def test_resolve_in_root_rejects_absolute_outside(tmp_path):
    with pytest.raises(ValueError):
        resolve_in_root(tmp_path, "/etc/passwd")


def test_resolve_in_root_rejects_symlink_escape(tmp_path):
    outside = tmp_path.parent / "outside_target"
    outside.mkdir()
    (outside / "secret.md").write_text("secret", encoding="utf-8")
    link = tmp_path / "link"
    os.symlink(outside, link)
    with pytest.raises(ValueError):
        resolve_in_root(tmp_path, "link/secret.md")


def test_resolve_root_defaults_to_env(tmp_path, monkeypatch):
    monkeypatch.setenv("DOXMIND_WORKSPACE_ROOT", str(tmp_path))
    assert resolve_root(None) == tmp_path.resolve()


def test_read_document_in_root_confines(tmp_path):
    (tmp_path / "note.md").write_text("# Hi\n\nbody\n", encoding="utf-8")
    doc = read_document_in_root(tmp_path, "note.md")
    assert "body" in doc["markdown"]
    with pytest.raises(ValueError):
        read_document_in_root(tmp_path, "../escape.md")
