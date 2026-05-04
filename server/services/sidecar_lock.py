"""Advisory locks for sidecar migration.

The lock is POSIX-only for now: Unix-like systems use ``fcntl.flock`` on
``<sidecar>.lock``. Windows currently uses a no-op lock so the desktop
runtime keeps working there until a Windows-specific file lock is added.
"""

from __future__ import annotations

import logging
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

logger = logging.getLogger(__name__)


@contextmanager
def _locked_sidecar(sidecar_path: Path) -> Iterator[None]:
    """Acquire an advisory per-sidecar migration lock.

    POSIX platforms use ``fcntl.flock`` against ``<sidecar>.lock``.
    Windows is a no-op for now because ``fcntl`` is not available there.
    """
    lock_path = sidecar_path.parent / f"{sidecar_path.name}.lock"
    if sys.platform == "win32":
        # Windows lacks fcntl; a Windows-specific locking backend can be added separately.
        logger.debug("sidecar migration lock is a no-op on Windows: %s", lock_path)
        yield
        return

    import fcntl

    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as lock_file:
        # flock is advisory and local-host oriented; do not rely on this for NFS/cross-host safety.
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    # Do not delete the lock file: advisory locks live with the inode, and deleting/recreating
    # the file can break correctness for concurrent waiters.
