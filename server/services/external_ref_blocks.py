"""External-reference Custom Block registry.

The registry is intentionally backend-only and contains only the metadata
needed to correlate markdown placeholders with Sidecar Extras slots.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class HydrationMode(StrEnum):
    EAGER = "eager"
    LAZY = "lazy"


class OrphanPolicy(StrEnum):
    DISCARD = "discard"
    KEEP = "keep"


class DuplicatePolicy(StrEnum):
    ERROR = "error"
    KEEP_FIRST = "keep_first"
    DEDUPE = "dedupe"


class NewPolicy(StrEnum):
    EMPTY = "empty"
    SKIP = "skip"


SalvageHandler = Callable[[Any, str], Any | None]
SlotKeyForId = Callable[[str], str]


def default_slot_key_for_id(block_id: str) -> str:
    return f"blocks/{block_id}"


def keep_prior_value(prior_value: Any, fresh_markdown: str) -> Any | None:  # noqa: ARG001
    return prior_value


@dataclass(frozen=True, slots=True)
class ExternalRefBlockDefinition:
    block_type: str
    hydration: HydrationMode
    on_orphan: OrphanPolicy
    on_duplicate: DuplicatePolicy
    on_new: NewPolicy
    slot_key_for_id: SlotKeyForId = default_slot_key_for_id
    salvage: SalvageHandler = keep_prior_value
    slot_key_prefixes: tuple[str, ...] = field(default=("blocks/",))

    def matches_slot_key(self, slot_key: str) -> bool:
        return any(slot_key.startswith(prefix) for prefix in self.slot_key_prefixes)


class ExternalRefBlockRegistry:
    def __init__(self, entries: Iterable[ExternalRefBlockDefinition] = ()) -> None:
        self._by_block_type: dict[str, ExternalRefBlockDefinition] = {}
        for entry in entries:
            self.register(entry)

    def register(self, entry: ExternalRefBlockDefinition) -> None:
        if entry.block_type in self._by_block_type:
            raise ValueError(f"external-reference block already registered: {entry.block_type}")
        self._by_block_type[entry.block_type] = entry

    def by_block_type(self, block_type: str) -> ExternalRefBlockDefinition:
        try:
            return self._by_block_type[block_type]
        except KeyError as exc:
            raise KeyError(f"unknown external-reference block type: {block_type}") from exc

    def by_slot_key(self, slot_key: str) -> tuple[ExternalRefBlockDefinition, ...]:
        return tuple(
            entry for entry in self._by_block_type.values() if entry.matches_slot_key(slot_key)
        )

    def block_types(self) -> tuple[str, ...]:
        return tuple(self._by_block_type)

    def entries(self) -> tuple[ExternalRefBlockDefinition, ...]:
        return tuple(self._by_block_type.values())


def default_external_ref_block_registry() -> ExternalRefBlockRegistry:
    return ExternalRefBlockRegistry(
        (
            ExternalRefBlockDefinition(
                block_type="pdf-block",
                hydration=HydrationMode.LAZY,
                on_orphan=OrphanPolicy.DISCARD,
                on_duplicate=DuplicatePolicy.ERROR,
                on_new=NewPolicy.EMPTY,
            ),
            ExternalRefBlockDefinition(
                block_type="excel-block",
                hydration=HydrationMode.LAZY,
                on_orphan=OrphanPolicy.DISCARD,
                on_duplicate=DuplicatePolicy.ERROR,
                on_new=NewPolicy.EMPTY,
            ),
        )
    )
