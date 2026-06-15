"""End-to-end CLI test: drives the real `python -m cli` entry as a subprocess
through a full document lifecycle. This exercises the actual process entry,
argument parsing, and exit codes — beyond what CliRunner covers.

`rm` is only tested in its abort path so no real file is sent to the OS Trash.
"""

import os
import subprocess
import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent


def _run(args, root, input_text=None):
    env = {**os.environ, "DOXMIND_WORKSPACE_ROOT": str(root)}
    return subprocess.run(
        [sys.executable, "-m", "cli", *args],
        cwd=SERVER_DIR,
        env=env,
        capture_output=True,
        text=True,
        input=input_text,
    )


def test_cli_full_lifecycle_subprocess(tmp_path):
    new = _run(["new", "notes/a.md", "--content", "# A\n\nalpha body"], tmp_path)
    assert new.returncode == 0, new.stderr
    assert (tmp_path / "notes" / "a.md").exists()

    ls = _run(["ls"], tmp_path)
    assert ls.returncode == 0, ls.stderr
    assert "notes/a.md" in ls.stdout

    search = _run(["search", "alpha"], tmp_path)
    assert search.returncode == 0, search.stderr
    assert "a.md" in search.stdout

    read = _run(["read", "notes/a.md"], tmp_path)
    assert "alpha body" in read.stdout

    edit = _run(["edit", "notes/a.md", "--content", "beta body"], tmp_path)
    assert edit.returncode == 0, edit.stderr
    assert "beta body" in _run(["read", "notes/a.md"], tmp_path).stdout

    out = tmp_path / "a.pdf"
    export = _run(["export", "notes/a.md", "--to", "pdf", "--out", str(out)], tmp_path)
    assert export.returncode == 0, export.stderr
    assert out.read_bytes().startswith(b"%PDF-")

    mv = _run(["mv", "notes/a.md", "notes/b.md", "--yes"], tmp_path)
    assert mv.returncode == 0, mv.stderr
    assert (tmp_path / "notes" / "b.md").exists()

    # rm without --yes and a "no" answer aborts: nothing is trashed.
    rm = _run(["rm", "notes/b.md"], tmp_path, input_text="n\n")
    assert rm.returncode != 0
    assert (tmp_path / "notes" / "b.md").exists()
