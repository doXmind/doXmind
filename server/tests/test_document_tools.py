"""Tests for Document Tools.

Tests the document editing tool executors:
- view_document
- str_replace_editor (exact match replace)
- replace_document
- search_in_document
- get_document_outline
- read_section
"""

from agents.tools.document_tools import (
    execute_document_tool,
    execute_replace_document,
    execute_search_in_document,
    execute_str_replace,
    execute_view_document,
    find_target_file,
    is_document_tool,
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
# execute_view_document Tests
# ============================================================================


class TestViewDocument:
    """Tests for view_document tool."""

    def test_view_document_returns_numbered_lines(self):
        """Should return content with line numbers."""
        files = create_sample_files()

        result = execute_view_document({}, files, "file-1")

        assert "result" in result
        assert "document.md" in result["result"]
        assert "   1 |" in result["result"]
        assert "Line 1" in result["result"]

    def test_view_document_specific_file(self):
        """Should view specified file."""
        files = create_sample_files()

        result = execute_view_document({"file_id": "file-2"}, files, "file-1")

        assert "notes.txt" in result["result"]
        assert "Note A" in result["result"]

    def test_view_document_no_file_open(self):
        """Should return message when no document is open."""
        result = execute_view_document({}, [], None)

        assert "No document" in result["result"]


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

    def test_str_replace_no_fuzzy_matching(self):
        """Should NOT match with different whitespace (exact match only)."""
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

        # Should fail because "Hello world" (single space) != "Hello   world" (three spaces)
        assert "error" in result

    def test_str_replace_error_message_is_actionable(self):
        """Should return actionable error message when not found."""
        files = create_sample_files()

        result = execute_str_replace(
            {"old_str": "nonexistent text", "new_str": "new"}, files, "file-1"
        )

        assert "error" in result
        assert "exact" in result["error"].lower() or "view_document" in result["error"]


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
# execute_search_in_document Tests
# ============================================================================


class TestSearchInDocument:
    """Tests for search_in_document tool."""

    def test_search_finds_matches(self):
        """Should find matching lines."""
        files = create_sample_files()

        result = execute_search_in_document({"query": "Line 3"}, files, "file-1")

        assert "result" in result
        assert "1 match" in result["result"]
        assert "Line 3" in result["result"]

    def test_search_case_insensitive(self):
        """Should search case-insensitively."""
        files = create_sample_files()

        result = execute_search_in_document(
            {"query": "line 3"},  # lowercase
            files,
            "file-1",
        )

        assert "result" in result
        assert "match" in result["result"]

    def test_search_no_matches(self):
        """Should indicate no matches found."""
        files = create_sample_files()

        result = execute_search_in_document({"query": "nonexistent"}, files, "file-1")

        assert "result" in result
        assert "No matches" in result["result"]

    def test_search_includes_context(self):
        """Should include context lines around match."""
        files = create_sample_files()

        result = execute_search_in_document({"query": "Line 3"}, files, "file-1")

        # Should have context lines (Line 2, Line 3, Line 4)
        assert "Line 2" in result["result"]
        assert "Line 4" in result["result"]

    def test_search_highlights_matching_line(self):
        """Should highlight the matching line with >>>."""
        files = create_sample_files()

        result = execute_search_in_document({"query": "Line 3"}, files, "file-1")

        assert ">>>" in result["result"]

    def test_search_multiple_matches(self):
        """Should find multiple matches."""
        files = [
            {
                "id": "file-1",
                "name": "doc.md",
                "content": "apple\norange\napple\nbanana\napple",
                "is_current": True,
            }
        ]

        result = execute_search_in_document({"query": "apple"}, files, "file-1")

        assert "3 match" in result["result"]

    def test_search_no_file_open(self):
        """Should return message when no file is open."""
        result = execute_search_in_document({"query": "test"}, [], None)

        assert "No document" in result["result"]


# ============================================================================
# execute_document_tool Tests
# ============================================================================


class TestExecuteDocumentTool:
    """Tests for the main execute_document_tool function."""

    def test_execute_view_document(self):
        """Should execute view_document tool."""
        files = create_sample_files()

        result = execute_document_tool("view_document", {}, files, "file-1")

        assert "result" in result
        assert "document.md" in result["result"]

    def test_execute_str_replace_editor(self):
        """Should execute str_replace_editor tool."""
        files = create_sample_files()

        result = execute_document_tool(
            "str_replace_editor", {"old_str": "Line 1", "new_str": "First Line"}, files, "file-1"
        )

        assert result.get("success") is True

    def test_execute_replace_document(self):
        """Should execute replace_document tool."""
        files = create_sample_files()

        result = execute_document_tool(
            "replace_document", {"new_content": "New content"}, files, "file-1"
        )

        assert result.get("success") is True

    def test_execute_search_in_document(self):
        """Should execute search_in_document tool."""
        files = create_sample_files()

        result = execute_document_tool("search_in_document", {"query": "Line"}, files, "file-1")

        assert "result" in result

    def test_execute_unknown_tool(self):
        """Should return error for unknown tool."""
        files = create_sample_files()

        result = execute_document_tool("unknown_tool", {}, files, "file-1")

        assert "error" in result
        assert "Unknown" in result["error"]


# ============================================================================
# is_document_tool Tests
# ============================================================================


class TestIsDocumentTool:
    """Tests for is_document_tool function."""

    def test_returns_true_for_document_tools(self):
        """Should return True for all document tools."""
        document_tools = [
            "get_document_outline",
            "read_section",
            "view_document",
            "str_replace_editor",
            "replace_document",
            "search_in_document",
        ]

        for tool in document_tools:
            assert is_document_tool(tool) is True, f"{tool} should be a document tool"

    def test_returns_false_for_non_document_tools(self):
        """Should return False for non-document tools."""
        non_document_tools = [
            "search_kb",
            "get_kb_file",
            "unknown_tool",
            "",
        ]

        for tool in non_document_tools:
            assert is_document_tool(tool) is False, f"{tool} should not be a document tool"
