"""PyMuPDF-backed paragraph block extraction.

Returns the layout-aware block / line / span tree for a PDF. This is the
foundation of the paragraph-mode PDF editor: each block becomes a flowable
paragraph in the frontend with its own bounding box and span styles.

PyMuPDF (MuPDF) handles paragraph clustering, reading order, and column
detection — algorithms that are deliberately *not* reimplemented in the
frontend, since heuristics there would be fragile.
"""

from __future__ import annotations

import io
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

import pymupdf

# PyMuPDF span flag bits (see MuPDF docs).
_FLAG_ITALIC = 1 << 1
_FLAG_BOLD = 1 << 4


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

    pages_out: list[dict[str, Any]] = []
    with pymupdf.open(stream=io.BytesIO(pdf_bytes), filetype="pdf") as doc:
        page_count = doc.page_count
        if page_count > limits.max_pages:
            raise ValueError(f"PDF has {page_count} pages; max allowed is {limits.max_pages}")

        wanted = (
            list(range(page_count))
            if page_indexes is None
            else [i for i in page_indexes if 0 <= i < page_count]
        )

        for page_index in wanted:
            page = doc.load_page(page_index)
            rect = page.rect
            text_dict = page.get_text("dict")

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

            pages_out.append(
                {
                    "pageIndex": page_index,
                    "width": round(rect.width, 3),
                    "height": round(rect.height, 3),
                    "blocks": blocks_out,
                }
            )

    return {
        "version": 2,
        "pageCount": page_count,
        "pages": pages_out,
    }
