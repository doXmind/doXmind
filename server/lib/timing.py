"""Lightweight perf timing for the local sidecar.

Opt-in via DOXMIND_PERF env var (1/true/yes/on). When enabled every span is
appended as one JSON line to ~/.doxmind/perf.log so a separate aggregator
(scripts/perf-summary.mjs) can compute p50/p95.

Disabled mode pays one env-var lookup at import time and a single boolean
check per `timed(...)` call — no log I/O, no allocation beyond the generator
frame.

Usage:

    from lib.timing import timed, record

    with timed("doc_read.hash_markdown", path=str(path), bytes=size):
        digest = hash_markdown(raw)

    # Zero-duration event for "this happened" markers (e.g. cache hits):
    record("excel.parse_workbook.cache_hit", path=str(path))

Extra kwargs are emitted as fields alongside the duration so we can group
results by file size, page count, etc., without adding more span names.

Note on log growth: every HTTP request gets a `request.total` line via the
FastAPI middleware, plus all explicit spans. A few hundred KB per minute
of heavy use is typical. The file is unbounded — leaving DOXMIND_PERF=1
on for a multi-hour session can produce many MB. Truncate manually
(`> ~/.doxmind/perf.log`) between bench runs if needed; rotation is
deliberately not implemented since this is a debug-only path.
"""

from __future__ import annotations

import contextlib
import json
import os
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any


def _flag() -> bool:
    raw = os.environ.get("DOXMIND_PERF", "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


_ENABLED = _flag()
_LOG_PATH = Path(os.environ.get("DOXMIND_PERF_LOG") or Path.home() / ".doxmind" / "perf.log")
_LOCK = threading.Lock()
_INIT_DONE = False


def _ensure_log_dir() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with contextlib.suppress(OSError):
        _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    _INIT_DONE = True


def _emit(record: dict[str, Any]) -> None:
    _ensure_log_dir()
    try:
        line = json.dumps(record, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        return
    with _LOCK:
        try:
            with _LOG_PATH.open("a", encoding="utf-8") as fp:
                fp.write(line)
                fp.write("\n")
        except OSError:
            # Never let perf logging break the request path.
            pass


@contextmanager
def timed(name: str, **fields: Any) -> Iterator[dict[str, Any]]:
    """Time a code block. Yields a mutable dict to attach late fields.

    Late-attaching is useful when a length / page count / size only becomes
    known mid-block:

        with timed("excel.parse_workbook") as span:
            wb = openpyxl.load_workbook(...)
            span["sheet_count"] = len(wb.sheetnames)
            ...
    """
    if not _ENABLED:
        # Yield an empty dict so callers can still write to it without
        # checking; the dict is just garbage-collected.
        yield {}
        return

    span: dict[str, Any] = dict(fields)
    start = time.perf_counter()
    try:
        yield span
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        record = {
            "ts": time.time(),
            "name": name,
            "ms": round(elapsed_ms, 3),
            **span,
        }
        _emit(record)


def record(name: str, **fields: Any) -> None:
    """Emit a single zero-duration span. Use for cache-hit / event markers.

    Equivalent to `with timed(name, **fields): pass`, but without the empty
    `with` block (which reads as if the work was supposed to go inside).
    """
    if not _ENABLED:
        return
    _emit(
        {
            "ts": time.time(),
            "name": name,
            "ms": 0.0,
            **fields,
        }
    )


def is_enabled() -> bool:
    return _ENABLED


def log_path() -> Path:
    return _LOG_PATH
