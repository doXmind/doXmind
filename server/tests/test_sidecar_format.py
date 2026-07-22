from __future__ import annotations

import re

from services.markdown_export import markdown_to_html


def _placeholder_line(block_type: str, block_id: str, rel_src: str) -> str:
    return f'<!-- {block_type} id="{block_id}" src="{rel_src}" -->'


def test_canonical_block_placeholder_survives_markdown_rendering() -> None:
    placeholder = _placeholder_line(
        "pdf-block",
        "1a2b3c4d-1111-4aaa-8bbb-123456789abc",
        "assets/spec.pdf",
    )
    rendered = markdown_to_html(f"# Spec\n\n{placeholder}\n\nAfter\n")

    assert placeholder in rendered

    # The placeholder must survive as a standalone block-level HTML comment.
    # If a future renderer change wrapped it inside <p>...</p> (or any other
    # element), the legacy recovery parser would not round-trip it cleanly.
    assert not re.search(
        r"<[^/!][^>]*>[^<]*" + re.escape(placeholder),
        rendered,
    ), "placeholder must not be nested inside another element"
    assert re.search(
        r"(?:^|\n)" + re.escape(placeholder) + r"(?:\n|$)",
        rendered,
    ), "placeholder must appear on its own line at block level"
