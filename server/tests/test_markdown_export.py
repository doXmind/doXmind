"""Neutral explicit Markdown-to-HTML export behavior."""

from __future__ import annotations

from services.markdown_export import markdown_to_html


def test_block_raw_html_passes_through_without_editor_sentinels() -> None:
    src = 'Intro\n\n<p align="center">\n  <a href="https://x.com"><img src="b.svg"></a>\n</p>\n\nAfter\n'
    out = markdown_to_html(src)
    assert 'data-raw-html="' not in out
    assert '<p align="center">' in out
    assert '<a href="https://x.com"><img src="b.svg"></a>' in out
    assert "<p>Intro</p>" in out
    assert "<p>After</p>" in out


def test_inline_raw_html_is_not_wrapped() -> None:
    out = markdown_to_html("A para with <span>inline</span> html.")
    assert "data-raw-html" not in out
    assert "<span>inline</span>" in out


def test_plain_markdown_has_no_sentinel() -> None:
    out = markdown_to_html("# Title\n\nA *para* and a list:\n\n- one\n- two\n")
    assert "data-raw-html" not in out


def test_empty_input() -> None:
    assert markdown_to_html("") == ""


def test_comment_placeholders_are_not_wrapped() -> None:
    # Legacy recovery comments remain ordinary raw HTML in a derived export.
    placeholder = '<!-- pdf-block id="abc" src="spec.pdf" -->'
    out = markdown_to_html(f"# Spec\n\n{placeholder}\n\nAfter\n")
    assert "data-raw-html" not in out
    assert placeholder in out


def test_details_toggle_is_not_wrapped() -> None:
    out = markdown_to_html("<details>\n<summary>S</summary>\n\nbody\n\n</details>\n")
    assert "data-raw-html" not in out
    assert "<details>" in out


def test_columns_div_is_not_wrapped() -> None:
    out = markdown_to_html('<div data-columns="2">\n\ncontent\n\n</div>\n')
    assert "data-raw-html" not in out
    assert "data-columns" in out


def test_task_lists_have_no_editor_schema_attributes() -> None:
    out = markdown_to_html("# Lists\n\n- [ ] Todo\n- [x] Done\n")
    assert "data-raw-html" not in out
    assert "data-type" not in out
    assert "data-checked" not in out
    assert "[ ] Todo" in out
    assert "[x] Done" in out
