from __future__ import annotations

from services.block_correlation import BlockCorrelation, CorrelationEvent, CorrelationReport
from services.external_ref_blocks import default_external_ref_block_registry


def test_correlate_no_events_returns_original_extras_and_empty_report() -> None:
    correlator = BlockCorrelation(default_external_ref_block_registry())
    extras = {"blocks": {"b1": {"page": 2}}}

    result = correlator.correlate(markdown_body="plain markdown", extras=extras)

    assert result.resolved_extras == extras
    assert result.resolved_extras is not extras
    assert result.report == CorrelationReport()
    assert result.report.events == []
    assert result.report.blocking is False


def test_report_by_kind_filters_events() -> None:
    orphan = CorrelationEvent(
        kind="orphan",
        block_type="pdf-block",
        id="b1",
        how_handled="discarded",
    )
    duplicate = CorrelationEvent(
        kind="duplicate",
        block_type="pdf-block",
        id="b1",
        how_handled="errored",
    )
    report = CorrelationReport(events=[orphan, duplicate], blocking=True)

    assert report.by_kind("orphan") == [orphan]
    assert report.by_kind("duplicate") == [duplicate]
    assert report.by_kind("new") == []
