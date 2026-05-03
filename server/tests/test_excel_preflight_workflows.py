"""Preflight coverage for realistic Excel editor workflows.

These tests model the three end-to-end scenarios we manually exercise in the
GUI: finance review, data analyst cleanup, and everyday heavy editing.  They
intentionally assert the exported XLSX rather than React internals so the
preflight catches sidecar/export regressions that would affect real users.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from openpyxl import load_workbook

from services.excel_workbook import export_edited_workbook

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "testdata" / "budget.xlsx"


def export_workbook(edits: dict[str, Any]):
    exported = export_edited_workbook(FIXTURE.read_bytes(), edits)
    out = ROOT / ".pytest_cache" / "excel-preflight.xlsx"
    out.parent.mkdir(exist_ok=True)
    out.write_bytes(exported)
    return load_workbook(out)


def test_finance_budget_review_workflow_exports_review_artifacts():
    """Finance reviews assumptions, annotates, freezes, and exports."""

    edits = {
        "version": 1,
        "cells": {
            "sheet-0!1,1": {"value": 240, "formula": None},
            "sheet-0!1,4": {"value": "Analyst note", "formula": None},
            "sheet-0!1,0": {"style": {"hyperlink": "https://example.com/finance-q1"}},
            "sheet-0!1,3": {"numberFormat": '"$"#,##0.00'},
            "sheet-0!2,3": {"numberFormat": '"$"#,##0.00'},
            "sheet-0!3,3": {"numberFormat": '"$"#,##0.00'},
            "sheet-0!4,3": {"numberFormat": '"$"#,##0.00'},
            "sheet-0!5,3": {"numberFormat": '"$"#,##0.00'},
        },
        "comments": {
            "sheet-0!1,2": {
                "text": "Finance reviewed price assumption",
                "author": "Finance",
                "updatedAt": "2026-05-02T00:00:00Z",
            }
        },
        "conditionalFormats": {
            "sheet-0": [
                {
                    "id": "finance-revenue-gt",
                    "range": {"top": 1, "left": 3, "bottom": 5, "right": 3},
                    "condition": {"kind": "cellValue", "op": "gt", "value": 5000},
                    "style": {"background": "#FFF2CC", "color": "#7F6000"},
                }
            ]
        },
        "frozen": {"sheet-0": {"row": 1, "col": 0}},
    }

    wb = export_workbook(edits)
    ws = wb["Q1 Summary"]

    assert ws["B2"].value == 240
    assert ws["E2"].value == "Analyst note"
    assert ws["A2"].hyperlink.target == "https://example.com/finance-q1"
    assert ws["C2"].comment.text == "Finance reviewed price assumption"
    assert ws["D2"].number_format == '"$"#,##0.00'
    assert ws.freeze_panes == "A2"
    assert len(list(ws.conditional_formatting)) == 1


def test_data_analyst_cleanup_workflow_exports_validation_and_sorted_values():
    """Analyst filters, sorts, replaces labels, and constrains status values."""

    edits = {
        "version": 1,
        "cells": {
            # Result of sorting A2:B6 by Region ascending, then replacing
            # Central with HQ and selecting Approved from a validation list.
            "sheet-0!1,0": {"value": "East", "formula": None},
            "sheet-0!1,1": {"value": 280, "formula": None},
            "sheet-0!2,0": {"value": "HQ", "formula": None},
            "sheet-0!2,1": {"value": 95, "formula": None},
            "sheet-0!3,0": {"value": "North", "formula": None},
            "sheet-0!3,1": {"value": 211, "formula": None},
            "sheet-0!4,0": {"value": "South", "formula": None},
            "sheet-0!4,1": {"value": 265, "formula": None},
            "sheet-0!5,0": {"value": "West", "formula": None},
            "sheet-0!5,1": {"value": 351, "formula": None},
            "sheet-0!3,4": {"value": "Approved", "formula": None},
        },
        "filters": {"sheet-0!0": ["East", "HQ", "South", "West"]},
        "filterMode": {"sheet-0": True},
        "validations": {
            "sheet-0!3,4": {"type": "list", "values": ["Approved", "Pending", "Rework"]},
            "sheet-0!4,4": {"type": "list", "values": ["Approved", "Pending", "Rework"]},
            "sheet-0!5,4": {"type": "list", "values": ["Approved", "Pending", "Rework"]},
        },
    }

    wb = export_workbook(edits)
    ws = wb["Q1 Summary"]

    assert [ws[f"A{row}"].value for row in range(2, 7)] == [
        "East",
        "HQ",
        "North",
        "South",
        "West",
    ]
    assert ws["E4"].value == "Approved"
    validations = list(ws.data_validations.dataValidation)
    assert len(validations) == 1
    assert validations[0].formula1 == '"Approved,Pending,Rework"'
    assert str(validations[0].sqref) == "E4 E5 E6"


def test_everyday_heavy_editing_workflow_exports_workbook_ops_and_merge_cleanup():
    """Daily editing covers copy/paste result, clear, sheet ops, and merge toggles."""

    edits = {
        "version": 1,
        "cells": {
            # Copy A2 to E8, redo it, then clear E8.
            "sheet-0!7,4": {"value": None, "formula": None},
        },
        "ops": [
            {"type": "mergeCells", "sheetId": "sheet-0", "top": 0, "left": 5, "bottom": 0, "right": 6},
            {
                "type": "unmergeCells",
                "sheetId": "sheet-0",
                "top": 0,
                "left": 5,
                "bottom": 0,
                "right": 6,
            },
        ],
        "workbookOps": [
            {
                "type": "addSheet",
                "sheetId": "sheet-user-scratch",
                "name": "Sheet",
                "afterSheetId": "sheet-0",
            },
            {"type": "renameSheet", "sheetId": "sheet-user-scratch", "name": "Finance Scratch"},
            {"type": "deleteSheet", "sheetId": "sheet-user-scratch"},
            {
                "type": "duplicateSheet",
                "sourceSheetId": "sheet-0",
                "sheetId": "sheet-user-copy",
                "name": "Q1 Summary (copy)",
            },
        ],
    }

    wb = export_workbook(edits)
    ws = wb["Q1 Summary"]

    assert "Finance Scratch" not in wb.sheetnames
    assert "Q1 Summary (copy)" in wb.sheetnames
    assert ws["E8"].value is None
    assert "F1:G1" not in {str(rng) for rng in ws.merged_cells.ranges}
