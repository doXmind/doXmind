"""Durable-write behavior for Markdown Page source."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from services.markdown_source import atomic_write


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX permission bits")
def test_atomic_write_preserves_permissions_through_the_process_umask(tmp_path: Path) -> None:
    page_path = tmp_path / "Shared.md"
    page_path.write_bytes(b"Body\n")
    page_path.chmod(0o664)

    previous_umask = os.umask(0o022)
    try:
        atomic_write(page_path, b"Changed\n")
    finally:
        os.umask(previous_umask)

    assert page_path.read_bytes() == b"Changed\n"
    assert page_path.stat().st_mode & 0o777 == 0o664
