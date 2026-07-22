"""Strictly read-only inspection for attachment recovery state.

Legacy JSON is inspected directly. This path never migrates, repairs, backs up,
or rewrites the attachment or its recovery artifacts.
"""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from typing import Any

from services.legacy_sidecar import placeholder_re_for, sidecar_path_for

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
    sidecar_state = _artifact_state(sidecar_path)
    backup_state = _artifact_state(backup_path)

    if sidecar_state == "unsafe":
        return _result(document_type, "unknown", "unreadable", sidecar_path)
    if sidecar_state == "missing":
        recovery_status = "none" if backup_state == "missing" else "unknown"
        return _result(document_type, recovery_status, "missing", sidecar_path)
    if legacy_editor_key is None:
        return _result(document_type, "none", "current", sidecar_path)

    try:
        sidecar = json.loads(_read_regular_artifact(sidecar_path))
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
    if recovery_status == "none" and backup_state != "missing":
        recovery_status = "unknown"
    return _result(document_type, recovery_status, sidecar_status, sidecar_path)


def read_attachment_recovery(path: Path) -> dict[str, Any] | None:
    """Return exact legacy editor state without migration, repair, or backup writes."""
    document_type, legacy_editor_key = _attachment_kind(path)
    if legacy_editor_key is None:
        raise ValueError("attachment recovery requires a PDF or spreadsheet")
    sidecar_path = sidecar_path_for(path)
    try:
        raw = _read_regular_artifact(sidecar_path)
        sidecar = json.loads(raw)
    except FileNotFoundError:
        return None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"attachment_recovery_unreadable: {sidecar_path}") from error
    if not isinstance(sidecar, dict):
        raise ValueError(f"attachment_recovery_unreadable: {sidecar_path}")

    legacy_cache_key = f"{document_type}_parsed_cache"
    has_legacy = legacy_editor_key in sidecar or legacy_cache_key in sidecar
    if has_legacy:
        if _has_current_editor(sidecar):
            raise ValueError(f"attachment_recovery_unreadable: {sidecar_path}")
        editor = sidecar.get(legacy_editor_key)
    else:
        version = sidecar.get("version")
        if type(version) is not int or version not in {1, 2}:
            raise ValueError(f"attachment_recovery_unreadable: {sidecar_path}")
        extras = sidecar.get("extras")
        blocks = extras.get("blocks") if isinstance(extras, dict) else None
        html = sidecar.get("html")
        placeholders = (
            list(placeholder_re_for((f"{document_type}-block",)).finditer(html))
            if isinstance(html, str)
            else []
        )
        if (
            not isinstance(blocks, dict)
            or len(placeholders) != 1
            or set(blocks) != {placeholders[0].group("id")}
        ):
            raise ValueError(f"attachment_recovery_unreadable: {sidecar_path}")
        slot = blocks[placeholders[0].group("id")]
        if not isinstance(slot, dict):
            raise ValueError(f"attachment_recovery_unreadable: {sidecar_path}")
        editor = slot.get("editor")

    if editor is not None and not isinstance(editor, dict):
        raise ValueError(f"attachment_recovery_unreadable: {sidecar_path}")
    return {"editor": editor}


def _artifact_state(path: Path) -> str:
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return "missing"
    except OSError:
        return "unsafe"
    return "regular" if stat.S_ISREG(metadata.st_mode) else "unsafe"


def _read_regular_artifact(path: Path) -> bytes:
    if _artifact_state(path) == "missing":
        raise FileNotFoundError(path)
    if _artifact_state(path) != "regular":
        raise ValueError(f"attachment_recovery_unreadable: {path}")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ValueError(f"attachment_recovery_unreadable: {path}") from error
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            raise ValueError(f"attachment_recovery_unreadable: {path}")
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            return handle.read()
    finally:
        os.close(descriptor)


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
    if any(_value_is_non_empty(value) for key, value in editor.items() if key not in known_fields):
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
    if any(_value_is_non_empty(value) for key, value in editor.items() if key not in known_fields):
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
