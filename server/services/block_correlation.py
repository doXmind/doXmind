"""Block correlation result types and empty scaffold."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal

from services.external_ref_blocks import ExternalRefBlockRegistry

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
        _ = markdown_body
        _ = self._registry
        return CorrelationResult(
            resolved_extras=dict(extras),
            report=CorrelationReport(),
        )
