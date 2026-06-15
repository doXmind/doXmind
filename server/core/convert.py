"""Binary document parsing (PDF / Excel) for the core facade (ADR 0010, S4).

Reads a PDF or .xlsx from disk and returns the same layout-aware JSON model the
editor uses, by importing the parse services directly. The ``*_in_root``
variants confine an agent-supplied path to the workspace root (S5); the free
``convert_*`` helpers back the CLI, where the human owns the path.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from core.workspace import resolve_in_root
from services.excel_workbook import parse_workbook
from services.pdf_blocks import parse_pdf_blocks


def convert_pdf(path: str | Path) -> dict[str, Any]:
    """Parse a PDF into layout-aware paragraph blocks."""
    return parse_pdf_blocks(Path(path).expanduser().read_bytes())


def convert_excel(path: str | Path) -> dict[str, Any]:
    """Parse an .xlsx/.xlsm workbook into a JSON cell model."""
    return parse_workbook(Path(path).expanduser().read_bytes())


def read_pdf_in_root(root: str | Path | None, rel_path: str | Path) -> dict[str, Any]:
    """Parse a workspace-confined PDF into paragraph blocks."""
    return parse_pdf_blocks(resolve_in_root(root, rel_path).read_bytes())


def read_excel_in_root(root: str | Path | None, rel_path: str | Path) -> dict[str, Any]:
    """Parse a workspace-confined .xlsx/.xlsm into a JSON cell model."""
    return parse_workbook(resolve_in_root(root, rel_path).read_bytes())
