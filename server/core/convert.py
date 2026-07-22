"""Read-only attachment parsing for the standalone core facade (ADR 0010, S4).

Reads a PDF or spreadsheet into a bounded conversion DTO. The ``*_in_root``
variants confine an agent-supplied path to the workspace root (S5); the free
``convert_*`` helpers back the CLI, where the human owns the path.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from core.workspace import resolve_in_root
from services.excel_workbook import parse_csv_workbook_json_bytes, parse_workbook
from services.pdf_blocks import parse_pdf_blocks


def convert_pdf(path: str | Path) -> dict[str, Any]:
    """Parse a PDF into layout-aware paragraph blocks."""
    return parse_pdf_blocks(Path(path).expanduser().read_bytes())


def convert_excel(path: str | Path) -> dict[str, Any]:
    """Parse an .xlsx/.xlsm/.csv spreadsheet into a JSON cell model."""
    source = Path(path).expanduser()
    if source.suffix.lower() == ".csv":
        return json.loads(parse_csv_workbook_json_bytes(source.read_bytes()))
    return parse_workbook(source.read_bytes())


def read_pdf_in_root(root: str | Path | None, rel_path: str | Path) -> dict[str, Any]:
    """Parse a workspace-confined PDF into paragraph blocks."""
    return parse_pdf_blocks(resolve_in_root(root, rel_path).read_bytes())


def read_excel_in_root(root: str | Path | None, rel_path: str | Path) -> dict[str, Any]:
    """Parse a workspace-confined .xlsx/.xlsm/.csv into a JSON cell model."""
    source = resolve_in_root(root, rel_path)
    if source.suffix.lower() == ".csv":
        return json.loads(parse_csv_workbook_json_bytes(source.read_bytes()))
    return parse_workbook(source.read_bytes())
