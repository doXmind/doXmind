"""Tests for the openpyxl-backed workbook parse path + its LRU cache.

The full parse_workbook contract is covered indirectly by the preflight
workflow tests (`test_excel_preflight_workflows.py`); this file focuses on
the cache invariants that landed alongside the perf pass.
"""

from __future__ import annotations

import io

import pytest
from openpyxl import Workbook

from services.excel_workbook import parse_workbook


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
