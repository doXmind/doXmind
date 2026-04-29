"""Tests for markdown_utils.

Tests the markdown_to_plain_text function which must produce output
identical to the frontend's markdownToPlainText() in src/lib/markdown.ts.
"""

from lib.markdown_utils import markdown_to_plain_text


class TestMarkdownToPlainText:
    """Tests for markdown_to_plain_text function."""

    def test_empty_string(self):
        """Should handle empty string."""
        assert markdown_to_plain_text("") == ""

    def test_plain_text(self):
        """Should return plain text unchanged."""
        assert markdown_to_plain_text("Hello world") == "Hello world"

    def test_removes_bold_asterisks(self):
        """Should remove bold ** markers."""
        assert markdown_to_plain_text("This is **bold** text") == "This is bold text"

    def test_removes_bold_underscores(self):
        """Should remove bold __ markers."""
        assert markdown_to_plain_text("This is __bold__ text") == "This is bold text"

    def test_removes_italic_asterisks(self):
        """Should remove italic * markers."""
        assert markdown_to_plain_text("This is *italic* text") == "This is italic text"

    def test_removes_italic_underscores(self):
        """Should remove italic _ markers but not in words."""
        assert markdown_to_plain_text("This is _italic_ text") == "This is italic text"
        # Should NOT remove underscores within words
        assert markdown_to_plain_text("snake_case_variable") == "snake_case_variable"

    def test_removes_strikethrough(self):
        """Should remove strikethrough ~~ markers."""
        assert markdown_to_plain_text("This is ~~deleted~~ text") == "This is deleted text"

    def test_removes_inline_code(self):
        """Should remove inline code backticks."""
        assert markdown_to_plain_text("Use `code` here") == "Use code here"

    def test_removes_links_keeps_text(self):
        """Should remove link syntax but keep link text."""
        assert markdown_to_plain_text("[click here](https://example.com)") == "click here"

    def test_removes_images_keeps_alt(self):
        """Should remove image syntax but keep alt text."""
        assert markdown_to_plain_text("![alt text](image.png)") == "alt text"

    def test_removes_headings(self):
        """Should remove heading markers."""
        assert markdown_to_plain_text("# Heading 1") == "Heading 1"
        assert markdown_to_plain_text("## Heading 2") == "Heading 2"
        assert markdown_to_plain_text("### Heading 3") == "Heading 3"

    def test_removes_blockquotes(self):
        """Should remove blockquote markers."""
        assert markdown_to_plain_text("> Quote text") == "Quote text"

    def test_removes_unordered_list_markers(self):
        """Should remove unordered list markers."""
        assert markdown_to_plain_text("- Item 1") == "Item 1"
        assert markdown_to_plain_text("* Item 2") == "Item 2"
        assert markdown_to_plain_text("+ Item 3") == "Item 3"

    def test_removes_ordered_list_markers(self):
        """Should remove ordered list markers."""
        assert markdown_to_plain_text("1. First item") == "First item"
        assert markdown_to_plain_text("2. Second item") == "Second item"
        assert markdown_to_plain_text("10. Tenth item") == "Tenth item"

    def test_removes_code_fences(self):
        """Should remove code fence markers."""
        code = "```python\nprint('hello')\n```"
        result = markdown_to_plain_text(code)
        assert "```" not in result
        assert "print('hello')" in result

    def test_removes_horizontal_rules(self):
        """Should remove horizontal rule markers."""
        assert markdown_to_plain_text("---") == ""
        assert markdown_to_plain_text("***") == ""
        assert markdown_to_plain_text("___") == ""

    def test_collapses_newlines(self):
        """Should collapse all newlines (matching doc.textContent behavior)."""
        text = "Line 1\nLine 2\n\nLine 3"
        result = markdown_to_plain_text(text)
        assert "\n" not in result
        assert result == "Line 1Line 2Line 3"

    def test_collapses_multiple_spaces(self):
        """Should collapse multiple spaces to single."""
        assert markdown_to_plain_text("Hello    world") == "Hello world"

    def test_trims_whitespace(self):
        """Should trim leading and trailing whitespace."""
        assert markdown_to_plain_text("  Hello world  ") == "Hello world"

    def test_complex_markdown(self):
        """Should handle complex markdown with multiple elements."""
        markdown = """# Title

This is **bold** and *italic* text.

- Item 1
- Item 2

[Link](https://example.com) and `code`."""

        result = markdown_to_plain_text(markdown)

        # Should not contain any markdown markers
        assert "#" not in result
        assert "**" not in result
        assert "*" not in result or result.count("*") == 0
        assert "-" not in result or "Item" in result  # hyphens only in content
        assert "[" not in result
        assert "]" not in result
        assert "(" not in result or ")" not in result  # parentheses only in content
        assert "`" not in result

        # Should contain all text content
        assert "Title" in result
        assert "bold" in result
        assert "italic" in result
        assert "Link" in result
        assert "code" in result

    def test_mixed_formatting(self):
        """Should handle mixed formatting in same line."""
        markdown = "This **has _nested_ formatting** here"
        result = markdown_to_plain_text(markdown)
        assert result == "This has nested formatting here"

    def test_removes_html_tags(self):
        """Should remove HTML tags."""
        assert markdown_to_plain_text("<p>Paragraph</p>") == "Paragraph"
        assert markdown_to_plain_text("<strong>Bold</strong>") == "Bold"


class TestSearchTextGeneration:
    """Tests verifying search_text generation matches frontend expectations."""

    def test_simple_text_unchanged(self):
        """Plain text should pass through unchanged."""
        text = "Hello world this is a test"
        assert markdown_to_plain_text(text) == text

    def test_formatted_text_produces_plain(self):
        """Formatted markdown should produce plain text for searching."""
        # This mirrors markdown text that callers search against.
        old_str = "**Important** information about `API` usage"
        # This should match what's in doc.textContent
        expected = "Important information about API usage"
        assert markdown_to_plain_text(old_str) == expected

    def test_multiline_produces_single_line(self):
        """Multi-line content should be joined without newlines."""
        old_str = """First paragraph.

Second paragraph.

Third paragraph."""
        result = markdown_to_plain_text(old_str)
        assert "\n" not in result
        assert result == "First paragraph.Second paragraph.Third paragraph."

    def test_list_items_joined(self):
        """List items should be joined without markers or newlines."""
        old_str = """- Apple
- Banana
- Cherry"""
        result = markdown_to_plain_text(old_str)
        assert result == "AppleBananaCherry"
