"""MarkdownDocumentState: single entry point for Document read/write.

A Document on disk is a `.md` file plus its hidden same-name `.doxmind`
sidecar. This module owns frontmatter parsing, sidecar version + hash
reconciliation, salvage of `extras` when the sidecar is stale, atomic
sidecar writes, and `meta.id` backfill from the sidecar.

`read()` returns a sealed `ReadOutcome` union with four variants:
`UsedSidecar`, `SidecarStale`, `NoSidecar`, `EmptyDocument`. Callers
branch on the variant rather than inspecting shape. `correlation` is
populated by the optional `Correlator` (typically `BlockCorrelation`
backed by the canonical `ExternalRefBlockRegistry`); it is `None` when
no correlator is configured.
"""

from __future__ import annotations

import copy
import json
import os
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any, Protocol

from lib.timing import record as perf_record
from lib.timing import timed as perf_timed
from services.block_correlation import CorrelationReport, CorrelationResult
from services.sidecar_io import (
    SIDECAR_VERSION,
    Corrupt,
    CorruptSidecarError,
    Loaded,
    Missing,
    atomic_write,
    build_md_with_frontmatter,
    hash_markdown,
    markdown_to_html,
    now_iso,
    parse_frontmatter,
    read_sidecar,
    sidecar_path_for,
)

# Process-local LRU cache for read() results, keyed on (path, file mtime,
# file size, sidecar mtime, sidecar size). The `markdown_to_html` step on
# the no-sidecar branch is by far the dominant cost (~535ms on a 4MB file
# in benchmarks), so keeping a few hundred recent ReadOutcomes in memory
# turns repeat opens into a lookup. The correlator/salvager identity is
# intentionally *not* part of the key — production wires them once per
# process, and tests that pass custom variants should call
# `_clear_read_cache()` between cases (or set `DOXMIND_DISABLE_DOC_CACHE=1`).
#
# Cap sizing: 128 entries comfortably covers a heavy-rotation vault (the
# usual 5-20 active docs plus headroom for hover-prefetch). Each cached
# ReadOutcome holds a parsed body + HTML + extras; for a typical 50 KB
# markdown that's roughly 0.5-1 MB at the cap — small next to the editor
# and PM state already resident.
_READ_CACHE_MAX = 128
_READ_CACHE: OrderedDict[tuple, ReadOutcome] = OrderedDict()
_READ_CACHE_LOCK = Lock()


def _read_cache_disabled() -> bool:
    return os.environ.get("DOXMIND_DISABLE_DOC_CACHE", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _read_cache_key(path: Path) -> tuple | None:
    try:
        st = path.stat()
    except OSError:
        return None
    sidecar_path = sidecar_path_for(path)
    try:
        ss = sidecar_path.stat()
        sidecar_mtime: int | None = ss.st_mtime_ns
        sidecar_size: int | None = ss.st_size
    except OSError:
        sidecar_mtime = None
        sidecar_size = None
    # Resolve before stringifying so `/foo/bar.md`, `/foo/./bar.md` and a
    # symlinked path don't fan out into separate cache entries (and, more
    # importantly, don't appear cache-hot then mysteriously cache-miss
    # depending on which form a future caller passes in). resolve() does a
    # stat itself but we already paid for stat above; this is microseconds.
    try:
        canonical = str(path.resolve())
    except OSError:
        canonical = str(path)
    return (
        canonical,
        st.st_mtime_ns,
        st.st_size,
        sidecar_mtime,
        sidecar_size,
    )


def _clone_outcome(outcome: ReadOutcome) -> ReadOutcome:
    """Return a deep copy so callers can mutate `meta` / `extras` safely.

    The ReadOutcome dataclasses are frozen, but their `meta` and `extras`
    fields are plain dicts. Without this, two `read()` calls on the same
    cache key would hand back the same dict instance, and any mutation by
    one caller would corrupt every subsequent cache hit. The dicts are
    small (frontmatter + a handful of extras slots) so deepcopy cost is
    negligible relative to skipping the markdown_to_html parse.
    """
    return copy.deepcopy(outcome)


def _clear_read_cache() -> None:
    """Clear the process-local read cache. For tests + benchmarks."""
    with _READ_CACHE_LOCK:
        _READ_CACHE.clear()


class Salvager(Protocol):
    """Decides which extras slots survive when a Sidecar goes stale."""

    def salvage(
        self,
        *,
        markdown_body: str,
        extras: dict[str, Any],
    ) -> tuple[dict[str, Any], list[str]]: ...


class _KeepAllSalvager:
    """Default salvager: carry every `extras` slot through a stale read (#147).

    The markdown hash governs only whether the cached editor HTML is reused or
    re-derived — it must not decide whether `extras` survive. Which slots
    actually persist is gated downstream by the `<!-- ... -->` markers still in
    the body (registry blocks via the correlator, databases in the frontend),
    so carrying everything through is safe: deleted markers still drop their
    data, surviving markers keep theirs. Discarding here instead let the next
    save permanently erase sidecar-only data (databases).
    """

    def salvage(
        self,
        *,
        markdown_body: str,  # noqa: ARG002
        extras: dict[str, Any],
    ) -> tuple[dict[str, Any], list[str]]:
        return dict(extras), []


class Correlator(Protocol):
    def correlate(
        self,
        *,
        markdown_body: str,
        extras: dict[str, Any],
    ) -> CorrelationResult: ...


@dataclass(frozen=True)
class DocumentSnapshot:
    html: str
    markdown: str
    meta: dict[str, Any]
    extras: dict[str, Any] | None = None


@dataclass(frozen=True)
class UsedSidecar:
    html: str
    markdown: str
    meta: dict[str, Any]
    extras: dict[str, Any] | None
    correlation: CorrelationReport | None = None


@dataclass(frozen=True)
class SidecarStale:
    fresh_html: str
    markdown: str
    meta: dict[str, Any]
    salvaged_extras: dict[str, Any]
    discarded_slots: list[str]
    correlation: CorrelationReport | None = None


@dataclass(frozen=True)
class NoSidecar:
    html: str
    markdown: str
    meta: dict[str, Any]
    correlation: CorrelationReport | None = None


@dataclass(frozen=True)
class EmptyDocument:
    meta: dict[str, Any]
    correlation: CorrelationReport | None = None


ReadOutcome = UsedSidecar | SidecarStale | NoSidecar | EmptyDocument


class MarkdownDocumentState:
    def __init__(
        self,
        salvager: Salvager | None = None,
        correlator: Correlator | None = None,
    ) -> None:
        self._salvager: Salvager = salvager or _KeepAllSalvager()
        self._correlator = correlator

    def read(self, path: Path) -> ReadOutcome:
        if not path.is_absolute():
            raise ValueError("document path must be absolute")
        # Cache lookup is split out of the perf-instrumented body below so
        # cache hits don't show up as `doc_read.total` spans (they'd skew
        # p50/p95). Hits are tagged with their own span instead.
        cache_key = None if _read_cache_disabled() else _read_cache_key(path)
        if cache_key is not None:
            with _READ_CACHE_LOCK:
                cached = _READ_CACHE.get(cache_key)
                if cached is not None:
                    _READ_CACHE.move_to_end(cache_key)
                    perf_record("doc_read.cache_hit", path=str(path))
                    # Deep-clone so caller mutations of `meta` / `extras`
                    # don't leak back into the cache. See _clone_outcome.
                    return _clone_outcome(cached)

        result = self._read_uncached(path)

        if cache_key is not None:
            with _READ_CACHE_LOCK:
                # Store a clone too so the returned `result` (which the
                # caller might mutate in-place) and the cached copy are
                # decoupled from the moment of insertion onward.
                _READ_CACHE[cache_key] = _clone_outcome(result)
                _READ_CACHE.move_to_end(cache_key)
                while len(_READ_CACHE) > _READ_CACHE_MAX:
                    _READ_CACHE.popitem(last=False)

        return result

    def _read_uncached(self, path: Path) -> ReadOutcome:
        with perf_timed("doc_read.total", path=str(path)) as total_span:
            with perf_timed("doc_read.read_text"):
                raw = path.read_text(encoding="utf-8")
            total_span["bytes"] = len(raw)

            with perf_timed("doc_read.parse_frontmatter"):
                meta, body = parse_frontmatter(raw)
            with perf_timed("doc_read.hash_markdown", bytes=len(raw)):
                current_hash = hash_markdown(raw)
            sidecar_path = sidecar_path_for(path)
            with perf_timed("doc_read.read_sidecar"):
                sidecar_result = read_sidecar(sidecar_path)

            if isinstance(sidecar_result, Loaded):
                sidecar = sidecar_result.data
                sidecar_id = sidecar.get("id")
                if sidecar_id and meta.get("id") != sidecar_id:
                    meta["id"] = sidecar_id

                version_ok = sidecar.get("version") == SIDECAR_VERSION
                hash_ok = sidecar.get("markdown_hash") == current_hash
                if version_ok and hash_ok:
                    extras = sidecar.get("extras")
                    if not isinstance(extras, dict) and extras is not None:
                        extras = None
                    with perf_timed("doc_read.correlate", branch="sidecar_fresh"):
                        correlation_result = self._correlate(markdown_body=body, extras=extras)
                    total_span["branch"] = "sidecar_fresh"
                    return UsedSidecar(
                        html=sidecar.get("html") or "",
                        markdown=body,
                        meta=meta,
                        extras=_extras_from_correlation_result(extras, correlation_result),
                        correlation=_report_from_correlation_result(correlation_result),
                    )

                existing_extras = sidecar.get("extras")
                extras_for_salvage = (
                    existing_extras if isinstance(existing_extras, dict) else {}
                )
                with perf_timed("doc_read.salvage"):
                    salvaged, discarded = self._salvager.salvage(
                        markdown_body=body, extras=extras_for_salvage
                    )
                with perf_timed("doc_read.correlate", branch="sidecar_stale"):
                    correlation_result = self._correlate(markdown_body=body, extras=salvaged)
                with perf_timed("doc_read.markdown_to_html", branch="sidecar_stale"):
                    fresh_html = "" if not body.strip() else markdown_to_html(body)
                total_span["branch"] = "sidecar_stale"
                return SidecarStale(
                    fresh_html=fresh_html,
                    markdown="" if not body.strip() else body,
                    meta=meta,
                    salvaged_extras=_extras_from_correlation_result(salvaged, correlation_result)
                    or {},
                    discarded_slots=discarded,
                    correlation=_report_from_correlation_result(correlation_result),
                )

            if isinstance(sidecar_result, Corrupt):
                forensic_path = _write_forensic_copy(sidecar_path, sidecar_result.raw)
                raise CorruptSidecarError(
                    sidecar_path,
                    forensic_path,
                    sidecar_result.reason,
                )

            if not isinstance(sidecar_result, Missing):
                raise TypeError(
                    f"unexpected sidecar read result: {type(sidecar_result).__name__}"
                )

            if not body.strip():
                with perf_timed("doc_read.correlate", branch="empty"):
                    correlation_result = self._correlate(markdown_body="", extras={})
                total_span["branch"] = "empty"
                return EmptyDocument(
                    meta=meta,
                    correlation=_report_from_correlation_result(correlation_result),
                )

            with perf_timed("doc_read.correlate", branch="no_sidecar"):
                correlation_result = self._correlate(markdown_body=body, extras={})
            with perf_timed("doc_read.markdown_to_html", branch="no_sidecar"):
                html = markdown_to_html(body)
            total_span["branch"] = "no_sidecar"
            return NoSidecar(
                html=html,
                markdown=body,
                meta=meta,
                correlation=_report_from_correlation_result(correlation_result),
            )

    def write_full(self, path: Path, snapshot: DocumentSnapshot) -> None:
        meta = dict(snapshot.meta)
        if not str(meta.get("id") or "").strip():
            raise ValueError("document id is required")
        meta.setdefault("updated", now_iso())

        md_content = build_md_with_frontmatter(meta, snapshot.markdown)
        atomic_write(path, md_content.encode("utf-8"))

        sidecar: dict[str, Any] = {
            "version": SIDECAR_VERSION,
            "id": meta["id"],
            "html": snapshot.html,
            "markdown_hash": hash_markdown(md_content),
            "updated_at": now_iso(),
        }
        if snapshot.extras is not None:
            sidecar["extras"] = snapshot.extras
        atomic_write(
            sidecar_path_for(path),
            json.dumps(sidecar, indent=2, ensure_ascii=False).encode(),
        )

    def write_slot(self, path: Path, slot_key: str, value: Any) -> None:
        if not path.is_absolute():
            raise ValueError("document path must be absolute")
        sidecar_path = sidecar_path_for(path)
        existing = read_sidecar(sidecar_path)

        if isinstance(existing, Missing):
            raw = path.read_text(encoding="utf-8")
            sidecar: dict[str, Any] = {
                "version": SIDECAR_VERSION,
                "markdown_hash": hash_markdown(raw),
                "extras": {slot_key: value},
                "updated_at": now_iso(),
            }
        elif isinstance(existing, Loaded):
            sidecar = dict(existing.data)
            extras_obj = sidecar.get("extras")
            extras = dict(extras_obj) if isinstance(extras_obj, dict) else {}
            extras[slot_key] = value
            sidecar["extras"] = extras
            sidecar["updated_at"] = now_iso()
        elif isinstance(existing, Corrupt):
            forensic_path = _write_forensic_copy(sidecar_path, existing.raw)
            raise CorruptSidecarError(sidecar_path, forensic_path, existing.reason)
        else:
            raise TypeError(f"unexpected sidecar read result: {type(existing).__name__}")

        atomic_write(
            sidecar_path,
            json.dumps(sidecar, indent=2, ensure_ascii=False).encode(),
        )

    def _correlate(
        self,
        *,
        markdown_body: str,
        extras: dict[str, Any] | None,
    ) -> CorrelationResult | None:
        if self._correlator is None:
            return None
        return self._correlator.correlate(
            markdown_body=markdown_body,
            extras=extras if isinstance(extras, dict) else {},
        )


def _report_from_correlation_result(
    correlation_result: CorrelationResult | None,
) -> CorrelationReport | None:
    if correlation_result is None:
        return None
    return correlation_result.report


def _extras_from_correlation_result(
    original_extras: dict[str, Any] | None,
    correlation_result: CorrelationResult | None,
) -> dict[str, Any] | None:
    if correlation_result is None:
        return original_extras
    if original_extras is None and not correlation_result.resolved_extras:
        return None
    return correlation_result.resolved_extras


def _write_forensic_copy(sidecar_path: Path, raw: bytes) -> Path:
    timestamp = now_iso().replace(":", "-")
    forensic_path = sidecar_path.parent / f"{sidecar_path.name}.corrupt-{timestamp}"
    atomic_write(forensic_path, raw)
    return forensic_path
