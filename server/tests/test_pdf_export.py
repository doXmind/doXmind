"""Round-trip tests for PyMuPDF-backed PDF export.

We build a small PDF, apply a series of edits, then re-parse the output
with PyMuPDF to verify the redaction + re-flow actually changed the
content stream — not just overlaid an annotation.
"""

from __future__ import annotations

import io
import json
from typing import Any

import pymupdf
import pytest

from services.pdf_blocks import parse_pdf_blocks
from services.pdf_export import export_edited_pdf


def _build_pdf(pages: list[list[tuple[str, tuple[float, float]]]]) -> bytes:
    doc = pymupdf.open()
    for page_lines in pages:
        page = doc.new_page(width=612, height=792)
        for text, (x, y) in page_lines:
            page.insert_text((x, y), text, fontname="helv", fontsize=14)
    buffer = io.BytesIO()
    doc.save(buffer)
    doc.close()
    return buffer.getvalue()


def _all_text(pdf_bytes: bytes) -> str:
    parsed = parse_pdf_blocks(pdf_bytes)
    out: list[str] = []
    for page in parsed["pages"]:
        for block in page["blocks"]:
            for line in block["lines"]:
                for span in line["spans"]:
                    out.append(span["text"])
    return " ".join(out)


def test_export_redacts_and_replaces_paragraph_text() -> None:
    pdf = _build_pdf([[("Hello original world", (72, 120))]])
    parsed = parse_pdf_blocks(pdf)
    block = parsed["pages"][0]["blocks"][0]
    bbox = block["bbox"]

    edits = {
        "pages": [
            {
                "pageIndex": 0,
                "textEdits": [
                    {
                        "rect": [
                            bbox[0],
                            bbox[1],
                            bbox[2] - bbox[0],
                            bbox[3] - bbox[1],
                        ],
                        "text": "Replaced fresh content",
                        "fontSize": 14,
                        "color": "#111111",
                        "align": "left",
                    }
                ],
            }
        ]
    }

    edited = export_edited_pdf(pdf, edits)
    text = _all_text(edited)
    assert "Replaced fresh content" in text
    assert "original" not in text


def test_export_deleted_edit_erases_without_replacement() -> None:
    pdf = _build_pdf([[("Sensitive secret words", (72, 120))]])
    parsed = parse_pdf_blocks(pdf)
    bbox = parsed["pages"][0]["blocks"][0]["bbox"]

    edits = {
        "pages": [
            {
                "pageIndex": 0,
                "textEdits": [
                    {
                        "rect": [
                            bbox[0],
                            bbox[1],
                            bbox[2] - bbox[0],
                            bbox[3] - bbox[1],
                        ],
                        "text": "ignored",
                        "deleted": True,
                    }
                ],
            }
        ]
    }
    edited = export_edited_pdf(pdf, edits)
    text = _all_text(edited)
    assert "Sensitive" not in text
    assert "secret" not in text


def test_export_inserts_free_text() -> None:
    pdf = _build_pdf([[("Body", (72, 120))]])
    edits = {
        "pages": [
            {
                "pageIndex": 0,
                "freeText": [
                    {
                        "rect": [72.0, 200.0, 300.0, 30.0],
                        "text": "Annotation by user",
                        "fontSize": 14,
                        "color": "#dc2626",
                    }
                ],
            }
        ]
    }
    edited = export_edited_pdf(pdf, edits)
    text = _all_text(edited)
    assert "Annotation by user" in text


def test_export_preserves_styled_segments_via_html() -> None:
    pdf = _build_pdf([[("Original text", (72, 120))]])
    parsed = parse_pdf_blocks(pdf)
    bbox = parsed["pages"][0]["blocks"][0]["bbox"]

    # text "Hello bold world" with the word "bold" bolded.
    edits = {
        "pages": [
            {
                "pageIndex": 0,
                "textEdits": [
                    {
                        "rect": [
                            bbox[0],
                            bbox[1],
                            max(bbox[2] - bbox[0], 200.0),
                            bbox[3] - bbox[1],
                        ],
                        "text": "Hello bold world",
                        "fontSize": 14,
                        "color": "#111111",
                        "styleRanges": [{"start": 6, "end": 10, "bold": True}],
                    }
                ],
            }
        ]
    }
    edited = export_edited_pdf(pdf, edits)
    text = _all_text(edited)
    assert "Hello" in text
    assert "bold" in text
    assert "world" in text

    # Verify the bolded segment kept a bold span — PyMuPDF re-parses with
    # the bold font flag set.
    parsed2 = parse_pdf_blocks(edited)
    saw_bold_segment = False
    for page in parsed2["pages"]:
        for block in page["blocks"]:
            for line in block["lines"]:
                for span in line["spans"]:
                    if "bold" in span["text"].lower() and span["bold"]:
                        saw_bold_segment = True
    assert saw_bold_segment, "expected a bold span containing 'bold'"


def test_export_draws_highlight_rect() -> None:
    pdf = _build_pdf([[("Body", (72, 120))]])
    edits = {
        "pages": [
            {
                "pageIndex": 0,
                "highlights": [
                    {
                        "rect": [70.0, 110.0, 80.0, 20.0],
                        "color": "#ffe66d",
                        "opacity": 0.45,
                    }
                ],
            }
        ]
    }
    edited = export_edited_pdf(pdf, edits)
    # No clean way to assert visually; just confirm a valid PDF + content
    # stream was produced.
    with pymupdf.open(stream=io.BytesIO(edited), filetype="pdf") as doc:
        assert doc.page_count == 1
        # Page rendering shouldn't error.
        pix = doc[0].get_pixmap(dpi=72)
        assert pix.width > 0 and pix.height > 0


def test_export_handles_alignment() -> None:
    pdf = _build_pdf([[("X", (72, 120))]])
    edits = {
        "pages": [
            {
                "pageIndex": 0,
                "freeText": [
                    {
                        "rect": [72.0, 200.0, 400.0, 50.0],
                        "text": "right aligned",
                        "fontSize": 14,
                        "align": "right",
                    }
                ],
            }
        ]
    }
    edited = export_edited_pdf(pdf, edits)
    parsed = parse_pdf_blocks(edited)
    spans = [
        s
        for page in parsed["pages"]
        for block in page["blocks"]
        for line in block["lines"]
        for s in line["spans"]
    ]
    target = [s for s in spans if "right aligned" in s["text"]]
    assert target, "expected the right-aligned text to be present"
    # Right-aligned means the span sits near the right edge of the rect.
    span_right = target[0]["bbox"][2]
    assert span_right > 200, f"expected text near right edge, got {span_right}"


def test_export_rejects_oversized_pdf() -> None:
    pdf = _build_pdf([[("a", (72, 72))], [("b", (72, 72))], [("c", (72, 72))]])
    edits: dict[str, Any] = {"pages": []}
    with pytest.raises(ValueError):
        export_edited_pdf(
            pdf,
            edits,
            limits=__import__("services.pdf_export", fromlist=["ExportLimits"]).ExportLimits(
                max_pages=2
            ),
        )


def test_export_endpoint_returns_pdf_binary(sync_client: Any) -> None:
    pdf = _build_pdf([[("hello", (72, 120))]])
    parsed = parse_pdf_blocks(pdf)
    bbox = parsed["pages"][0]["blocks"][0]["bbox"]
    edits = {
        "pages": [
            {
                "pageIndex": 0,
                "textEdits": [
                    {
                        "rect": [
                            bbox[0],
                            bbox[1],
                            bbox[2] - bbox[0],
                            bbox[3] - bbox[1],
                        ],
                        "text": "via api",
                        "fontSize": 14,
                    }
                ],
            }
        ]
    }
    response = sync_client.post(
        "/api/pdf/export-edited",
        files={"file": ("smoke.pdf", pdf, "application/pdf")},
        data={"edits": json.dumps(edits)},
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    body = response.content
    assert body.startswith(b"%PDF")
    text = _all_text(body)
    assert "via api" in text


def test_export_endpoint_rejects_invalid_json(sync_client: Any) -> None:
    pdf = _build_pdf([[("x", (72, 72))]])
    response = sync_client.post(
        "/api/pdf/export-edited",
        files={"file": ("smoke.pdf", pdf, "application/pdf")},
        data={"edits": "not-json"},
    )
    assert response.status_code == 400


def test_export_redacts_at_original_rect_when_paragraph_was_dragged() -> None:
    """If `originalRect` differs from `rect`, redact at original (where the
    real glyphs live) and write the new text at the dragged position."""
    pdf = _build_pdf([[("DRAGGED ORIGINAL", (72, 120))]])
    parsed = parse_pdf_blocks(pdf)
    bbox = parsed["pages"][0]["blocks"][0]["bbox"]
    original_rect = [
        bbox[0],
        bbox[1],
        bbox[2] - bbox[0],
        bbox[3] - bbox[1],
    ]
    # Move the paragraph 200pt down — well clear of the original location.
    new_rect = [original_rect[0], original_rect[1] + 200.0, original_rect[2], original_rect[3]]

    edits = {
        "pages": [
            {
                "pageIndex": 0,
                "textEdits": [
                    {
                        "rect": new_rect,
                        "originalRect": original_rect,
                        "text": "Moved paragraph",
                        "fontSize": 14,
                    }
                ],
            }
        ]
    }
    edited = export_edited_pdf(pdf, edits)
    parsed2 = parse_pdf_blocks(edited)

    spans = [
        s
        for page in parsed2["pages"]
        for block in page["blocks"]
        for line in block["lines"]
        for s in line["spans"]
    ]
    # Original glyphs should be gone (redacted at original_rect).
    assert not any("DRAGGED" in s["text"] for s in spans)
    assert not any("ORIGINAL" in s["text"] for s in spans)
    # New text should appear near the moved location (y around 320).
    moved = [s for s in spans if "Moved paragraph" in s["text"]]
    assert moved, "expected the moved paragraph text"
    assert moved[0]["bbox"][1] > 250, (
        f"expected new text below y=250, got bbox y={moved[0]['bbox'][1]}"
    )


def test_export_endpoint_rejects_non_object_edits(sync_client: Any) -> None:
    pdf = _build_pdf([[("x", (72, 72))]])
    response = sync_client.post(
        "/api/pdf/export-edited",
        files={"file": ("smoke.pdf", pdf, "application/pdf")},
        data={"edits": "[]"},
    )
    assert response.status_code == 400
