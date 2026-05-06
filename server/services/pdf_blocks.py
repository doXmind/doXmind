"""PyMuPDF-backed paragraph block extraction.

Returns the layout-aware block / line / span tree for a PDF. This is the
foundation of the paragraph-mode PDF editor: each block becomes a flowable
paragraph in the frontend with its own bounding box and span styles.

PyMuPDF (MuPDF) handles paragraph clustering, reading order, and column
detection — algorithms that are deliberately *not* reimplemented in the
frontend, since heuristics there would be fragile.
"""

from __future__ import annotations

import copy
import hashlib
import io
import os
from collections import OrderedDict
from collections.abc import Iterable
from dataclasses import dataclass
from threading import Lock
from typing import Any

import pymupdf

from lib.timing import record as perf_record
from lib.timing import timed as perf_timed

# PyMuPDF span flag bits (see MuPDF docs).
_FLAG_ITALIC = 1 << 1
_FLAG_BOLD = 1 << 4

# Process-local LRU cache of parsed PDF block trees keyed on the SHA-256 of
# the input bytes plus the requested page-index tuple. Hashing 8 MB of bytes
# is ~10ms in Python; the parse it skips is hundreds of ms even on small
# PDFs and seconds on big ones, so the trade is heavily one-sided. The hash
# also doubles as a content-fingerprint, so any modification to the source
# PDF invalidates the cache automatically.
_PDF_CACHE_MAX = 16
_PDF_CACHE: OrderedDict[tuple, dict[str, Any]] = OrderedDict()
_PDF_CACHE_LOCK = Lock()


def _pdf_cache_disabled() -> bool:
    return os.environ.get("DOXMIND_DISABLE_PDF_CACHE", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _clear_pdf_cache() -> None:
    """For tests / benchmarks."""
    with _PDF_CACHE_LOCK:
        _PDF_CACHE.clear()


def _color_to_hex(value: Any) -> str:
    """Convert PyMuPDF's integer color to '#rrggbb'.

    PyMuPDF returns sRGB packed as an int; black is 0 in some cases.
    """
    if value is None:
        return "#111111"
    try:
        intval = int(value)
    except (TypeError, ValueError):
        return "#111111"
    intval &= 0xFFFFFF
    return f"#{intval:06x}"


def _round_bbox(bbox: Iterable[float]) -> list[float]:
    return [round(float(v), 3) for v in bbox]


@dataclass(slots=True)
class ParseBlocksLimits:
    """Guardrails for malicious / oversized inputs."""

    max_pages: int = 500
    max_blocks_per_page: int = 5000
    max_spans_per_page: int = 50000


def parse_pdf_blocks(
    pdf_bytes: bytes,
    *,
    page_indexes: list[int] | None = None,
    limits: ParseBlocksLimits | None = None,
) -> dict[str, Any]:
    """Extract layout-aware paragraph blocks from a PDF.

    Coordinates are returned in PDF user space with the origin at the
    top-left of each page (matching what the frontend canvas uses).

    Args:
        pdf_bytes: raw PDF bytes.
        page_indexes: zero-based page indexes to extract; ``None`` = all pages.
        limits: optional safety limits.

    Returns a dict with shape::

        {
          "version": 2,
          "pageCount": <int>,
          "pages": [
            {
              "pageIndex": 0,
              "width": 612.0,
              "height": 792.0,
              "blocks": [
                {
                  "id": "p0-b0",
                  "bbox": [x0, y0, x1, y1],
                  "lines": [
                    {
                      "bbox": [...],
                      "spans": [
                        {
                          "text": "...",
                          "bbox": [...],
                          "font": "Helvetica",
                          "size": 12.0,
                          "color": "#111111",
                          "bold": false,
                          "italic": false,
                          "flags": 0
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
    """
    if not pdf_bytes:
        raise ValueError("pdf_bytes is empty")

    limits = limits or ParseBlocksLimits()

    cache_key: tuple | None = None
    if not _pdf_cache_disabled():
        with perf_timed("pdf.parse_blocks.hash", bytes=len(pdf_bytes)):
            content_hash = hashlib.sha256(pdf_bytes).hexdigest()
        cache_key = (
            content_hash,
            tuple(page_indexes) if page_indexes is not None else None,
        )
        with _PDF_CACHE_LOCK:
            cached = _PDF_CACHE.get(cache_key)
            if cached is not None:
                _PDF_CACHE.move_to_end(cache_key)
                perf_record("pdf.parse_blocks.cache_hit")
                # Deep-clone so a future caller that mutates the block tree
                # (filter, merge, downstream transform) can't corrupt the
                # entry. Block trees are bounded by `limits` (5k blocks /
                # 50k spans per page) so the copy is fast relative to the
                # hundreds of ms a re-parse would cost.
                return copy.deepcopy(cached)

    pages_out: list[dict[str, Any]] = []
    with perf_timed(
        "pdf.parse_blocks.total",
        bytes=len(pdf_bytes),
    ) as total_span, pymupdf.open(stream=io.BytesIO(pdf_bytes), filetype="pdf") as doc:
        page_count = doc.page_count
        total_span["page_count"] = page_count
        if page_count > limits.max_pages:
            raise ValueError(f"PDF has {page_count} pages; max allowed is {limits.max_pages}")

        wanted = (
            list(range(page_count))
            if page_indexes is None
            else [i for i in page_indexes if 0 <= i < page_count]
        )
        total_span["pages_requested"] = len(wanted)

        for page_index in wanted:
            with perf_timed("pdf.parse_blocks.page", page=page_index):
                page = doc.load_page(page_index)
                rect = page.rect
                text_dict = page.get_text("dict")
                pages_out.append(
                    _extract_page_blocks(
                        text_dict, rect=rect, page_index=page_index, limits=limits
                    )
                )

    result = {
        "version": 2,
        "pageCount": page_count,
        "pages": pages_out,
    }

    if cache_key is not None:
        with _PDF_CACHE_LOCK:
            # Cache an independent copy so the returned `result` (which the
            # caller may freely mutate) and the cache entry are decoupled
            # from insertion onward.
            _PDF_CACHE[cache_key] = copy.deepcopy(result)
            _PDF_CACHE.move_to_end(cache_key)
            while len(_PDF_CACHE) > _PDF_CACHE_MAX:
                _PDF_CACHE.popitem(last=False)

    return result


def _extract_page_blocks(
    text_dict: dict[str, Any],
    *,
    rect: Any,
    page_index: int,
    limits: ParseBlocksLimits,
) -> dict[str, Any]:
    blocks_out: list[dict[str, Any]] = []
    span_count = 0
    for block_index, block in enumerate(text_dict.get("blocks", [])):
        if block.get("type") != 0:
            # type 1 = image block; we don't surface these as paragraphs.
            continue
        if len(blocks_out) >= limits.max_blocks_per_page:
            break

        lines_out: list[dict[str, Any]] = []
        for line in block.get("lines", []):
            spans_out: list[dict[str, Any]] = []
            for span in line.get("spans", []):
                text = span.get("text", "")
                if not text:
                    continue
                flags = int(span.get("flags", 0))
                spans_out.append(
                    {
                        "text": text,
                        "bbox": _round_bbox(span.get("bbox", (0, 0, 0, 0))),
                        "font": span.get("font", "") or "",
                        "size": round(float(span.get("size", 0.0)), 3),
                        "color": _color_to_hex(span.get("color")),
                        "flags": flags,
                        "bold": bool(flags & _FLAG_BOLD),
                        "italic": bool(flags & _FLAG_ITALIC),
                    }
                )
                span_count += 1
                if span_count >= limits.max_spans_per_page:
                    break
            if spans_out:
                lines_out.append(
                    {
                        "bbox": _round_bbox(line.get("bbox", (0, 0, 0, 0))),
                        "spans": spans_out,
                    }
                )
            if span_count >= limits.max_spans_per_page:
                break

        if lines_out:
            blocks_out.append(
                {
                    "id": f"p{page_index}-b{block_index}",
                    "bbox": _round_bbox(block.get("bbox", (0, 0, 0, 0))),
                    "lines": lines_out,
                }
            )
        if span_count >= limits.max_spans_per_page:
            break

    return {
        "pageIndex": page_index,
        "width": round(rect.width, 3),
        "height": round(rect.height, 3),
        "blocks": blocks_out,
    }
