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


def _build_rotated_pdf() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=200, height=100)
    page.set_rotation(90)
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
                            max(bbox[2] - bbox[0], 200.0),
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


def test_strict_empty_text_with_explicit_deletion_does_not_insert_a_space() -> None:
    pdf = _build_pdf([[("Delete me", (72, 120))]])
    bbox = parse_pdf_blocks(pdf)["pages"][0]["blocks"][0]["bbox"]

    edited = export_edited_pdf(
        pdf,
        {
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
                            "text": "",
                            "deleted": True,
                        }
                    ],
                }
            ]
        },
        strict_recovery=True,
    )

    with pymupdf.open(stream=io.BytesIO(edited), filetype="pdf") as doc:
        assert doc[0].get_text() == ""


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
                            max(bbox[2] - bbox[0], 200.0),
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
        data={"edits": json.dumps(edits), "strict_recovery": "true"},
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


@pytest.mark.parametrize(
    "edits",
    [
        {"pages": [{"pageIndex": 9}]},
        {
            "pages": [
                {
                    "pageIndex": 0,
                    "freeText": [{"rect": [600, 780, 20, 20], "text": "outside"}],
                }
            ]
        },
        {
            "pages": [
                {
                    "pageIndex": 0,
                    "freeText": [
                        {"rect": [72, 200, 200, 30], "text": "future", "underline": True}
                    ],
                }
            ]
        },
        {
            "pages": [
                {
                    "pageIndex": 0,
                    "highlights": [{"rect": [72, 200, 30, 10], "color": "not-a-color"}],
                }
            ]
        },
        {
            "pages": [
                {
                    "pageIndex": 0,
                    "highlights": [{"rect": [72, 200, 30, 10], "opacity": 1.5}],
                }
            ]
        },
        {
            "pages": [
                {
                    "pageIndex": 0,
                    "freeText": [{"rect": [72, 200, 200, 30], "text": "emoji 😀"}],
                }
            ]
        },
        {
            "pages": [
                {
                    "pageIndex": 0,
                    "freeText": [
                        {"rect": [72, 200, 200, 30], "text": "deleted", "deleted": True}
                    ],
                }
            ]
        },
        {"pages": [{"pageIndex": 0}, {"pageIndex": 0}]},
    ],
)
def test_strict_recovery_endpoint_rejects_skipped_or_lossy_payloads(
    sync_client: Any,
    edits: dict[str, Any],
) -> None:
    pdf = _build_pdf([[("source", (72, 72))]])
    response = sync_client.post(
        "/api/pdf/export-edited",
        files={"file": ("strict.pdf", pdf, "application/pdf")},
        data={"edits": json.dumps(edits), "strict_recovery": "true"},
    )
    assert response.status_code == 400, response.text


def test_strict_recovery_rejects_empty_replacement_without_deletion(sync_client: Any) -> None:
    pdf = _build_pdf([[("source", (72, 72))]])
    response = sync_client.post(
        "/api/pdf/export-edited",
        files={"file": ("strict.pdf", pdf, "application/pdf")},
        data={
            "edits": json.dumps(
                {
                    "pages": [
                        {
                            "pageIndex": 0,
                            "textEdits": [
                                {"rect": [72, 50, 80, 30], "text": "", "fontSize": 12}
                            ],
                        }
                    ]
                }
            ),
            "strict_recovery": "true",
        },
    )

    assert response.status_code == 400, response.text


def test_strict_recovery_rejects_empty_free_text(sync_client: Any) -> None:
    pdf = _build_pdf([[("source", (72, 72))]])
    response = sync_client.post(
        "/api/pdf/export-edited",
        files={"file": ("strict.pdf", pdf, "application/pdf")},
        data={
            "edits": json.dumps(
                {
                    "pages": [
                        {
                            "pageIndex": 0,
                            "freeText": [
                                {"rect": [72, 200, 80, 30], "text": "", "fontSize": 12}
                            ],
                        }
                    ]
                }
            ),
            "strict_recovery": "true",
        },
    )

    assert response.status_code == 400, response.text


@pytest.mark.parametrize(
    "edit",
    [
        {"rect": [72, 200, 200, 30], "text": "control\x01text", "fontSize": 12},
        {"rect": [72, 200, 200, 30], "text": "tab\ttext", "fontSize": 12},
        {"rect": [72, 200, 200, 30], "text": "carriage\rreturn", "fontSize": 12},
        {
            "rect": [72, 200, 200, 30],
            "text": "recovered",
            "fontSize": 12,
            "fontFamily": "\ud800",
        },
        {
            "rect": [72, 200, 200, 30],
            "text": "recovered",
            "fontSize": 12,
            "fontFamily": "Arial;font-size:1px",
        },
        {"rect": [72, 200, 200, 30], "text": "recovered", "fontSize": 10**400},
        {"rect": [72, 200, 10**400, 30], "text": "recovered", "fontSize": 12},
    ],
)
def test_strict_recovery_rejects_unsafe_text_and_numbers(
    sync_client: Any,
    edit: dict[str, Any],
) -> None:
    pdf = _build_pdf([[("source", (72, 72))]])
    response = sync_client.post(
        "/api/pdf/export-edited",
        files={"file": ("strict.pdf", pdf, "application/pdf")},
        data={
            "edits": json.dumps({"pages": [{"pageIndex": 0, "freeText": [edit]}]}),
            "strict_recovery": "true",
        },
    )

    assert response.status_code == 400, response.text


@pytest.mark.parametrize("text", ["A  B", " A B ", "A\n  B"])
def test_strict_recovery_preserves_spaces_and_lf_newlines(text: str) -> None:
    edited = export_edited_pdf(
        _build_pdf([[("source", (72, 72))]]),
        {
            "pages": [
                {
                    "pageIndex": 0,
                    "freeText": [
                        {
                            "rect": [72, 200, 300, 80],
                            "text": text,
                            "fontSize": 12,
                        }
                    ],
                }
            ]
        },
        strict_recovery=True,
    )

    with pymupdf.open(stream=io.BytesIO(edited), filetype="pdf") as doc:
        assert text in doc[0].get_text("text")


def test_legacy_pdf_export_keeps_permissive_out_of_range_behavior(sync_client: Any) -> None:
    pdf = _build_pdf([[("source", (72, 72))]])
    response = sync_client.post(
        "/api/pdf/export-edited",
        files={"file": ("legacy.pdf", pdf, "application/pdf")},
        data={"edits": json.dumps({"pages": [{"pageIndex": 9}]})},
    )
    assert response.status_code == 200, response.text


def test_strict_recovery_rejects_text_that_does_not_fit(monkeypatch: pytest.MonkeyPatch) -> None:
    pdf = _build_pdf([[("source", (72, 72))]])
    monkeypatch.setattr("services.pdf_export._insert_text_html", lambda *_args, **_kwargs: False)

    with pytest.raises(ValueError, match="did not fit"):
        export_edited_pdf(
            pdf,
            {
                "pages": [
                    {
                        "pageIndex": 0,
                        "freeText": [{"rect": [72, 200, 200, 30], "text": "recovered"}],
                    }
                ]
            },
            strict_recovery=True,
        )


def test_strict_recovery_rejects_text_that_only_fits_when_shrunk() -> None:
    pdf = _build_pdf([[("source", (72, 72))]])

    with pytest.raises(ValueError, match="did not fit"):
        export_edited_pdf(
            pdf,
            {
                "pages": [
                    {
                        "pageIndex": 0,
                        "freeText": [
                            {
                                "rect": [72, 200, 20, 10],
                                "text": "This cannot fit at the requested size",
                                "fontSize": 20,
                            }
                        ],
                    }
                ]
            },
            strict_recovery=True,
        )


@pytest.mark.parametrize(
    "page_edits",
    [
        {"freeText": [{"rect": [10, 20, 40, 20], "text": "recovered", "fontSize": 10}]},
        {"highlights": [{"rect": [10, 20, 40, 20]}]},
    ],
)
def test_strict_recovery_rejects_edits_on_rotated_pages(page_edits: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match="rotation"):
        export_edited_pdf(
            _build_rotated_pdf(),
            {"pages": [{"pageIndex": 0, **page_edits}]},
            strict_recovery=True,
        )


def test_strict_recovery_preserves_explicit_zero_highlight_opacity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pdf = _build_pdf([[("source", (72, 72))]])
    seen_opacities: list[float] = []
    seen_fills: list[tuple[float, float, float]] = []
    original_draw_rect = pymupdf.Page.draw_rect

    def capture_opacity(page, *args, **kwargs):
        seen_opacities.append(kwargs["fill_opacity"])
        seen_fills.append(kwargs["fill"])
        return original_draw_rect(page, *args, **kwargs)

    monkeypatch.setattr(pymupdf.Page, "draw_rect", capture_opacity)
    export_edited_pdf(
        pdf,
        {
            "pages": [
                {
                    "pageIndex": 0,
                    "highlights": [{"rect": [72, 80, 20, 10], "opacity": 0}],
                }
            ]
        },
        strict_recovery=True,
    )

    assert seen_opacities == [0.0]
    assert seen_fills == [(1.0, 230 / 255, 109 / 255)]


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity", "1e400", "-1e400"])
def test_pdf_export_endpoint_rejects_non_finite_json_numbers(sync_client: Any, number: str) -> None:
    pdf = _build_pdf([[("source", (72, 72))]])
    response = sync_client.post(
        "/api/pdf/export-edited",
        files={"file": ("strict.pdf", pdf, "application/pdf")},
        data={"edits": f'{{"pages":[],"unused":{number}}}', "strict_recovery": "true"},
    )

    assert response.status_code == 400
