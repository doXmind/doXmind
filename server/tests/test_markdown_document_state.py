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

from services.markdown_document_state import (
    DocumentSnapshot,
    EmptyDocument,
    MarkdownDocumentState,
    NoSidecar,
    SidecarStale,
    UsedSidecar,
)
from services.sidecar_io import sidecar_path_for


def _write_md(path: Path, body: str, meta_lines: list[str] | None = None) -> None:
    if meta_lines is None:
        path.write_text(body, encoding="utf-8")
        return
    frontmatter = "---\n" + "\n".join(meta_lines) + "\n---\n\n"
    path.write_text(frontmatter + body, encoding="utf-8")


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
    for tmp in leftover_tmps:
        tmp.unlink()


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
