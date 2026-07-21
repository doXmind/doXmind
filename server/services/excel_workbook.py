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

import csv
import hashlib
import io
import logging
import math
import os
import xml.etree.ElementTree as ET
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import PurePosixPath
from threading import Lock
from typing import Any

# Cache encode/decode: prefer orjson (Rust-backed, ~2x stdlib on multi-MB
# DTOs). Falls back to stdlib json if orjson is somehow unavailable so the
# server still works even with a stripped-down env.
try:
    import orjson as _json  # type: ignore[import-not-found]

    def _cache_encode(obj: Any) -> bytes:
        return _json.dumps(obj)

    def _cache_decode(data: bytes) -> Any:
        return _json.loads(data)

except ImportError:  # pragma: no cover — orjson is in requirements.txt
    import json as _stdlib_json

    def _cache_encode(obj: Any) -> bytes:
        return _stdlib_json.dumps(obj).encode("utf-8")

    def _cache_decode(data: bytes) -> Any:
        return _stdlib_json.loads(data)


from openpyxl import load_workbook
from openpyxl.cell.cell import Cell
from openpyxl.comments import Comment
from openpyxl.compat.strings import safe_string
from openpyxl.formatting.rule import (
    CellIsRule,
    ColorScaleRule,
    FormulaRule,
    Rule,
)
from openpyxl.styles import Border, Font, PatternFill, Side
from openpyxl.styles.colors import Color
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.styles.numbers import is_date_format
from openpyxl.utils import get_column_letter, range_boundaries
from openpyxl.utils.datetime import from_excel
from openpyxl.workbook.workbook import Workbook
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.worksheet import Worksheet

from lib.timing import record as perf_record
from lib.timing import timed as perf_timed

logger = logging.getLogger(__name__)

# Defensive caps. A pathological workbook can exceed Excel's nominal
# 1,048,576 rows × 16,384 columns; even normal sheets often have used_range
# stretching off into empty territory. We clamp to a reasonable viewport so
# the JSON payload stays bounded.
MAX_SHEETS = 64
MAX_ROWS_PER_SHEET = 5000
MAX_COLS_PER_SHEET = 200
_SHEET_LAYOUT_MARKERS = (
    b"<cols",
    b":cols",
    b"<mergeCell",
    b":mergeCell",
    b"<pane",
    b":pane",
    b"<hyperlink",
    b":hyperlink",
    b" ht=",
)
_REL_ID_ATTR = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

# Process-local LRU cache for parsed workbook DTOs. The dual openpyxl load
# in parse_workbook is the slowest backend operation in the whole app
# (15+ seconds on an 8 MB workbook); even with the frontend sidecar cache,
# every fresh process or post-edit save pays it again. Hashing the input
# bytes is ~30 ms on big workbooks — trivial next to the 15 s parse it
# replaces. The hash also serves as a content fingerprint, so any
# byte-level modification invalidates automatically.
#
# Cache values are stored as JSON-encoded bytes (not Python dicts) so that
# every hit returns a freshly-parsed dict with mutation isolation, without
# paying for `copy.deepcopy` on the way out. On a 50k-cell workbook
# deepcopy was ~450 ms / hit; json round-trip via stdlib was ~96 ms;
# orjson brings that down to ~42 ms — still slower than serving a shared
# reference, but isolation is a hard requirement for cache safety.
#
# FUTURE WORK: the FastAPI handler that consumes this result already
# JSON-serialises it for the response, so the in-process "isolation" we
# pay for here is defending an attack surface that doesn't exist in
# practice. A cleaner design would have the handler own the read-only
# contract (cache returns a shared reference; handler must not mutate
# before the response is dispatched). That removes the per-hit decode
# entirely and pushes large.repeat-cache-hit closer to 0. Not done in
# this PR because it crosses the cache/handler boundary and warrants a
# focused review; tracked at PR #60 review thread.
_XLSX_CACHE_MAX = 8
_XLSX_CACHE: OrderedDict[str, bytes] = OrderedDict()
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
    cache_key = _workbook_cache_key(xlsx_bytes)
    cached = _cached_workbook_json(cache_key)
    if cached is not None:
        # JSON round-trip rather than deepcopy: every hit gets a fresh dict
        # (mutation by future callers can't corrupt the entry) while avoiding
        # ~10x the per-cell overhead of CPython's copy.deepcopy on a
        # deeply-nested DTO. orjson roughly halves the decode cost again on
        # multi-MB DTOs.
        return _cache_decode(cached)

    parse_limits = limits or ParseLimits()
    result = _parse_workbook_uncached(xlsx_bytes, parse_limits)
    _store_workbook_json(cache_key, _cache_encode(result))
    return result


def parse_workbook_json_bytes(
    xlsx_bytes: bytes,
    *,
    limits: ParseLimits | None = None,
) -> bytes:
    """Parse an .xlsx blob and return the wire-ready JSON representation.

    The FastAPI endpoint can stream these bytes directly. On cache hits this
    avoids a large JSON bytes -> Python dict -> JSON bytes round-trip; on cold
    parses it still uses the same encoded bytes that populate the LRU.
    """
    cache_key = _workbook_cache_key(xlsx_bytes)
    cached = _cached_workbook_json(cache_key)
    if cached is not None:
        return cached

    parse_limits = limits or ParseLimits()
    encoded = _cache_encode(_parse_workbook_uncached(xlsx_bytes, parse_limits))
    _store_workbook_json(cache_key, encoded)
    return encoded


def parse_csv_workbook_json_bytes(
    csv_bytes: bytes,
    *,
    limits: ParseLimits | None = None,
) -> bytes:
    """Parse a CSV blob into the same single-sheet JSON model as an .xlsx."""
    if not csv_bytes:
        raise ValueError("empty csv body")
    cache_key = _csv_cache_key(csv_bytes)
    cached = _cached_workbook_json(cache_key)
    if cached is not None:
        return cached

    parse_limits = limits or ParseLimits()
    encoded = _cache_encode(_parse_csv_uncached(csv_bytes, parse_limits))
    _store_workbook_json(cache_key, encoded)
    return encoded


def csv_to_xlsx_bytes(csv_bytes: bytes) -> bytes:
    """Build a minimal .xlsx workbook from CSV bytes for export-edited."""
    wb = _workbook_from_csv_bytes(csv_bytes, ParseLimits())
    out = io.BytesIO()
    wb.save(out)
    wb.close()
    return out.getvalue()


def _workbook_cache_key(xlsx_bytes: bytes) -> str | None:
    if not xlsx_bytes:
        raise ValueError("empty xlsx body")
    if _xlsx_cache_disabled():
        return None
    with perf_timed("excel.parse_workbook.hash", bytes=len(xlsx_bytes)):
        return hashlib.sha256(xlsx_bytes).hexdigest()


def _csv_cache_key(csv_bytes: bytes) -> str | None:
    if _xlsx_cache_disabled():
        return None
    with perf_timed("excel.parse_csv.hash", bytes=len(csv_bytes)):
        return "csv:" + hashlib.sha256(csv_bytes).hexdigest()


def _parse_csv_uncached(csv_bytes: bytes, parse_limits: ParseLimits) -> dict[str, Any]:
    with perf_timed("excel.parse_csv.total", bytes=len(csv_bytes)):
        wb = _workbook_from_csv_bytes(csv_bytes, parse_limits)
        try:
            sheet = wb.active
            assert sheet is not None
            sheet_dto, sheet_truncations = _parse_sheet(
                sheet,
                value_sheet_loader=None,
                index=0,
                limits=parse_limits,
            )
        finally:
            wb.close()

    return {
        "version": 1,
        "sheets": [sheet_dto],
        "truncated": {
            "sheets": False,
            "rowsBy": {"sheet-0": True} if sheet_truncations.get("rows") else {},
            "colsBy": {"sheet-0": True} if sheet_truncations.get("cols") else {},
        },
    }


def _workbook_from_csv_bytes(csv_bytes: bytes, limits: ParseLimits) -> Workbook:
    try:
        text = csv_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("failed to parse csv: expected UTF-8 text") from exc

    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "Sheet1"
    raw_rows = 0
    raw_cols = 0
    try:
        reader = csv.reader(io.StringIO(text))
        for raw_rows, row in enumerate(reader, start=1):
            raw_cols = max(raw_cols, len(row))
            if raw_rows > limits.max_rows:
                continue
            for col_index, value in enumerate(row[: limits.max_cols], start=1):
                if value != "":
                    ws.cell(row=raw_rows, column=col_index, value=value)
    except csv.Error as exc:
        raise ValueError(f"failed to parse csv: {exc}") from exc
    if raw_rows > limits.max_rows:
        ws.cell(row=limits.max_rows + 1, column=1, value=None)
    if raw_cols > limits.max_cols:
        ws.cell(row=1, column=limits.max_cols + 1, value=None)
    return wb


def _cached_workbook_json(cache_key: str | None) -> bytes | None:
    if cache_key is None:
        return None
    with _XLSX_CACHE_LOCK:
        cached = _XLSX_CACHE.get(cache_key)
        if cached is None:
            return None
        _XLSX_CACHE.move_to_end(cache_key)
        perf_record("excel.parse_workbook.cache_hit")
        return cached


def _store_workbook_json(cache_key: str | None, encoded: bytes) -> None:
    if cache_key is None:
        return
    with _XLSX_CACHE_LOCK:
        _XLSX_CACHE[cache_key] = encoded
        _XLSX_CACHE.move_to_end(cache_key)
        while len(_XLSX_CACHE) > _XLSX_CACHE_MAX:
            _XLSX_CACHE.popitem(last=False)


def _parse_workbook_uncached(xlsx_bytes: bytes, parse_limits: ParseLimits) -> dict[str, Any]:
    with perf_timed("excel.parse_workbook.total", bytes=len(xlsx_bytes)) as total_span:
        wb_formulas: Workbook | None = None
        wb_values: Workbook | None = None
        try:
            # data_only=False so we keep the raw formulas. Frontend gets a
            # lazy second pass with data_only=True only if formula cells need
            # cached values. Plain data tables avoid a full second workbook
            # load on cold open.
            with perf_timed("excel.load_data_only_false"):
                wb_formulas = load_workbook(io.BytesIO(xlsx_bytes), data_only=False, read_only=True)
        except Exception as exc:
            # openpyxl raises a grab-bag of exception types on malformed files.
            raise ValueError(f"failed to parse xlsx: {exc}") from exc

        def value_sheet_for(name: str) -> Worksheet | None:
            nonlocal wb_values
            if wb_values is None:
                with perf_timed("excel.load_data_only_true"):
                    wb_values = load_workbook(
                        io.BytesIO(xlsx_bytes), data_only=True, read_only=True
                    )
            return wb_values[name] if name in wb_values.sheetnames else None

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
                    sheet_dto, sheet_truncations = _parse_sheet(
                        formula_sheet,
                        value_sheet_loader=lambda sheet_name=name: value_sheet_for(sheet_name),
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
        except Exception as exc:
            raise ValueError(f"failed to parse xlsx: {exc}") from exc
        finally:
            if wb_formulas is not None:
                wb_formulas.close()
            if wb_values is not None:
                wb_values.close()

    result = {
        "version": 1,
        "sheets": sheets,
        "truncated": {
            "sheets": truncated_sheets,
            "rowsBy": rows_truncated,
            "colsBy": cols_truncated,
        },
    }

    return result


def _parse_sheet(
    formula_sheet: Worksheet,
    value_sheet_loader: Callable[[], Worksheet | None] | None = None,
    *,
    index: int,
    limits: ParseLimits,
) -> tuple[dict[str, Any], dict[str, bool]]:
    sheet_id = f"sheet-{index}"
    cells: list[dict[str, Any]] = []
    raw_rows_hint = formula_sheet.max_row or 0
    raw_cols_hint = formula_sheet.max_column or 0
    raw_rows = raw_rows_hint
    raw_cols = raw_cols_hint
    layout: (
        tuple[
            dict[str, float],
            dict[str, float],
            list[dict[str, int]],
            dict[str, int],
            dict[tuple[int, int], str],
        ]
        | None
    ) = None

    if hasattr(formula_sheet, "_cells"):
        row_count = min(raw_rows, limits.max_rows)
        col_count = min(raw_cols, limits.max_cols)
        materialized: list[Cell] = []
        formula_coords: set[tuple[int, int]] = set()
        for cell in formula_sheet._cells.values():
            if cell.row < 1 or cell.row > row_count:
                continue
            if cell.column < 1 or cell.column > col_count:
                continue
            materialized.append(cell)
            raw = cell.value
            if isinstance(raw, str) and raw.startswith("="):
                formula_coords.add((cell.row - 1, cell.column - 1))
        value_sheet = value_sheet_loader() if formula_coords and value_sheet_loader else None
        cached_formula_values = _cached_formula_values(value_sheet, formula_coords)

        for cell in sorted(materialized, key=lambda item: (item.row, item.column)):
            row_idx = cell.row - 1
            col_idx = cell.column - 1
            raw = cell.value
            is_formula = isinstance(raw, str) and raw.startswith("=")
            if (
                raw is not None
                and not is_formula
                and not cell.has_style
                and cell.number_format == "General"
                and cell.hyperlink is None
            ):
                cells.append(
                    {
                        "row": row_idx,
                        "col": col_idx,
                        "value": (
                            raw
                            if isinstance(raw, (str, int, float, bool))
                            else _coerce_jsonable(raw)
                        ),
                        "formula": None,
                    }
                )
                continue
            dto = _cell_to_dto(
                cell,
                cached_value=(
                    cached_formula_values.get((row_idx, col_idx)) if is_formula else None
                ),
                row=row_idx,
                col=col_idx,
            )
            if dto is not None:
                cells.append(dto)
    else:
        max_col_arg = min(raw_cols_hint or limits.max_cols, limits.max_cols)
        materialized: list[Any] = []
        formula_coords: set[tuple[int, int]] = set()
        for row in formula_sheet.iter_rows(
            min_row=1,
            max_row=limits.max_rows,
            min_col=1,
            max_col=max_col_arg,
        ):
            for cell in row:
                row_number = getattr(cell, "row", None)
                column_number = getattr(cell, "column", None)
                if row_number is None or column_number is None:
                    continue
                raw_rows = max(raw_rows, int(row_number))
                raw_cols = max(raw_cols, int(column_number))
                row_idx = int(row_number) - 1
                col_idx = int(column_number) - 1
                materialized.append(cell)
                raw = cell.value
                if isinstance(raw, str) and raw.startswith("="):
                    formula_coords.add((row_idx, col_idx))

        row_count = min(raw_rows, limits.max_rows)
        col_count = min(raw_cols, limits.max_cols)
        layout = _sheet_layout(
            formula_sheet,
            row_count=row_count,
            col_count=col_count,
        )
        read_only_hyperlinks = layout[4]

        cached_formula_values = _cached_formula_values_from_formula_xml(
            formula_sheet,
            formula_coords,
        )
        if len(cached_formula_values) < len(formula_coords):
            value_sheet = value_sheet_loader() if formula_coords and value_sheet_loader else None
            cached_formula_values = {
                **_cached_formula_values(value_sheet, formula_coords),
                **cached_formula_values,
            }

        for cell in materialized:
            row_idx = int(cell.row) - 1
            col_idx = int(cell.column) - 1
            if row_idx >= row_count or col_idx >= col_count:
                continue
            raw = cell.value
            is_formula = isinstance(raw, str) and raw.startswith("=")
            hyperlink = read_only_hyperlinks.get((row_idx, col_idx))
            if (
                raw is not None
                and not is_formula
                and not getattr(cell, "has_style", False)
                and getattr(cell, "number_format", "General") == "General"
                and hyperlink is None
            ):
                cells.append(
                    {
                        "row": row_idx,
                        "col": col_idx,
                        "value": (
                            raw
                            if isinstance(raw, (str, int, float, bool))
                            else _coerce_jsonable(raw)
                        ),
                        "formula": None,
                    }
                )
                continue
            dto = _cell_to_dto(
                cell,
                cached_value=(
                    cached_formula_values.get((row_idx, col_idx)) if is_formula else None
                ),
                hyperlink=hyperlink,
                row=row_idx,
                col=col_idx,
            )
            if dto is not None:
                cells.append(dto)

    row_count = min(raw_rows, limits.max_rows)
    col_count = min(raw_cols, limits.max_cols)

    if layout is None:
        layout = _sheet_layout(formula_sheet, row_count=row_count, col_count=col_count)
    row_heights, col_widths, merges, frozen, _hyperlinks = layout

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


def _sheet_layout(
    sheet: Any,
    *,
    row_count: int,
    col_count: int,
) -> tuple[
    dict[str, float],
    dict[str, float],
    list[dict[str, int]],
    dict[str, int],
    dict[tuple[int, int], str],
]:
    if hasattr(sheet, "row_dimensions") and hasattr(sheet, "column_dimensions"):
        row_heights: dict[str, float] = {}
        for row_idx, dim in (sheet.row_dimensions or {}).items():
            if dim.height is None:
                continue
            # openpyxl indexes rows from 1; we serialise zero-based.
            if not isinstance(row_idx, int):
                continue
            if row_idx < 1 or row_idx > row_count:
                continue
            row_heights[str(row_idx - 1)] = float(dim.height)

        col_widths: dict[str, float] = {}
        for col_letter, dim in (sheet.column_dimensions or {}).items():
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
        for merged_range in sheet.merged_cells.ranges:
            merges.append(
                {
                    "top": merged_range.min_row - 1,
                    "left": merged_range.min_col - 1,
                    "bottom": merged_range.max_row - 1,
                    "right": merged_range.max_col - 1,
                }
            )
        return row_heights, col_widths, merges, _frozen_panes(sheet), {}

    return _read_only_sheet_layout(sheet, row_count=row_count, col_count=col_count)


def _read_only_sheet_layout(
    sheet: Any,
    *,
    row_count: int,
    col_count: int,
) -> tuple[
    dict[str, float],
    dict[str, float],
    list[dict[str, int]],
    dict[str, int],
    dict[tuple[int, int], str],
]:
    archive = getattr(getattr(sheet, "parent", None), "_archive", None)
    worksheet_path = getattr(sheet, "_worksheet_path", None)
    if archive is None or worksheet_path is None:
        return {}, {}, [], {"row": 0, "col": 0}, {}

    row_heights: dict[str, float] = {}
    col_widths: dict[str, float] = {}
    merges: list[dict[str, int]] = []
    frozen = {"row": 0, "col": 0}
    hyperlinks: dict[tuple[int, int], str] = {}

    payload = archive.read(worksheet_path)
    if not any(marker in payload for marker in _SHEET_LAYOUT_MARKERS):
        return row_heights, col_widths, merges, frozen, hyperlinks

    rels = _read_sheet_relationships(archive, worksheet_path)

    with io.BytesIO(payload) as fh:
        for _event, elem in ET.iterparse(fh, events=("end",)):
            tag = elem.tag.rsplit("}", 1)[-1]
            if tag == "row":
                row_ref = elem.get("r")
                height = elem.get("ht")
                if row_ref and height:
                    try:
                        row_idx = int(row_ref)
                        if 1 <= row_idx <= row_count:
                            row_heights[str(row_idx - 1)] = float(height)
                    except ValueError:
                        pass
            elif tag == "col":
                width = elem.get("width")
                if width:
                    try:
                        min_col = int(elem.get("min", "1"))
                        max_col = int(elem.get("max", str(min_col)))
                        parsed_width = float(width)
                    except ValueError:
                        elem.clear()
                        continue
                    for col_idx in range(max(min_col, 1), min(max_col, col_count) + 1):
                        col_widths[str(col_idx - 1)] = parsed_width
            elif tag == "mergeCell":
                ref = elem.get("ref")
                if ref:
                    try:
                        min_col, min_row, max_col, max_row = range_boundaries(ref)
                    except ValueError:
                        elem.clear()
                        continue
                    if min_row <= row_count and min_col <= col_count:
                        merges.append(
                            {
                                "top": min_row - 1,
                                "left": min_col - 1,
                                "bottom": min(max_row, row_count) - 1,
                                "right": min(max_col, col_count) - 1,
                            }
                        )
            elif tag == "pane":
                top_left = elem.get("topLeftCell")
                if top_left:
                    frozen = _frozen_from_cell_ref(top_left)
                else:
                    try:
                        frozen = {
                            "row": max(int(float(elem.get("ySplit", "0"))), 0),
                            "col": max(int(float(elem.get("xSplit", "0"))), 0),
                        }
                    except ValueError:
                        frozen = {"row": 0, "col": 0}
            elif tag == "hyperlink":
                ref = elem.get("ref")
                target = elem.get("location")
                rel_id = elem.get(_REL_ID_ATTR)
                if rel_id and rel_id in rels:
                    target = rels[rel_id]
                if ref and target:
                    _add_hyperlink_refs(hyperlinks, ref, target, row_count, col_count)
            elem.clear()

    return row_heights, col_widths, merges, frozen, hyperlinks


def _read_sheet_relationships(archive: Any, worksheet_path: str) -> dict[str, str]:
    path = PurePosixPath(worksheet_path)
    rels_path = path.parent / "_rels" / f"{path.name}.rels"
    try:
        payload = archive.read(str(rels_path))
    except KeyError:
        return {}

    rels: dict[str, str] = {}
    for _event, elem in ET.iterparse(io.BytesIO(payload), events=("end",)):
        if elem.tag.rsplit("}", 1)[-1] != "Relationship":
            elem.clear()
            continue
        rel_id = elem.get("Id")
        target = elem.get("Target")
        if rel_id and target:
            rels[rel_id] = target
        elem.clear()
    return rels


def _add_hyperlink_refs(
    hyperlinks: dict[tuple[int, int], str],
    ref: str,
    target: str,
    row_count: int,
    col_count: int,
) -> None:
    try:
        min_col, min_row, max_col, max_row = range_boundaries(ref)
    except ValueError:
        return
    for row_idx in range(max(min_row, 1), min(max_row, row_count) + 1):
        for col_idx in range(max(min_col, 1), min(max_col, col_count) + 1):
            hyperlinks[(row_idx - 1, col_idx - 1)] = target


def _cached_formula_values_from_formula_xml(
    formula_sheet: Any,
    formula_coords: set[tuple[int, int]],
) -> dict[tuple[int, int], Any]:
    if not formula_coords:
        return {}
    archive = getattr(getattr(formula_sheet, "parent", None), "_archive", None)
    worksheet_path = getattr(formula_sheet, "_worksheet_path", None)
    if archive is None or worksheet_path is None:
        return {}

    shared_strings = getattr(formula_sheet, "_shared_strings", []) or []
    payload = archive.read(worksheet_path)

    cached: dict[tuple[int, int], Any] = {}
    with io.BytesIO(payload) as fh:
        for _event, elem in ET.iterparse(fh, events=("end",)):
            tag = elem.tag.rsplit("}", 1)[-1]
            if tag != "c":
                continue
            ref = elem.get("r")
            if not ref:
                elem.clear()
                continue
            try:
                col, row, _max_col, _max_row = range_boundaries(ref)
            except ValueError:
                elem.clear()
                continue
            coord = (row - 1, col - 1)
            if coord in formula_coords:
                cached[coord] = _cached_formula_cell_value(elem, shared_strings)
                if len(cached) == len(formula_coords):
                    elem.clear()
                    break
            elem.clear()
    return cached


def _cached_formula_cell_value(elem: ET.Element, shared_strings: list[Any]) -> Any:
    cell_type = elem.get("t")
    value_text: str | None = None
    inline_text: str | None = None
    for child in elem:
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "v":
            value_text = child.text
        elif tag == "is":
            inline_text = "".join(child.itertext())

    if inline_text is not None:
        return inline_text
    if value_text is None:
        return None
    if cell_type == "s":
        try:
            return shared_strings[int(value_text)]
        except (ValueError, IndexError):
            return value_text
    if cell_type == "b":
        return value_text == "1"
    if cell_type in {"str", "e"}:
        return value_text
    try:
        numeric = float(value_text)
    except ValueError:
        return value_text
    return int(numeric) if numeric.is_integer() else numeric


def _cached_formula_values(
    value_sheet: Any | None,
    formula_coords: set[tuple[int, int]],
) -> dict[tuple[int, int], Any]:
    if value_sheet is None or not formula_coords:
        return {}

    min_row = min(row for row, _ in formula_coords) + 1
    max_row = max(row for row, _ in formula_coords) + 1
    min_col = min(col for _, col in formula_coords) + 1
    max_col = max(col for _, col in formula_coords) + 1
    wanted = formula_coords
    cached: dict[tuple[int, int], Any] = {}

    for row_offset, values in enumerate(
        value_sheet.iter_rows(
            min_row=min_row,
            max_row=max_row,
            min_col=min_col,
            max_col=max_col,
            values_only=True,
        )
    ):
        row_idx = min_row - 1 + row_offset
        for col_offset, value in enumerate(values):
            col_idx = min_col - 1 + col_offset
            if (row_idx, col_idx) in wanted:
                cached[(row_idx, col_idx)] = value
    return cached


def _cell_to_dto(
    cell: Any,
    *,
    cached_value: Any,
    hyperlink: str | None = None,
    row: int,
    col: int,
) -> dict[str, Any] | None:
    raw = cell.value
    formula: str | None = None
    value: Any = raw

    if isinstance(raw, str) and raw.startswith("="):
        formula = raw
        value = _formula_cached_value_for_cell(cell, cached_value)

    if value is None and formula is None and not _has_visible_style(cell, hyperlink=hyperlink):
        return None

    style = _cell_style(cell, hyperlink=hyperlink)
    dto: dict[str, Any] = {
        "row": row,
        "col": col,
        "value": _coerce_jsonable(value),
        "formula": formula,
    }
    number_format = getattr(cell, "number_format", None)
    if number_format and number_format != "General":
        dto["numberFormat"] = number_format
    if style:
        dto["style"] = style
    return dto


def _formula_cached_value_for_cell(cell: Any, cached_value: Any) -> Any:
    if (
        cached_value is None
        or isinstance(cached_value, bool)
        or not isinstance(cached_value, (int, float))
    ):
        return cached_value
    number_format = getattr(cell, "number_format", None)
    if not number_format or not is_date_format(number_format):
        return cached_value
    workbook = getattr(getattr(cell, "parent", None), "parent", None)
    try:
        epoch = getattr(workbook, "epoch", None)
        return (
            from_excel(cached_value, epoch=epoch) if epoch is not None else from_excel(cached_value)
        )
    except Exception:
        return cached_value


def _has_visible_style(cell: Any, *, hyperlink: str | None = None) -> bool:
    """True when a blank cell still carries paint we want to preserve."""
    if hyperlink:
        return True
    if getattr(cell, "has_style", False):
        font = getattr(cell, "font", None)
        if font is not None and (font.bold or font.italic or font.underline):
            return True
        if font is not None and font.color and font.color.rgb:
            return True
        fill = getattr(cell, "fill", None)
        if fill is not None and fill.fgColor and getattr(fill.fgColor, "rgb", None):
            rgb = fill.fgColor.rgb
            if isinstance(rgb, str) and rgb not in {"00000000", "FFFFFFFF"}:
                return True
    return False


def _cell_style(cell: Any, *, hyperlink: str | None = None) -> dict[str, Any]:
    style: dict[str, Any] = {}
    if not getattr(cell, "has_style", False):
        if hyperlink:
            style["hyperlink"] = hyperlink
        return style
    font = getattr(cell, "font", None)
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
    fill = getattr(cell, "fill", None)
    if fill is not None and fill.fgColor:
        bg = _color_to_hex(fill.fgColor)
        if bg and bg.lower() not in {"#000000", "#ffffff"}:
            style["background"] = bg
    alignment = getattr(cell, "alignment", None)
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
    cell_hyperlink = getattr(cell, "hyperlink", None)
    if hyperlink:
        style["hyperlink"] = hyperlink
    elif cell_hyperlink is not None:
        target = getattr(cell_hyperlink, "target", None) or getattr(cell_hyperlink, "ref", None)
        if isinstance(target, str) and target:
            style["hyperlink"] = target
    border = _border_to_dict(getattr(cell, "border", None))
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
    return _frozen_from_cell_ref(cell_ref)


def _frozen_from_cell_ref(cell_ref: str) -> dict[str, int]:
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
    *,
    strict_recovery: bool = False,
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
    sheet_lookup: dict[str, str] = {f"sheet-{i}": name for i, name in enumerate(wb.sheetnames)}
    if strict_recovery:
        _validate_recovery_targets(edits, wb, sheet_lookup)
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

    if strict_recovery and edits.get("activeSheetId") is not None:
        active_name = sheet_lookup[edits["activeSheetId"]]
        wb.active = wb[active_name]

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
            if strict_recovery and isinstance(value, str) and value.startswith("="):
                sheet[cell_ref].data_type = "s"
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
            # updatedAt is legacy UI metadata. Strict recovery validates it,
            # but XLSX comments have no timestamp field to preserve.
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
            for index, entry in enumerate(rules):
                applied = _apply_cf_rule(sheet, entry, exact=strict_recovery)
                if strict_recovery and not applied:
                    raise ValueError(
                        f"recovery conditional format {sheet_id!r}[{index}] was not applied"
                    )

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _validate_recovery_targets(
    edits: dict[str, Any],
    wb: Workbook,
    sheet_lookup: dict[str, str],
) -> None:
    """Reject recovery entries the permissive legacy exporter would omit."""
    _validate_recovery_top_level(edits)
    merge_ranges = {
        sheet_id: [
            (rng.min_row - 1, rng.min_col - 1, rng.max_row - 1, rng.max_col - 1)
            for rng in wb[sheet_name].merged_cells.ranges
        ]
        for sheet_id, sheet_name in sheet_lookup.items()
    }
    final_lookup = _validate_recovery_workbook_ops(
        edits.get("workbookOps") or [],
        sheet_lookup,
        merge_ranges,
    )
    _validate_recovery_structural_ops(
        edits.get("ops") or [],
        final_lookup,
        merge_ranges,
    )

    for key, payload in (edits.get("cells") or {}).items():
        sheet_id, row, col = _parse_recovery_cell_key(key, final_lookup, "cells")
        _require_recovery_merged_anchor(sheet_id, row, col, merge_ranges, f"cell {key!r}")
        sheet_name = final_lookup[sheet_id]
        source_value = (
            wb[sheet_name].cell(row=row + 1, column=col + 1).value
            if sheet_name in wb.sheetnames
            else None
        )
        _validate_recovery_cell_payload(key, payload, source_value=source_value)

    _validate_recovery_validations(
        edits.get("validations") or {},
        final_lookup,
        merge_ranges,
        wb,
    )
    _validate_recovery_comments(
        edits.get("comments") or {},
        final_lookup,
        merge_ranges,
    )

    for field, max_index in (
        ("rowHeights", _EXCEL_MAX_ROW_INDEX),
        ("colWidths", _EXCEL_MAX_COL_INDEX),
    ):
        for key, value in (edits.get(field) or {}).items():
            _parse_recovery_dimension_key(key, final_lookup, field, max_index)
            number = _require_recovery_number(value, f"{field}[{key!r}]", positive=True)
            maximum = 409.5 if field == "rowHeights" else 255
            if number > maximum:
                raise ValueError(f"recovery {field}[{key!r}] exceeds Excel's {maximum} limit")

    _validate_recovery_frozen(edits.get("frozen") or {}, final_lookup)
    _validate_recovery_conditional_formats(
        edits.get("conditionalFormats") or {},
        final_lookup,
    )

    active_sheet_id = edits.get("activeSheetId")
    if active_sheet_id is not None:
        _require_recovery_sheet(active_sheet_id, final_lookup, "active sheet")


_RECOVERY_WORKBOOK_OP_FIELDS = {
    "addSheet": ({"type", "sheetId", "name"}, {"afterSheetId"}),
}


def _validate_recovery_workbook_ops(
    ops: list[Any],
    sheet_lookup: dict[str, str],
    merge_ranges: dict[str, list[tuple[int, int, int, int]]],
) -> dict[str, str]:
    final_lookup = dict(sheet_lookup)
    for index, op in enumerate(ops):
        field = f"workbookOps[{index}]"
        if not isinstance(op, dict):
            raise ValueError(f"recovery {field} must be an object")
        op_type = op.get("type")
        schema = _RECOVERY_WORKBOOK_OP_FIELDS.get(op_type)
        if schema is None:
            raise ValueError(f"recovery {field} has an unsupported type {op_type!r}")
        required, optional = schema
        missing = required - set(op)
        unknown = set(op) - required - optional
        if missing or unknown:
            detail = sorted(missing or unknown)[0]
            raise ValueError(f"recovery {field} has an invalid field {detail!r}")

        new_id = _require_recovery_sheet_id(op["sheetId"], field)
        if new_id in final_lookup:
            raise ValueError(f"recovery {field} reuses sheet id {new_id!r}")
        after_id = op.get("afterSheetId")
        if after_id is not None:
            _require_recovery_sheet(after_id, final_lookup, field)
        name = _validate_recovery_sheet_name(op["name"], final_lookup.values(), field)
        final_lookup[new_id] = name
        merge_ranges[new_id] = []
    return final_lookup


def _validate_recovery_sheet_name(
    value: Any,
    existing_names: Any,
    field: str,
) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"recovery {field} has an invalid sheet name")
    _require_recovery_excel_text(value, f"{field} sheet name", max_length=31)
    if value != value.strip():
        raise ValueError(f"recovery {field} has an invalid sheet name")
    if any(char in value for char in "[]:*?/\\"):
        raise ValueError(f"recovery {field} has an invalid sheet name")
    if value.casefold() in {str(name).casefold() for name in existing_names}:
        raise ValueError(f"recovery {field} duplicates sheet name {value!r}")
    return value


def _require_recovery_sheet_id(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"recovery {field} has an invalid sheet id")
    return value


def _validate_recovery_structural_ops(
    ops: list[Any],
    _sheet_lookup: dict[str, str],
    _merge_ranges: dict[str, list[tuple[int, int, int, int]]],
) -> None:
    if ops:
        raise ValueError(
            "strict recovery cannot preserve every dependency of structural workbook operations"
        )


def _require_recovery_int(
    value: Any,
    field: str,
    *,
    minimum: int,
    maximum: int,
) -> int:
    if type(value) is not int or value < minimum or value > maximum:
        raise ValueError(f"recovery {field} must be an integer in {minimum}..{maximum}")
    return value


_RECOVERY_TOP_LEVEL_FIELDS = {
    "version",
    "activeSheetId",
    "cells",
    "rowHeights",
    "colWidths",
    "ops",
    "workbookOps",
    "frozen",
    "validations",
    "comments",
    "conditionalFormats",
}


def _validate_recovery_top_level(edits: dict[str, Any]) -> None:
    unknown = set(edits) - _RECOVERY_TOP_LEVEL_FIELDS
    if unknown:
        raise ValueError(f"unsupported recovery state field: {sorted(unknown)[0]}")

    if "version" in edits and (type(edits["version"]) is not int or edits["version"] != 1):
        raise ValueError("recovery state version must be 1")

    if "activeSheetId" in edits and (
        not isinstance(edits["activeSheetId"], str) or not edits["activeSheetId"]
    ):
        raise ValueError("'edits.activeSheetId' must be a non-empty string")

    for field in (
        "cells",
        "rowHeights",
        "colWidths",
        "frozen",
        "validations",
        "comments",
        "conditionalFormats",
    ):
        if field in edits and not isinstance(edits[field], dict):
            raise ValueError(f"'edits.{field}' must be an object")

    for field in ("ops", "workbookOps"):
        if field in edits and not isinstance(edits[field], list):
            raise ValueError(f"'edits.{field}' must be an array")


_EXCEL_MAX_ROW_INDEX = 1_048_575
_EXCEL_MAX_COL_INDEX = 16_383
_RECOVERY_CELL_FIELDS = {"value", "formula", "numberFormat", "style"}
_EXCEL_MAX_CELL_TEXT = 32_767
_EXCEL_MAX_FORMULA_TEXT = 8_192
_EXCEL_MAX_NUMBER = 9.99999999999999e307
_EXCEL_MIN_NONZERO_NUMBER = 2.2250738585072014e-308
_RECOVERY_STYLE_FIELDS = {
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "color",
    "background",
    "textAlign",
    "verticalAlign",
    "wrapText",
    "textOverflow",
    "fontSize",
    "fontFamily",
    "rotation",
    "hyperlink",
    "border",
}


def _parse_recovery_cell_key(
    key: Any,
    sheet_lookup: dict[str, str],
    field: str,
) -> tuple[str, int, int]:
    if not isinstance(key, str) or key.count("!") != 1:
        raise ValueError(f"invalid recovery {field} key: {key!r}")
    sheet_id, coords = key.split("!", 1)
    if coords.count(",") != 1:
        raise ValueError(f"invalid recovery {field} key: {key!r}")
    row_text, col_text = coords.split(",", 1)
    if not row_text.isascii() or not row_text.isdigit():
        raise ValueError(f"invalid recovery {field} row in key: {key!r}")
    if not col_text.isascii() or not col_text.isdigit():
        raise ValueError(f"invalid recovery {field} column in key: {key!r}")
    row = int(row_text)
    col = int(col_text)
    if row > _EXCEL_MAX_ROW_INDEX or col > _EXCEL_MAX_COL_INDEX:
        raise ValueError(f"recovery {field} coordinate is outside Excel limits: {key!r}")
    _require_recovery_sheet(sheet_id, sheet_lookup, field)
    return sheet_id, row, col


def _parse_recovery_dimension_key(
    key: Any,
    sheet_lookup: dict[str, str],
    field: str,
    max_index: int,
) -> tuple[str, int]:
    if not isinstance(key, str) or key.count("!") != 1:
        raise ValueError(f"invalid recovery {field} key: {key!r}")
    sheet_id, index_text = key.split("!", 1)
    if not index_text.isascii() or not index_text.isdigit():
        raise ValueError(f"invalid recovery {field} index in key: {key!r}")
    index = int(index_text)
    if index > max_index:
        raise ValueError(f"recovery {field} index is outside Excel limits: {key!r}")
    _require_recovery_sheet(sheet_id, sheet_lookup, field)
    return sheet_id, index


def _require_recovery_merged_anchor(
    sheet_id: str,
    row: int,
    col: int,
    merge_ranges: dict[str, list[tuple[int, int, int, int]]],
    field: str,
) -> None:
    for top, left, bottom, right in merge_ranges.get(sheet_id, []):
        if top <= row <= bottom and left <= col <= right and (row, col) != (top, left):
            raise ValueError(f"recovery {field} targets a non-anchor merged cell")


def _require_recovery_excel_text(
    value: str,
    field: str,
    *,
    max_length: int,
) -> str:
    if any(
        not (
            codepoint in {0x09, 0x0A, 0x0D}
            or 0x20 <= codepoint <= 0xD7FF
            or 0xE000 <= codepoint <= 0xFFFD
            or 0x10000 <= codepoint <= 0x10FFFF
        )
        for codepoint in map(ord, value)
    ):
        raise ValueError(f"recovery {field} contains a character invalid in XML 1.0")
    if "\r" in value:
        raise ValueError(f"recovery {field} contains a carriage return XLSX cannot preserve")
    length = len(value.encode("utf-16-le")) // 2
    if length > max_length:
        raise ValueError(f"recovery {field} exceeds Excel's {max_length}-character limit")
    return value


def _validate_recovery_cell_payload(key: str, payload: Any, *, source_value: Any) -> None:
    if not isinstance(payload, dict) or not payload:
        raise ValueError(f"recovery cell {key!r} must contain an edit object")
    unknown = set(payload) - _RECOVERY_CELL_FIELDS
    if unknown:
        raise ValueError(f"unsupported recovery cell field: {sorted(unknown)[0]}")

    if "value" in payload:
        value = payload["value"]
        if value is not None and not isinstance(value, (str, int, float, bool)):
            raise ValueError(f"recovery cell {key!r} has an invalid value")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            _require_recovery_number(value, f"cell {key!r} value")
        if isinstance(value, str):
            _require_recovery_excel_text(
                value,
                f"cell {key!r} value",
                max_length=_EXCEL_MAX_CELL_TEXT,
            )

    if (
        "formula" in payload
        and payload["formula"] is not None
        and not isinstance(payload["formula"], str)
    ):
        raise ValueError(f"recovery cell {key!r} has an invalid formula")
    if "formula" in payload and not payload["formula"] and "value" not in payload:
        raise ValueError(f"recovery cell {key!r} cannot clear a formula without a value")
    if isinstance(payload.get("formula"), str) and payload["formula"]:
        if payload.get("value") is not None:
            raise ValueError(
                f"recovery cell {key!r} cannot combine a formula with a non-null value"
            )
        formula = payload["formula"]
        normalized_formula = formula if formula.startswith("=") else f"={formula}"
        _require_recovery_excel_text(
            normalized_formula,
            f"cell {key!r} formula",
            max_length=_EXCEL_MAX_FORMULA_TEXT,
        )

    if "numberFormat" in payload and (
        not isinstance(payload["numberFormat"], str) or not payload["numberFormat"]
    ):
        raise ValueError(f"recovery cell {key!r} has an invalid number format")
    if isinstance(payload.get("numberFormat"), str):
        _require_recovery_excel_text(
            payload["numberFormat"],
            f"cell {key!r} number format",
            max_length=255,
        )

    if "style" in payload:
        _validate_recovery_style(payload["style"], f"cell {key!r}")
        hyperlink = payload["style"].get("hyperlink")
        if isinstance(hyperlink, str) and hyperlink:
            final_value = source_value
            if isinstance(payload.get("formula"), str) and payload["formula"]:
                final_value = payload["formula"]
            elif "value" in payload:
                final_value = payload["value"]
            if final_value is None or final_value == "":
                raise ValueError(
                    f"recovery cell {key!r} cannot attach a hyperlink to an empty cell"
                )


def _validate_recovery_style(style: Any, field: str) -> None:
    if not isinstance(style, dict) or not style:
        raise ValueError(f"recovery {field} style must be a non-empty object")
    unknown = set(style) - _RECOVERY_STYLE_FIELDS
    if unknown:
        raise ValueError(f"unsupported recovery style field: {sorted(unknown)[0]}")

    for key in ("bold", "italic", "underline", "strikethrough", "wrapText"):
        if key in style and not isinstance(style[key], bool):
            raise ValueError(f"recovery {field} style.{key} must be boolean")

    for key in ("color", "background"):
        if key in style:
            value = style[key]
            if not isinstance(value, str) or (value and _normalise_hex(value) is None):
                raise ValueError(f"recovery {field} style.{key} has an invalid color")

    if "textAlign" in style and style["textAlign"] not in _HORIZONTAL_ALIGN_MAP:
        raise ValueError(f"recovery {field} style.textAlign is invalid")
    if "verticalAlign" in style and style["verticalAlign"] not in _VERTICAL_ALIGN_MAP:
        raise ValueError(f"recovery {field} style.verticalAlign is invalid")
    if "textOverflow" in style and style["textOverflow"] != "wrap":
        raise ValueError(
            f"recovery {field} style.textOverflow cannot be represented exactly in XLSX"
        )
    if "wrapText" in style and "textOverflow" in style and not (
        style["wrapText"] is True and style["textOverflow"] == "wrap"
    ):
        raise ValueError(
            f"recovery {field} style.wrapText conflicts with style.textOverflow"
        )

    if "fontSize" in style:
        font_size = _require_recovery_number(
            style["fontSize"], f"{field} style.fontSize", positive=True
        )
        if font_size > 409:
            raise ValueError(f"recovery {field} style.fontSize exceeds Excel's 409-point limit")
    if "fontFamily" in style and (
        not isinstance(style["fontFamily"], str) or not style["fontFamily"]
    ):
        raise ValueError(f"recovery {field} style.fontFamily must be a non-empty string")
    if isinstance(style.get("fontFamily"), str):
        _require_recovery_excel_text(
            style["fontFamily"],
            f"{field} style.fontFamily",
            max_length=255,
        )
    if "rotation" in style:
        rotation = _require_recovery_number(style["rotation"], f"{field} style.rotation")
        if not rotation.is_integer() or rotation < -90 or rotation > 90:
            raise ValueError(f"recovery {field} style.rotation must be an integer in -90..90")
    if "hyperlink" in style and not isinstance(style["hyperlink"], str):
        raise ValueError(f"recovery {field} style.hyperlink must be a string")
    if isinstance(style.get("hyperlink"), str):
        _require_recovery_excel_text(
            style["hyperlink"],
            f"{field} style.hyperlink",
            max_length=2_083,
        )

    if "border" in style:
        border = style["border"]
        if border is None:
            return
        if not isinstance(border, dict):
            raise ValueError(f"recovery {field} style.border must be an object or null")
        unknown_sides = set(border) - {"top", "right", "bottom", "left"}
        if unknown_sides:
            raise ValueError(f"unsupported recovery border side: {sorted(unknown_sides)[0]}")
        for side_name, side in border.items():
            if not isinstance(side, dict) or set(side) - {"style", "color"}:
                raise ValueError(f"recovery {field} border.{side_name} is malformed")
            if side.get("style") not in _FRONTEND_BORDER_STYLES:
                raise ValueError(f"recovery {field} border.{side_name}.style is invalid")
            if "color" in side:
                color = side["color"]
                if not isinstance(color, str) or (color and _normalise_hex(color) is None):
                    raise ValueError(f"recovery {field} border.{side_name}.color is invalid")


def _require_recovery_number(value: Any, field: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"recovery {field} must be a number")
    try:
        number = float(value)
    except (OverflowError, ValueError) as exc:
        raise ValueError(f"recovery {field} must be finite") from exc
    if not math.isfinite(number):
        raise ValueError(f"recovery {field} must be finite")
    magnitude = abs(number)
    if magnitude > _EXCEL_MAX_NUMBER:
        raise ValueError(f"recovery {field} exceeds Excel's numeric range")
    if 0 < magnitude < _EXCEL_MIN_NONZERO_NUMBER:
        raise ValueError(f"recovery {field} is below Excel's numeric range")
    try:
        serialized_number = float(safe_string(value))
    except (OverflowError, TypeError, ValueError) as exc:
        raise ValueError(f"recovery {field} cannot be preserved exactly in XLSX") from exc
    if serialized_number != value:
        raise ValueError(f"recovery {field} cannot be preserved exactly in XLSX")
    if positive and number <= 0:
        raise ValueError(f"recovery {field} must be positive")
    return number


def _validate_recovery_frozen(
    frozen: dict[str, Any],
    sheet_lookup: dict[str, str],
) -> None:
    for sheet_id, payload in frozen.items():
        _require_recovery_sheet(sheet_id, sheet_lookup, "frozen")
        if not isinstance(payload, dict) or set(payload) != {"row", "col"}:
            raise ValueError(f"recovery frozen[{sheet_id!r}] is malformed")
        _require_recovery_int(
            payload["row"],
            f"frozen[{sheet_id!r}].row",
            minimum=0,
            maximum=_EXCEL_MAX_ROW_INDEX,
        )
        _require_recovery_int(
            payload["col"],
            f"frozen[{sheet_id!r}].col",
            minimum=0,
            maximum=_EXCEL_MAX_COL_INDEX,
        )


def _validate_recovery_validations(
    validations: dict[str, Any],
    sheet_lookup: dict[str, str],
    merge_ranges: dict[str, list[tuple[int, int, int, int]]],
    wb: Workbook,
) -> None:
    for key, payload in validations.items():
        sheet_id, row, col = _parse_recovery_cell_key(key, sheet_lookup, "validations")
        _require_recovery_merged_anchor(sheet_id, row, col, merge_ranges, f"validation {key!r}")
        sheet_name = sheet_lookup[sheet_id]
        if sheet_name in wb.sheetnames:
            cell_ref = f"{get_column_letter(col + 1)}{row + 1}"
            if any(
                validation.sqref and cell_ref in validation.sqref
                for validation in wb[sheet_name].data_validations.dataValidation
            ):
                raise ValueError(
                    f"recovery validation {key!r} overlaps an existing source validation"
                )
        if not isinstance(payload, dict) or set(payload) != {"type", "values"}:
            raise ValueError(f"recovery validation {key!r} is malformed")
        values = payload["values"]
        if payload["type"] != "list" or not isinstance(values, list) or not values:
            raise ValueError(f"recovery validation {key!r} is unsupported or empty")
        if any(not isinstance(value, str) for value in values):
            raise ValueError(f"recovery validation {key!r} values must be strings")
        for index, value in enumerate(values):
            _require_recovery_excel_text(
                value,
                f"validation {key!r} value {index}",
                max_length=_EXCEL_MAX_CELL_TEXT,
            )
            if "," in value or "\n" in value or "\r" in value:
                raise ValueError(
                    f"recovery validation {key!r} contains an inline-list delimiter"
                )
        escaped = ",".join(value.replace('"', '""') for value in values)
        if len(escaped) + 2 > 255:
            raise ValueError(f"recovery validation {key!r} exceeds Excel's inline-list limit")


def _validate_recovery_comments(
    comments: dict[str, Any],
    sheet_lookup: dict[str, str],
    merge_ranges: dict[str, list[tuple[int, int, int, int]]],
) -> None:
    allowed = {"text", "author", "updatedAt"}
    for key, payload in comments.items():
        sheet_id, row, col = _parse_recovery_cell_key(key, sheet_lookup, "comments")
        _require_recovery_merged_anchor(sheet_id, row, col, merge_ranges, f"comment {key!r}")
        if (
            not isinstance(payload, dict)
            or "text" not in payload
            or set(payload) - allowed
            or not isinstance(payload["text"], str)
            or not payload["text"]
        ):
            raise ValueError(f"recovery comment {key!r} is malformed")
        _require_recovery_excel_text(
            payload["text"],
            f"comment {key!r}.text",
            max_length=_EXCEL_MAX_CELL_TEXT,
        )
        if "author" in payload:
            if not isinstance(payload["author"], str) or not payload["author"]:
                raise ValueError(f"recovery comment {key!r}.author is malformed")
            _require_recovery_excel_text(
                payload["author"],
                f"comment {key!r}.author",
                max_length=255,
            )
        if "updatedAt" in payload:
            _validate_recovery_timestamp(payload["updatedAt"], f"comment {key!r}.updatedAt")


def _validate_recovery_timestamp(value: Any, field: str) -> None:
    """Validate legacy UI metadata that XLSX cannot and need not persist."""
    if not isinstance(value, str) or not value:
        raise ValueError(f"recovery {field} must be an ISO timestamp")
    normalized = f"{value[:-1]}+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"recovery {field} must be an ISO timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"recovery {field} must include a timezone")


_RECOVERY_CF_KINDS = {
    "cellValue",
    "between",
    "containsText",
    "duplicate",
    "unique",
    "blank",
    "notBlank",
    "colorScale",
}


def _validate_recovery_conditional_formats(
    conditional_formats: dict[str, Any],
    sheet_lookup: dict[str, str],
) -> None:
    for sheet_id, rules in conditional_formats.items():
        _require_recovery_sheet(sheet_id, sheet_lookup, "conditionalFormats")
        if not isinstance(rules, list):
            raise ValueError(f"recovery conditionalFormats[{sheet_id!r}] must be an array")
        for index, rule in enumerate(rules):
            field = f"conditionalFormats[{sheet_id!r}][{index}]"
            if (
                not isinstance(rule, dict)
                or not {"id", "range", "condition"}.issubset(rule)
                or set(rule) - {"id", "range", "condition", "style"}
                or not isinstance(rule["id"], str)
                or not rule["id"]
            ):
                raise ValueError(f"recovery {field} is malformed")
            _validate_recovery_cf_range(rule["range"], field)
            _validate_recovery_cf_condition(rule["condition"], field)
            _validate_recovery_cf_formulas(rule["range"], rule["condition"], field)
            if "style" in rule:
                if rule["condition"].get("kind") == "colorScale":
                    raise ValueError(f"recovery {field} color scale cannot carry a style")
                _validate_recovery_cf_style(rule["style"], field)
        for index, rule in enumerate(rules):
            if rule["condition"].get("kind") != "colorScale":
                continue
            cell_range = rule["range"]
            for later_index, later_rule in enumerate(rules[index + 1 :], start=index + 1):
                later_range = later_rule["range"]
                disjoint = (
                    cell_range["bottom"] < later_range["top"]
                    or later_range["bottom"] < cell_range["top"]
                    or cell_range["right"] < later_range["left"]
                    or later_range["right"] < cell_range["left"]
                )
                if not disjoint:
                    raise ValueError(
                        "recovery conditionalFormats"
                        f"[{sheet_id!r}][{index}] color scale overlaps "
                        f"lower-priority rule [{later_index}]"
                    )


def _validate_recovery_cf_range(value: Any, field: str) -> None:
    if not isinstance(value, dict) or set(value) != {"top", "left", "bottom", "right"}:
        raise ValueError(f"recovery {field}.range is malformed")
    top = _require_recovery_int(
        value["top"], f"{field}.range.top", minimum=0, maximum=_EXCEL_MAX_ROW_INDEX
    )
    left = _require_recovery_int(
        value["left"], f"{field}.range.left", minimum=0, maximum=_EXCEL_MAX_COL_INDEX
    )
    bottom = _require_recovery_int(
        value["bottom"], f"{field}.range.bottom", minimum=0, maximum=_EXCEL_MAX_ROW_INDEX
    )
    right = _require_recovery_int(
        value["right"], f"{field}.range.right", minimum=0, maximum=_EXCEL_MAX_COL_INDEX
    )
    if bottom < top or right < left:
        raise ValueError(f"recovery {field}.range is reversed")


def _validate_recovery_cf_condition(value: Any, field: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"recovery {field}.condition must be an object")
    kind = value.get("kind")
    if kind not in _RECOVERY_CF_KINDS:
        raise ValueError(f"recovery {field}.condition kind is unsupported")

    if kind == "cellValue":
        if set(value) != {"kind", "op", "value"} or value["op"] not in {
            "gt",
            "lt",
            "gte",
            "lte",
            "eq",
            "neq",
        }:
            raise ValueError(f"recovery {field}.condition is malformed")
        operand = value["value"]
        if isinstance(operand, bool) or not isinstance(operand, (str, int, float)):
            raise ValueError(f"recovery {field}.condition value is malformed")
        if isinstance(operand, str):
            _require_recovery_excel_text(
                operand,
                f"{field}.condition value",
                max_length=_EXCEL_MAX_CELL_TEXT,
            )
        else:
            _require_recovery_number(operand, f"{field}.condition value")
        return

    if kind == "between":
        if set(value) - {"kind", "min", "max", "inclusive"} or not {
            "kind",
            "min",
            "max",
        }.issubset(value):
            raise ValueError(f"recovery {field}.condition is malformed")
        minimum = _require_recovery_number(value["min"], f"{field}.condition.min")
        maximum = _require_recovery_number(value["max"], f"{field}.condition.max")
        if minimum > maximum:
            raise ValueError(f"recovery {field}.condition range is reversed")
        if "inclusive" in value and not isinstance(value["inclusive"], bool):
            raise ValueError(f"recovery {field}.condition.inclusive must be boolean")
        return

    if kind == "containsText":
        if set(value) - {"kind", "text", "mode", "caseSensitive"} or not {
            "kind",
            "text",
            "mode",
        }.issubset(value):
            raise ValueError(f"recovery {field}.condition is malformed")
        if not isinstance(value["text"], str) or not value["text"]:
            raise ValueError(f"recovery {field}.condition.text must be non-empty")
        _require_recovery_excel_text(
            value["text"],
            f"{field}.condition.text",
            max_length=_EXCEL_MAX_CELL_TEXT,
        )
        if value["mode"] not in {"contains", "notContains", "startsWith", "endsWith"}:
            raise ValueError(f"recovery {field}.condition.mode is invalid")
        if "caseSensitive" in value and not isinstance(value["caseSensitive"], bool):
            raise ValueError(f"recovery {field}.condition.caseSensitive must be boolean")
        return

    if kind == "colorScale":
        if set(value) - {"kind", "min", "mid", "max"} or not {
            "kind",
            "min",
            "max",
        }.issubset(value):
            raise ValueError(f"recovery {field}.condition is malformed")
        for endpoint in ("min", "max"):
            _validate_recovery_cf_scale_point(value[endpoint], f"{field}.condition.{endpoint}")
        if "mid" in value:
            _validate_recovery_cf_scale_point(value["mid"], f"{field}.condition.mid")
        return

    if set(value) != {"kind"}:
        raise ValueError(f"recovery {field}.condition has unsupported fields")


def _validate_recovery_cf_scale_point(value: Any, field: str) -> None:
    if (
        not isinstance(value, dict)
        or "color" not in value
        or set(value) - {"color", "value"}
        or not isinstance(value["color"], str)
        or not value["color"]
        or _normalise_hex(value["color"]) is None
    ):
        raise ValueError(f"recovery {field} is malformed")
    if "value" in value:
        _require_recovery_number(value["value"], f"{field}.value")


def _validate_recovery_cf_style(value: Any, field: str) -> None:
    allowed = {"bold", "italic", "underline", "strikethrough", "color", "background"}
    if not isinstance(value, dict) or set(value) - allowed:
        raise ValueError(f"recovery {field}.style is malformed")
    for key in ("bold", "italic", "underline", "strikethrough"):
        if key in value:
            if not isinstance(value[key], bool):
                raise ValueError(f"recovery {field}.style.{key} must be boolean")
            if value[key] is False:
                raise ValueError(
                    f"recovery {field}.style.{key}=false cannot be represented exactly"
                )
    for key in ("color", "background"):
        if key in value and (
            not isinstance(value[key], str) or not value[key] or _normalise_hex(value[key]) is None
        ):
            raise ValueError(f"recovery {field}.style.{key} has an invalid color")


def _require_recovery_sheet(
    sheet_id: Any,
    sheet_lookup: dict[str, str],
    field: str,
) -> None:
    if not isinstance(sheet_id, str) or sheet_id not in sheet_lookup:
        raise ValueError(f"recovery {field} targets missing sheet {sheet_id!r}")


def _validate_recovery_cf_formulas(
    cell_range: dict[str, int],
    condition: dict[str, Any],
    field: str,
) -> None:
    formulas = _build_cf_formulas(
        cell_range["top"],
        cell_range["left"],
        condition,
        exact=True,
    )
    if formulas is None:
        raise ValueError(f"recovery {field}.condition cannot be represented exactly")
    for index, formula in enumerate(formulas):
        _require_recovery_excel_text(
            formula,
            f"{field}.generated formula {index}",
            max_length=_EXCEL_MAX_FORMULA_TEXT,
        )


def _build_cf_formulas(
    top: int,
    left: int,
    condition: dict[str, Any],
    *,
    exact: bool,
) -> list[str] | None:
    kind = condition.get("kind")
    anchor = f"{get_column_letter(left + 1)}{top + 1}"

    if kind == "cellValue":
        value = condition.get("value")
        if value is None:
            return None
        return [_format_cf_operand(value, preserve_string=exact)]

    if kind == "between":
        try:
            minimum = float(condition.get("min"))
            maximum = float(condition.get("max"))
        except (OverflowError, TypeError, ValueError):
            return None
        if exact and condition.get("inclusive") is False:
            return [f"AND({anchor}>{minimum},{anchor}<{maximum})"]
        return [str(minimum), str(maximum)]

    if kind == "containsText":
        text = condition.get("text")
        if not isinstance(text, str) or not text:
            return None
        mode = str(condition.get("mode") or "contains")
        case_sensitive = exact and condition.get("caseSensitive") is True
        search_text = text
        if mode in {"contains", "notContains"} and not case_sensitive:
            search_text = search_text.replace("~", "~~").replace("*", "~*").replace("?", "~?")
        escaped = search_text.replace('"', '""')
        if mode == "contains":
            find_fn = "FIND" if case_sensitive else "SEARCH"
            return [f'NOT(ISERROR({find_fn}("{escaped}",{anchor})))']
        if mode == "notContains":
            find_fn = "FIND" if case_sensitive else "SEARCH"
            return [f'ISERROR({find_fn}("{escaped}",{anchor}))']
        if mode == "startsWith" and case_sensitive:
            return [f'EXACT(LEFT({anchor},{len(text)}),"{escaped}")']
        if mode == "endsWith" and case_sensitive:
            return [f'EXACT(RIGHT({anchor},{len(text)}),"{escaped}")']
        if mode == "startsWith":
            return [f'LEFT({anchor},{len(text)})="{escaped}"']
        if mode == "endsWith":
            return [f'RIGHT({anchor},{len(text)})="{escaped}"']
        return None

    if kind == "blank":
        return [f"LEN(TRIM({anchor}))=0"]
    if kind == "notBlank":
        return [f"LEN(TRIM({anchor}))>0"]
    if kind in {"duplicate", "unique", "colorScale"}:
        return []
    return None


def _apply_cf_rule(sheet: Worksheet, entry: Any, *, exact: bool = False) -> bool:
    """Translate a single sidecar CF entry into an openpyxl conditional-
    formatting rule and attach it to ``sheet``. Silent no-op for malformed
    payloads — keeping export resilient to old/partial sidecars."""
    if not isinstance(entry, dict):
        return False
    rng = entry.get("range")
    if not isinstance(rng, dict):
        return False
    try:
        top = int(rng["top"])
        left = int(rng["left"])
        bottom = int(rng["bottom"])
        right = int(rng["right"])
    except (KeyError, TypeError, ValueError):
        return False
    if top > bottom or left > right:
        return False
    range_ref = f"{get_column_letter(left + 1)}{top + 1}:{get_column_letter(right + 1)}{bottom + 1}"

    cond = entry.get("condition") or {}
    if not isinstance(cond, dict):
        return False
    kind = cond.get("kind")
    style = entry.get("style") or {}
    fill, font = _build_dxf(style if isinstance(style, dict) else {})

    def add_rule(rule: Rule) -> None:
        if exact:
            # Strict recovery follows the sidecar's first-match-wins order.
            # openpyxl assigns increasing priorities as rules are added;
            # stopIfTrue prevents lower-priority matches from layering styles.
            rule.stopIfTrue = True
        sheet.conditional_formatting.add(range_ref, rule)

    if kind == "colorScale":
        try:
            min_color = _normalise_hex(cond.get("min", {}).get("color"))
            max_color = _normalise_hex(cond.get("max", {}).get("color"))
            mid_payload = cond.get("mid")
            if not min_color or not max_color:
                return False
            start_type = "num" if exact and "value" in cond["min"] else "min"
            start_value = cond["min"].get("value") if start_type == "num" else None
            end_type = "num" if exact and "value" in cond["max"] else "max"
            end_value = cond["max"].get("value") if end_type == "num" else None
            if isinstance(mid_payload, dict):
                mid_color = _normalise_hex(mid_payload.get("color"))
                mid_type = "num" if exact and "value" in mid_payload else "percent"
                mid_value = mid_payload.get("value") if mid_type == "num" else 50
                rule = ColorScaleRule(
                    start_type=start_type,
                    start_value=start_value,
                    start_color=min_color,
                    mid_type=mid_type,
                    mid_value=mid_value,
                    mid_color=mid_color or "FFFFEB84",
                    end_type=end_type,
                    end_value=end_value,
                    end_color=max_color,
                )
            else:
                rule = ColorScaleRule(
                    start_type=start_type,
                    start_value=start_value,
                    start_color=min_color,
                    end_type=end_type,
                    end_value=end_value,
                    end_color=max_color,
                )
            add_rule(rule)
        except Exception:
            return False
        return True

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
            return False
        formulas = _build_cf_formulas(top, left, cond, exact=exact)
        if formulas is None:
            return False
        rule = CellIsRule(operator=operator, formula=formulas, fill=fill, font=font)
        add_rule(rule)
        return True

    if kind == "between":
        formulas = _build_cf_formulas(top, left, cond, exact=exact)
        if formulas is None:
            return False
        if exact and cond.get("inclusive") is False:
            rule = FormulaRule(
                formula=formulas,
                fill=fill,
                font=font,
            )
        else:
            rule = CellIsRule(
                operator="between",
                formula=formulas,
                fill=fill,
                font=font,
            )
        add_rule(rule)
        return True

    if kind == "containsText":
        formulas = _build_cf_formulas(top, left, cond, exact=exact)
        if formulas is None:
            return False
        rule = FormulaRule(formula=formulas, fill=fill, font=font)
        add_rule(rule)
        return True

    if kind in ("duplicate", "unique"):
        rule_type = "duplicateValues" if kind == "duplicate" else "uniqueValues"
        dxf = DifferentialStyle(fill=fill, font=font)
        rule = Rule(type=rule_type, dxf=dxf)
        add_rule(rule)
        return True

    if kind in ("blank", "notBlank"):
        formulas = _build_cf_formulas(top, left, cond, exact=exact)
        if formulas is None:
            return False
        rule = FormulaRule(formula=formulas, fill=fill, font=font)
        add_rule(rule)
        return True
    return False


def _format_cf_operand(value: Any, *, preserve_string: bool = False) -> str:
    """Format a CF operand for openpyxl's `formula` array. Numbers go in
    bare; strings are double-quoted (with embedded quotes doubled)."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    s = str(value)
    if s == "":
        return '""'
    if not preserve_string:
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
        normalized = f"FF{raw.upper()}"
    elif len(raw) == 8:
        normalized = raw.upper()
    else:
        return None
    try:
        int(normalized, 16)
    except ValueError:
        return None
    return normalized


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


def _split_cell_key(key: str, sheet_lookup: dict[str, str]) -> tuple[str | None, int, int]:
    try:
        sheet_id, coords = key.split("!", 1)
        row_str, col_str = coords.split(",", 1)
        return sheet_lookup.get(sheet_id), int(row_str), int(col_str)
    except (ValueError, AttributeError):
        return None, 0, 0


def _split_row_key(key: str, sheet_lookup: dict[str, str]) -> tuple[str | None, int]:
    try:
        sheet_id, row_str = key.split("!", 1)
        return sheet_lookup.get(sheet_id), int(row_str)
    except (ValueError, AttributeError):
        return None, 0


def _split_col_key(key: str, sheet_lookup: dict[str, str]) -> tuple[str | None, int]:
    try:
        sheet_id, col_str = key.split("!", 1)
        return sheet_lookup.get(sheet_id), int(col_str)
    except (ValueError, AttributeError):
        return None, 0
