"""Strictly read-only inspection and recovery reads for attachment sidecars.

This module deliberately does not call the Synthetic Document readers: those
readers may migrate legacy sidecars, create backups, or write forensic copies.
"""

from __future__ import annotations

import json
import math
import re
import stat
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
    "frozen",
    "validations",
    "comments",
    "conditionalFormats",
}
EXCEL_UNSUPPORTED_RECOVERY_FIELDS = {"filters", "filterMode"}
KNOWN_SIDECAR_VERSIONS = {1, 2}
LEGACY_FIELDS = {
    "pdf_editor",
    "pdf_parsed_cache",
    "excel_editor",
    "excel_parsed_cache",
}
PDF_ITEM_EDIT_ID_RE = re.compile(r"p[0-9]+-t[0-9]+\Z")
SHA256_RE = re.compile(r"[0-9a-fA-F]{64}\Z")


def inspect_attachment(path: Path) -> dict[str, Any]:
    document_type, legacy_editor_key = _attachment_kind(path)
    sidecar_path = sidecar_path_for(path)

    if legacy_editor_key is None:
        recovery_status, sidecar_status = _inspect_html_sidecar(sidecar_path)
        return _result(
            document_type,
            recovery_status,
            sidecar_status,
            sidecar_path,
            recovery_sources=[],
            recommended_source=None,
        )

    candidates = [
        _inspect_candidate(sidecar_path, "sidecar", document_type, legacy_editor_key),
        _inspect_candidate(
            sidecar_path.with_name(f"{sidecar_path.name}.bak"),
            "backup",
            document_type,
            legacy_editor_key,
        ),
    ]
    available = [
        candidate for candidate in candidates if candidate["recoveryStatus"] == "available"
    ]
    if available:
        recovery_status = "available"
    elif any(candidate["recoveryStatus"] == "unknown" for candidate in candidates):
        recovery_status = "unknown"
    else:
        recovery_status = "none"

    recommended_source: str | None = None
    if len(available) == 1:
        recommended_source = available[0]["source"]
    elif (
        len(available) == 2
        and available[0]["editorState"] == available[1]["editorState"]
        and available[0]["sourceHash"] == available[1]["sourceHash"]
    ):
        recommended_source = "sidecar"

    return _result(
        document_type,
        recovery_status,
        candidates[0]["sidecarStatus"],
        sidecar_path,
        recovery_sources=[_public_candidate(candidate) for candidate in candidates],
        recommended_source=recommended_source,
    )


def read_attachment_recovery(path: Path, source: str) -> dict[str, Any]:
    """Read one explicitly selected recoverable editor state without writing."""
    if source not in {"sidecar", "backup"}:
        raise ValueError("attachment recovery source must be 'sidecar' or 'backup'")

    document_type, legacy_editor_key = _attachment_kind(path)
    if legacy_editor_key is None:
        raise ValueError("attachment recovery is only available for PDF and Excel files")

    sidecar_path = sidecar_path_for(path)
    candidate_path = (
        sidecar_path if source == "sidecar" else sidecar_path.with_name(f"{sidecar_path.name}.bak")
    )
    candidate = _inspect_candidate(candidate_path, source, document_type, legacy_editor_key)
    if candidate["recoveryStatus"] != "available":
        raise ValueError(f"attachment recovery source {source!r} is not recoverable")

    return {
        "documentType": document_type,
        "source": source,
        "sidecarStatus": candidate["sidecarStatus"],
        "editorState": candidate["editorState"],
        "sourceHash": candidate["sourceHash"],
    }


def _inspect_html_sidecar(sidecar_path: Path) -> tuple[str, str]:
    raw, read_status = _read_regular_file(sidecar_path)
    if read_status == "missing":
        return "none", "missing"
    if read_status == "unreadable":
        return "unknown", "unreadable"
    assert raw is not None
    try:
        sidecar = _loads_strict_json(raw)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return "unknown", "unreadable"
    if not isinstance(sidecar, dict):
        return "unknown", "unreadable"
    return "none", "current"


def _inspect_candidate(
    candidate_path: Path,
    source: str,
    document_type: str,
    legacy_editor_key: str,
) -> dict[str, Any]:
    raw, read_status = _read_regular_file(candidate_path)
    if read_status == "missing":
        return _candidate(source, "none", "missing")
    if read_status == "unreadable":
        return _candidate(source, "unknown", "unreadable")
    assert raw is not None

    try:
        sidecar = _loads_strict_json(raw)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return _candidate(source, "unknown", "unreadable")
    if not isinstance(sidecar, dict):
        return _candidate(source, "unknown", "unreadable")

    version = sidecar.get("version")
    if "version" in sidecar and (type(version) is not int or version not in KNOWN_SIDECAR_VERSIONS):
        return _candidate(source, "unknown", "unreadable")

    expected_legacy_fields = {
        legacy_editor_key,
        legacy_editor_key.replace("_editor", "_parsed_cache"),
    }
    present_legacy_fields = LEGACY_FIELDS.intersection(sidecar)
    if present_legacy_fields.difference(expected_legacy_fields):
        return _candidate(source, "unknown", "unreadable")

    if present_legacy_fields:
        if _has_current_editor(sidecar):
            return _candidate(source, "unknown", "unreadable")
        sidecar_status = "legacy"
        editor = sidecar.get(legacy_editor_key)
        parsed_cache = sidecar.get(legacy_editor_key.replace("_editor", "_parsed_cache"))
    else:
        if type(version) is not int or version not in KNOWN_SIDECAR_VERSIONS:
            return _candidate(source, "unknown", "unreadable")
        sidecar_status = "current"
        slot = _current_slot(sidecar, document_type)
        if slot is _INVALID:
            return _candidate(source, "unknown", "unreadable")
        editor = slot.get("editor")
        parsed_cache = slot.get("parsedCache")

    recovery_status = (
        _pdf_recovery_status(editor) if document_type == "pdf" else _excel_recovery_status(editor)
    )
    source_hash = _normalized_source_hash(parsed_cache)
    if recovery_status == "available" and source_hash is None:
        recovery_status = "unknown"
    if recovery_status == "unknown":
        return _candidate(source, recovery_status, "unreadable")
    return _candidate(
        source,
        recovery_status,
        sidecar_status,
        editor_state=editor if recovery_status == "available" else None,
        source_hash=source_hash if recovery_status == "available" else None,
    )


def _read_regular_file(path: Path) -> tuple[bytes | None, str]:
    """Read a derived sidecar path only when the directory entry is a regular file."""
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return None, "missing"
    except OSError:
        return None, "unreadable"
    if stat.S_ISLNK(mode) or not stat.S_ISREG(mode):
        return None, "unreadable"
    try:
        return path.read_bytes(), "readable"
    except OSError:
        return None, "unreadable"


_INVALID = object()


def _current_slot(sidecar: dict[str, Any], document_type: str) -> Any:
    extras = sidecar.get("extras")
    if not isinstance(extras, dict):
        return _INVALID
    blocks = extras.get("blocks")
    if not isinstance(blocks, dict) or any(not isinstance(slot, dict) for slot in blocks.values()):
        return _INVALID
    html = sidecar.get("html")
    placeholders = (
        list(placeholder_re_for((f"{document_type}-block",)).finditer(html))
        if isinstance(html, str)
        else []
    )
    if len(placeholders) != 1:
        return _INVALID
    block_id = placeholders[0].group("id")
    if set(blocks) != {block_id}:
        return _INVALID
    return blocks[block_id]


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
    version = editor.get("version")
    if "version" in editor and (type(version) is not int or version not in {1, 2}):
        return "unknown"
    if "edits" in editor:
        edits = editor["edits"]
        if not isinstance(edits, dict) or any(
            PDF_ITEM_EDIT_ID_RE.fullmatch(edit_id) is None for edit_id in edits
        ):
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
    version = editor.get("version")
    if "version" in editor and (type(version) is not int or version != 1):
        return "unknown"
    known_fields = EXCEL_VIEW_FIELDS | EXCEL_EDIT_FIELDS | EXCEL_UNSUPPORTED_RECOVERY_FIELDS
    if any(_value_is_non_empty(value) for key, value in editor.items() if key not in known_fields):
        return "unknown"
    if any(_value_is_non_empty(editor.get(key)) for key in EXCEL_UNSUPPORTED_RECOVERY_FIELDS):
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


def _loads_strict_json(raw: bytes) -> Any:
    return json.loads(
        raw,
        parse_constant=_reject_json_constant,
        parse_float=_parse_finite_json_float,
    )


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"invalid JSON numeric constant: {value}")


def _parse_finite_json_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError(f"JSON number is out of range: {value}")
    return parsed


def _normalized_source_hash(parsed_cache: Any) -> str | None:
    if not isinstance(parsed_cache, dict):
        return None
    source_hash = parsed_cache.get("sourceHash")
    if not isinstance(source_hash, str) or SHA256_RE.fullmatch(source_hash) is None:
        return None
    return source_hash.lower()


def _attachment_kind(path: Path) -> tuple[str, str | None]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "pdf", "pdf_editor"
    if suffix in {".xlsx", ".xlsm", ".csv"}:
        return "excel", "excel_editor"
    if suffix in {".html", ".htm"}:
        return "html", None
    raise ValueError("attachment inspection requires PDF, spreadsheet, or HTML")


def _candidate(
    source: str,
    recovery_status: str,
    sidecar_status: str,
    *,
    editor_state: dict[str, Any] | None = None,
    source_hash: str | None = None,
) -> dict[str, Any]:
    return {
        "source": source,
        "recoveryStatus": recovery_status,
        "sidecarStatus": sidecar_status,
        "editorState": editor_state,
        "sourceHash": source_hash,
    }


def _public_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": candidate["source"],
        "recoveryStatus": candidate["recoveryStatus"],
        "sidecarStatus": candidate["sidecarStatus"],
    }


def _result(
    document_type: str,
    recovery_status: str,
    sidecar_status: str,
    sidecar_path: Path,
    *,
    recovery_sources: list[dict[str, Any]],
    recommended_source: str | None,
) -> dict[str, Any]:
    return {
        "documentType": document_type,
        "recoveryStatus": recovery_status,
        "sidecarStatus": sidecar_status,
        "sidecarPath": sidecar_path.name,
        "recoverySources": recovery_sources,
        "recommendedSource": recommended_source,
    }
