"""Advisory locks for sidecar migration.

Unix-like systems use ``fcntl.flock`` on ``<sidecar>.lock``; Windows uses
``msvcrt.locking`` on the same file. Both are advisory, local-host locks —
do not rely on them for NFS/cross-host safety.
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

    POSIX platforms use ``fcntl.flock`` against ``<sidecar>.lock``; Windows
    uses ``msvcrt.locking`` on the first byte of the same file. Both block
    until the lock is granted, mirroring ``LOCK_EX`` semantics.
    """
    lock_path = sidecar_path.parent / f"{sidecar_path.name}.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    if sys.platform == "win32":
        import msvcrt

        with lock_path.open("a+b") as lock_file:
            # LK_LOCK waits ~1s between 10 attempts then raises OSError; loop
            # so contention blocks indefinitely like flock(LOCK_EX) instead of
            # failing. The critical section (one sidecar rewrite) is short.
            lock_file.seek(0)
            while True:
                try:
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
                    break
                except OSError:
                    continue
            try:
                yield
            finally:
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
        # Like the POSIX branch: never delete the lock file — concurrent
        # waiters may hold a handle to it, and delete/recreate races would
        # hand two processes different files to lock.
        return

    import fcntl

    with lock_path.open("a+b") as lock_file:
        # flock is advisory and local-host oriented; do not rely on this for NFS/cross-host safety.
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    # Do not delete the lock file: advisory locks live with the inode, and deleting/recreating
    # the file can break correctness for concurrent waiters.
