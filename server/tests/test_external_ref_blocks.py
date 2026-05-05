from __future__ import annotations

import pytest

from services.external_ref_blocks import (
    DuplicatePolicy,
    ExternalRefBlockDefinition,
    ExternalRefBlockRegistry,
    HydrationMode,
    NewPolicy,
    OrphanPolicy,
    default_external_ref_block_registry,
    keep_prior_value,
)


def test_default_registry_contains_pdf_and_excel_blocks_only() -> None:
    registry = default_external_ref_block_registry()

    assert registry.block_types() == ("pdf-block", "excel-block")
    assert registry.by_block_type("pdf-block").hydration is HydrationMode.LAZY
    assert registry.by_block_type("excel-block").hydration is HydrationMode.LAZY
    assert registry.by_block_type("pdf-block").on_orphan is OrphanPolicy.DISCARD
    assert registry.by_block_type("pdf-block").on_duplicate is DuplicatePolicy.ERROR
    assert registry.by_block_type("pdf-block").on_new is NewPolicy.EMPTY


def test_registry_lookup_by_block_type() -> None:
    entry = ExternalRefBlockDefinition(
        block_type="test-block",
        hydration=HydrationMode.EAGER,
        on_orphan=OrphanPolicy.KEEP,
        on_duplicate=DuplicatePolicy.KEEP_FIRST,
        on_new=NewPolicy.SKIP,
        salvage=keep_prior_value,
    )
    registry = ExternalRefBlockRegistry([entry])

    assert registry.by_block_type("test-block") is entry


def test_registry_lookup_by_slot_key() -> None:
    registry = default_external_ref_block_registry()

    pdf_match = registry.by_slot_key(
        "blocks/1a2b3c4d-1111-4aaa-8bbb-123456789abc",
        "pdf-block",
    )
    excel_match = registry.by_slot_key(
        "blocks/1a2b3c4d-1111-4aaa-8bbb-123456789abc",
        "excel-block",
    )

    assert pdf_match is registry.by_block_type("pdf-block")
    assert excel_match is registry.by_block_type("excel-block")
    assert registry.by_slot_key("blocks/abc", "unknown-block") is None
    assert registry.by_block_type("pdf-block").slot_key_for_id("abc") == "blocks/abc"


def test_registry_rejects_duplicate_block_type() -> None:
    entry = ExternalRefBlockDefinition(
        block_type="test-block",
        hydration=HydrationMode.EAGER,
        on_orphan=OrphanPolicy.KEEP,
        on_duplicate=DuplicatePolicy.KEEP_FIRST,
        on_new=NewPolicy.SKIP,
        salvage=keep_prior_value,
    )
    registry = ExternalRefBlockRegistry([entry])

    with pytest.raises(ValueError, match="already registered: test-block"):
        registry.register(entry)
