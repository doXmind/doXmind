"""Raw-HTML block sentinel wrapping in markdown_to_html (issue #149)."""

from __future__ import annotations

from services.sidecar_io import markdown_to_html


def test_block_raw_html_is_wrapped_in_sentinel() -> None:
    src = 'Intro\n\n<p align="center">\n  <a href="https://x.com"><img src="b.svg"></a>\n</p>\n\nAfter\n'
    out = markdown_to_html(src)
    assert 'data-raw-html="' in out
    assert "&lt;p align=&quot;center&quot;&gt;" in out  # original markup, escaped
    assert "<p>Intro</p>" in out
    assert "<p>After</p>" in out
    assert out.count("data-raw-html=") == 1  # one sentinel per raw-HTML block


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
    # pdf-block / excel-block / database placeholders are HTML comments owned by
    # the external-reference block registry — they must pass through verbatim.
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


def test_task_lists_are_not_wrapped() -> None:
    # render_task_lists pre-renders `- [ ]` into `<ul data-type="taskList">`
    # HTML claimed by the taskList node — it must not be wrapped.
    out = markdown_to_html("# Lists\n\n- [ ] Todo\n- [x] Done\n")
    assert "data-raw-html" not in out
    assert '<ul data-type="taskList">' in out
    assert '<li data-type="taskItem" data-checked="false"><p>Todo</p></li>' in out
    assert '<li data-type="taskItem" data-checked="true"><p>Done</p></li>' in out
