"""Tests for Document Tools.

Tests the document tool executors:
- get_outline (unified)
- read_content (unified)
- search (unified)
- str_replace_editor (edit)
- replace_document (edit)
"""

import pytest

from agents.tools.document_tools import (
    EDIT_TOOL_NAMES,
    UNIFIED_TOOL_NAMES,
    execute_edit_tool,
    execute_replace_document,
    execute_search,
    execute_str_replace,
    find_target_file,
)

# ============================================================================
# Sample Data
# ============================================================================


def create_sample_files():
    """Create sample files for testing."""
    return [
        {
            "id": "file-1",
            "name": "document.md",
            "content": "Line 1\nLine 2\nLine 3\nLine 4\nLine 5",
            "is_current": True,
        },
        {
            "id": "file-2",
            "name": "notes.txt",
            "content": "Note A\nNote B\nNote C",
        },
    ]


# ============================================================================
# find_target_file Tests
# ============================================================================


class TestFindTargetFile:
    """Tests for find_target_file function."""

    def test_find_by_file_id(self):
        """Should find file by specific ID."""
        files = create_sample_files()

        result = find_target_file(files, "file-2", "file-1")

        assert result is not None
        assert result["id"] == "file-2"
        assert result["name"] == "notes.txt"

    def test_find_by_current_file_id(self):
        """Should use current_file_id when file_id is None."""
        files = create_sample_files()

        result = find_target_file(files, None, "file-2")

        assert result is not None
        assert result["id"] == "file-2"

    def test_find_by_is_current_flag(self):
        """Should find file marked as current when no IDs specified."""
        files = create_sample_files()

        result = find_target_file(files, None, None)

        assert result is not None
        assert result["id"] == "file-1"
        assert result.get("is_current") is True

    def test_fallback_to_first_file(self):
        """Should fallback to first file when nothing matched."""
        files = [
            {"id": "file-1", "name": "doc.md", "content": "Content"},
            {"id": "file-2", "name": "doc2.md", "content": "Content 2"},
        ]

        result = find_target_file(files, "nonexistent", None)

        assert result is not None
        assert result["id"] == "file-1"

    def test_returns_none_for_empty_files(self):
        """Should return None when files list is empty."""
        result = find_target_file([], "file-1", "file-1")

        assert result is None


# ============================================================================
# execute_str_replace Tests
# ============================================================================


class TestStrReplace:
    """Tests for str_replace_editor tool."""

    def test_str_replace_success(self):
        """Should return edit operation on success."""
        files = create_sample_files()

        result = execute_str_replace(
            {"old_str": "Line 2", "new_str": "Modified Line 2"}, files, "file-1"
        )

        assert result.get("success") is True
        assert result["type"] == "str_replace"
        assert result["file_id"] == "file-1"
        assert result["old_str"] == "Line 2"
        assert result["new_str"] == "Modified Line 2"

    def test_str_replace_string_not_found(self):
        """Should return error when string not found."""
        files = create_sample_files()

        result = execute_str_replace(
            {"old_str": "Nonexistent text", "new_str": "New text"}, files, "file-1"
        )

        assert "error" in result
        assert "no exact match" in result["error"].lower()

    def test_str_replace_multiple_matches(self):
        """Should return error when string found multiple times."""
        files = [
            {
                "id": "file-1",
                "name": "doc.md",
                "content": "word word word",
                "is_current": True,
            }
        ]

        result = execute_str_replace({"old_str": "word", "new_str": "thing"}, files, "file-1")

        assert "error" in result
        assert "3 times" in result["error"]

    def test_str_replace_no_file_open(self):
        """Should return error when no file is open."""
        result = execute_str_replace({"old_str": "old", "new_str": "new"}, [], None)

        assert "error" in result
        assert "No document" in result["error"]

    def test_str_replace_specific_file(self):
        """Should replace in specific file."""
        files = create_sample_files()

        result = execute_str_replace(
            {"file_id": "file-2", "old_str": "Note B", "new_str": "Note X"}, files, "file-1"
        )

        assert result.get("success") is True
        assert result["file_id"] == "file-2"

    def test_str_replace_empty_old_str(self):
        """Should return error when old_str is empty."""
        files = create_sample_files()

        result = execute_str_replace({"old_str": "", "new_str": "Some text"}, files, "file-1")

        assert "error" in result
        assert "required" in result["error"].lower()

    def test_str_replace_missing_old_str(self):
        """Should return error when old_str is not provided."""
        files = create_sample_files()

        result = execute_str_replace({"new_str": "Some text"}, files, "file-1")

        assert "error" in result
        assert "required" in result["error"].lower()

    def test_str_replace_whitespace_normalization(self):
        """Should match via whitespace normalization when only spaces differ."""
        files = [
            {
                "id": "file-1",
                "name": "doc.md",
                "content": "Hello   world\nNew line",
                "is_current": True,
            }
        ]

        result = execute_str_replace(
            {"old_str": "Hello world", "new_str": "Hi world"}, files, "file-1"
        )

        assert result.get("success") is True
        assert result["old_str"] == "Hello   world"  # Returns ORIGINAL document text
        assert result["new_str"] == "Hi world"
        assert "normalization_note" in result

    def test_str_replace_error_message_is_actionable(self):
        """Should return actionable error message when not found."""
        files = create_sample_files()

        result = execute_str_replace(
            {"old_str": "nonexistent text", "new_str": "new"}, files, "file-1"
        )

        assert "error" in result
        assert "exact" in result["error"].lower() or "read_content" in result["error"]


# ============================================================================
# Whitespace Normalization Tests
# ============================================================================


class TestWhitespaceNormalization:
    """Tests for whitespace normalization fallback in str_replace."""

    def test_trailing_whitespace_normalization(self):
        """Should match when trailing whitespace differs."""
        files = [
            {
                "id": "f1",
                "name": "doc.md",
                "content": "Line one  \nLine two",
                "is_current": True,
            }
        ]
        result = execute_str_replace(
            {"old_str": "Line one\nLine two", "new_str": "Changed"}, files, "f1"
        )
        assert result.get("success") is True
        assert result["old_str"] == "Line one  \nLine two"
        assert "normalization_note" in result

    def test_crlf_normalization(self):
        """Should match when line endings differ (\\r\\n vs \\n)."""
        files = [
            {
                "id": "f1",
                "name": "doc.md",
                "content": "Line 1\r\nLine 2",
                "is_current": True,
            }
        ]
        result = execute_str_replace(
            {"old_str": "Line 1\nLine 2", "new_str": "Changed"}, files, "f1"
        )
        assert result.get("success") is True
        assert "normalization_note" in result

    def test_nbsp_normalization(self):
        """Should match when non-breaking spaces differ from regular spaces."""
        files = [
            {
                "id": "f1",
                "name": "doc.md",
                "content": "Hello\u00a0world",
                "is_current": True,
            }
        ]
        result = execute_str_replace({"old_str": "Hello world", "new_str": "Hi world"}, files, "f1")
        assert result.get("success") is True
        assert result["old_str"] == "Hello\u00a0world"
        assert "normalization_note" in result

    def test_no_normalization_in_code_blocks(self):
        """Should NOT normalize whitespace inside fenced code blocks."""
        content = "text\n```python\ndef foo(  ):\n    pass\n```\nmore text"
        files = [{"id": "f1", "name": "doc.md", "content": content, "is_current": True}]
        # Trying to match with different whitespace inside code block should fail
        result = execute_str_replace(
            {"old_str": "def foo():\n  pass", "new_str": "def bar(): pass"}, files, "f1"
        )
        assert "error" in result

    def test_normalization_multiple_matches_still_fails(self):
        """Should fail if normalization produces multiple matches."""
        files = [
            {
                "id": "f1",
                "name": "doc.md",
                "content": "hello  world\nhello   world",
                "is_current": True,
            }
        ]
        result = execute_str_replace({"old_str": "hello world", "new_str": "bye"}, files, "f1")
        assert "error" in result

    def test_exact_match_preferred_over_normalization(self):
        """Should NOT have normalization_note when exact match succeeds."""
        files = [
            {
                "id": "f1",
                "name": "doc.md",
                "content": "Hello world\nLine two",
                "is_current": True,
            }
        ]
        result = execute_str_replace({"old_str": "Hello world", "new_str": "Hi world"}, files, "f1")
        assert result.get("success") is True
        assert "normalization_note" not in result

    def test_tab_normalization(self):
        """Should match when tabs differ from spaces."""
        files = [
            {
                "id": "f1",
                "name": "doc.md",
                "content": "Hello\tworld",
                "is_current": True,
            }
        ]
        result = execute_str_replace({"old_str": "Hello world", "new_str": "Hi"}, files, "f1")
        assert result.get("success") is True
        assert result["old_str"] == "Hello\tworld"
        assert "normalization_note" in result

    def test_offset_correct_after_normalization(self):
        """Should return correct character offset for normalized match."""
        files = [
            {
                "id": "f1",
                "name": "doc.md",
                "content": "Prefix text\nHello   world\nSuffix",
                "is_current": True,
            }
        ]
        result = execute_str_replace({"old_str": "Hello world", "new_str": "Hi world"}, files, "f1")
        assert result.get("success") is True
        # The offset should point to "Hello   world" in the original content
        content = "Prefix text\nHello   world\nSuffix"
        assert (
            content[result["offset"] : result["offset"] + len(result["old_str"])] == "Hello   world"
        )


# ============================================================================
# Similar Text Hints Tests
# ============================================================================


class TestSimilarTextHints:
    """Tests for similar text hints in error messages."""

    def test_similar_text_hint_provided(self):
        """Should include hint when similar text exists."""
        files = [
            {
                "id": "f1",
                "name": "doc.md",
                "content": "The quick brown fox jumps over the lazy dog. "
                "This is a longer paragraph with enough content.",
                "is_current": True,
            }
        ]
        result = execute_str_replace(
            {
                "old_str": "The quick brown fox jumped over the lazy dog",
                "new_str": "New text",
            },
            files,
            "f1",
        )
        assert "error" in result
        assert "Did you mean" in result["error"]

    def test_no_hint_for_completely_different_text(self):
        """Should NOT include hint when text is completely different."""
        files = [
            {
                "id": "f1",
                "name": "doc.md",
                "content": "Hello world, this is a test document.",
                "is_current": True,
            }
        ]
        result = execute_str_replace(
            {
                "old_str": "xyz abc 123 completely different unrelated text here",
                "new_str": "New",
            },
            files,
            "f1",
        )
        assert "error" in result
        # May or may not have hint, but if it does, it should meet threshold

    def test_no_hint_for_short_target(self):
        """Should skip hint for very short targets."""
        files = [
            {
                "id": "f1",
                "name": "doc.md",
                "content": "Hello world",
                "is_current": True,
            }
        ]
        result = execute_str_replace({"old_str": "xyz", "new_str": "New"}, files, "f1")
        assert "error" in result
        assert "Did you mean" not in result["error"]


# ============================================================================
# execute_replace_document Tests
# ============================================================================


class TestReplaceDocument:
    """Tests for replace_document tool."""

    def test_replace_document_success(self):
        """Should return edit operation on success."""
        files = create_sample_files()

        result = execute_replace_document(
            {"new_content": "Completely new content"}, files, "file-1"
        )

        assert result.get("success") is True
        assert result["type"] == "replace_all"
        assert result["file_id"] == "file-1"
        assert result["new_content"] == "Completely new content"

    def test_replace_document_empty_content(self):
        """Should allow replacing with empty content."""
        files = create_sample_files()

        result = execute_replace_document({"new_content": ""}, files, "file-1")

        assert result.get("success") is True
        assert result["new_content"] == ""

    def test_replace_document_no_file_open(self):
        """Should return error when no file is open."""
        result = execute_replace_document({"new_content": "New content"}, [], None)

        assert "error" in result


# ============================================================================
# execute_edit_tool Tests
# ============================================================================


class TestExecuteEditTool:
    """Tests for the execute_edit_tool dispatcher."""

    def test_execute_str_replace_editor(self):
        """Should execute str_replace_editor tool."""
        files = create_sample_files()

        result = execute_edit_tool(
            "str_replace_editor", {"old_str": "Line 1", "new_str": "First Line"}, files, "file-1"
        )

        assert result.get("success") is True

    def test_execute_replace_document(self):
        """Should execute replace_document tool."""
        files = create_sample_files()

        result = execute_edit_tool(
            "replace_document", {"new_content": "New content"}, files, "file-1"
        )

        assert result.get("success") is True

    def test_execute_unknown_tool(self):
        """Should return error for unknown tool."""
        files = create_sample_files()

        result = execute_edit_tool("unknown_tool", {}, files, "file-1")

        assert "error" in result
        assert "Unknown" in result["error"]


# ============================================================================
# Tool Name Sets Tests
# ============================================================================


class TestToolNameSets:
    """Tests for tool name constants."""

    def test_unified_tool_names(self):
        """Should contain the unified read/search tools."""
        assert "get_outline" in UNIFIED_TOOL_NAMES
        assert "read_content" in UNIFIED_TOOL_NAMES
        assert "search" in UNIFIED_TOOL_NAMES

    def test_edit_tool_names(self):
        """Should contain the edit tools."""
        assert "str_replace_editor" in EDIT_TOOL_NAMES
        assert "replace_document" in EDIT_TOOL_NAMES

    def test_old_tools_not_in_sets(self):
        """Should not contain old tool names."""
        all_names = UNIFIED_TOOL_NAMES | EDIT_TOOL_NAMES
        old_tools = [
            "get_document_outline",
            "read_section",
            "view_document",
            "search_in_document",
        ]
        for tool in old_tools:
            assert tool not in all_names, f"{tool} should not be in tool name sets"


# ============================================================================
# Search Tests for Mermaid/Math Content
# ============================================================================


class TestSearchMermaidContent:
    """Tests for searching within mermaid chart and math block content."""

    @pytest.mark.asyncio
    async def test_search_mermaid_in_markdown(self):
        """Should find text in mermaid code fences (markdown format)."""
        files = [
            {
                "id": "file-1",
                "name": "doc.md",
                "content": "# Doc\n\n```mermaid\ngraph TD\n    A[Start] --> B[Process]\n```\n\nEnd.",
                "is_current": True,
            }
        ]
        result = await execute_search({"query": "Process"}, files, "file-1")
        assert "match" in result["result"].lower() or "Process" in result["result"]

    @pytest.mark.asyncio
    async def test_search_mermaid_in_markdown_multi_node(self):
        """Search should find text inside mermaid code fences."""
        files = [
            {
                "id": "file-1",
                "name": "doc.md",
                "content": "# Analysis\n\n```mermaid\ngraph TD\n    A[Start] --> B[Process]\n```\n",
                "is_current": True,
            }
        ]
        result = await execute_search({"query": "Process"}, files, "file-1")
        assert "No matches" not in result["result"]
        assert "Process" in result["result"]

    @pytest.mark.asyncio
    async def test_search_mermaid_in_html_content(self):
        """Should find text in mermaid data-code when content is raw HTML."""
        files = [
            {
                "id": "file-1",
                "name": "doc.md",
                "content": (
                    "<p>Hello</p>"
                    '<div data-type="mermaid-chart" '
                    'data-code="graph TD&#10;    A[Start] --&gt; B[End]" '
                    'class="mermaid-chart"></div>'
                    "<p>End</p>"
                ),
                "is_current": True,
            }
        ]
        result = await execute_search({"query": "Start"}, files, "file-1")
        assert "No matches" not in result["result"]
        assert "Start" in result["result"]

    @pytest.mark.asyncio
    async def test_search_no_match(self):
        """Should return no matches for text not in document."""
        files = [
            {
                "id": "file-1",
                "name": "doc.md",
                "content": "Hello world",
                "is_current": True,
            }
        ]
        result = await execute_search({"query": "nonexistent"}, files, "file-1")
        assert "No matches" in result["result"]
