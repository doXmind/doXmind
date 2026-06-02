"""HtmlDocumentState: read/write for first-class HTML documents.

An HTML document on disk is a portable ``.html`` / ``.htm`` file plus its
hidden same-name ``.doxmind`` sidecar. doXmind renders the file faithfully
(real HTML + CSS, in a sandboxed frame) and edits its text content in place,
so the *whole document* is the unit of state — there is no markdown render
step and no body/shell split. The editor serializes the full document
(doctype + head + body) and we write it back verbatim, which makes the
round-trip lossless: tags, attributes, styles and inert ``<script>`` markup
all survive an edit cycle.

The sidecar carries the stable document ``id`` (HTML has no frontmatter to
hold one) and a hash of the on-disk file used as the external-edit sentinel.
Its wire shape matches the Markdown sidecar: ``version``, ``id``, ``html``
(the full document), ``markdown_hash`` (hash of that document), ``updated_at``.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from services.sidecar_io import (
    SIDECAR_VERSION,
    Loaded,
    atomic_write,
    hash_markdown,
    now_iso,
    read_sidecar,
    sidecar_path_for,
)


@dataclass(frozen=True)
class HtmlReadOutcome:
    editor_html: str
    meta: dict[str, Any]
    source_state: str


@dataclass(frozen=True)
class HtmlDocumentSnapshot:
    html: str
    meta: dict[str, Any]


class HtmlDocumentState:
    def read(self, path: Path) -> HtmlReadOutcome:
        if not path.is_absolute():
            raise ValueError("document path must be absolute")
        raw = path.read_text(encoding="utf-8")
        current_hash = hash_markdown(raw)
        sidecar_result = read_sidecar(sidecar_path_for(path))

        sidecar_id: str | None = None
        source_state = "sidecar_missing"
        if isinstance(sidecar_result, Loaded):
            sid = sidecar_result.data.get("id")
            if isinstance(sid, str) and sid:
                sidecar_id = sid
            version_ok = sidecar_result.data.get("version") == SIDECAR_VERSION
            hash_ok = sidecar_result.data.get("markdown_hash") == current_hash
            source_state = "sidecar_fresh" if (version_ok and hash_ok) else "sidecar_stale"

        meta = {
            "id": sidecar_id or str(uuid.uuid4()),
            "title": path.stem,
            "updated": now_iso(),
        }
        if not raw.strip():
            source_state = "empty"
        return HtmlReadOutcome(editor_html=raw, meta=meta, source_state=source_state)

    def write_full(self, path: Path, snapshot: HtmlDocumentSnapshot) -> None:
        meta = dict(snapshot.meta)
        if not str(meta.get("id") or "").strip():
            raise ValueError("document id is required")
        meta.setdefault("updated", now_iso())

        full_html = snapshot.html
        atomic_write(path, full_html.encode("utf-8"))

        sidecar: dict[str, Any] = {
            "version": SIDECAR_VERSION,
            "id": meta["id"],
            "html": full_html,
            "markdown_hash": hash_markdown(full_html),
            "updated_at": now_iso(),
        }
        atomic_write(
            sidecar_path_for(path),
            json.dumps(sidecar, indent=2, ensure_ascii=False).encode(),
        )
