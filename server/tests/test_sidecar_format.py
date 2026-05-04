from __future__ import annotations

from services.sidecar_io import markdown_to_html


def test_canonical_block_placeholder_survives_markdown_rendering() -> None:
    placeholder = (
        '<!-- pdf-block id="1a2b3c4d-1111-4aaa-8bbb-123456789abc" '
        'src="assets/spec.pdf" -->'
    )
    rendered = markdown_to_html(f"# Spec\n\n{placeholder}\n\nAfter\n")

    assert placeholder in rendered
