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
import math
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
    strict_recovery: bool = False,
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

        if strict_recovery:
            _validate_strict_recovery_payload(doc, edits, limits)

        for page_payload in edits.get("pages", []):
            page_index = int(page_payload.get("pageIndex", -1))
            if page_index < 0 or page_index >= doc.page_count:
                if strict_recovery:
                    raise ValueError(f"recovery page index {page_index} is out of range")
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
                    if strict_recovery:
                        raise ValueError(f"recovery page {page_index} has an invalid redaction rect")
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
                    if strict_recovery:
                        raise ValueError(f"recovery page {page_index} has an invalid text rect")
                    continue
                inserted = _insert_text_html(page, rect, edit, exact=strict_recovery)
                if strict_recovery and not inserted:
                    raise ValueError(f"recovery page {page_index} replacement text did not fit")

            # 4. Free-text annotations.
            for edit in free_text:
                rect = _rect_from_payload(edit.get("rect"))
                if rect is None or rect.is_empty:
                    if strict_recovery:
                        raise ValueError(f"recovery page {page_index} has an invalid free-text rect")
                    continue
                inserted = _insert_text_html(page, rect, edit, exact=strict_recovery)
                if strict_recovery and not inserted:
                    raise ValueError(f"recovery page {page_index} free text did not fit")

            # 5. Highlights — drawn after text so they tint the final visible
            #    content, not redacted glyphs.
            for hl in highlights:
                rect = _rect_from_payload(hl.get("rect"))
                if rect is None or rect.is_empty:
                    if strict_recovery:
                        raise ValueError(f"recovery page {page_index} has an invalid highlight rect")
                    continue
                fill = _hex_to_unit_rgb(hl.get("color")) or (1.0, 230 / 255, 109 / 255)
                opacity = float(hl.get("opacity", 0.45))
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


_STRICT_PAGE_FIELDS = {"pageIndex", "textEdits", "freeText", "highlights"}
_STRICT_TEXT_FIELDS = {
    "rect",
    "originalRect",
    "text",
    "fontSize",
    "fontFamily",
    "color",
    "bold",
    "italic",
    "align",
    "deleted",
    "styleRanges",
}
_STRICT_RANGE_FIELDS = {"start", "end", "color", "highlightColor", "bold", "italic"}
_STRICT_HIGHLIGHT_FIELDS = {"rect", "color", "opacity"}


def _validate_strict_recovery_payload(
    doc: pymupdf.Document,
    edits: dict[str, Any],
    limits: ExportLimits,
) -> None:
    if set(edits) != {"pages"} or not isinstance(edits.get("pages"), list):
        raise ValueError("strict PDF recovery payload must contain only a pages array")

    seen_pages: set[int] = set()
    for payload_index, page_payload in enumerate(edits["pages"]):
        field = f"pages[{payload_index}]"
        if not isinstance(page_payload, dict):
            raise ValueError(f"recovery {field} must be an object")
        if "pageIndex" not in page_payload or set(page_payload) - _STRICT_PAGE_FIELDS:
            raise ValueError(f"recovery {field} has unsupported fields")
        page_index = page_payload["pageIndex"]
        if type(page_index) is not int or page_index < 0 or page_index >= doc.page_count:
            raise ValueError(f"recovery {field}.pageIndex is out of range")
        if page_index in seen_pages:
            raise ValueError(f"recovery page {page_index} appears more than once")
        seen_pages.add(page_index)

        collections: dict[str, list[Any]] = {}
        for key in ("textEdits", "freeText", "highlights"):
            value = page_payload.get(key, [])
            if not isinstance(value, list):
                raise ValueError(f"recovery {field}.{key} must be an array")
            collections[key] = value
        total = sum(len(value) for value in collections.values())
        if total > limits.max_edits_per_page:
            raise ValueError(f"Page {page_index} has too many edits (max {limits.max_edits_per_page})")
        if total and doc[page_index].rotation != 0:
            raise ValueError(f"recovery page {page_index} uses unsupported page rotation")

        page_rect = doc[page_index].rect
        for index, edit in enumerate(collections["textEdits"]):
            _validate_strict_text_edit(
                edit,
                page_rect,
                f"{field}.textEdits[{index}]",
                allow_original_rect=True,
            )
        for index, edit in enumerate(collections["freeText"]):
            _validate_strict_text_edit(
                edit,
                page_rect,
                f"{field}.freeText[{index}]",
                allow_original_rect=False,
            )
        for index, highlight in enumerate(collections["highlights"]):
            _validate_strict_highlight(
                highlight,
                page_rect,
                f"{field}.highlights[{index}]",
            )


def _validate_strict_text_edit(
    edit: Any,
    page_rect: pymupdf.Rect,
    field: str,
    *,
    allow_original_rect: bool,
) -> None:
    allowed = (
        _STRICT_TEXT_FIELDS
        if allow_original_rect
        else _STRICT_TEXT_FIELDS - {"originalRect", "deleted"}
    )
    if not isinstance(edit, dict) or not {"rect", "text"}.issubset(edit) or set(edit) - allowed:
        raise ValueError(f"recovery {field} is malformed or has unsupported fields")
    _require_strict_rect(edit["rect"], page_rect, f"{field}.rect")
    if "originalRect" in edit:
        _require_strict_rect(edit["originalRect"], page_rect, f"{field}.originalRect")

    text = edit["text"]
    if not isinstance(text, str):
        raise ValueError(f"recovery {field}.text must be a string")
    if not _is_strict_pdf_text(text):
        raise ValueError(f"recovery {field}.text contains unsupported characters")
    if text == "":
        if not allow_original_rect:
            raise ValueError(f"recovery {field}.text must be non-empty")
        if edit.get("deleted") is not True:
            raise ValueError(f"recovery {field}.text is empty without an explicit deletion")

    if "fontSize" in edit:
        _require_strict_number(edit["fontSize"], f"{field}.fontSize", positive=True)
    if "fontFamily" in edit:
        family = edit["fontFamily"]
        if (
            not isinstance(family, str)
            or not family
            or not _is_xml_text(family)
            or any(character in family for character in ";{}<>\t\r\n")
        ):
            raise ValueError(f"recovery {field}.fontFamily is invalid")
    for key in ("bold", "italic", "deleted"):
        if key in edit and not isinstance(edit[key], bool):
            raise ValueError(f"recovery {field}.{key} must be boolean")
    if "align" in edit and edit["align"] not in {"left", "center", "right"}:
        raise ValueError(f"recovery {field}.align is invalid")
    if "color" in edit and _hex_to_unit_rgb(edit["color"]) is None:
        raise ValueError(f"recovery {field}.color is invalid")

    ranges = edit.get("styleRanges", [])
    if not isinstance(ranges, list):
        raise ValueError(f"recovery {field}.styleRanges must be an array")
    for index, style_range in enumerate(ranges):
        range_field = f"{field}.styleRanges[{index}]"
        if (
            not isinstance(style_range, dict)
            or set(style_range) - _STRICT_RANGE_FIELDS
            or not {"start", "end"}.issubset(style_range)
        ):
            raise ValueError(f"recovery {range_field} is malformed or unsupported")
        start = style_range["start"]
        end = style_range["end"]
        if type(start) is not int or type(end) is not int or start < 0 or end <= start or end > len(text):
            raise ValueError(f"recovery {range_field} has invalid bounds")
        for key in ("bold", "italic"):
            if key in style_range and not isinstance(style_range[key], bool):
                raise ValueError(f"recovery {range_field}.{key} must be boolean")
        for key in ("color", "highlightColor"):
            if key in style_range and _hex_to_unit_rgb(style_range[key]) is None:
                raise ValueError(f"recovery {range_field}.{key} is invalid")


def _validate_strict_highlight(
    highlight: Any,
    page_rect: pymupdf.Rect,
    field: str,
) -> None:
    if (
        not isinstance(highlight, dict)
        or "rect" not in highlight
        or set(highlight) - _STRICT_HIGHLIGHT_FIELDS
    ):
        raise ValueError(f"recovery {field} is malformed or has unsupported fields")
    _require_strict_rect(highlight["rect"], page_rect, f"{field}.rect")
    if "color" in highlight and _hex_to_unit_rgb(highlight["color"]) is None:
        raise ValueError(f"recovery {field}.color is invalid")
    if "opacity" in highlight:
        opacity = _require_strict_number(highlight["opacity"], f"{field}.opacity")
        if opacity < 0 or opacity > 1:
            raise ValueError(f"recovery {field}.opacity must be between zero and one")


def _require_strict_rect(value: Any, page_rect: pymupdf.Rect, field: str) -> pymupdf.Rect:
    rect = _rect_from_payload(value)
    if rect is None or rect.is_empty:
        raise ValueError(f"recovery {field} is invalid")
    if (
        rect.x0 < page_rect.x0
        or rect.y0 < page_rect.y0
        or rect.x1 > page_rect.x1
        or rect.y1 > page_rect.y1
    ):
        raise ValueError(f"recovery {field} is outside the page")
    return rect


def _require_strict_number(value: Any, field: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"recovery {field} must be a number")
    try:
        number = float(value)
    except (OverflowError, ValueError) as exc:
        raise ValueError(f"recovery {field} is invalid") from exc
    if not math.isfinite(number) or (positive and number <= 0):
        raise ValueError(f"recovery {field} is invalid")
    return number


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _rect_from_payload(value: Any) -> pymupdf.Rect | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        x, y, w, h = (float(v) for v in value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not all(math.isfinite(number) for number in (x, y, w, h)) or w <= 0 or h <= 0:
        return None
    return pymupdf.Rect(x, y, x + w, y + h)


def _is_strict_pdf_text(value: str) -> bool:
    return (
        _is_xml_text(value)
        and "\t" not in value
        and "\r" not in value
        and all(ord(character) <= 0xFFFF for character in value)
    )


def _is_xml_text(value: str) -> bool:
    return all(
        character in "\t\n\r"
        or 0x20 <= ord(character) <= 0xD7FF
        or 0xE000 <= ord(character) <= 0xFFFD
        or 0x10000 <= ord(character) <= 0x10FFFF
        for character in value
    )


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
        f'line-height:1.2; white-space:pre-wrap; margin:0; padding:0;">'
        f"{''.join(body_parts)}"
        f"</div>"
    )


def _htmlbox_result_fits(result: Any, *, exact: bool) -> bool:
    """Normalize insert_htmlbox's return value across PyMuPDF versions.

    Older versions return a single float (spare height). Newer versions
    return ``(spare, scale)``. ``scale_low=1`` already prevents shrinking
    on older versions; when a scale is reported, verify it too.
    """
    if isinstance(result, (tuple, list)):
        if not result:
            return False
        spare = float(result[0])
        scale = float(result[1]) if len(result) > 1 else 1.0
        return spare >= 0 and (not exact or math.isclose(scale, 1.0, abs_tol=1e-6))
    try:
        return float(result) >= 0
    except (TypeError, ValueError):
        return False


def _insert_text_html(
    page: pymupdf.Page,
    rect: pymupdf.Rect,
    edit: dict[str, Any],
    *,
    exact: bool = False,
) -> bool:
    html_body = _build_html(edit)
    # insert_htmlbox returns (spare_height, scale). spare>=0 = content fit;
    # negative = overflow. Strict recovery must preserve both the requested
    # font size and rect, so it forbids scaling and the legacy expanded retry.
    result = page.insert_htmlbox(rect, html_body, css=None, scale_low=1.0 if exact else 0.0)
    if _htmlbox_result_fits(result, exact=exact):
        return True
    if exact:
        return False

    page_rect = page.rect
    if rect.y1 < page_rect.y1 - 1:
        expanded = pymupdf.Rect(rect.x0, rect.y0, rect.x1, page_rect.y1)
        retry_result = page.insert_htmlbox(expanded, html_body, css=None, scale_low=0.0)
        return _htmlbox_result_fits(retry_result, exact=False)
    return False
