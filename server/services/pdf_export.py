"""PyMuPDF-backed PDF export with true content-stream rewriting.

Replaces the legacy pdf-lib overlay export. For each text edit we:

1. Mark the original rect with ``add_redact_annot`` (true glyph erasure).
2. Call ``apply_redactions`` once per page (atomic erase pass).
3. Re-flow the replacement text into the same rect using ``insert_htmlbox``
   — MuPDF's Story API handles word-wrap, alignment, multi-style spans,
   and highlight backgrounds with zero manual layout code.

Highlights become semi-transparent fills via ``draw_rect``. Free-text uses
``insert_htmlbox`` directly (no redaction needed since these are new
annotations, not replacements).

Coordinate system: all rects are PDF user space with the origin at the
top-left of each page (the same convention `parse_pdf_blocks` returns).
"""

from __future__ import annotations

import html
import io
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

import pymupdf

# Alignment values consumed by `pymupdf.TEXT_ALIGN_*`. We re-export numeric
# constants so the module has no runtime dependency on the alias names.
_ALIGN_LEFT = 0
_ALIGN_CENTER = 1
_ALIGN_RIGHT = 2


@dataclass(slots=True)
class ExportLimits:
    """Guardrails for malicious / oversized inputs."""

    max_pages: int = 500
    max_edits_per_page: int = 5000


def export_edited_pdf(
    pdf_bytes: bytes,
    edits: dict[str, Any],
    *,
    limits: ExportLimits | None = None,
) -> bytes:
    """Apply paragraph / single-run / free-text / highlight edits and return
    the new PDF bytes.

    Edit payload shape::

        {
          "pages": [
            {
              "pageIndex": 0,
              "textEdits": [{
                "rect": [x, y, w, h],
                "text": "...",
                "fontSize": 14,
                "fontFamily": "Helvetica",
                "color": "#111111",
                "bold": false,
                "italic": false,
                "align": "left" | "center" | "right",
                "deleted": false,
                "styleRanges": [{ start, end, color?, bold?, italic?,
                                  highlightColor? }]
              }],
              "freeText": [{ ...same shape... }],
              "highlights": [{ "rect": [x, y, w, h], "color": "#ffe66d",
                               "opacity": 0.45 }]
            }
          ]
        }
    """
    if not pdf_bytes:
        raise ValueError("pdf_bytes is empty")

    limits = limits or ExportLimits()

    with pymupdf.open(stream=io.BytesIO(pdf_bytes), filetype="pdf") as doc:
        if doc.page_count > limits.max_pages:
            raise ValueError(f"PDF has {doc.page_count} pages; max allowed is {limits.max_pages}")

        for page_payload in edits.get("pages", []):
            page_index = int(page_payload.get("pageIndex", -1))
            if page_index < 0 or page_index >= doc.page_count:
                continue
            page = doc[page_index]

            text_edits = page_payload.get("textEdits") or []
            free_text = page_payload.get("freeText") or []
            highlights = page_payload.get("highlights") or []
            if len(text_edits) + len(free_text) + len(highlights) > limits.max_edits_per_page:
                raise ValueError(
                    f"Page {page_index} has too many edits (max {limits.max_edits_per_page})"
                )

            # 1. Mark all text-edit rects for redaction. Replacement text is
            #    drawn separately with insert_htmlbox so we get multi-style
            #    + alignment for free. ``originalRect`` overrides the redact
            #    location when the user has dragged a paragraph — the
            #    original glyphs sit at the parse-time bbox, not the new one.
            for edit in text_edits:
                redact_source = edit.get("originalRect") or edit.get("rect")
                rect = _rect_from_payload(redact_source)
                if rect is None or rect.is_empty:
                    continue
                page.add_redact_annot(rect, fill=(1, 1, 1))

            # 2. Apply once — this is the only true content-stream rewrite.
            if text_edits:
                page.apply_redactions()

            # 3. Write replacement text via Story HTML.
            for edit in text_edits:
                if edit.get("deleted"):
                    continue
                rect = _rect_from_payload(edit.get("rect"))
                if rect is None or rect.is_empty:
                    continue
                _insert_text_html(page, rect, edit)

            # 4. Free-text annotations.
            for edit in free_text:
                rect = _rect_from_payload(edit.get("rect"))
                if rect is None or rect.is_empty:
                    continue
                _insert_text_html(page, rect, edit)

            # 5. Highlights — drawn after text so they tint the final visible
            #    content, not redacted glyphs.
            for hl in highlights:
                rect = _rect_from_payload(hl.get("rect"))
                if rect is None or rect.is_empty:
                    continue
                fill = _hex_to_unit_rgb(hl.get("color")) or (1, 0.9, 0.4)
                opacity = float(hl.get("opacity") or 0.45)
                page.draw_rect(
                    rect,
                    color=None,
                    fill=fill,
                    fill_opacity=max(0.0, min(1.0, opacity)),
                    width=0,
                    overlay=True,
                )

        out = io.BytesIO()
        doc.save(out, garbage=3, deflate=True)
        return out.getvalue()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _rect_from_payload(value: Any) -> pymupdf.Rect | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        x, y, w, h = (float(v) for v in value)
    except (TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    return pymupdf.Rect(x, y, x + w, y + h)


def _hex_to_unit_rgb(value: Any) -> tuple[float, float, float] | None:
    if not isinstance(value, str):
        return None
    raw = value.strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) != 6:
        return None
    try:
        r = int(raw[0:2], 16) / 255.0
        g = int(raw[2:4], 16) / 255.0
        b = int(raw[4:6], 16) / 255.0
    except ValueError:
        return None
    return (r, g, b)


def _align_value(align: Any) -> int:
    if not isinstance(align, str):
        return _ALIGN_LEFT
    return {
        "left": _ALIGN_LEFT,
        "center": _ALIGN_CENTER,
        "right": _ALIGN_RIGHT,
    }.get(align.lower(), _ALIGN_LEFT)


@dataclass(slots=True)
class _StyledSegment:
    text: str
    color: str | None
    highlight_color: str | None
    bold: bool
    italic: bool


def _segments_from_ranges(
    text: str,
    ranges: Iterable[dict[str, Any]] | None,
    base: dict[str, Any],
) -> list[_StyledSegment]:
    """Mirror frontend ``textSegmentsFromRanges`` so exports match the editor."""
    rs = [r for r in (ranges or []) if isinstance(r, dict)]
    text_len = len(text)
    boundaries = {0, text_len}
    for r in rs:
        start = max(0, min(text_len, int(r.get("start", 0))))
        end = max(0, min(text_len, int(r.get("end", 0))))
        if end > start:
            boundaries.add(start)
            boundaries.add(end)
    points = sorted(boundaries)

    segments: list[_StyledSegment] = []
    for i in range(len(points) - 1):
        start, end = points[i], points[i + 1]
        if end <= start:
            continue
        # Merge all ranges that cover [start, end).
        color = base.get("color")
        highlight = None
        bold = bool(base.get("bold"))
        italic = bool(base.get("italic"))
        for r in rs:
            r_start = int(r.get("start", 0))
            r_end = int(r.get("end", 0))
            if r_start < end and r_end > start:
                if r.get("color"):
                    color = r["color"]
                if r.get("highlightColor"):
                    highlight = r["highlightColor"]
                if r.get("bold") is not None:
                    bold = bool(r["bold"])
                if r.get("italic") is not None:
                    italic = bool(r["italic"])
        segments.append(
            _StyledSegment(
                text=text[start:end],
                color=color,
                highlight_color=highlight,
                bold=bold,
                italic=italic,
            )
        )
    return segments


def _build_html(edit: dict[str, Any]) -> str:
    text = str(edit.get("text") or "")
    if not text:
        # insert_htmlbox needs at least one char; whitespace ok.
        text = " "
    align = edit.get("align") or "left"
    font_size = float(edit.get("fontSize") or 12)
    family = edit.get("fontFamily") or "Helvetica, Arial, sans-serif"

    base = {
        "color": edit.get("color") or "#111111",
        "bold": bool(edit.get("bold")),
        "italic": bool(edit.get("italic")),
    }
    segments = _segments_from_ranges(text, edit.get("styleRanges"), base)

    body_parts: list[str] = []
    for seg in segments:
        styles: list[str] = []
        if seg.color:
            styles.append(f"color:{seg.color}")
        if seg.highlight_color:
            styles.append(f"background-color:{seg.highlight_color}")
        if seg.bold:
            styles.append("font-weight:bold")
        if seg.italic:
            styles.append("font-style:italic")
        style_attr = ";".join(styles)
        escaped = html.escape(seg.text).replace("\n", "<br/>")
        body_parts.append(f'<span style="{style_attr}">{escaped}</span>')

    safe_align = align if align in ("left", "center", "right", "justify") else "left"
    safe_family = html.escape(family, quote=True)
    return (
        f'<div style="text-align:{safe_align}; '
        f"font-size:{font_size}px; "
        f"font-family:{safe_family}; "
        f'line-height:1.2; margin:0; padding:0;">'
        f"{''.join(body_parts)}"
        f"</div>"
    )


def _spare_from_htmlbox_result(result: Any) -> float:
    """Normalize insert_htmlbox's return value across PyMuPDF versions.

    Older versions return a single float (spare height). Newer versions
    return ``(spare, scale)``. We only care about ``spare``.
    """
    if isinstance(result, (tuple, list)):
        return float(result[0]) if result else 0.0
    try:
        return float(result)
    except (TypeError, ValueError):
        return 0.0


def _insert_text_html(page: pymupdf.Page, rect: pymupdf.Rect, edit: dict[str, Any]) -> None:
    html_body = _build_html(edit)
    # insert_htmlbox returns (spare_height, scale). spare>=0 = content fit;
    # negative = overflow. Try the original rect first; if it overflows,
    # expand downward to the page bottom and retry once.
    result = page.insert_htmlbox(rect, html_body, css=None, scale_low=0.0)
    spare = _spare_from_htmlbox_result(result)
    if spare >= 0:
        return

    page_rect = page.rect
    if rect.y1 < page_rect.y1 - 1:
        expanded = pymupdf.Rect(rect.x0, rect.y0, rect.x1, page_rect.y1)
        page.insert_htmlbox(expanded, html_body, css=None, scale_low=0.0)
