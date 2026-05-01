"""Tests for PyMuPDF-backed paragraph block extraction.

Builds tiny synthetic PDFs at runtime via PyMuPDF itself so the suite has
no fixture-file coupling and runs fast.
"""

from __future__ import annotations

import io
from typing import Any

import pymupdf
import pytest

from services.pdf_blocks import ParseBlocksLimits, parse_pdf_blocks


def _build_pdf(pages: list[list[tuple[str, tuple[float, float]]]]) -> bytes:
    """Render a tiny PDF.

    ``pages`` is a list of pages; each page is a list of ``(text, (x, y))``
    tuples drawn at 12pt Helvetica. Coordinates are in PDF user space with
    the origin at the top-left.
    """
    doc = pymupdf.open()
    for page_lines in pages:
        page = doc.new_page(width=612, height=792)
        for text, (x, y) in page_lines:
            page.insert_text((x, y), text, fontname="helv", fontsize=12)
    buffer = io.BytesIO()
    doc.save(buffer)
    doc.close()
    return buffer.getvalue()


def test_parse_blocks_returns_top_level_shape() -> None:
    pdf = _build_pdf([[("Hello world", (72, 72))]])
    result = parse_pdf_blocks(pdf)

    assert result["version"] == 2
    assert result["pageCount"] == 1
    assert isinstance(result["pages"], list)
    assert len(result["pages"]) == 1

    page = result["pages"][0]
    assert page["pageIndex"] == 0
    assert page["width"] == pytest.approx(612, abs=1)
    assert page["height"] == pytest.approx(792, abs=1)
    assert isinstance(page["blocks"], list)


def test_parse_blocks_extracts_text_and_bbox() -> None:
    pdf = _build_pdf([[("Codex PDF Editor Smoke Test", (72, 72))]])
    result = parse_pdf_blocks(pdf)

    blocks = result["pages"][0]["blocks"]
    assert len(blocks) >= 1

    block = blocks[0]
    assert block["id"] == "p0-b0"
    assert isinstance(block["bbox"], list) and len(block["bbox"]) == 4
    assert len(block["lines"]) >= 1

    spans = block["lines"][0]["spans"]
    assert spans, "expected at least one span"
    assert "Codex" in "".join(s["text"] for s in spans)

    span = spans[0]
    assert span["size"] == pytest.approx(12, abs=0.5)
    assert span["color"].startswith("#")
    assert isinstance(span["bold"], bool)
    assert isinstance(span["italic"], bool)


def test_parse_blocks_clusters_consecutive_lines_into_one_block() -> None:
    """PyMuPDF groups vertically-adjacent same-style lines into one block."""
    pdf = _build_pdf(
        [
            [
                ("Line one of the paragraph", (72, 72)),
                ("Line two of the paragraph", (72, 90)),
                ("Line three of the paragraph", (72, 108)),
            ]
        ]
    )
    result = parse_pdf_blocks(pdf)

    blocks = result["pages"][0]["blocks"]
    # Should be a single paragraph block holding 3 lines, not 3 separate boxes.
    assert len(blocks) == 1
    assert len(blocks[0]["lines"]) == 3


def test_parse_blocks_separates_blocks_by_vertical_gap() -> None:
    """A wide vertical gap should produce two distinct blocks."""
    pdf = _build_pdf(
        [
            [
                ("First paragraph", (72, 72)),
                ("Far below paragraph", (72, 400)),
            ]
        ]
    )
    result = parse_pdf_blocks(pdf)
    blocks = result["pages"][0]["blocks"]
    assert len(blocks) >= 2


def test_parse_blocks_supports_page_index_filter() -> None:
    pdf = _build_pdf(
        [
            [("Page one", (72, 72))],
            [("Page two", (72, 72))],
            [("Page three", (72, 72))],
        ]
    )
    result = parse_pdf_blocks(pdf, page_indexes=[1])

    assert result["pageCount"] == 3
    assert len(result["pages"]) == 1
    assert result["pages"][0]["pageIndex"] == 1
    text = "".join(
        s["text"]
        for block in result["pages"][0]["blocks"]
        for line in block["lines"]
        for s in line["spans"]
    )
    assert "Page two" in text


def test_parse_blocks_skips_out_of_range_page_indexes() -> None:
    pdf = _build_pdf([[("Only page", (72, 72))]])
    result = parse_pdf_blocks(pdf, page_indexes=[0, 5, -1])
    assert [p["pageIndex"] for p in result["pages"]] == [0]


def test_parse_blocks_rejects_empty_input() -> None:
    with pytest.raises(ValueError):
        parse_pdf_blocks(b"")


def test_parse_blocks_rejects_pdf_exceeding_max_pages() -> None:
    pdf = _build_pdf([[("a", (72, 72))], [("b", (72, 72))], [("c", (72, 72))]])
    with pytest.raises(ValueError):
        parse_pdf_blocks(pdf, limits=ParseBlocksLimits(max_pages=2))


def test_endpoint_returns_blocks(sync_client: Any) -> None:
    pdf = _build_pdf([[("hello sidecar", (72, 72))]])
    response = sync_client.post(
        "/api/pdf/parse-blocks",
        files={"file": ("smoke.pdf", pdf, "application/pdf")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["version"] == 2
    assert body["pages"][0]["blocks"][0]["lines"][0]["spans"][0]["text"].startswith("hello")


def test_endpoint_rejects_non_pdf_content_type(sync_client: Any) -> None:
    response = sync_client.post(
        "/api/pdf/parse-blocks",
        files={"file": ("oops.txt", b"not a pdf", "text/plain")},
    )
    assert response.status_code == 415


def test_endpoint_rejects_empty_body(sync_client: Any) -> None:
    response = sync_client.post(
        "/api/pdf/parse-blocks",
        files={"file": ("empty.pdf", b"", "application/pdf")},
    )
    assert response.status_code == 400


def test_endpoint_filters_by_page_indexes(sync_client: Any) -> None:
    pdf = _build_pdf(
        [
            [("Page one", (72, 72))],
            [("Page two", (72, 72))],
        ]
    )
    response = sync_client.post(
        "/api/pdf/parse-blocks",
        files={"file": ("two.pdf", pdf, "application/pdf")},
        data={"pageIndexes": "1"},
    )
    assert response.status_code == 200
    body = response.json()
    assert [p["pageIndex"] for p in body["pages"]] == [1]
