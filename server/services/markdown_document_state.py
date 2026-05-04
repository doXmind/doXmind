"""MarkdownDocumentState: single entry point for Document read/write.

A Document on disk is a `.md` file plus its hidden same-name `.doxmind`
sidecar. This module owns frontmatter parsing, sidecar version + hash
reconciliation, salvage of `extras` when the sidecar is stale, atomic
sidecar writes, and `meta.id` backfill from the sidecar.

`read()` returns a sealed `ReadOutcome` union with four variants:
`UsedSidecar`, `SidecarStale`, `NoSidecar`, `EmptyDocument`. Callers branch
on the variant rather than inspecting shape. `correlation` is a typed
placeholder; #4 will populate it via the canonical
`ExternalRefBlockRegistry`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from services.sidecar_io import (
    SIDECAR_VERSION,
    Corrupt,
    CorruptSidecarError,
    Loaded,
    Missing,
    atomic_write,
    build_md_with_frontmatter,
    hash_markdown,
    markdown_to_html,
    now_iso,
    parse_frontmatter,
    read_sidecar,
    sidecar_path_for,
)


class CorrelationReport:
    """Placeholder for the Block correlation report that #4 will populate."""


class Salvager(Protocol):
    """Decides which extras slots survive when a Sidecar goes stale.

    #4 will replace this protocol with the canonical
    `ExternalRefBlockRegistry`, which consults each registered Custom Block
    type for its salvage rule.
    """

    def salvage(
        self,
        *,
        markdown_body: str,
        extras: dict[str, Any],
    ) -> tuple[dict[str, Any], list[str]]: ...


class _DiscardAllSalvager:
    def salvage(
        self,
        *,
        markdown_body: str,  # noqa: ARG002
        extras: dict[str, Any],
    ) -> tuple[dict[str, Any], list[str]]:
        return {}, sorted(extras.keys())


@dataclass(frozen=True)
class DocumentSnapshot:
    html: str
    markdown: str
    meta: dict[str, Any]
    extras: dict[str, Any] | None = None


@dataclass(frozen=True)
class UsedSidecar:
    html: str
    markdown: str
    meta: dict[str, Any]
    extras: dict[str, Any] | None
    correlation: CorrelationReport | None = None


@dataclass(frozen=True)
class SidecarStale:
    fresh_html: str
    markdown: str
    meta: dict[str, Any]
    salvaged_extras: dict[str, Any]
    discarded_slots: list[str]
    correlation: CorrelationReport | None = None


@dataclass(frozen=True)
class NoSidecar:
    html: str
    markdown: str
    meta: dict[str, Any]
    correlation: CorrelationReport | None = None


@dataclass(frozen=True)
class EmptyDocument:
    meta: dict[str, Any]
    correlation: CorrelationReport | None = None


ReadOutcome = UsedSidecar | SidecarStale | NoSidecar | EmptyDocument


class MarkdownDocumentState:
    def __init__(self, salvager: Salvager | None = None) -> None:
        self._salvager: Salvager = salvager or _DiscardAllSalvager()

    def read(self, path: Path) -> ReadOutcome:
        if not path.is_absolute():
            raise ValueError("document path must be absolute")
        raw = path.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(raw)
        current_hash = hash_markdown(raw)
        sidecar_path = sidecar_path_for(path)
        sidecar_result = read_sidecar(sidecar_path)

        if isinstance(sidecar_result, Loaded):
            sidecar = sidecar_result.data
            sidecar_id = sidecar.get("id")
            if sidecar_id and meta.get("id") != sidecar_id:
                meta["id"] = sidecar_id

            version_ok = sidecar.get("version") == SIDECAR_VERSION
            hash_ok = sidecar.get("markdown_hash") == current_hash
            if version_ok and hash_ok:
                extras = sidecar.get("extras")
                if not isinstance(extras, dict) and extras is not None:
                    extras = None
                return UsedSidecar(
                    html=sidecar.get("html") or "",
                    markdown=body,
                    meta=meta,
                    extras=extras,
                )

            existing_extras = sidecar.get("extras")
            extras_for_salvage = existing_extras if isinstance(existing_extras, dict) else {}
            salvaged, discarded = self._salvager.salvage(
                markdown_body=body, extras=extras_for_salvage
            )
            fresh_html = "" if not body.strip() else markdown_to_html(body)
            return SidecarStale(
                fresh_html=fresh_html,
                markdown="" if not body.strip() else body,
                meta=meta,
                salvaged_extras=salvaged,
                discarded_slots=discarded,
            )

        if isinstance(sidecar_result, Corrupt):
            forensic_path = _write_forensic_copy(sidecar_path, sidecar_result.raw)
            raise CorruptSidecarError(
                sidecar_path,
                forensic_path,
                sidecar_result.reason,
            )

        if not isinstance(sidecar_result, Missing):
            raise TypeError(f"unexpected sidecar read result: {type(sidecar_result).__name__}")

        if not body.strip():
            return EmptyDocument(meta=meta)

        return NoSidecar(
            html=markdown_to_html(body),
            markdown=body,
            meta=meta,
        )

    def write_full(self, path: Path, snapshot: DocumentSnapshot) -> None:
        meta = dict(snapshot.meta)
        if not str(meta.get("id") or "").strip():
            raise ValueError("document id is required")
        meta.setdefault("updated", now_iso())

        md_content = build_md_with_frontmatter(meta, snapshot.markdown)
        atomic_write(path, md_content.encode("utf-8"))

        sidecar: dict[str, Any] = {
            "version": SIDECAR_VERSION,
            "id": meta["id"],
            "html": snapshot.html,
            "markdown_hash": hash_markdown(md_content),
            "updated_at": now_iso(),
        }
        if snapshot.extras is not None:
            sidecar["extras"] = snapshot.extras
        atomic_write(
            sidecar_path_for(path),
            json.dumps(sidecar, indent=2, ensure_ascii=False).encode(),
        )

    def write_slot(self, path: Path, slot_key: str, value: Any) -> None:
        if not path.is_absolute():
            raise ValueError("document path must be absolute")
        sidecar_path = sidecar_path_for(path)
        existing = read_sidecar(sidecar_path)

        if isinstance(existing, Missing):
            raw = path.read_text(encoding="utf-8")
            sidecar: dict[str, Any] = {
                "version": SIDECAR_VERSION,
                "markdown_hash": hash_markdown(raw),
                "extras": {slot_key: value},
                "updated_at": now_iso(),
            }
        elif isinstance(existing, Loaded):
            sidecar = dict(existing.data)
            extras_obj = sidecar.get("extras")
            extras = dict(extras_obj) if isinstance(extras_obj, dict) else {}
            extras[slot_key] = value
            sidecar["extras"] = extras
            sidecar["updated_at"] = now_iso()
        elif isinstance(existing, Corrupt):
            forensic_path = _write_forensic_copy(sidecar_path, existing.raw)
            raise CorruptSidecarError(sidecar_path, forensic_path, existing.reason)
        else:
            raise TypeError(f"unexpected sidecar read result: {type(existing).__name__}")

        atomic_write(
            sidecar_path,
            json.dumps(sidecar, indent=2, ensure_ascii=False).encode(),
        )


def _write_forensic_copy(sidecar_path: Path, raw: bytes) -> Path:
    timestamp = now_iso().replace(":", "-")
    forensic_path = sidecar_path.parent / f"{sidecar_path.name}.corrupt-{timestamp}"
    atomic_write(forensic_path, raw)
    return forensic_path
