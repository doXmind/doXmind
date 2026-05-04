from __future__ import annotations

from services.block_correlation import (
    BlockCorrelation,
    CorrelationEvent,
    CorrelationReport,
    HowHandled,
)
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
from services.synthetic_document import _placeholder_line


def test_correlate_no_events_returns_original_extras_and_empty_report() -> None:
    correlator = BlockCorrelation(default_external_ref_block_registry())
    block_id = "1a2b3c4d-1111-4aaa-8bbb-123456789abc"
    extras = {"blocks": {block_id: {"page": 2}}}
    markdown = (
        f'<!-- pdf-block id="{block_id}" src="assets/spec.pdf" -->\n'
        "\n"
        "plain markdown"
    )

    result = correlator.correlate(markdown_body=markdown, extras=extras)

    assert result.resolved_extras == extras
    assert result.resolved_extras is not extras
    assert result.report == CorrelationReport()
    assert result.report.events == []
    assert result.report.blocking is False


def test_correlate_discards_orphan_pdf_block_slot() -> None:
    correlator = BlockCorrelation(default_external_ref_block_registry())
    block_id = "1a2b3c4d-1111-4aaa-8bbb-123456789abc"
    extras = {
        "blocks": {
            block_id: {
                "editor": {"version": 1},
                "parsedCache": {"pages": []},
            }
        }
    }

    result = correlator.correlate(
        markdown_body="# User removed the placeholder\n",
        extras=extras,
    )

    assert result.resolved_extras == {"blocks": {}}
    assert result.report.events == [
        CorrelationEvent(
            kind="orphan",
            block_type="pdf-block",
            id=block_id,
            how_handled=HowHandled.DISCARDED,
            detail={"slot_key": f"blocks/{block_id}"},
        )
    ]
    assert result.report.blocking is False


def test_correlate_keeps_orphan_slot_when_registered_policy_is_keep() -> None:
    block_id = "1a2b3c4d-1111-4aaa-8bbb-123456789abc"
    registry = ExternalRefBlockRegistry(
        [
            ExternalRefBlockDefinition(
                block_type="temp-block",
                hydration=HydrationMode.LAZY,
                on_orphan=OrphanPolicy.KEEP,
                on_duplicate=DuplicatePolicy.ERROR,
                on_new=NewPolicy.EMPTY,
                salvage=keep_prior_value,
            )
        ]
    )
    correlator = BlockCorrelation(registry)
    extras = {"blocks": {block_id: {"value": 1}}}

    result = correlator.correlate(
        markdown_body="# User removed the placeholder\n",
        extras=extras,
    )

    assert result.resolved_extras == extras
    assert result.report.events == [
        CorrelationEvent(
            kind="orphan",
            block_type="temp-block",
            id=block_id,
            how_handled=HowHandled.KEPT,
            detail={"slot_key": f"blocks/{block_id}"},
        )
    ]
    assert result.report.blocking is False


def test_report_by_kind_filters_events() -> None:
    orphan = CorrelationEvent(
        kind="orphan",
        block_type="pdf-block",
        id="b1",
        how_handled=HowHandled.DISCARDED,
    )
    duplicate = CorrelationEvent(
        kind="duplicate",
        block_type="pdf-block",
        id="b1",
        how_handled=HowHandled.ERRORED,
    )
    report = CorrelationReport(events=[orphan, duplicate])

    assert report.by_kind("orphan") == [orphan]
    assert report.by_kind("duplicate") == [duplicate]
    assert report.by_kind("new") == []


def test_pdf_block_new_id_creates_empty_slot_and_reports_event() -> None:
    correlator = BlockCorrelation(default_external_ref_block_registry())
    block_id = "pdf-new-id"
    markdown = _placeholder_line("pdf-block", block_id, "assets/spec.pdf")

    result = correlator.correlate(markdown_body=markdown, extras={"blocks": {}})

    assert result.resolved_extras["blocks"][block_id] == {}
    assert result.report.blocking is False
    assert len(result.report.by_kind("new")) == 1
    event = result.report.by_kind("new")[0]
    assert event.block_type == "pdf-block"
    assert event.id == block_id
    assert event.how_handled == HowHandled.CREATED_EMPTY


def test_excel_block_new_id_creates_empty_slot_and_reports_event() -> None:
    correlator = BlockCorrelation(default_external_ref_block_registry())
    block_id = "excel-new-id"
    markdown = _placeholder_line("excel-block", block_id, "assets/budget.xlsx")

    result = correlator.correlate(markdown_body=markdown, extras={"blocks": {}})

    assert result.resolved_extras["blocks"][block_id] == {}
    assert result.report.blocking is False
    assert len(result.report.by_kind("new")) == 1
    event = result.report.by_kind("new")[0]
    assert event.block_type == "excel-block"
    assert event.id == block_id
    assert event.how_handled == HowHandled.CREATED_EMPTY


def test_new_id_with_skip_policy_reports_event_and_leaves_extras_unchanged() -> None:
    registry = ExternalRefBlockRegistry(
        (
            ExternalRefBlockDefinition(
                block_type="test-block",
                hydration=HydrationMode.LAZY,
                on_orphan=OrphanPolicy.KEEP,
                on_duplicate=DuplicatePolicy.ERROR,
                on_new=NewPolicy.SKIP,
                salvage=keep_prior_value,
            ),
        )
    )
    correlator = BlockCorrelation(registry)
    extras = {"blocks": {"existing": {"value": 1}}, "other": {"kept": True}}
    markdown = _placeholder_line("test-block", "test-new-id", "assets/data.bin")

    result = correlator.correlate(markdown_body=markdown, extras=extras)

    assert result.resolved_extras == extras
    assert result.report.blocking is False
    assert len(result.report.by_kind("new")) == 1
    event = result.report.by_kind("new")[0]
    assert event.block_type == "test-block"
    assert event.id == "test-new-id"
    assert event.how_handled == HowHandled.SKIPPED
