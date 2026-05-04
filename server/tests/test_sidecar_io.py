"""Unit tests for low-level sidecar I/O primitives."""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from unittest.mock import patch

import pytest

from services.sidecar_io import Corrupt, Loaded, Missing, atomic_write, read_sidecar


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


def test_read_sidecar_returns_missing_when_file_does_not_exist(tmp_path: Path) -> None:
    result = read_sidecar(tmp_path / ".Missing.doxmind")

    assert isinstance(result, Missing)


def test_read_sidecar_returns_corrupt_for_invalid_json(tmp_path: Path) -> None:
    path = tmp_path / ".Invalid.doxmind"
    raw = b'{"version": 1'
    path.write_bytes(raw)

    result = read_sidecar(path)

    assert isinstance(result, Corrupt)
    assert result.raw == raw
    assert result.reason


@pytest.mark.parametrize("payload", ["hello", [1, 2, 3]])
def test_read_sidecar_returns_corrupt_when_top_level_is_not_dict(
    tmp_path: Path,
    payload: object,
) -> None:
    path = tmp_path / ".Scalar.doxmind"
    raw = json.dumps(payload).encode()
    path.write_bytes(raw)

    result = read_sidecar(path)

    assert isinstance(result, Corrupt)
    assert result.raw == raw
    assert "not a dict" in result.reason


def test_read_sidecar_returns_corrupt_for_non_utf8_bytes(tmp_path: Path) -> None:
    path = tmp_path / ".Binary.doxmind"
    raw = b"\xff\xfe\xfa"
    path.write_bytes(raw)

    result = read_sidecar(path)

    assert isinstance(result, Corrupt)
    assert result.raw == raw
    assert result.reason


def test_read_sidecar_returns_loaded_for_valid_sidecar_json(tmp_path: Path) -> None:
    path = tmp_path / ".Valid.doxmind"
    data = {"version": 1, "html": "<p>ok</p>"}
    path.write_text(json.dumps(data), encoding="utf-8")

    result = read_sidecar(path)

    assert isinstance(result, Loaded)
    assert result.data == data
