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


def _correlator() -> BlockCorrelation:
    return BlockCorrelation(default_external_ref_block_registry())


def _pdf_placeholder(block_id: str, src: str = "assets/spec.pdf") -> str:
    return f'<!-- pdf-block id="{block_id}" src="{src}" -->'


def _excel_placeholder(block_id: str, src: str = "assets/sheet.xlsx") -> str:
    return f'<!-- excel-block id="{block_id}" src="{src}" -->'


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
    assert report.blocking is True



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


def test_duplicate_pdf_placeholders_emit_blocking_event_and_preserve_extras() -> None:
    extras = {"blocks": {"b1": {"page": 2}}}
    markdown = "\n".join(
        [
            "# Doc",
            _pdf_placeholder("b1", "assets/a.pdf"),
            "middle",
            _pdf_placeholder("b1", "assets/b.pdf"),
        ]
    )

    result = _correlator().correlate(markdown_body=markdown, extras=extras)

    assert result.resolved_extras == extras
    assert result.resolved_extras is not extras
    assert result.report.blocking is True
    assert result.report.events == [
        CorrelationEvent(
            kind="duplicate",
            block_type="pdf-block",
            id="b1",
            how_handled=HowHandled.ERRORED,
            detail={"locations": [{"line": 2}, {"line": 4}]},
        )
    ]


def test_duplicate_excel_placeholders_emit_blocking_event_and_preserve_extras() -> None:
    extras = {"blocks": {"sheet1": {"activeSheet": "Q1"}}}
    markdown = "\n".join(
        [
            _excel_placeholder("sheet1", "assets/a.xlsx"),
            "middle",
            _excel_placeholder("sheet1", "assets/b.xlsx"),
        ]
    )

    result = _correlator().correlate(markdown_body=markdown, extras=extras)

    assert result.resolved_extras == extras
    assert result.resolved_extras is not extras
    assert result.report.blocking is True
    assert result.report.events == [
        CorrelationEvent(
            kind="duplicate",
            block_type="excel-block",
            id="sheet1",
            how_handled=HowHandled.ERRORED,
            detail={"locations": [{"line": 1}, {"line": 3}]},
        )
    ]


def test_mixed_pdf_and_excel_duplicates_emit_two_events() -> None:
    markdown = "\n".join(
        [
            _pdf_placeholder("doc1", "assets/a.pdf"),
            _excel_placeholder("sheet1", "assets/a.xlsx"),
            _pdf_placeholder("doc1", "assets/b.pdf"),
            _excel_placeholder("sheet1", "assets/b.xlsx"),
        ]
    )

    result = _correlator().correlate(markdown_body=markdown, extras={})

    assert result.report.blocking is True
    assert result.report.events == [
        CorrelationEvent(
            kind="duplicate",
            block_type="pdf-block",
            id="doc1",
            how_handled=HowHandled.ERRORED,
            detail={"locations": [{"line": 1}, {"line": 3}]},
        ),
        CorrelationEvent(
            kind="duplicate",
            block_type="excel-block",
            id="sheet1",
            how_handled=HowHandled.ERRORED,
            detail={"locations": [{"line": 2}, {"line": 4}]},
        ),
    ]


def test_three_placeholders_with_same_id_emit_one_event_with_three_locations() -> None:
    markdown = "\n".join(
        [
            _pdf_placeholder("doc1", "assets/a.pdf"),
            _pdf_placeholder("doc1", "assets/b.pdf"),
            "middle",
            _pdf_placeholder("doc1", "assets/c.pdf"),
        ]
    )

    result = _correlator().correlate(markdown_body=markdown, extras={})

    assert result.report.events == [
        CorrelationEvent(
            kind="duplicate",
            block_type="pdf-block",
            id="doc1",
            how_handled=HowHandled.ERRORED,
            detail={"locations": [{"line": 1}, {"line": 2}, {"line": 4}]},
        )
    ]


def test_same_id_on_different_block_types_is_not_duplicate() -> None:
    markdown = "\n".join(
        [
            _pdf_placeholder("shared-id", "assets/a.pdf"),
            _excel_placeholder("shared-id", "assets/a.xlsx"),
        ]
    )

    result = _correlator().correlate(markdown_body=markdown, extras={})

    assert result.report.by_kind("duplicate") == []
    assert result.report.blocking is False


def test_report_blocking_tracks_only_errored_events() -> None:
    non_blocking_report = CorrelationReport(
        events=[
            CorrelationEvent(
                kind="orphan",
                block_type="pdf-block",
                id="b1",
                how_handled=HowHandled.DISCARDED,
            ),
            CorrelationEvent(
                kind="new",
                block_type="excel-block",
                id="b2",
                how_handled=HowHandled.CREATED_EMPTY,
            ),
        ]
    )
    blocking_report = CorrelationReport(
        events=[
            CorrelationEvent(
                kind="orphan",
                block_type="pdf-block",
                id="b1",
                how_handled=HowHandled.DISCARDED,
            ),
            CorrelationEvent(
                kind="duplicate",
                block_type="excel-block",
                id="b2",
                how_handled=HowHandled.ERRORED,
            ),
        ]
    )

    assert non_blocking_report.blocking is False
    assert blocking_report.blocking is True
