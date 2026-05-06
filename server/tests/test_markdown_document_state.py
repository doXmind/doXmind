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

from services.block_correlation import (
    BlockCorrelation,
    CorrelationEvent,
    CorrelationReport,
    HowHandled,
)
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
from services.synthetic_document import _placeholder_line


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


def _pdf_placeholder(block_id: str) -> str:
    return f'<!-- pdf-block id="{block_id}" src="assets/spec.pdf" -->'


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


def test_used_sidecar_discards_orphan_pdf_block_slot(tmp_path: Path) -> None:
    state = _state_with_correlator()
    path = tmp_path / "UsedOrphan.md"
    block_id = "1a2b3c4d-1111-4aaa-8bbb-123456789abc"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>body</p>",
            markdown="body without a placeholder",
            meta={"id": "doc-1"},
            extras={
                "blocks": {
                    block_id: {
                        "editor": {"version": 1},
                        "parsedCache": {"pages": []},
                    }
                }
            },
        ),
    )

    outcome = state.read(path)

    assert isinstance(outcome, UsedSidecar)
    assert outcome.extras == {"blocks": {}}
    assert outcome.correlation is not None
    assert outcome.correlation.events == [
        CorrelationEvent(
            kind="orphan",
            block_type="pdf-block",
            id=block_id,
            how_handled=HowHandled.DISCARDED,
            detail={"slot_key": f"blocks/{block_id}"},
        )
    ]
    assert outcome.correlation.blocking is False


def test_stale_sidecar_discards_salvaged_pdf_slot_after_placeholder_removed(
    tmp_path: Path,
) -> None:
    class KeepEverythingSalvager:
        def salvage(
            self,
            *,
            markdown_body: str,  # noqa: ARG002
            extras: dict[str, Any],
        ) -> tuple[dict[str, Any], list[str]]:
            return dict(extras), []

    state = MarkdownDocumentState(
        salvager=KeepEverythingSalvager(),
        correlator=BlockCorrelation(default_external_ref_block_registry()),
    )
    path = tmp_path / "StaleOrphan.md"
    block_id = "1a2b3c4d-1111-4aaa-8bbb-123456789abc"
    state.write_full(
        path,
        DocumentSnapshot(
            html=_pdf_placeholder(block_id),
            markdown=_pdf_placeholder(block_id) + "\n",
            meta={"id": "doc-1"},
            extras={
                "blocks": {
                    block_id: {
                        "editor": {"version": 1},
                        "parsedCache": {"pages": []},
                    }
                }
            },
        ),
    )
    path.write_text("---\nid: doc-1\n---\n\n# Placeholder removed\n", encoding="utf-8")

    outcome = state.read(path)

    assert isinstance(outcome, SidecarStale)
    assert outcome.salvaged_extras == {"blocks": {}}
    assert outcome.correlation is not None
    assert outcome.correlation.events == [
        CorrelationEvent(
            kind="orphan",
            block_type="pdf-block",
            id=block_id,
            how_handled=HowHandled.DISCARDED,
            detail={"slot_key": f"blocks/{block_id}"},
        )
    ]
    assert outcome.correlation.blocking is False


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


def test_configured_correlator_propagates_new_events_in_read_outcomes(
    tmp_path: Path,
) -> None:
    used_state = _state_with_correlator()
    used_path = tmp_path / "UsedNew.md"
    used_markdown = _placeholder_line("pdf-block", "used-new", "assets/spec.pdf")
    used_state.write_full(
        used_path,
        DocumentSnapshot(
            html=used_markdown,
            markdown=used_markdown,
            meta={"id": "used-new-doc"},
            extras={"blocks": {}},
        ),
    )

    stale_state = _state_with_correlator()
    stale_path = tmp_path / "StaleNew.md"
    stale_state.write_full(
        stale_path,
        DocumentSnapshot(
            html="<p>old</p>",
            markdown="old",
            meta={"id": "stale-new-doc"},
            extras={},
        ),
    )
    stale_markdown = _placeholder_line("excel-block", "stale-new", "assets/budget.xlsx")
    stale_path.write_text(
        f"---\nid: stale-new-doc\n---\n\n{stale_markdown}\n",
        encoding="utf-8",
    )

    no_sidecar_path = tmp_path / "NoSidecarNew.md"
    no_sidecar_markdown = _placeholder_line("pdf-block", "no-sidecar-new", "assets/ref.pdf")
    _write_md(
        no_sidecar_path,
        no_sidecar_markdown,
        meta_lines=["id: no-sidecar-new-doc"],
    )

    outcomes = (
        used_state.read(used_path),
        stale_state.read(stale_path),
        _state_with_correlator().read(no_sidecar_path),
    )

    assert isinstance(outcomes[0], UsedSidecar)
    assert outcomes[0].extras == {"blocks": {"used-new": {}}}
    assert isinstance(outcomes[1], SidecarStale)
    assert outcomes[1].salvaged_extras == {"blocks": {"stale-new": {}}}
    assert isinstance(outcomes[2], NoSidecar)
    for outcome, block_id in zip(
        outcomes, ("used-new", "stale-new", "no-sidecar-new"), strict=True
    ):
        assert outcome.correlation is not None
        assert outcome.correlation.blocking is False
        event = outcome.correlation.by_kind("new")[0]
        assert event.id == block_id
        assert event.how_handled == HowHandled.CREATED_EMPTY


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


# ---------------------------------------------------------------------- cache


def test_read_cache_hit_returns_clone_so_caller_mutation_doesnt_leak(
    tmp_path: Path,
) -> None:
    """Mutating the meta/extras of one read() return value must not bleed
    into the next read() of the same file. Without the deep-clone in
    `_clone_outcome`, callers would share the cache's interior state."""
    from services.markdown_document_state import _clear_read_cache

    _clear_read_cache()
    state = MarkdownDocumentState()
    path = tmp_path / "Plan.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>x</p>",
            markdown="x",
            meta={"id": "doc-1", "title": "Plan"},
            extras={"databases": {"d1": {"rows": []}}},
        ),
    )

    first = state.read(path)
    assert isinstance(first, UsedSidecar)

    # Caller mutates returned meta + extras.
    first.meta["id"] = "WAS-MUTATED"
    assert first.extras is not None
    first.extras["databases"]["d1"]["rows"].append({"injected": True})

    second = state.read(path)
    assert isinstance(second, UsedSidecar)
    assert second.meta["id"] == "doc-1", "cache was corrupted by caller mutation"
    assert second.extras == {"databases": {"d1": {"rows": []}}}


def test_read_cache_invalidated_when_md_mtime_changes(tmp_path: Path) -> None:
    """Editing the .md file (changing mtime+size) must bust the cache."""
    from services.markdown_document_state import _clear_read_cache

    _clear_read_cache()
    state = MarkdownDocumentState()
    path = tmp_path / "Plan.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>v1</p>",
            markdown="v1",
            meta={"id": "doc-1", "title": "Plan"},
            extras={},
        ),
    )

    first = state.read(path)
    assert isinstance(first, UsedSidecar)
    assert "v1" in first.markdown

    # Rewrite the .md with new content. write_full bumps file mtime; the
    # cache key includes mtime so the next read recomputes.
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>v2</p>",
            markdown="v2",
            meta={"id": "doc-1", "title": "Plan"},
            extras={},
        ),
    )

    second = state.read(path)
    assert isinstance(second, UsedSidecar)
    assert "v2" in second.markdown


def test_read_cache_invalidated_when_sidecar_mtime_changes(tmp_path: Path) -> None:
    """Replacing only the sidecar (.doxmind) without touching the .md file
    must still bust the cache: a new sidecar means new editor HTML."""
    from services.markdown_document_state import _clear_read_cache

    _clear_read_cache()
    state = MarkdownDocumentState()
    path = tmp_path / "Plan.md"
    body = "body content\n"
    _write_md(path, body, meta_lines=["id: doc-1"])

    # First read: NoSidecar branch (no .doxmind yet).
    first = state.read(path)
    assert isinstance(first, NoSidecar)

    # Now write a sidecar matching the body's hash. Cache key includes
    # sidecar mtime+size; a freshly-written sidecar must invalidate.
    sidecar_path = sidecar_path_for(path)
    from services.sidecar_io import SIDECAR_VERSION, hash_markdown

    sidecar_path.write_text(
        json.dumps(
            {
                "version": SIDECAR_VERSION,
                "id": "doc-1",
                "html": "<p>from-sidecar</p>",
                "markdown_hash": hash_markdown(path.read_text()),
                "extras": {},
            }
        ),
        encoding="utf-8",
    )

    second = state.read(path)
    assert isinstance(second, UsedSidecar)
    assert second.html == "<p>from-sidecar</p>"


def test_read_cache_disabled_via_env(tmp_path: Path, monkeypatch) -> None:
    from services.markdown_document_state import _clear_read_cache

    monkeypatch.setenv("DOXMIND_DISABLE_DOC_CACHE", "1")
    _clear_read_cache()
    state = MarkdownDocumentState()
    path = tmp_path / "Plan.md"
    state.write_full(
        path,
        DocumentSnapshot(
            html="<p>x</p>",
            markdown="x",
            meta={"id": "doc-1"},
            extras={},
        ),
    )
    first = state.read(path)
    second = state.read(path)
    assert isinstance(first, UsedSidecar)
    assert isinstance(second, UsedSidecar)
    # With cache disabled, mutating one return doesn't affect the other
    # (they're freshly computed each time, not clones of a cached entry).
    first.meta["id"] = "MUTATED"
    assert second.meta["id"] == "doc-1"
