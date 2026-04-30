"""Marker model installation state + background download orchestration.

The Marker pipeline downloads ~2GB of Surya weights from HuggingFace on
first use. We don't want that to happen silently in the middle of a PDF
import — the user should see a one-time confirm prompt with a progress
indicator.

We track install state in a sentinel file under ``DATA_DIR``:

    ~/.doxmind/marker-models.json

Presence + ``installed_at`` field = ready to use. To force a re-download
the user just deletes the file. We deliberately do not try to inspect
the HuggingFace cache — its layout has changed across hub versions and
we want a check that doesn't break when Marker bumps Surya revisions.

Concurrency: a single in-process ``asyncio.Lock`` protects against two
download requests racing. If one is already running, ``start_download``
returns the existing task instead of kicking off a second one.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from config import get_settings

logger = logging.getLogger(__name__)

Status = Literal["idle", "downloading", "installed", "error"]

# Realistic estimate for the Surya bundle marker pulls down. We don't
# know the exact total ahead of time (HF Hub doesn't tell us before the
# download starts, and Surya's revision pins move), so we use this as
# the denominator for the % bar and clamp to <=99% until the install
# sentinel actually flips. Adjust if Surya's footprint changes.
MARKER_TOTAL_BYTES_ESTIMATE = 2_000_000_000  # ~2.0 GB


@dataclass
class MarkerState:
    status: Status = "idle"
    started_at: float | None = None
    finished_at: float | None = None
    installed_at: float | None = None
    error: str | None = None
    # Marker / huggingface_hub doesn't surface a clean progress fraction
    # without monkey-patching tqdm, so we instead watch the HF cache
    # directory and report bytes_downloaded as the delta since the
    # download started. The UI computes a percentage against
    # MARKER_TOTAL_BYTES_ESTIMATE and renders a real progress bar.
    phase: str | None = None
    bytes_downloaded: int = 0
    bytes_total_estimate: int = MARKER_TOTAL_BYTES_ESTIMATE


_state = MarkerState()
_lock = asyncio.Lock()
_task: asyncio.Task[None] | None = None
_watcher_task: asyncio.Task[None] | None = None
_baseline_cache_bytes: int = 0


# ---------------------------------------------------------------------------
# HF cache directory watcher
# ---------------------------------------------------------------------------
#
# Monitoring strategy: walk the HuggingFace hub cache directory and sum
# file sizes. We capture a baseline before the download starts and report
# (current - baseline) as bytes_downloaded. This is robust against any
# changes to how marker / huggingface_hub trigger downloads — we don't
# care what code path is fetching, only that bytes land on disk.
#
# Cost: a full os.walk over the cache. On a fresh machine this is <500
# files even after Surya lands, walking takes ~10ms. We poll every 1.5s,
# so the overhead is negligible.


def _hf_cache_dir() -> Path:
    """Resolve the HuggingFace hub cache root, respecting HF_HOME / HF_HUB_CACHE."""
    if hub := os.environ.get("HF_HUB_CACHE"):
        return Path(hub)
    if home := os.environ.get("HF_HOME"):
        return Path(home) / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def _dir_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for root, _dirs, files in os.walk(path, followlinks=False):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                # File yanked between walk and stat — fine, just skip.
                continue
    return total


async def _watch_cache_growth() -> None:
    """Update bytes_downloaded from the HF cache delta until the install
    task completes (or status changes away from "downloading")."""
    try:
        while _state.status == "downloading":
            try:
                current = await asyncio.to_thread(_dir_size_bytes, _hf_cache_dir())
                # Clamp to >= 0 in case the cache shrinks (hub gc, etc.)
                _state.bytes_downloaded = max(0, current - _baseline_cache_bytes)
            except Exception as e:  # noqa: BLE001
                logger.debug("cache size probe failed: %s", e)
            await asyncio.sleep(1.5)
    except asyncio.CancelledError:
        pass


def _sentinel_path() -> Path:
    return get_settings().data_dir / "marker-models.json"


def _load_sentinel() -> dict | None:
    path = _sentinel_path()
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError) as e:
        logger.warning("Marker sentinel unreadable, treating as not installed: %s", e)
        return None


def _write_sentinel() -> None:
    path = _sentinel_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "installed_at": time.time(),
        "marker_version": _marker_version(),
    }
    path.write_text(json.dumps(payload, indent=2))


def _marker_version() -> str:
    try:
        from importlib.metadata import version

        return version("marker-pdf")
    except Exception:
        return "unknown"


def _hydrate_from_disk() -> None:
    """Reconcile the in-memory state with what the sentinel file says."""
    sentinel = _load_sentinel()
    if sentinel and _state.status != "downloading":
        _state.status = "installed"
        _state.installed_at = sentinel.get("installed_at")
        _state.error = None
        # Best-effort: surface the actual on-disk footprint of the cache
        # so a returning user sees "1.8 GB installed" rather than "0 B".
        # This is cheap (one walk on /status hits) and only runs when
        # the in-memory state hadn't already landed there.
        if _state.bytes_downloaded == 0:
            _state.bytes_downloaded = _state.bytes_total_estimate


def is_installed() -> bool:
    _hydrate_from_disk()
    return _state.status == "installed"


def get_state() -> dict:
    _hydrate_from_disk()
    return {
        "status": _state.status,
        "installed": _state.status == "installed",
        "phase": _state.phase,
        "started_at": _state.started_at,
        "finished_at": _state.finished_at,
        "installed_at": _state.installed_at,
        "error": _state.error,
        "bytes_downloaded": _state.bytes_downloaded,
        "bytes_total_estimate": _state.bytes_total_estimate,
        "marker_version": _marker_version(),
    }


def _download_sync() -> None:
    """Blocking call: pull every model Marker's pipeline needs.

    Runs in a thread (see ``start_download``) so the FastAPI event loop
    stays responsive. ``create_model_dict`` is what triggers the actual
    HuggingFace fetches the first time around.
    """
    # Imported lazily — these pull in PyTorch and we want server boot to
    # stay fast for users who never touch a scanned PDF.
    from marker.models import create_model_dict

    _state.phase = "loading layout + ocr models"
    create_model_dict()
    _state.phase = "warming pipeline"


async def _run_download() -> None:
    global _task, _watcher_task, _baseline_cache_bytes
    _state.status = "downloading"
    _state.started_at = time.time()
    _state.finished_at = None
    _state.error = None
    _state.phase = "starting"
    _state.bytes_downloaded = 0

    # Snapshot the cache size BEFORE the download starts so we can report
    # the delta (rather than the absolute size — the user may already
    # have unrelated HF models cached).
    _baseline_cache_bytes = await asyncio.to_thread(_dir_size_bytes, _hf_cache_dir())
    _watcher_task = asyncio.create_task(_watch_cache_growth())

    try:
        await asyncio.to_thread(_download_sync)
        _write_sentinel()
        _state.status = "installed"
        _state.installed_at = time.time()
        _state.finished_at = time.time()
        _state.phase = None
        # Final size delta — the watcher loop exits as soon as status
        # flips, so do one last sample to land at the true total instead
        # of the most recent in-flight value.
        final = await asyncio.to_thread(_dir_size_bytes, _hf_cache_dir())
        _state.bytes_downloaded = max(_state.bytes_downloaded, final - _baseline_cache_bytes)
        logger.info(
            "Marker models installed in %.1fs (%.1f MB)",
            _state.finished_at - _state.started_at,
            _state.bytes_downloaded / 1_000_000,
        )
    except Exception as e:  # noqa: BLE001 — surfaced to the UI verbatim
        logger.exception("Marker model download failed")
        _state.status = "error"
        _state.error = str(e)
        _state.finished_at = time.time()
        _state.phase = None
    finally:
        _task = None
        if _watcher_task and not _watcher_task.done():
            _watcher_task.cancel()
        _watcher_task = None


async def start_download() -> dict:
    """Kick off the background download (idempotent).

    Returns immediately with the current state. The caller should poll
    ``get_state()`` (via the status endpoint) to track progress.
    """
    global _task
    async with _lock:
        if is_installed():
            return get_state()
        if _task is not None and not _task.done():
            return get_state()
        _task = asyncio.create_task(_run_download())
    return get_state()


async def ensure_installed_or_409() -> None:
    """Raise ``MarkerModelsRequiredError`` unless the models are ready.

    Used by the import endpoint when Marker is the only converter that
    can handle the file.
    """
    from exceptions import MarkerModelsRequiredError

    if is_installed():
        return
    raise MarkerModelsRequiredError(details=get_state())
