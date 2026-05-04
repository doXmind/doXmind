"""Unit tests for low-level sidecar I/O primitives."""

from __future__ import annotations

import os
import stat
from pathlib import Path
from unittest.mock import patch

import pytest

from services.sidecar_io import atomic_write


def test_atomic_write_fsyncs_temp_file_before_rename(tmp_path: Path) -> None:
    target = tmp_path / "Doc.doxmind"
    fsync_paths: list[Path] = []

    def capture_fsync(fd: int) -> None:
        tmp_files = list(tmp_path.glob(f".{target.name}.tmp-*"))
        if tmp_files:
            fd_stat = os.fstat(fd)
            for tmp_file in tmp_files:
                tmp_stat = tmp_file.stat()
                if (fd_stat.st_dev, fd_stat.st_ino) == (tmp_stat.st_dev, tmp_stat.st_ino):
                    fsync_paths.append(tmp_file)

    with patch("os.fsync", side_effect=capture_fsync) as fsync:
        atomic_write(target, b'{"ok": true}')

    assert fsync.call_count >= 1
    assert any(path.name.startswith(f".{target.name}.tmp-") for path in fsync_paths)


def test_atomic_write_fsyncs_parent_directory_after_rename(tmp_path: Path) -> None:
    target = tmp_path / "Doc.doxmind"
    directory_fsyncs = 0

    def capture_fsync(fd: int) -> None:
        nonlocal directory_fsyncs
        if stat.S_ISDIR(os.fstat(fd).st_mode):
            directory_fsyncs += 1

    with patch("os.fsync", side_effect=capture_fsync) as fsync:
        atomic_write(target, b'{"ok": true}')

    assert fsync.call_count >= 1
    if os.name != "nt":
        assert directory_fsyncs >= 1


def test_atomic_write_cleans_up_temp_file_when_replace_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "Doc.doxmind"

    def fail_replace(self: Path, target: Path) -> Path:
        raise OSError("simulated replace failure")

    monkeypatch.setattr(Path, "replace", fail_replace)

    with pytest.raises(OSError, match="simulated replace failure"):
        atomic_write(target, b'{"ok": true}')

    assert list(tmp_path.glob(f".{target.name}.tmp-*")) == []
