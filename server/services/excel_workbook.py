"""Excel parse + export pipeline backed by openpyxl.

Mirrors the role ``services.pdf_blocks`` plays for PDFs: the editor never
talks to openpyxl directly. The frontend renders from the JSON cell model
returned by :func:`parse_workbook` and applies user edits via the sidecar
state. On export, :func:`export_edited_workbook` re-applies those edits onto
the original ``.xlsx`` bytes so we keep styles, formulas, and other features
the JSON cell model doesn't represent yet (charts, pivots, conditional
formatting, named ranges).
"""

from __future__ import annotations

import hashlib
import io
import logging
import os
from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock
from typing import Any

from openpyxl import load_workbook
from openpyxl.cell.cell import Cell
from openpyxl.comments import Comment
from openpyxl.formatting.rule import (
    CellIsRule,
    ColorScaleRule,
    FormulaRule,
    Rule,
)
from openpyxl.styles import Border, Font, PatternFill, Side
from openpyxl.styles.colors import Color
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.utils import get_column_letter
from openpyxl.workbook.workbook import Workbook
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.worksheet import Worksheet

from lib.timing import timed as perf_timed

logger = logging.getLogger(__name__)

# Defensive caps. A pathological workbook can exceed Excel's nominal
# 1,048,576 rows × 16,384 columns; even normal sheets often have used_range
# stretching off into empty territory. We clamp to a reasonable viewport so
# the JSON payload stays bounded.
MAX_SHEETS = 64
MAX_ROWS_PER_SHEET = 5000
MAX_COLS_PER_SHEET = 200

# Process-local LRU cache for parsed workbook DTOs. The dual openpyxl load
# in parse_workbook is the slowest backend operation in the whole app
# (15+ seconds on an 8 MB workbook); even with the frontend sidecar cache,
# every fresh process or post-edit save pays it again. Hashing the input
# bytes is ~30 ms on big workbooks — trivial next to the 15 s parse it
# replaces. The hash also serves as a content fingerprint, so any
# byte-level modification invalidates automatically.
_XLSX_CACHE_MAX = 8
_XLSX_CACHE: OrderedDict[str, dict[str, Any]] = OrderedDict()
_XLSX_CACHE_LOCK = Lock()


def _xlsx_cache_disabled() -> bool:
    return os.environ.get("DOXMIND_DISABLE_XLSX_CACHE", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _clear_xlsx_cache() -> None:
    """For tests / benchmarks."""
    with _XLSX_CACHE_LOCK:
        _XLSX_CACHE.clear()


@dataclass
class ParseLimits:
    max_sheets: int = MAX_SHEETS
    max_rows: int = MAX_ROWS_PER_SHEET
    max_cols: int = MAX_COLS_PER_SHEET


def parse_workbook(
    xlsx_bytes: bytes,
    *,
    limits: ParseLimits | None = None,
) -> dict[str, Any]:
    """Parse an .xlsx blob into a JSON-serialisable cell model.

    Returns::

        {
          "version": 1,
          "sheets": [
            {
              "id": "sheet-0",
              "name": "Sheet1",
              "index": 0,
              "rowCount": 24,
              "colCount": 8,
              "rowHeights": {"0": 22.0, ...},   # row index -> px (omitted = default)
              "colWidths":  {"0": 96.0, ...},   # col index -> px (omitted = default)
              "merges":   [{"top":1,"left":0,"bottom":2,"right":3}, ...],
              "frozen":   {"row": 1, "col": 0},
              "cells": [
                {
                  "row": 0, "col": 0,
                  "value": "Q1 Revenue",
                  "formula": null,
                  "numberFormat": "General",
                  "style": {"bold": true, "color": "#111111"}
                }, ...
              ]
            }
          ],
          "truncated": {"sheets": false, "rowsBy": {...}, "colsBy": {...}}
        }
    """
    if not xlsx_bytes:
        raise ValueError("empty xlsx body")
    parse_limits = limits or ParseLimits()

    cache_key: str | None = None
    if not _xlsx_cache_disabled():
        with perf_timed("excel.parse_workbook.hash", bytes=len(xlsx_bytes)):
            cache_key = hashlib.sha256(xlsx_bytes).hexdigest()
        with _XLSX_CACHE_LOCK:
            cached = _XLSX_CACHE.get(cache_key)
            if cached is not None:
                _XLSX_CACHE.move_to_end(cache_key)
                with perf_timed("excel.parse_workbook.cache_hit"):
                    pass
                return cached

    with perf_timed("excel.parse_workbook.total", bytes=len(xlsx_bytes)) as total_span:
        try:
            # data_only=False so we keep the raw formulas. Frontend gets a
            # second pass with data_only=True for the cached results.
            with perf_timed("excel.load_data_only_false"):
                wb_formulas = load_workbook(
                    io.BytesIO(xlsx_bytes), data_only=False, read_only=False
                )
            with perf_timed("excel.load_data_only_true"):
                wb_values = load_workbook(
                    io.BytesIO(xlsx_bytes), data_only=True, read_only=True
                )
        except Exception as exc:
            # openpyxl raises a grab-bag of exception types on malformed files.
            raise ValueError(f"failed to parse xlsx: {exc}") from exc

        sheets: list[dict[str, Any]] = []
        truncated_sheets = len(wb_formulas.sheetnames) > parse_limits.max_sheets
        rows_truncated: dict[str, bool] = {}
        cols_truncated: dict[str, bool] = {}
        total_span["sheet_count"] = min(len(wb_formulas.sheetnames), parse_limits.max_sheets)

        try:
            with perf_timed("excel.parse_sheets") as sheets_span:
                cell_total = 0
                for index, name in enumerate(wb_formulas.sheetnames):
                    if index >= parse_limits.max_sheets:
                        break
                    formula_sheet = wb_formulas[name]
                    value_sheet = (
                        wb_values[name] if name in wb_values.sheetnames else None
                    )
                    sheet_dto, sheet_truncations = _parse_sheet(
                        formula_sheet,
                        value_sheet,
                        index=index,
                        limits=parse_limits,
                    )
                    cell_total += len(sheet_dto.get("cells", []))
                    sheets.append(sheet_dto)
                    if sheet_truncations.get("rows"):
                        rows_truncated[sheet_dto["id"]] = True
                    if sheet_truncations.get("cols"):
                        cols_truncated[sheet_dto["id"]] = True
                sheets_span["cells"] = cell_total
            total_span["cells"] = cell_total
        except ValueError as exc:
            raise ValueError(f"failed to parse xlsx: {exc}") from exc

    result = {
        "version": 1,
        "sheets": sheets,
        "truncated": {
            "sheets": truncated_sheets,
            "rowsBy": rows_truncated,
            "colsBy": cols_truncated,
        },
    }

    if cache_key is not None:
        with _XLSX_CACHE_LOCK:
            _XLSX_CACHE[cache_key] = result
            _XLSX_CACHE.move_to_end(cache_key)
            while len(_XLSX_CACHE) > _XLSX_CACHE_MAX:
                _XLSX_CACHE.popitem(last=False)

    return result


def _parse_sheet(
    formula_sheet: Worksheet,
    value_sheet: Worksheet | None,
    *,
    index: int,
    limits: ParseLimits,
) -> tuple[dict[str, Any], dict[str, bool]]:
    sheet_id = f"sheet-{index}"
    raw_rows = formula_sheet.max_row or 0
    raw_cols = formula_sheet.max_column or 0
    row_count = min(raw_rows, limits.max_rows)
    col_count = min(raw_cols, limits.max_cols)

    cells: list[dict[str, Any]] = []
    if row_count and col_count:
        # Walk formula + value sheets in parallel with a single pass each.
        # `wb_values` is `read_only=True` (SAX streaming), so calling
        # `value_sheet.iter_rows(min_row=r, max_row=r)` once per row would
        # rescan from the start of the XML stream every iteration —
        # O(rows²) — which on a 1k-row sheet is tens of seconds. Zipping
        # the two iterators lets each side stream end-to-end exactly once.
        formula_iter = formula_sheet.iter_rows(
            min_row=1,
            max_row=row_count,
            min_col=1,
            max_col=col_count,
        )
        if value_sheet is not None:
            value_iter = value_sheet.iter_rows(
                min_row=1,
                max_row=row_count,
                min_col=1,
                max_col=col_count,
                values_only=True,
            )
            paired: Any = zip(formula_iter, value_iter, strict=True)
        else:
            paired = ((row, ()) for row in formula_iter)

        for row_idx, (formula_row, value_row) in enumerate(paired):
            for col_idx, cell in enumerate(formula_row):
                cached_value = (
                    value_row[col_idx]
                    if col_idx < len(value_row)
                    else None
                )
                dto = _cell_to_dto(
                    cell,
                    cached_value=cached_value,
                    row=row_idx,
                    col=col_idx,
                )
                if dto is not None:
                    cells.append(dto)

    row_heights: dict[str, float] = {}
    for row_idx, dim in (formula_sheet.row_dimensions or {}).items():
        if dim.height is None:
            continue
        # openpyxl indexes rows from 1; we serialise zero-based.
        if not isinstance(row_idx, int):
            continue
        if row_idx < 1 or row_idx > row_count:
            continue
        row_heights[str(row_idx - 1)] = float(dim.height)

    col_widths: dict[str, float] = {}
    for col_letter, dim in (formula_sheet.column_dimensions or {}).items():
        if dim.width is None:
            continue
        try:
            zero_based = _col_letter_to_index(col_letter)
        except ValueError:
            continue
        if zero_based >= col_count:
            continue
        col_widths[str(zero_based)] = float(dim.width)

    merges: list[dict[str, int]] = []
    for merged_range in formula_sheet.merged_cells.ranges:
        merges.append(
            {
                "top": merged_range.min_row - 1,
                "left": merged_range.min_col - 1,
                "bottom": merged_range.max_row - 1,
                "right": merged_range.max_col - 1,
            }
        )

    frozen = _frozen_panes(formula_sheet)

    return (
        {
            "id": sheet_id,
            "name": formula_sheet.title,
            "index": index,
            "rowCount": row_count,
            "colCount": col_count,
            "rowHeights": row_heights,
            "colWidths": col_widths,
            "merges": merges,
            "frozen": frozen,
            "cells": cells,
        },
        {
            "rows": raw_rows > row_count,
            "cols": raw_cols > col_count,
        },
    )


def _cell_to_dto(
    cell: Cell,
    *,
    cached_value: Any,
    row: int,
    col: int,
) -> dict[str, Any] | None:
    raw = cell.value
    formula: str | None = None
    value: Any = raw

    if isinstance(raw, str) and raw.startswith("="):
        formula = raw
        value = cached_value

    if value is None and formula is None and not _has_visible_style(cell):
        return None

    style = _cell_style(cell)
    dto: dict[str, Any] = {
        "row": row,
        "col": col,
        "value": _coerce_jsonable(value),
        "formula": formula,
    }
    number_format = cell.number_format
    if number_format and number_format != "General":
        dto["numberFormat"] = number_format
    if style:
        dto["style"] = style
    return dto


def _has_visible_style(cell: Cell) -> bool:
    """True when a blank cell still carries paint we want to preserve."""
    if cell.has_style:
        font = cell.font
        if font is not None and (font.bold or font.italic or font.underline):
            return True
        if font is not None and font.color and font.color.rgb:
            return True
        fill = cell.fill
        if fill is not None and fill.fgColor and getattr(fill.fgColor, "rgb", None):
            rgb = fill.fgColor.rgb
            if isinstance(rgb, str) and rgb not in {"00000000", "FFFFFFFF"}:
                return True
    return False


def _cell_style(cell: Cell) -> dict[str, Any]:
    style: dict[str, Any] = {}
    if not cell.has_style:
        return style
    font = cell.font
    if font is not None:
        if font.bold:
            style["bold"] = True
        if font.italic:
            style["italic"] = True
        if font.underline and font.underline != "none":
            style["underline"] = True
        if font.strike:
            style["strikethrough"] = True
        color = _color_to_hex(font.color)
        if color:
            style["color"] = color
        if font.size:
            style["fontSize"] = float(font.size)
        if font.name:
            style["fontFamily"] = font.name
    fill = cell.fill
    if fill is not None and fill.fgColor:
        bg = _color_to_hex(fill.fgColor)
        if bg and bg.lower() not in {"#000000", "#ffffff"}:
            style["background"] = bg
    alignment = cell.alignment
    if alignment is not None:
        if alignment.horizontal in {"left", "center", "right"}:
            style["textAlign"] = alignment.horizontal
        if alignment.vertical in {"top", "center", "bottom"}:
            style["verticalAlign"] = (
                "middle" if alignment.vertical == "center" else alignment.vertical
            )
        if alignment.wrap_text:
            style["wrapText"] = True
        rotation = alignment.text_rotation
        if isinstance(rotation, (int, float)) and rotation:
            # Map openpyxl's split domain back to a single signed degree
            # value the frontend understands (0–90 up, -1 to -90 down).
            deg = int(rotation)
            if 0 < deg <= 90:
                style["rotation"] = deg
            elif 90 < deg <= 180:
                style["rotation"] = -(deg - 90)
    if cell.hyperlink is not None:
        target = getattr(cell.hyperlink, "target", None) or getattr(cell.hyperlink, "ref", None)
        if isinstance(target, str) and target:
            style["hyperlink"] = target
    border = _border_to_dict(cell.border)
    if border:
        style["border"] = border
    return style


_OPENPYXL_BORDER_STYLES = {
    "thin": "thin",
    "hair": "thin",
    "medium": "medium",
    "thick": "thick",
    "double": "double",
    "dashed": "dashed",
    "mediumDashed": "dashed",
    "dotted": "dotted",
    "dashDot": "dashed",
    "mediumDashDot": "dashed",
    "dashDotDot": "dashed",
    "mediumDashDotDot": "dashed",
    "slantDashDot": "dashed",
}


def _side_to_dict(side: Any) -> dict[str, Any] | None:
    if side is None:
        return None
    style_name = getattr(side, "style", None)
    if not style_name:
        return None
    mapped = _OPENPYXL_BORDER_STYLES.get(style_name)
    if not mapped:
        return None
    out: dict[str, Any] = {"style": mapped}
    color = _color_to_hex(getattr(side, "color", None))
    if color:
        out["color"] = color
    return out


def _border_to_dict(border: Any) -> dict[str, Any] | None:
    if border is None:
        return None
    out: dict[str, Any] = {}
    for side_name in ("top", "right", "bottom", "left"):
        side = _side_to_dict(getattr(border, side_name, None))
        if side:
            out[side_name] = side
    return out or None


def _color_to_hex(color: Any) -> str | None:
    if color is None:
        return None
    rgb = getattr(color, "rgb", None)
    if not isinstance(rgb, str) or len(rgb) < 6:
        return None
    # openpyxl emits "AARRGGBB" — strip alpha.
    hex_part = rgb[-6:]
    return f"#{hex_part.lower()}"


def _frozen_panes(sheet: Worksheet) -> dict[str, int]:
    cell_ref = sheet.freeze_panes
    if not cell_ref:
        return {"row": 0, "col": 0}
    try:
        col_letters = "".join(ch for ch in cell_ref if ch.isalpha())
        row_digits = "".join(ch for ch in cell_ref if ch.isdigit())
        col = _col_letter_to_index(col_letters) if col_letters else 0
        row = int(row_digits) - 1 if row_digits else 0
        return {"row": max(row, 0), "col": max(col, 0)}
    except ValueError:
        return {"row": 0, "col": 0}


def _col_letter_to_index(letters: str) -> int:
    letters = letters.strip().upper()
    if not letters or not letters.isalpha():
        raise ValueError(f"invalid column letter: {letters!r}")
    total = 0
    for ch in letters:
        total = total * 26 + (ord(ch) - ord("A") + 1)
    return total - 1


def _coerce_jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    # Datetimes, Decimals, etc. — fall back to string. The frontend doesn't
    # need full type fidelity for the spike; rich types come back from the
    # next phase when we wire openpyxl numberFormat → renderer.
    try:
        return str(value)
    except Exception:
        return None


def export_edited_workbook(
    xlsx_bytes: bytes,
    edits: dict[str, Any],
) -> bytes:
    """Apply sidecar edits onto the original .xlsx and return new bytes.

    ``edits`` shape mirrors :class:`ExcelEditorState` in the frontend::

        {
          "ops": [
            {"type": "insertRow", "sheetId": "sheet-0", "before": 2, "count": 1}
          ],
          "cells": {
            "sheet-0!0,0": {"value": "Hello"},
            "sheet-0!1,2": {"formula": "=A1+B1"},
            "sheet-0!2,0": {"value": null}                  # clear cell
          },
          "rowHeights": {"sheet-0!0": 32.5},
          "colWidths":  {"sheet-0!4": 140.0}
        }

    Structural ops (``insertRow`` / ``deleteRow`` / ``insertCol`` /
    ``deleteCol``) are replayed first via openpyxl's ``insert_rows`` /
    ``delete_rows`` / ``insert_cols`` / ``delete_cols``. The frontend has
    already transformed cell-edit keys into post-op coordinates so the
    cell phase that follows can write into the right targets.

    Anything not present in ``edits`` is left untouched in the original
    workbook — that's how we preserve charts, conditional formatting, etc.
    """
    if not xlsx_bytes:
        raise ValueError("empty xlsx body")

    try:
        wb: Workbook = load_workbook(io.BytesIO(xlsx_bytes), data_only=False)
    except Exception as exc:
        raise ValueError(f"failed to parse xlsx: {exc}") from exc

    cell_edits = edits.get("cells") or {}
    if not isinstance(cell_edits, dict):
        raise ValueError("'edits.cells' must be an object")
    row_height_edits = edits.get("rowHeights") or {}
    col_width_edits = edits.get("colWidths") or {}
    ops = edits.get("ops") or []
    if not isinstance(ops, list):
        raise ValueError("'edits.ops' must be an array")
    workbook_ops = edits.get("workbookOps") or []
    if not isinstance(workbook_ops, list):
        raise ValueError("'edits.workbookOps' must be an array")

    # ------------------------------------------------------------------
    # Phase 0: workbook-level ops (add / rename / duplicate / delete sheet).
    #
    # `sheet_lookup` maps the frontend's stable sheet ids (`"sheet-0"`,
    # `"sheet-user-<uuid>"`, …) to the live openpyxl sheet name as the
    # workbook mutates. Subsequent phases resolve sheet ids through this
    # map so they target post-mutation tabs.
    # ------------------------------------------------------------------
    sheet_lookup: dict[str, str] = {
        f"sheet-{i}": name for i, name in enumerate(wb.sheetnames)
    }
    for op in workbook_ops:
        if not isinstance(op, dict):
            continue
        op_type = op.get("type")
        if op_type == "addSheet":
            sheet_id = str(op.get("sheetId") or "")
            requested_name = str(op.get("name") or "Sheet")
            unique_name = _unique_sheet_name(wb, requested_name)
            after_id = op.get("afterSheetId")
            anchor_name = sheet_lookup.get(str(after_id)) if after_id else None
            anchor_index = (
                wb.sheetnames.index(anchor_name) + 1 if anchor_name in wb.sheetnames else None
            )
            wb.create_sheet(title=unique_name, index=anchor_index)
            sheet_lookup[sheet_id] = unique_name
        elif op_type == "renameSheet":
            sheet_id = str(op.get("sheetId") or "")
            old_name = sheet_lookup.get(sheet_id)
            if old_name is None or old_name not in wb.sheetnames:
                continue
            new_name = _unique_sheet_name(wb, str(op.get("name") or old_name), exclude=old_name)
            wb[old_name].title = new_name
            sheet_lookup[sheet_id] = new_name
        elif op_type == "duplicateSheet":
            source_id = str(op.get("sourceSheetId") or "")
            source_name = sheet_lookup.get(source_id)
            if source_name is None or source_name not in wb.sheetnames:
                continue
            new_id = str(op.get("sheetId") or "")
            requested_name = str(op.get("name") or f"{source_name} (copy)")
            unique_name = _unique_sheet_name(wb, requested_name)
            copied = wb.copy_worksheet(wb[source_name])
            copied.title = unique_name
            sheet_lookup[new_id] = unique_name
        elif op_type == "deleteSheet":
            sheet_id = str(op.get("sheetId") or "")
            target_name = sheet_lookup.get(sheet_id)
            if target_name is None or target_name not in wb.sheetnames:
                continue
            if len(wb.sheetnames) <= 1:
                # openpyxl refuses to delete the only sheet — match Excel.
                continue
            del wb[target_name]
            sheet_lookup.pop(sheet_id, None)

    # ------------------------------------------------------------------
    # Phase 1: replay structural ops in order. After this point row/col
    # indices used by the cell-edit phase are interpreted in the *post-op*
    # space, which matches what the frontend stored.
    #
    # openpyxl's insert_rows / delete_rows / insert_cols / delete_cols use
    # 1-based indices and shift everything below / right of the boundary.
    # They do *not* update existing formulas — references to cells that
    # got shifted are preserved as-is. Excel re-opens generally fix this
    # via its calc engine; documenting here so we don't surprise anyone.
    # ------------------------------------------------------------------
    for op in ops:
        if not isinstance(op, dict):
            continue
        sheet_name = sheet_lookup.get(str(op.get("sheetId") or ""))
        if sheet_name is None:
            continue
        sheet = wb[sheet_name]
        op_type = op.get("type")
        try:
            count = max(1, int(op.get("count", 1)))
        except (TypeError, ValueError):
            count = 1
        if op_type == "insertRow":
            try:
                before = int(op.get("before", 0))
            except (TypeError, ValueError):
                continue
            sheet.insert_rows(before + 1, count)
        elif op_type == "deleteRow":
            try:
                index = int(op.get("index", 0))
            except (TypeError, ValueError):
                continue
            sheet.delete_rows(index + 1, count)
        elif op_type == "insertCol":
            try:
                before = int(op.get("before", 0))
            except (TypeError, ValueError):
                continue
            sheet.insert_cols(before + 1, count)
        elif op_type == "deleteCol":
            try:
                index = int(op.get("index", 0))
            except (TypeError, ValueError):
                continue
            sheet.delete_cols(index + 1, count)
        elif op_type in {"mergeCells", "unmergeCells"}:
            try:
                top = int(op.get("top", 0))
                left = int(op.get("left", 0))
                bottom = int(op.get("bottom", 0))
                right = int(op.get("right", 0))
            except (TypeError, ValueError):
                continue
            if bottom < top or right < left:
                continue
            kwargs = {
                "start_row": top + 1,
                "start_column": left + 1,
                "end_row": bottom + 1,
                "end_column": right + 1,
            }
            if op_type == "mergeCells":
                # Drop any pre-existing merges fully contained in the new
                # one, otherwise openpyxl raises on overlapping ranges.
                contained = [
                    r
                    for r in sheet.merged_cells.ranges
                    if r.min_row >= kwargs["start_row"]
                    and r.max_row <= kwargs["end_row"]
                    and r.min_col >= kwargs["start_column"]
                    and r.max_col <= kwargs["end_column"]
                ]
                for r in contained:
                    sheet.unmerge_cells(str(r))
                sheet.merge_cells(**kwargs)
            else:
                # unmerge_cells with explicit bounds requires the exact
                # range; loop over intersecting ranges instead so users
                # can clear arbitrary merges via a covering selection.
                intersecting = [
                    r
                    for r in sheet.merged_cells.ranges
                    if r.min_row <= kwargs["end_row"]
                    and r.max_row >= kwargs["start_row"]
                    and r.min_col <= kwargs["end_column"]
                    and r.max_col >= kwargs["start_column"]
                ]
                for r in intersecting:
                    sheet.unmerge_cells(str(r))

    for key, payload in cell_edits.items():
        sheet_name, row_idx, col_idx = _split_cell_key(key, sheet_lookup)
        if sheet_name is None:
            continue
        sheet = wb[sheet_name]
        cell_ref = f"{get_column_letter(col_idx + 1)}{row_idx + 1}"
        if not isinstance(payload, dict):
            continue
        if "formula" in payload and payload["formula"]:
            formula = str(payload["formula"])
            sheet[cell_ref] = formula if formula.startswith("=") else f"={formula}"
        elif "value" in payload:
            value = payload["value"]
            sheet[cell_ref] = value
        if "numberFormat" in payload and payload["numberFormat"]:
            sheet[cell_ref].number_format = str(payload["numberFormat"])
        style_patch = payload.get("style")
        if isinstance(style_patch, dict) and style_patch:
            _apply_style_patch(sheet[cell_ref], style_patch)

    for key, height in (row_height_edits or {}).items():
        sheet_name, row_idx = _split_row_key(key, sheet_lookup)
        if sheet_name is None or not isinstance(height, (int, float)):
            continue
        wb[sheet_name].row_dimensions[row_idx + 1].height = float(height)

    for key, width in (col_width_edits or {}).items():
        sheet_name, col_idx = _split_col_key(key, sheet_lookup)
        if sheet_name is None or not isinstance(width, (int, float)):
            continue
        letter = get_column_letter(col_idx + 1)
        wb[sheet_name].column_dimensions[letter].width = float(width)

    # Freeze panes — openpyxl wants an A1-style cell reference whose
    # top-left corner is the *first* unfrozen cell. {row:1,col:0} → "A2",
    # {row:0,col:1} → "B1", {row:2,col:1} → "B3", and so on.
    frozen_edits = edits.get("frozen") or {}
    if isinstance(frozen_edits, dict):
        for sheet_id, payload in frozen_edits.items():
            sheet_name = sheet_lookup.get(str(sheet_id))
            if sheet_name is None or not isinstance(payload, dict):
                continue
            row = max(0, int(payload.get("row", 0) or 0))
            col = max(0, int(payload.get("col", 0) or 0))
            if row == 0 and col == 0:
                wb[sheet_name].freeze_panes = None
            else:
                wb[sheet_name].freeze_panes = f"{get_column_letter(col + 1)}{row + 1}"

    # Data validation (list type) — group cells by sheet + value list so
    # each unique list creates one DataValidation covering many ranges.
    validations = edits.get("validations") or {}
    if isinstance(validations, dict):
        # sheet_name -> values_tuple -> [cell_refs]
        grouped: dict[str, dict[tuple[str, ...], list[str]]] = {}
        for key, payload in validations.items():
            if not isinstance(payload, dict):
                continue
            if payload.get("type") != "list":
                continue
            values = payload.get("values")
            if not isinstance(values, list) or not values:
                continue
            sheet_name, row_idx, col_idx = _split_cell_key(str(key), sheet_lookup)
            if sheet_name is None:
                continue
            cell_ref = f"{get_column_letter(col_idx + 1)}{row_idx + 1}"
            tup = tuple(str(v) for v in values)
            grouped.setdefault(sheet_name, {}).setdefault(tup, []).append(cell_ref)
        for sheet_name, lists in grouped.items():
            sheet = wb[sheet_name]
            for values_tuple, cell_refs in lists.items():
                # openpyxl's list-formula expects a quoted CSV. Escape
                # double-quotes via doubling — Excel's own convention.
                escaped = ",".join(v.replace('"', '""') for v in values_tuple)
                dv = DataValidation(
                    type="list",
                    formula1=f'"{escaped}"',
                    allow_blank=True,
                    showDropDown=False,
                )
                for cell_ref in cell_refs:
                    dv.add(cell_ref)
                sheet.add_data_validation(dv)

    # Cell comments — straight openpyxl Comment(text, author).
    comments = edits.get("comments") or {}
    if isinstance(comments, dict):
        for key, payload in comments.items():
            if not isinstance(payload, dict):
                continue
            text = payload.get("text")
            if not isinstance(text, str) or not text:
                continue
            author = payload.get("author") or "doXmind"
            sheet_name, row_idx, col_idx = _split_cell_key(str(key), sheet_lookup)
            if sheet_name is None:
                continue
            wb[sheet_name].cell(row=row_idx + 1, column=col_idx + 1).comment = Comment(
                str(text), str(author)
            )

    # Conditional formatting — emit one Rule per CF entry. We use the
    # high-level helpers (CellIsRule / ColorScaleRule / FormulaRule) so
    # the produced .xlsx renders correctly in Excel and Sheets without
    # us having to construct DifferentialStyle DXFs by hand for the
    # plain-vanilla cases.
    cfmts = edits.get("conditionalFormats") or {}
    if isinstance(cfmts, dict):
        for sheet_id, rules in cfmts.items():
            sheet_name = sheet_lookup.get(str(sheet_id))
            if sheet_name is None or sheet_name not in wb.sheetnames:
                continue
            if not isinstance(rules, list):
                continue
            sheet = wb[sheet_name]
            for entry in rules:
                _apply_cf_rule(sheet, entry)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _apply_cf_rule(sheet: Worksheet, entry: Any) -> None:
    """Translate a single sidecar CF entry into an openpyxl conditional-
    formatting rule and attach it to ``sheet``. Silent no-op for malformed
    payloads — keeping export resilient to old/partial sidecars."""
    if not isinstance(entry, dict):
        return
    rng = entry.get("range")
    if not isinstance(rng, dict):
        return
    try:
        top = int(rng["top"])
        left = int(rng["left"])
        bottom = int(rng["bottom"])
        right = int(rng["right"])
    except (KeyError, TypeError, ValueError):
        return
    if top > bottom or left > right:
        return
    range_ref = (
        f"{get_column_letter(left + 1)}{top + 1}"
        f":{get_column_letter(right + 1)}{bottom + 1}"
    )

    cond = entry.get("condition") or {}
    if not isinstance(cond, dict):
        return
    kind = cond.get("kind")
    style = entry.get("style") or {}
    fill, font = _build_dxf(style if isinstance(style, dict) else {})

    if kind == "colorScale":
        try:
            min_color = _normalise_hex(cond.get("min", {}).get("color"))
            max_color = _normalise_hex(cond.get("max", {}).get("color"))
            mid_payload = cond.get("mid")
            if not min_color or not max_color:
                return
            if isinstance(mid_payload, dict):
                mid_color = _normalise_hex(mid_payload.get("color"))
                rule = ColorScaleRule(
                    start_type="min",
                    start_color=min_color,
                    mid_type="percentile",
                    mid_value=50,
                    mid_color=mid_color or "FFFFEB84",
                    end_type="max",
                    end_color=max_color,
                )
            else:
                rule = ColorScaleRule(
                    start_type="min",
                    start_color=min_color,
                    end_type="max",
                    end_color=max_color,
                )
            sheet.conditional_formatting.add(range_ref, rule)
        except Exception:
            return
        return

    if kind == "cellValue":
        op_map = {
            "gt": "greaterThan",
            "lt": "lessThan",
            "gte": "greaterThanOrEqual",
            "lte": "lessThanOrEqual",
            "eq": "equal",
            "neq": "notEqual",
        }
        operator = op_map.get(str(cond.get("op")))
        value = cond.get("value")
        if operator is None or value is None:
            return
        formula = [_format_cf_operand(value)]
        rule = CellIsRule(operator=operator, formula=formula, fill=fill, font=font)
        sheet.conditional_formatting.add(range_ref, rule)
        return

    if kind == "between":
        try:
            min_v = float(cond.get("min"))
            max_v = float(cond.get("max"))
        except (TypeError, ValueError):
            return
        rule = CellIsRule(
            operator="between",
            formula=[str(min_v), str(max_v)],
            fill=fill,
            font=font,
        )
        sheet.conditional_formatting.add(range_ref, rule)
        return

    if kind == "containsText":
        text = cond.get("text")
        if not isinstance(text, str) or text == "":
            return
        mode = str(cond.get("mode") or "contains")
        anchor = f"{get_column_letter(left + 1)}{top + 1}"
        escaped = text.replace('"', '""')
        if mode == "contains":
            formula = f'NOT(ISERROR(SEARCH("{escaped}",{anchor})))'
        elif mode == "notContains":
            formula = f'ISERROR(SEARCH("{escaped}",{anchor}))'
        elif mode == "startsWith":
            formula = f'LEFT({anchor},{len(text)})="{escaped}"'
        elif mode == "endsWith":
            formula = f'RIGHT({anchor},{len(text)})="{escaped}"'
        else:
            return
        rule = FormulaRule(formula=[formula], fill=fill, font=font)
        sheet.conditional_formatting.add(range_ref, rule)
        return

    if kind in ("duplicate", "unique"):
        rule_type = "duplicateValues" if kind == "duplicate" else "uniqueValues"
        dxf = DifferentialStyle(fill=fill, font=font)
        rule = Rule(type=rule_type, dxf=dxf)
        sheet.conditional_formatting.add(range_ref, rule)
        return

    if kind in ("blank", "notBlank"):
        anchor = f"{get_column_letter(left + 1)}{top + 1}"
        formula = f'LEN(TRIM({anchor}))=0' if kind == "blank" else f'LEN(TRIM({anchor}))>0'
        rule = FormulaRule(formula=[formula], fill=fill, font=font)
        sheet.conditional_formatting.add(range_ref, rule)
        return


def _format_cf_operand(value: Any) -> str:
    """Format a CF operand for openpyxl's `formula` array. Numbers go in
    bare; strings are double-quoted (with embedded quotes doubled)."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    s = str(value)
    if s == "":
        return '""'
    try:
        f = float(s)
        return str(f)
    except ValueError:
        pass
    escaped = s.replace('"', '""')
    return f'"{escaped}"'


def _build_dxf(style: dict[str, Any]) -> tuple[PatternFill | None, Font | None]:
    """Build the (fill, font) pair referenced by a CF rule's DifferentialStyle.
    The frontend's CF style is intentionally a small subset of `ExcelCellStyle`
    (background / color / bold / italic / underline / strikethrough)."""
    fill = None
    bg_hex = _normalise_hex(style.get("background")) if style.get("background") else None
    if bg_hex:
        fill = PatternFill(start_color=bg_hex, end_color=bg_hex, fill_type="solid")
    font_kwargs: dict[str, Any] = {}
    color_hex = _normalise_hex(style.get("color")) if style.get("color") else None
    if color_hex:
        font_kwargs["color"] = Color(rgb=color_hex)
    if style.get("bold"):
        font_kwargs["bold"] = True
    if style.get("italic"):
        font_kwargs["italic"] = True
    if style.get("underline"):
        font_kwargs["underline"] = "single"
    if style.get("strikethrough"):
        font_kwargs["strike"] = True
    font = Font(**font_kwargs) if font_kwargs else None
    return fill, font


_VERTICAL_ALIGN_MAP = {"top": "top", "middle": "center", "bottom": "bottom"}
_HORIZONTAL_ALIGN_MAP = {"left": "left", "center": "center", "right": "right"}

_FRONTEND_BORDER_STYLES = {"thin", "medium", "thick", "double", "dashed", "dotted"}


def _build_side(payload: Any) -> Side | None:
    if not isinstance(payload, dict):
        return None
    style_name = payload.get("style")
    if style_name not in _FRONTEND_BORDER_STYLES:
        return None
    color_hex = _normalise_hex(payload.get("color")) if payload.get("color") else None
    color = Color(rgb=color_hex) if color_hex else None
    return Side(style=style_name, color=color)


def _build_border(payload: dict[str, Any]) -> Border:
    """Translate the frontend's `ExcelBorderConfig` patch into an openpyxl
    ``Border``. Sides absent from the patch (or that don't map to a known
    style) are left as default ``Side`` objects with ``style=None``.
    """
    kwargs: dict[str, Any] = {}
    for side_name in ("top", "right", "bottom", "left"):
        if side_name in payload:
            built = _build_side(payload[side_name])
            kwargs[side_name] = built if built is not None else Side(style=None)
    return Border(**kwargs)


def _unique_sheet_name(wb: Workbook, preferred: str, *, exclude: str | None = None) -> str:
    """Return a sheet name that's unique within ``wb``. openpyxl raises if a
    duplicate title is assigned, so we suffix " 2", " 3", … until we find a
    free slot. ``exclude`` lets a rename keep its original name even though
    it's currently occupied.
    """
    base = (preferred or "Sheet").strip() or "Sheet"
    # Excel caps sheet names at 31 chars.
    base = base[:31]
    taken = {n for n in wb.sheetnames if n != exclude}
    if base not in taken:
        return base
    for i in range(2, 1000):
        candidate = f"{base[: max(1, 31 - len(str(i)) - 1)]} {i}"
        if candidate not in taken:
            return candidate
    return f"Sheet-{len(wb.sheetnames) + 1}"


def _normalise_hex(color: str) -> str | None:
    """Strip the leading `#` and pad to AARRGGBB so openpyxl is happy."""
    if not isinstance(color, str):
        return None
    raw = color.strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) == 6:
        return f"FF{raw.upper()}"
    if len(raw) == 8:
        return raw.upper()
    return None


def _apply_style_patch(cell: Cell, patch: dict[str, Any]) -> None:
    """Merge a frontend `ExcelCellStyle` patch onto an openpyxl cell.

    The patch is sparse — only fields the user actually changed appear.
    We rebuild the cell's `Font` / `Alignment` / `PatternFill` from the
    existing values plus the override so that touching one attribute
    doesn't reset the others (openpyxl's style objects are immutable, so
    in-place mutation isn't an option).
    """
    font = cell.font
    align = cell.alignment

    new_font_kwargs: dict[str, Any] = {}
    if "bold" in patch:
        new_font_kwargs["bold"] = bool(patch["bold"])
    if "italic" in patch:
        new_font_kwargs["italic"] = bool(patch["italic"])
    if "underline" in patch:
        new_font_kwargs["underline"] = "single" if patch["underline"] else None
    if "strikethrough" in patch:
        new_font_kwargs["strike"] = bool(patch["strikethrough"])
    if "fontSize" in patch and isinstance(patch["fontSize"], (int, float)):
        new_font_kwargs["size"] = float(patch["fontSize"])
    if "fontFamily" in patch and isinstance(patch["fontFamily"], str) and patch["fontFamily"]:
        new_font_kwargs["name"] = patch["fontFamily"]
    if "color" in patch:
        argb = _normalise_hex(patch["color"]) if patch["color"] else None
        new_font_kwargs["color"] = Color(rgb=argb) if argb else None
    if new_font_kwargs:
        cell.font = font.copy(**new_font_kwargs)

    new_align_kwargs: dict[str, Any] = {}
    if "textAlign" in patch and patch["textAlign"] in _HORIZONTAL_ALIGN_MAP:
        new_align_kwargs["horizontal"] = _HORIZONTAL_ALIGN_MAP[patch["textAlign"]]
    if "verticalAlign" in patch and patch["verticalAlign"] in _VERTICAL_ALIGN_MAP:
        new_align_kwargs["vertical"] = _VERTICAL_ALIGN_MAP[patch["verticalAlign"]]
    if "wrapText" in patch:
        new_align_kwargs["wrap_text"] = bool(patch["wrapText"])
    if "textOverflow" in patch:
        # openpyxl only knows about `wrap_text` — collapse the 3-state
        # frontend value to the closest Excel-native equivalent. "wrap"
        # turns wrap on; "clip" / "overflow" both turn it off (Excel
        # picks the actual clipping behaviour from cell width on its own).
        new_align_kwargs["wrap_text"] = patch["textOverflow"] == "wrap"
    if "rotation" in patch and isinstance(patch["rotation"], (int, float)):
        # openpyxl uses 0–90 for upward rotation, 91–180 for downward
        # (encoded as 90 + abs(degrees)). Clamp to that domain.
        deg = int(patch["rotation"])
        if deg >= 0:
            new_align_kwargs["text_rotation"] = max(0, min(90, deg))
        else:
            new_align_kwargs["text_rotation"] = max(91, min(180, 90 + abs(deg)))
    if new_align_kwargs:
        cell.alignment = align.copy(**new_align_kwargs)

    if "hyperlink" in patch:
        link = patch["hyperlink"]
        if isinstance(link, str) and link:
            cell.hyperlink = link
        else:
            cell.hyperlink = None

    if "background" in patch:
        bg = patch["background"]
        argb = _normalise_hex(bg) if bg else None
        if argb:
            cell.fill = PatternFill(fill_type="solid", fgColor=argb, bgColor=argb)
        else:
            # Drop the user fill — leave the cell with whatever the parsed
            # workbook had (openpyxl can't truly "delete" a fill, so we set
            # an empty PatternFill which is the convention for "no fill").
            cell.fill = PatternFill(fill_type=None)

    if "border" in patch:
        border_payload = patch["border"]
        if isinstance(border_payload, dict):
            cell.border = _build_border(border_payload)
        elif border_payload is None:
            cell.border = Border()


def _split_cell_key(
    key: str, sheet_lookup: dict[str, str]
) -> tuple[str | None, int, int]:
    try:
        sheet_id, coords = key.split("!", 1)
        row_str, col_str = coords.split(",", 1)
        return sheet_lookup.get(sheet_id), int(row_str), int(col_str)
    except (ValueError, AttributeError):
        return None, 0, 0


def _split_row_key(
    key: str, sheet_lookup: dict[str, str]
) -> tuple[str | None, int]:
    try:
        sheet_id, row_str = key.split("!", 1)
        return sheet_lookup.get(sheet_id), int(row_str)
    except (ValueError, AttributeError):
        return None, 0


def _split_col_key(
    key: str, sheet_lookup: dict[str, str]
) -> tuple[str | None, int]:
    try:
        sheet_id, col_str = key.split("!", 1)
        return sheet_lookup.get(sheet_id), int(col_str)
    except (ValueError, AttributeError):
        return None, 0
