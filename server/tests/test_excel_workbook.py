"""Tests for the openpyxl-backed workbook parse path + its LRU cache.

The full parse_workbook contract is covered indirectly by the preflight
workflow tests (`test_excel_preflight_workflows.py`); this file focuses on
the cache invariants that landed alongside the perf pass.
"""

from __future__ import annotations

import io
import json
import zipfile
from xml.etree import ElementTree as ET

import pytest
from openpyxl import Workbook

from services.excel_workbook import parse_workbook, parse_workbook_json_bytes


def _build_xlsx(rows: int = 3, cols: int = 3) -> bytes:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    for r in range(1, rows + 1):
        for c in range(1, cols + 1):
            ws.cell(row=r, column=c, value=f"R{r}C{c}")
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _build_formula_xlsx() -> bytes:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws["A1"] = 1
    ws["B1"] = "=A1"
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _build_cached_date_formula_xlsx() -> bytes:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws["A1"] = 1
    ws["B1"] = "=DATE(2026,5,28)"
    ws["B1"].number_format = "yyyy-mm-dd"
    buffer = io.BytesIO()
    wb.save(buffer)

    patched = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(buffer.getvalue())) as zin:
        with zipfile.ZipFile(patched, "w") as zout:
            for item in zin.infolist():
                payload = zin.read(item.filename)
                if item.filename == "xl/worksheets/sheet1.xml":
                    root = ET.fromstring(payload)
                    namespace = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
                    cell = root.find(f".//{namespace}c[@r='B1']")
                    assert cell is not None
                    for value_node in cell.findall(f"{namespace}v"):
                        cell.remove(value_node)
                    value_node = ET.SubElement(cell, f"{namespace}v")
                    value_node.text = "46170"
                    payload = ET.tostring(root, encoding="utf-8")
                zout.writestr(item, payload)
    return patched.getvalue()


def _build_formula_xlsx_with_out_of_range_empty_cache() -> bytes:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws["A1"] = 1
    ws["B1"] = "=A1"
    ws["A6000"] = "=A1"
    buffer = io.BytesIO()
    wb.save(buffer)

    patched = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(buffer.getvalue())) as zin:
        with zipfile.ZipFile(patched, "w") as zout:
            for item in zin.infolist():
                payload = zin.read(item.filename)
                if item.filename == "xl/worksheets/sheet1.xml":
                    root = ET.fromstring(payload)
                    namespace = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
                    cell = root.find(f".//{namespace}c[@r='B1']")
                    assert cell is not None
                    for value_node in cell.findall(f"{namespace}v"):
                        cell.remove(value_node)
                    value_node = ET.SubElement(cell, f"{namespace}v")
                    value_node.text = "1"
                    payload = ET.tostring(root, encoding="utf-8")
                zout.writestr(item, payload)
    return patched.getvalue()


def _build_formatted_xlsx() -> bytes:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "Formatted"
    ws["A1"] = "Header"
    ws["A1"].font = ws["A1"].font.copy(bold=True)
    ws["A2"] = "Link"
    ws["A2"].hyperlink = "https://example.com"
    ws["B2"] = 1234
    ws["B2"].number_format = '"$"#,##0.00'
    ws["B2"].fill = ws["B2"].fill.copy(fill_type="solid", fgColor="FFF2CC")
    ws.row_dimensions[1].height = 24
    ws.column_dimensions["B"].width = 18
    ws.merge_cells("C3:D4")
    ws.freeze_panes = "B2"
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def test_parse_workbook_read_only_path_preserves_layout_and_styles() -> None:
    from services.excel_workbook import _clear_xlsx_cache

    _clear_xlsx_cache()
    sheet = parse_workbook(_build_formatted_xlsx())["sheets"][0]

    assert sheet["rowHeights"] == {"0": 24.0}
    assert sheet["colWidths"] == {"1": 18.0}
    assert sheet["merges"] == [{"top": 2, "left": 2, "bottom": 3, "right": 3}]
    assert sheet["frozen"] == {"row": 1, "col": 1}
    assert sheet["cells"][0]["style"]["bold"] is True
    link_cell = next(cell for cell in sheet["cells"] if cell["row"] == 1 and cell["col"] == 0)
    assert link_cell["style"]["hyperlink"] == "https://example.com"
    money_cell = next(cell for cell in sheet["cells"] if cell["row"] == 1 and cell["col"] == 1)
    assert money_cell["numberFormat"] == '"$"#,##0.00'
    assert money_cell["style"]["background"] == "#fff2cc"


def test_parse_workbook_skips_data_only_load_without_formulas(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import services.excel_workbook as workbook_module
    from services.excel_workbook import _clear_xlsx_cache

    calls: list[tuple[bool | None, bool | None]] = []
    real_load_workbook = workbook_module.load_workbook

    def spy_load_workbook(*args, **kwargs):
        calls.append((kwargs.get("data_only"), kwargs.get("read_only")))
        return real_load_workbook(*args, **kwargs)

    monkeypatch.setattr(workbook_module, "load_workbook", spy_load_workbook)
    _clear_xlsx_cache()

    parse_workbook(_build_xlsx(rows=2, cols=2))

    assert calls == [(False, True)]


def test_parse_workbook_reads_formula_cached_values_from_formula_xml(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import services.excel_workbook as workbook_module
    from services.excel_workbook import _clear_xlsx_cache

    calls: list[tuple[bool | None, bool | None]] = []
    real_load_workbook = workbook_module.load_workbook

    def spy_load_workbook(*args, **kwargs):
        calls.append((kwargs.get("data_only"), kwargs.get("read_only")))
        return real_load_workbook(*args, **kwargs)

    monkeypatch.setattr(workbook_module, "load_workbook", spy_load_workbook)
    _clear_xlsx_cache()

    parse_workbook(_build_formula_xlsx())

    assert calls == [(False, True)]


def test_parse_workbook_preserves_cached_formula_date_values() -> None:
    from services.excel_workbook import _clear_xlsx_cache

    _clear_xlsx_cache()
    sheet = parse_workbook(_build_cached_date_formula_xlsx())["sheets"][0]
    date_cell = next(cell for cell in sheet["cells"] if cell["row"] == 0 and cell["col"] == 1)

    assert date_cell["formula"] == "=DATE(2026,5,28)"
    assert date_cell["value"] == "2026-05-28 00:00:00"


def test_parse_workbook_ignores_out_of_range_empty_formula_cache() -> None:
    from services.excel_workbook import _clear_xlsx_cache

    _clear_xlsx_cache()
    sheet = parse_workbook(_build_formula_xlsx_with_out_of_range_empty_cache())["sheets"][0]
    formula_cell = next(cell for cell in sheet["cells"] if cell["row"] == 0 and cell["col"] == 1)

    assert formula_cell["value"] == 1


def test_parse_cache_hit_returns_clone_so_caller_mutation_doesnt_leak() -> None:
    from services.excel_workbook import _clear_xlsx_cache

    _clear_xlsx_cache()
    xlsx = _build_xlsx()

    first = parse_workbook(xlsx)
    first["sheets"][0]["cells"] = []  # simulate a downstream filter / mutation

    second = parse_workbook(xlsx)
    assert len(second["sheets"][0]["cells"]) > 0, "cache was corrupted by caller mutation"


def test_parse_cache_invalidated_by_byte_flip() -> None:
    from services.excel_workbook import _clear_xlsx_cache

    _clear_xlsx_cache()
    xlsx_a = _build_xlsx(rows=2, cols=2)
    xlsx_b = _build_xlsx(rows=4, cols=2)

    result_a = parse_workbook(xlsx_a)
    result_b = parse_workbook(xlsx_b)

    # Different byte content → different cache key → distinct results.
    assert result_a["sheets"][0]["rowCount"] == 2
    assert result_b["sheets"][0]["rowCount"] == 4


def test_parse_workbook_json_bytes_reuses_wire_cache() -> None:
    from services.excel_workbook import _clear_xlsx_cache

    _clear_xlsx_cache()
    xlsx = _build_xlsx(rows=2, cols=2)

    first = parse_workbook_json_bytes(xlsx)
    second = parse_workbook_json_bytes(xlsx)

    assert second == first
    assert json.loads(second)["sheets"][0]["rowCount"] == 2


def test_parse_cache_disabled_via_env(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.excel_workbook import _clear_xlsx_cache

    monkeypatch.setenv("DOXMIND_DISABLE_XLSX_CACHE", "1")
    _clear_xlsx_cache()
    xlsx = _build_xlsx()

    first = parse_workbook(xlsx)
    first["sheets"][0]["cells"] = []
    second = parse_workbook(xlsx)
    # With cache off, mutation can't leak — second is a fresh parse.
    assert len(second["sheets"][0]["cells"]) > 0
