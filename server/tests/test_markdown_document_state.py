"""Unit tests for MarkdownDocumentState.

These tests call the module directly with `tmp_path`-backed real files.
No FastAPI startup, no HTTP.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from services.block_correlation import BlockCorrelation, CorrelationReport
from services.external_ref_blocks import default_external_ref_block_registry
from services.markdown_document_state import (
    DocumentSnapshot,
    EmptyDocument,
    MarkdownDocumentState,
    NoSidecar,
    SidecarStale,
    UsedSidecar,
)
from services.sidecar_io import CorruptSidecarError, sidecar_path_for


def _write_md(path: Path, body: str, meta_lines: list[str] | None = None) -> None:
    if meta_lines is None:
        path.write_text(body, encoding="utf-8")
        return
    frontmatter = "---\n" + "\n".join(meta_lines) + "\n---\n\n"
    path.write_text(frontmatter + body, encoding="utf-8")


def _state_with_correlator() -> MarkdownDocumentState:
    return MarkdownDocumentState(
        correlator=BlockCorrelation(default_external_ref_block_registry())
    )


def test_used_sidecar_when_hash_matches(tmp_path: Path) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "Plan.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>hello</p>",
            markdown="hello",
            meta={"id": "doc-1", "title": "Plan"},
            extras={"databases": {}},
        ),
    )

    outcome = state.read(path)

    assert isinstance(outcome, UsedSidecar)
    assert outcome.html == "<p>hello</p>"
    assert outcome.markdown.strip() == "hello"
    assert outcome.meta["id"] == "doc-1"
    assert outcome.extras == {"databases": {}}
    assert outcome.correlation is None


def test_configured_correlator_populates_empty_report_for_all_read_outcomes(
    tmp_path: Path,
) -> None:
    used_state = _state_with_correlator()
    used_path = tmp_path / "Used.md"
    used_state.write_full(
        used_path,
        DocumentSnapshot(
            html="<p>used</p>",
            markdown="used",
            meta={"id": "used-1"},
            extras={"blocks": {}},
        ),
    )

    stale_state = _state_with_correlator()
    stale_path = tmp_path / "Stale.md"
    stale_state.write_full(
        stale_path,
        DocumentSnapshot(
            html="<p>stale</p>",
            markdown="stale",
            meta={"id": "stale-1"},
            extras={"blocks": {}},
        ),
    )
    stale_path.write_text("---\nid: stale-1\n---\n\nfresh\n", encoding="utf-8")

    no_sidecar_path = tmp_path / "NoSidecar.md"
    _write_md(no_sidecar_path, "body\n", meta_lines=["id: no-sidecar-1"])

    empty_path = tmp_path / "Empty.md"
    _write_md(empty_path, "", meta_lines=["id: empty-1"])

    outcomes = (
        used_state.read(used_path),
        stale_state.read(stale_path),
        _state_with_correlator().read(no_sidecar_path),
        _state_with_correlator().read(empty_path),
    )

    assert isinstance(outcomes[0], UsedSidecar)
    assert isinstance(outcomes[1], SidecarStale)
    assert isinstance(outcomes[2], NoSidecar)
    assert isinstance(outcomes[3], EmptyDocument)
    assert [outcome.correlation for outcome in outcomes] == [
        CorrelationReport(),
        CorrelationReport(),
        CorrelationReport(),
        CorrelationReport(),
    ]


def test_no_sidecar_with_non_empty_body(tmp_path: Path) -> None:
    path = tmp_path / "Loose.md"
    _write_md(path, "# Heading\n\nbody\n", meta_lines=["id: ext-1"])

    outcome = MarkdownDocumentState().read(path)

    assert isinstance(outcome, NoSidecar)
    assert outcome.meta["id"] == "ext-1"
    assert "<h1>Heading</h1>" in outcome.html
    assert outcome.correlation is None


def test_empty_document_when_body_empty_and_no_sidecar(tmp_path: Path) -> None:
    path = tmp_path / "Empty.md"
    _write_md(path, "", meta_lines=["id: empty-1"])

    outcome = MarkdownDocumentState().read(path)

    assert isinstance(outcome, EmptyDocument)
    assert outcome.meta["id"] == "empty-1"
    assert outcome.correlation is None


def test_sidecar_stale_when_hash_mismatches(tmp_path: Path) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "Doc.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>old</p>",
            markdown="old",
            meta={"id": "doc-1"},
            extras={"databases": {"d1": {"rows": []}}},
        ),
    )

    path.write_text("---\nid: doc-1\n---\n\n# External\n", encoding="utf-8")

    outcome = state.read(path)

    assert isinstance(outcome, SidecarStale)
    assert "<h1>External</h1>" in outcome.fresh_html
    assert outcome.salvaged_extras == {}
    assert outcome.discarded_slots == ["databases"]
    assert outcome.correlation is None


def test_sidecar_stale_when_version_mismatches(tmp_path: Path) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "Versioned.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>v</p>",
            markdown="v",
            meta={"id": "doc-1"},
            extras={"alpha": {"x": 1}},
        ),
    )

    sidecar_path = sidecar_path_for(path)
    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    sidecar["version"] = 999_999
    sidecar_path.write_text(json.dumps(sidecar), encoding="utf-8")

    outcome = state.read(path)

    assert isinstance(outcome, SidecarStale)
    assert outcome.salvaged_extras == {}
    assert outcome.discarded_slots == ["alpha"]


def test_meta_id_is_backfilled_from_sidecar_when_disagreeing(tmp_path: Path) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "Mixed.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>x</p>",
            markdown="x",
            meta={"id": "sidecar-id"},
        ),
    )

    raw = path.read_text(encoding="utf-8")
    raw = raw.replace('id: "sidecar-id"', 'id: "frontmatter-id"')
    path.write_text(raw, encoding="utf-8")

    outcome = state.read(path)

    assert isinstance(outcome, SidecarStale)
    assert outcome.meta["id"] == "sidecar-id"


def test_write_full_then_read_roundtrips_extras(tmp_path: Path) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "Round.md"
    extras = {"databases": {"d1": {"rows": [{"a": 1}]}}, "blocks": {"b1": {"k": "v"}}}
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>hi</p>",
            markdown="hi",
            meta={"id": "doc-1"},
            extras=extras,
        ),
    )

    outcome = state.read(path)

    assert isinstance(outcome, UsedSidecar)
    assert outcome.extras == extras


def test_atomic_write_interrupted_before_rename_leaves_prior_sidecar_intact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "Atomic.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>v1</p>",
            markdown="v1",
            meta={"id": "doc-1"},
            extras={"a": 1},
        ),
    )

    sidecar = sidecar_path_for(path)
    original_sidecar_bytes = sidecar.read_bytes()

    real_replace = os.replace

    def failing_replace(src: Any, dst: Any) -> None:
        if str(dst) == str(sidecar):
            raise OSError("simulated crash before rename")
        return real_replace(src, dst)

    monkeypatch.setattr(os, "replace", failing_replace)

    with pytest.raises(OSError, match="simulated crash"):
        state.write_full(
            path,
            DocumentSnapshot(
                html="<p>v2</p>",
                markdown="v2",
                meta={"id": "doc-1"},
                extras={"a": 2},
            ),
        )

    assert sidecar.read_bytes() == original_sidecar_bytes
    leftover_tmps = [
        p for p in sidecar.parent.iterdir() if p.name.startswith(f".{sidecar.name}.tmp-")
    ]
    assert leftover_tmps == []


def test_custom_salvager_is_consulted_for_stale_sidecar(tmp_path: Path) -> None:
    captured: dict[str, Any] = {}

    class KeepEverythingSalvager:
        def salvage(
            self,
            *,
            markdown_body: str,
            extras: dict[str, Any],
        ) -> tuple[dict[str, Any], list[str]]:
            captured["markdown_body"] = markdown_body
            captured["extras"] = dict(extras)
            return dict(extras), []

    state = MarkdownDocumentState(salvager=KeepEverythingSalvager())
    path = tmp_path / "Salvage.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>old</p>",
            markdown="old body",
            meta={"id": "doc-1"},
            extras={"databases": {"d1": {"rows": []}}},
        ),
    )

    path.write_text("---\nid: doc-1\n---\n\nfresh body\n", encoding="utf-8")

    outcome = state.read(path)

    assert isinstance(outcome, SidecarStale)
    assert outcome.salvaged_extras == {"databases": {"d1": {"rows": []}}}
    assert outcome.discarded_slots == []
    assert captured["extras"] == {"databases": {"d1": {"rows": []}}}
    assert "fresh body" in captured["markdown_body"]


def test_read_rejects_relative_path(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="absolute"):
        MarkdownDocumentState().read(Path("relative.md"))


def test_write_slot_new_slot_preserves_other_extras(tmp_path: Path) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "Slot.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>x</p>",
            markdown="x",
            meta={"id": "doc-1"},
            extras={"databases": {"d1": {"rows": [{"a": 1}]}}, "callouts": {"c1": "info"}},
        ),
    )

    state.write_slot(path, "pdf_blocks", {"b1": {"page": 1}})

    sidecar = json.loads(sidecar_path_for(path).read_text(encoding="utf-8"))
    assert sidecar["extras"]["databases"] == {"d1": {"rows": [{"a": 1}]}}
    assert sidecar["extras"]["callouts"] == {"c1": "info"}
    assert sidecar["extras"]["pdf_blocks"] == {"b1": {"page": 1}}


def test_write_slot_overwrite_preserves_other_extras(tmp_path: Path) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "Overwrite.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>x</p>",
            markdown="x",
            meta={"id": "doc-1"},
            extras={"databases": {"d1": {"rows": []}}, "pdf_blocks": {"b1": {"page": 1}}},
        ),
    )

    state.write_slot(path, "pdf_blocks", {"b1": {"page": 2}, "b2": {"page": 5}})

    sidecar = json.loads(sidecar_path_for(path).read_text(encoding="utf-8"))
    assert sidecar["extras"]["databases"] == {"d1": {"rows": []}}
    assert sidecar["extras"]["pdf_blocks"] == {"b1": {"page": 2}, "b2": {"page": 5}}


def test_two_write_slot_calls_retain_both_slots(tmp_path: Path) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "Both.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>x</p>",
            markdown="x",
            meta={"id": "doc-1"},
            extras={},
        ),
    )

    state.write_slot(path, "pdf_blocks", {"b1": 1})
    state.write_slot(path, "excel_blocks", {"e1": 2})

    sidecar = json.loads(sidecar_path_for(path).read_text(encoding="utf-8"))
    assert sidecar["extras"] == {"pdf_blocks": {"b1": 1}, "excel_blocks": {"e1": 2}}


def test_write_slot_then_read_returns_used_sidecar_with_merged_extras(tmp_path: Path) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "Merge.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>x</p>",
            markdown="x",
            meta={"id": "doc-1"},
            extras={"databases": {"d1": {}}},
        ),
    )

    state.write_slot(path, "pdf_blocks", {"b1": {"page": 7}})

    outcome = state.read(path)

    assert isinstance(outcome, UsedSidecar)
    assert outcome.extras == {
        "databases": {"d1": {}},
        "pdf_blocks": {"b1": {"page": 7}},
    }


def test_write_slot_no_existing_sidecar_creates_minimal_sidecar(tmp_path: Path) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "Fresh.md"
    _write_md(path, "# Body\n\ncontent\n", meta_lines=["id: ext-1"])

    state.write_slot(path, "pdf_blocks", {"b1": {"page": 1}})

    outcome = state.read(path)

    assert isinstance(outcome, UsedSidecar)
    assert outcome.extras == {"pdf_blocks": {"b1": {"page": 1}}}


def test_write_slot_preserves_top_level_fields(tmp_path: Path) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "TopLevel.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>preserved</p>",
            markdown="preserved",
            meta={"id": "doc-1"},
            extras={"alpha": 1},
        ),
    )

    sidecar_before = json.loads(sidecar_path_for(path).read_text(encoding="utf-8"))

    state.write_slot(path, "beta", {"b": 2})

    sidecar_after = json.loads(sidecar_path_for(path).read_text(encoding="utf-8"))
    assert sidecar_after["html"] == sidecar_before["html"]
    assert sidecar_after["version"] == sidecar_before["version"]
    assert sidecar_after["id"] == sidecar_before["id"]
    assert sidecar_after["markdown_hash"] == sidecar_before["markdown_hash"]
    assert isinstance(sidecar_after["updated_at"], str)


def test_read_against_corrupt_sidecar_raises_and_writes_forensic_copy(
    tmp_path: Path,
) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "Corrupt.md"
    _write_md(path, "body\n", meta_lines=["id: doc-1"])
    sidecar_path = sidecar_path_for(path)
    corrupt_bytes = b'{"version": 1'
    sidecar_path.write_bytes(corrupt_bytes)

    with pytest.raises(CorruptSidecarError) as excinfo:
        state.read(path)

    assert excinfo.value.sidecar_path == sidecar_path
    assert excinfo.value.forensic_path is not None
    assert sidecar_path.read_bytes() == corrupt_bytes
    assert excinfo.value.forensic_path.exists()
    assert excinfo.value.forensic_path.read_bytes() == corrupt_bytes
    assert excinfo.value.forensic_path.name.startswith(f"{sidecar_path.name}.corrupt-")


def test_write_slot_against_corrupt_sidecar_raises_and_preserves_original(
    tmp_path: Path,
) -> None:
    state = MarkdownDocumentState()
    path = tmp_path / "SlotCorrupt.md"
    _write_md(path, "body\n", meta_lines=["id: doc-1"])
    sidecar_path = sidecar_path_for(path)
    corrupt_bytes = b"\xff\xfe"
    sidecar_path.write_bytes(corrupt_bytes)

    with pytest.raises(CorruptSidecarError) as excinfo:
        state.write_slot(path, "pdf_blocks", {"b1": {"page": 1}})

    assert excinfo.value.sidecar_path == sidecar_path
    assert excinfo.value.forensic_path is not None
    assert sidecar_path.read_bytes() == corrupt_bytes
    assert excinfo.value.forensic_path.exists()
    assert excinfo.value.forensic_path.read_bytes() == corrupt_bytes
