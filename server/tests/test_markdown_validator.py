"""Tests for markdown_validator module.

Tests all four validation checks: tables, mermaid, math, and code blocks.
Ensures warnings include original text content (not line numbers) so the
agent can use str_replace_editor to fix issues.
"""

from utils.markdown_validator import (
    _check_code_blocks,
    _check_math,
    _check_mermaid,
    _check_tables,
    validate_markdown,
)

# ============================================================================
# Table Validation
# ============================================================================


class TestCheckTables:
    def test_valid_table_no_warnings(self):
        text = "| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |"
        assert _check_tables(text) == []

    def test_valid_table_with_alignment(self):
        text = "| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |"
        assert _check_tables(text) == []

    def test_column_count_mismatch(self):
        text = "| A | B |\n| --- | --- |\n| 1 | 2 | 3 |"
        warnings = _check_tables(text)
        assert len(warnings) == 1
        assert "column mismatch" in warnings[0].lower()
        assert "| 1 | 2 | 3 |" in warnings[0]

    def test_missing_separator_row(self):
        text = "| Header1 | Header2 |\n| Data1 | Data2 |"
        warnings = _check_tables(text)
        assert len(warnings) == 1
        assert "separator" in warnings[0].lower()
        assert "| Header1 | Header2 |" in warnings[0]

    def test_no_table_content(self):
        text = "Just a regular paragraph.\nNo tables here."
        assert _check_tables(text) == []

    def test_single_row_table(self):
        # A single row is not really a valid table, but we don't warn
        text = "| Only header |"
        assert _check_tables(text) == []

    def test_multiple_tables_with_issues(self):
        text = (
            "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n"
            "Some text\n\n"
            "| X | Y | Z |\n| --- | --- | --- |\n| 1 | 2 |"
        )
        warnings = _check_tables(text)
        assert len(warnings) == 1
        assert "| 1 | 2 |" in warnings[0]

    def test_table_at_end_of_text(self):
        text = "| A | B |\n| --- | --- |\n| 1 | 2 | 3 |"
        warnings = _check_tables(text)
        assert len(warnings) == 1

    def test_table_surrounded_by_text(self):
        text = "Before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter"
        assert _check_tables(text) == []


# ============================================================================
# Mermaid Validation
# ============================================================================


class TestCheckMermaid:
    def test_valid_mermaid_block(self):
        text = "```mermaid\ngraph TD\n  A --> B\n```"
        warnings = _check_mermaid(text)
        # Should only have the skill reminder, no errors
        assert len(warnings) == 1
        assert "charting" in warnings[0].lower()

    def test_no_mermaid_no_warnings(self):
        text = "Just regular text."
        assert _check_mermaid(text) == []

    def test_beta_diagram_without_suffix(self):
        text = "```mermaid\nxychart\n  x-axis [a, b]\n```"
        warnings = _check_mermaid(text)
        beta_warnings = [w for w in warnings if "beta" in w.lower()]
        assert len(beta_warnings) == 1
        assert "xychart-beta" in beta_warnings[0]

    def test_beta_diagram_with_suffix_ok(self):
        text = "```mermaid\nxychart-beta\n  x-axis [a, b]\n```"
        warnings = _check_mermaid(text)
        beta_warnings = [w for w in warnings if "beta" in w.lower()]
        assert len(beta_warnings) == 0

    def test_sankey_without_beta(self):
        text = "```mermaid\nsankey\n  A,B,10\n```"
        warnings = _check_mermaid(text)
        beta_warnings = [w for w in warnings if "beta" in w.lower()]
        assert len(beta_warnings) == 1
        assert "sankey-beta" in beta_warnings[0]

    def test_unclosed_mermaid_block(self):
        text = "```mermaid\ngraph TD\n  A --> B\n"
        warnings = _check_mermaid(text)
        unclosed = [w for w in warnings if "unclosed" in w.lower()]
        assert len(unclosed) == 1

    def test_multiple_valid_mermaid_blocks(self):
        text = "```mermaid\ngraph TD\n  A --> B\n```\n\n```mermaid\npie\n  title Test\n```"
        warnings = _check_mermaid(text)
        # Only skill reminder, no errors
        assert all("charting" in w.lower() or "skill" in w.lower() for w in warnings)


# ============================================================================
# Math Validation
# ============================================================================


class TestCheckMath:
    def test_valid_block_math(self):
        text = "The equation is $$E = mc^2$$ and that's it."
        assert _check_math(text) == []

    def test_valid_inline_math(self):
        text = "The value $x + y$ equals $z$."
        assert _check_math(text) == []

    def test_unclosed_block_math(self):
        text = "The equation is $$E = mc^2 and that's it."
        warnings = _check_math(text)
        assert len(warnings) >= 1
        assert any("$$" in w for w in warnings)

    def test_unclosed_inline_math(self):
        text = "The value $x + y equals z."
        warnings = _check_math(text)
        assert len(warnings) >= 1
        assert any("$" in w for w in warnings)

    def test_escaped_dollar_not_false_positive(self):
        text = "The price is \\$100 and \\$200."
        assert _check_math(text) == []

    def test_no_math_no_warnings(self):
        text = "Just regular text with no math."
        assert _check_math(text) == []

    def test_math_inside_code_block_ignored(self):
        text = "```python\nprice = '$100'\n```"
        assert _check_math(text) == []

    def test_multiple_valid_inline_math(self):
        text = "If $a = 1$ and $b = 2$ then $a + b = 3$."
        assert _check_math(text) == []


# ============================================================================
# Code Block Validation
# ============================================================================


class TestCheckCodeBlocks:
    def test_valid_code_block(self):
        text = "```python\nprint('hello')\n```"
        assert _check_code_blocks(text) == []

    def test_valid_code_block_no_language(self):
        text = "```\nsome code\n```"
        assert _check_code_blocks(text) == []

    def test_unclosed_code_block(self):
        text = "```python\nprint('hello')\n"
        warnings = _check_code_blocks(text)
        assert len(warnings) >= 1
        assert any("unclosed" in w.lower() for w in warnings)

    def test_unknown_language(self):
        text = "```pythn\nprint('hello')\n```"
        warnings = _check_code_blocks(text)
        assert len(warnings) == 1
        assert "pythn" in warnings[0]
        assert "python" in warnings[0]  # suggestion

    def test_known_languages_no_warnings(self):
        for lang in ["python", "javascript", "typescript", "rust", "go", "java", "sql"]:
            text = f"```{lang}\ncode here\n```"
            assert _check_code_blocks(text) == [], f"False warning for language: {lang}"

    def test_alias_languages_no_warnings(self):
        for lang in ["js", "ts", "py", "rb", "sh", "yml", "jsx", "tsx"]:
            text = f"```{lang}\ncode here\n```"
            assert _check_code_blocks(text) == [], f"False warning for alias: {lang}"

    def test_multiple_code_blocks_one_invalid(self):
        text = "```python\ncode\n```\n\n```javscript\ncode\n```"
        warnings = _check_code_blocks(text)
        assert len(warnings) == 1
        assert "javscript" in warnings[0]
        assert "javascript" in warnings[0]  # suggestion

    def test_mermaid_language_accepted(self):
        text = "```mermaid\ngraph TD\n```"
        assert _check_code_blocks(text) == []


# ============================================================================
# Integration: validate_markdown
# ============================================================================


class TestValidateMarkdown:
    def test_clean_markdown_no_warnings(self):
        text = "# Hello\n\nSome text.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |"
        assert validate_markdown(text) == []

    def test_multiple_issues(self):
        text = (
            "| A | B |\n| --- | --- |\n| 1 | 2 | 3 |\n\n"
            "The value $x is unclosed.\n\n"
            "```pythn\ncode\n```"
        )
        warnings = validate_markdown(text)
        assert len(warnings) >= 3  # table + math + code language

    def test_plain_text_no_warnings(self):
        text = "Just some regular markdown text.\n\nWith paragraphs.\n\n- And lists\n- Like this"
        assert validate_markdown(text) == []

    def test_warnings_contain_original_text(self):
        """Verify warnings include original text for str_replace_editor usage."""
        text = "| A | B |\n| --- | --- |\n| 1 | 2 | 3 |"
        warnings = validate_markdown(text)
        assert any("| 1 | 2 | 3 |" in w for w in warnings)
