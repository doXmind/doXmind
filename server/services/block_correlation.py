"""Block correlation for External-reference placeholders and Extras slots."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal

from services.external_ref_blocks import (
    ExternalRefBlockDefinition,
    ExternalRefBlockRegistry,
    NewPolicy,
    OrphanPolicy,
)

CorrelationEventKind = Literal["orphan", "duplicate", "new"]


class HowHandled(StrEnum):
    ERRORED = "errored"
    DISCARDED = "discarded"
    CREATED_EMPTY = "created_empty"
    KEPT = "kept"
    SKIPPED = "skipped"
    DEDUPED = "deduped"


@dataclass(frozen=True, slots=True)
class CorrelationEvent:
    kind: CorrelationEventKind
    block_type: str
    id: str
    how_handled: HowHandled
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class CorrelationReport:
    events: list[CorrelationEvent] = field(default_factory=list)

    @property
    def blocking(self) -> bool:
        return any(event.how_handled == HowHandled.ERRORED for event in self.events)

    def by_kind(self, kind: CorrelationEventKind) -> list[CorrelationEvent]:
        return [event for event in self.events if event.kind == kind]


@dataclass(frozen=True, slots=True)
class CorrelationResult:
    resolved_extras: dict[str, Any]
    report: CorrelationReport


class BlockCorrelation:
    def __init__(self, registry: ExternalRefBlockRegistry) -> None:
        self._registry = registry

    def correlate(self, *, markdown_body: str, extras: dict[str, Any]) -> CorrelationResult:
        events: list[CorrelationEvent] = []
        resolved_extras = dict(extras)
        placeholder_re = _placeholder_re_for(self._registry.block_types())
        placeholder_ids: set[str] = set()

        for match in placeholder_re.finditer(markdown_body):
            block_type = match.group("block_type")
            block_id = match.group("id")
            placeholder_ids.add(block_id)

            blocks = resolved_extras.get("blocks")
            if isinstance(blocks, dict) and block_id in blocks:
                continue

            definition = self._registry.by_block_type(block_type)
            if definition.on_new == NewPolicy.EMPTY:
                current_blocks = resolved_extras.get("blocks")
                next_blocks = dict(current_blocks) if isinstance(current_blocks, dict) else {}
                next_blocks[block_id] = {}
                resolved_extras["blocks"] = next_blocks
                how_handled = HowHandled.CREATED_EMPTY
            elif definition.on_new == NewPolicy.SKIP:
                how_handled = HowHandled.SKIPPED
            else:
                raise ValueError(
                    f"unsupported on_new policy {definition.on_new!r} for {block_type}"
                )

            events.append(
                CorrelationEvent(
                    kind="new",
                    block_type=block_type,
                    id=block_id,
                    how_handled=how_handled,
                    detail={
                        "src": match.group("src"),
                        "attrs": match.group("attrs"),
                    },
                )
            )

        resolved_extras = self._resolve_orphans(
            extras=resolved_extras,
            placeholder_ids=placeholder_ids,
            events=events,
        )

        return CorrelationResult(
            resolved_extras=resolved_extras,
            report=CorrelationReport(events=events),
        )

    def _resolve_orphans(
        self,
        *,
        extras: dict[str, Any],
        placeholder_ids: set[str],
        events: list[CorrelationEvent],
    ) -> dict[str, Any]:
        resolved_extras = dict(extras)
        blocks = extras.get("blocks")
        if not isinstance(blocks, dict):
            return resolved_extras

        resolved_blocks = dict(blocks)
        for block_id, slot_value in blocks.items():
            if block_id in placeholder_ids:
                continue

            slot_key = f"blocks/{block_id}"
            entry = self._entry_for_slot(slot_key=slot_key, slot_value=slot_value)
            if entry is None:
                continue

            if entry.on_orphan is OrphanPolicy.DISCARD:
                resolved_blocks.pop(block_id, None)
                how_handled = HowHandled.DISCARDED
            else:
                how_handled = HowHandled.KEPT

            events.append(
                CorrelationEvent(
                    kind="orphan",
                    block_type=entry.block_type,
                    id=block_id,
                    how_handled=how_handled,
                    detail={"slot_key": slot_key},
                )
            )

        resolved_extras["blocks"] = resolved_blocks
        return resolved_extras

    def _entry_for_slot(
        self,
        *,
        slot_key: str,
        slot_value: Any,
    ) -> ExternalRefBlockDefinition | None:
        explicit_block_type = _explicit_block_type(slot_value)
        if explicit_block_type is not None:
            return self._registry.by_slot_key(slot_key, explicit_block_type)

        for entry in self._registry.entries():
            matched = self._registry.by_slot_key(slot_key, entry.block_type)
            if matched is not None:
                return matched
        return None


def _placeholder_re_for(block_types: tuple[str, ...]) -> re.Pattern[str]:
    if not block_types:
        return re.compile(r"a\Ab")
    alternatives = "|".join(re.escape(block_type) for block_type in block_types)
    return re.compile(
        rf"<!--\s*(?P<block_type>{alternatives})\s+"
        r"id=\"(?P<id>[^\"]+)\"\s+"
        r"src=\"(?P<src>[^\"]+)\"(?P<attrs>.*?)\s*-->"
    )


def _explicit_block_type(slot_value: Any) -> str | None:
    if not isinstance(slot_value, dict):
        return None
    block_type = slot_value.get("block_type") or slot_value.get("blockType")
    if isinstance(block_type, str) and block_type.strip():
        return block_type
    return None
