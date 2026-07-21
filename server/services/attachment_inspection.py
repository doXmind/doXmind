"""Strictly read-only inspection for attachment recovery state.

This module deliberately does not call the Synthetic Document readers: those
readers may migrate legacy sidecars, create backups, or write forensic copies.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from services.sidecar_io import placeholder_re_for, sidecar_path_for

PDF_VIEW_FIELDS = {"version"}
PDF_EDIT_FIELDS = {"edits", "textEdits", "paragraphEdits", "freeText", "highlights"}
EXCEL_VIEW_FIELDS = {"version", "activeSheetId"}
EXCEL_EDIT_FIELDS = {
    "cells",
    "rowHeights",
    "colWidths",
    "ops",
    "workbookOps",
    "filters",
    "filterMode",
    "frozen",
    "validations",
    "comments",
    "conditionalFormats",
}


def inspect_attachment(path: Path) -> dict[str, Any]:
    document_type, legacy_editor_key = _attachment_kind(path)
    sidecar_path = sidecar_path_for(path)
    backup_path = sidecar_path.with_name(f"{sidecar_path.name}.bak")

    if not sidecar_path.exists():
        recovery_status = "unknown" if backup_path.exists() else "none"
        return _result(document_type, recovery_status, "missing", sidecar_path)
    if legacy_editor_key is None:
        return _result(document_type, "none", "current", sidecar_path)

    try:
        sidecar = json.loads(sidecar_path.read_bytes())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return _result(document_type, "unknown", "unreadable", sidecar_path)
    if not isinstance(sidecar, dict):
        return _result(document_type, "unknown", "unreadable", sidecar_path)

    if legacy_editor_key in sidecar:
        if _has_current_editor(sidecar):
            return _result(document_type, "unknown", "unreadable", sidecar_path)
        sidecar_status = "legacy"
        editor = sidecar.get(legacy_editor_key)
    else:
        version = sidecar.get("version")
        if type(version) is not int or version not in {1, 2}:
            return _result(document_type, "unknown", "unreadable", sidecar_path)
        sidecar_status = "current"
        extras = sidecar.get("extras")
        if not isinstance(extras, dict):
            return _result(document_type, "unknown", "unreadable", sidecar_path)
        blocks = extras.get("blocks")
        if not isinstance(blocks, dict) or any(
            not isinstance(slot, dict) for slot in blocks.values()
        ):
            return _result(document_type, "unknown", "unreadable", sidecar_path)
        html = sidecar.get("html")
        placeholders = (
            list(placeholder_re_for((f"{document_type}-block",)).finditer(html))
            if isinstance(html, str)
            else []
        )
        if len(placeholders) != 1:
            return _result(document_type, "unknown", "unreadable", sidecar_path)
        block_id = placeholders[0].group("id")
        if set(blocks) != {block_id}:
            return _result(document_type, "unknown", "unreadable", sidecar_path)
        editor = blocks[block_id].get("editor")

    if document_type == "pdf":
        recovery_status = _pdf_recovery_status(editor)
        if recovery_status == "unknown":
            sidecar_status = "unreadable"
    else:
        recovery_status = _excel_recovery_status(editor)
        if recovery_status == "unknown":
            sidecar_status = "unreadable"
    if recovery_status == "none" and backup_path.exists():
        recovery_status = "unknown"
    return _result(document_type, recovery_status, sidecar_status, sidecar_path)


def _has_current_editor(sidecar: dict[str, Any]) -> bool:
    extras = sidecar.get("extras")
    if not isinstance(extras, dict):
        return False
    blocks = extras.get("blocks")
    return isinstance(blocks, dict) and any(
        isinstance(slot, dict) and "editor" in slot for slot in blocks.values()
    )


def _pdf_recovery_status(editor: Any) -> str:
    if editor is None:
        return "none"
    if not isinstance(editor, dict):
        return "unknown"
    known_fields = PDF_VIEW_FIELDS | PDF_EDIT_FIELDS
    if any(
        _value_is_non_empty(value)
        for key, value in editor.items()
        if key not in known_fields
    ):
        return "unknown"
    if any(_value_is_non_empty(editor.get(key)) for key in PDF_EDIT_FIELDS):
        return "available"
    return "none"


def _excel_recovery_status(editor: Any) -> str:
    if editor is None:
        return "none"
    if not isinstance(editor, dict):
        return "unknown"
    known_fields = EXCEL_VIEW_FIELDS | EXCEL_EDIT_FIELDS
    if any(
        _value_is_non_empty(value)
        for key, value in editor.items()
        if key not in known_fields
    ):
        return "unknown"
    if any(_value_is_non_empty(editor.get(key)) for key in EXCEL_EDIT_FIELDS):
        return "available"
    return "none"


def _value_is_non_empty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return True
    return bool(value)


def _attachment_kind(path: Path) -> tuple[str, str | None]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "pdf", "pdf_editor"
    if suffix in {".xlsx", ".xlsm", ".csv"}:
        return "excel", "excel_editor"
    if suffix in {".html", ".htm"}:
        return "html", None
    raise ValueError("attachment inspection requires PDF, spreadsheet, or HTML")


def _result(
    document_type: str,
    recovery_status: str,
    sidecar_status: str,
    sidecar_path: Path,
) -> dict[str, Any]:
    return {
        "documentType": document_type,
        "recoveryStatus": recovery_status,
        "sidecarStatus": sidecar_status,
        "sidecarPath": sidecar_path.name,
    }
