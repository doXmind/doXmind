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

import io
import logging
from dataclasses import dataclass
from typing import Any

from openpyxl import load_workbook
from openpyxl.cell.cell import Cell
from openpyxl.utils import get_column_letter
from openpyxl.workbook.workbook import Workbook
from openpyxl.worksheet.worksheet import Worksheet

logger = logging.getLogger(__name__)

# Defensive caps. A pathological workbook can exceed Excel's nominal
# 1,048,576 rows × 16,384 columns; even normal sheets often have used_range
# stretching off into empty territory. We clamp to a reasonable viewport so
# the JSON payload stays bounded.
MAX_SHEETS = 64
MAX_ROWS_PER_SHEET = 5000
MAX_COLS_PER_SHEET = 200


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

    try:
        # data_only=False so we keep the raw formulas. Frontend gets a
        # second pass with data_only=True for the cached results.
        wb_formulas = load_workbook(
            io.BytesIO(xlsx_bytes), data_only=False, read_only=False
        )
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

    for index, name in enumerate(wb_formulas.sheetnames):
        if index >= parse_limits.max_sheets:
            break
        formula_sheet = wb_formulas[name]
        value_sheet = wb_values[name] if name in wb_values.sheetnames else None
        sheet_dto, sheet_truncations = _parse_sheet(
            formula_sheet,
            value_sheet,
            index=index,
            limits=parse_limits,
        )
        sheets.append(sheet_dto)
        if sheet_truncations.get("rows"):
            rows_truncated[sheet_dto["id"]] = True
        if sheet_truncations.get("cols"):
            cols_truncated[sheet_dto["id"]] = True

    return {
        "version": 1,
        "sheets": sheets,
        "truncated": {
            "sheets": truncated_sheets,
            "rowsBy": rows_truncated,
            "colsBy": cols_truncated,
        },
    }


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
        for row_idx, formula_row in enumerate(
            formula_sheet.iter_rows(
                min_row=1,
                max_row=row_count,
                min_col=1,
                max_col=col_count,
            )
        ):
            value_row: tuple[Any, ...] | None = None
            if value_sheet is not None:
                value_row_iter = next(
                    iter(
                        value_sheet.iter_rows(
                            min_row=row_idx + 1,
                            max_row=row_idx + 1,
                            min_col=1,
                            max_col=col_count,
                            values_only=True,
                        )
                    ),
                    None,
                )
                value_row = value_row_iter

            for col_idx, cell in enumerate(formula_row):
                cached_value = (
                    value_row[col_idx]
                    if value_row is not None and col_idx < len(value_row)
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
    return style


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
          "cells": {
            "sheet-0!0,0": {"value": "Hello"},
            "sheet-0!1,2": {"formula": "=A1+B1"},
            "sheet-0!2,0": {"value": null}                  # clear cell
          },
          "rowHeights": {"sheet-0!0": 32.5},
          "colWidths":  {"sheet-0!4": 140.0}
        }

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

    sheet_lookup = {f"sheet-{i}": name for i, name in enumerate(wb.sheetnames)}

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

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


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
