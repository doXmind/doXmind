"""Cross-runtime fixtures for Synthetic Document sidecar compatibility."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from services.sidecar_io import SIDECAR_VERSION, sidecar_path_for

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "sidecar_compat"


def invoke(sync_client, command: str, payload: dict[str, Any]) -> Any:
    response = sync_client.post(
        "/api/workspace/invoke",
        json={"command": command, "payload": payload},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _write_source(path: Path) -> None:
    if path.suffix.lower() == ".pdf":
        path.write_bytes(b"%PDF-1.4\n% compat fixture\n%%EOF\n")
    else:
        path.write_bytes(b"PK\x03\x04 compat fixture workbook")


def _install_fixture(source_path: Path, fixture_name: str) -> Path:
    _write_source(source_path)
    sidecar_path = sidecar_path_for(source_path)
    sidecar_path.write_bytes((FIXTURES / fixture_name).read_bytes())
    return sidecar_path


def _read_sidecar(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _slot(sidecar: dict[str, Any], block_id: str) -> dict[str, Any]:
    return sidecar["extras"]["blocks"][block_id]


def _assert_no_legacy_fields(sidecar: dict[str, Any], legacy_keys: tuple[str, str]) -> None:
    assert sidecar["version"] == SIDECAR_VERSION
    assert sidecar.get("source_path") is None
    assert sidecar.get("updated_at_unix_nanos") is None
    assert all(key not in sidecar for key in legacy_keys)


@pytest.mark.parametrize(
    "case",
    [
        {
            "filename": "Spec.pdf",
            "fixture": "pdf_markdown_shape.doxmind.json",
            "block_id": "fixture-pdf-block",
            "read_doc": "workspace_read_pdf_doc_state",
            "write_editor": "workspace_write_pdf_editor_state",
            "write_cache": "workspace_write_pdf_parsed_cache",
            "legacy_keys": ("pdf_editor", "pdf_parsed_cache"),
            "editor": {"version": 1, "edits": {"9:0": {"text": "browser pdf"}}},
            "cache_hash": "valid-pdf-hash-2",
            "cache_parsed": {"pages": [{"index": 1, "text": "updated"}]},
            "slot_extra": {"keep": "pdf"},
        },
        {
            "filename": "Budget.xlsx",
            "fixture": "excel_markdown_shape.doxmind.json",
            "block_id": "fixture-excel-block",
            "read_doc": "workspace_read_excel_doc_state",
            "write_editor": "workspace_write_excel_editor_state",
            "write_cache": "workspace_write_excel_parsed_cache",
            "legacy_keys": ("excel_editor", "excel_parsed_cache"),
            "editor": {
                "version": 1,
                "activeSheetId": "Sheet2",
                "sheets": [{"id": "Sheet2", "name": "Browser"}],
            },
            "cache_hash": "valid-excel-hash-2",
            "cache_parsed": {"sheets": [{"id": "Sheet2", "rows": 4}]},
            "slot_extra": {"keep": "excel"},
        },
    ],
)
def test_browser_dev_editor_and_cache_writes_match_sidecar_contract(
    sync_client, tmp_path: Path, case: dict[str, Any]
) -> None:
    source_path = tmp_path / case["filename"]
    sidecar_path = _install_fixture(source_path, case["fixture"])

    initial = invoke(
        sync_client,
        case["read_doc"],
        {"root": str(tmp_path), "path": source_path.name},
    )
    assert initial["editor"] is not None
    assert initial["parsedCache"]["sourceHash"].startswith("valid-")

    invoke(
        sync_client,
        case["write_editor"],
        {"root": str(tmp_path), "path": source_path.name, "payload": case["editor"]},
    )
    after_editor = invoke(
        sync_client,
        case["read_doc"],
        {"root": str(tmp_path), "path": source_path.name},
    )
    assert after_editor["editor"] == case["editor"]
    assert after_editor["parsedCache"] == initial["parsedCache"]

    invoke(
        sync_client,
        case["write_cache"],
        {
            "root": str(tmp_path),
            "path": source_path.name,
            "sourceHash": case["cache_hash"],
            "parsed": case["cache_parsed"],
        },
    )
    after_cache = invoke(
        sync_client,
        case["read_doc"],
        {"root": str(tmp_path), "path": source_path.name},
    )
    assert after_cache["editor"] == case["editor"]
    assert after_cache["parsedCache"] == {
        "sourceHash": case["cache_hash"],
        "parsed": case["cache_parsed"],
    }

    sidecar = _read_sidecar(sidecar_path)
    _assert_no_legacy_fields(sidecar, case["legacy_keys"])
    assert f'id="{case["block_id"]}"' in sidecar["html"]
    assert sidecar["extras"]["unrelated"]["keep"] is True
    slot = _slot(sidecar, case["block_id"])
    assert slot["editor"] == case["editor"]
    assert slot["parsedCache"] == after_cache["parsedCache"]
    assert slot["slotExtra"] == case["slot_extra"]


@pytest.mark.parametrize(
    "case",
    [
        {
            "filename": "Spec.pdf",
            "fixture": "pdf_legacy.doxmind.json",
            "block_id": "legacy-pdf-block",
            "read_doc": "workspace_read_pdf_doc_state",
            "write_editor": "workspace_write_pdf_editor_state",
            "legacy_keys": ("pdf_editor", "pdf_parsed_cache"),
            "unrelated": "legacy-pdf",
            "editor_marker": ("edits", "2:0"),
            "cache_hash": "legacy-pdf-hash",
            "post_editor": {"version": 1, "edits": {"3:0": {"text": "post"}}},
        },
        {
            "filename": "Budget.xlsx",
            "fixture": "excel_legacy.doxmind.json",
            "block_id": "legacy-excel-block",
            "read_doc": "workspace_read_excel_doc_state",
            "write_editor": "workspace_write_excel_editor_state",
            "legacy_keys": ("excel_editor", "excel_parsed_cache"),
            "unrelated": "legacy-excel",
            "editor_marker": ("activeSheetId", "LegacySheet"),
            "cache_hash": "legacy-excel-hash",
            "post_editor": {
                "version": 1,
                "activeSheetId": "PostSheet",
                "sheets": [{"id": "PostSheet"}],
            },
        },
    ],
)
def test_browser_dev_migrates_legacy_fixture_to_shared_shape(
    sync_client, tmp_path: Path, case: dict[str, Any]
) -> None:
    source_path = tmp_path / case["filename"]
    sidecar_path = _install_fixture(source_path, case["fixture"])

    migrated_state = invoke(
        sync_client,
        case["read_doc"],
        {"root": str(tmp_path), "path": source_path.name},
    )

    marker_key, marker_value = case["editor_marker"]
    if marker_key == "edits":
        assert marker_value in migrated_state["editor"][marker_key]
    else:
        assert migrated_state["editor"][marker_key] == marker_value
    assert migrated_state["parsedCache"]["sourceHash"] == case["cache_hash"]
    assert sidecar_path.with_name(f"{sidecar_path.name}.bak").exists()

    sidecar = _read_sidecar(sidecar_path)
    _assert_no_legacy_fields(sidecar, case["legacy_keys"])
    assert sidecar["id"].startswith("legacy-")
    assert f'id="{case["block_id"]}"' in sidecar["html"]
    assert sidecar["extras"]["unrelated"]["keep"] == case["unrelated"]
    slot = _slot(sidecar, case["block_id"])
    assert slot["slotExtra"] == {"keep": True}
    assert slot["parsedCache"]["sourceHash"] == case["cache_hash"]

    invoke(
        sync_client,
        case["write_editor"],
        {"root": str(tmp_path), "path": source_path.name, "payload": case["post_editor"]},
    )
    post_write = _read_sidecar(sidecar_path)
    _assert_no_legacy_fields(post_write, case["legacy_keys"])
    assert case["block_id"] in post_write["extras"]["blocks"]
    assert _slot(post_write, case["block_id"])["editor"] == case["post_editor"]
