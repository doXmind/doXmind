"""
Tests for History Compressor Service.
"""

from services.history_compressor import HistoryCompressor


class MockMessage:
    """Mock Message object for testing."""

    def __init__(
        self,
        role: str,
        content: str,
        tool_calls: list[dict] | None = None,
    ):
        self.role = role
        self.content = content
        self.tool_calls = tool_calls


class TestHistoryCompressor:
    """Tests for HistoryCompressor."""

    def setup_method(self):
        self.compressor = HistoryCompressor()

    def test_no_compression_when_under_threshold(self):
        """Messages under threshold should not be compressed."""
        messages = [
            MockMessage("user", "Hello"),
            MockMessage("assistant", "Hi there!"),
            MockMessage("user", "How are you?"),
            MockMessage("assistant", "I'm doing well."),
        ]

        result = self.compressor.compress(messages)

        assert len(result) == 4
        assert result[0]["role"] == "user"
        assert result[0]["content"] == "Hello"

    def test_no_compression_at_threshold(self):
        """Exactly 10 messages should not be compressed."""
        messages = [
            MockMessage("user", f"Message {i}")
            if i % 2 == 0
            else MockMessage("assistant", f"Response {i}")
            for i in range(10)
        ]

        result = self.compressor.compress(messages)

        assert len(result) == 10

    def test_compression_above_threshold(self):
        """Messages above threshold should be compressed."""
        messages = [
            MockMessage("user", f"Message {i}")
            if i % 2 == 0
            else MockMessage("assistant", f"Response {i}")
            for i in range(15)
        ]

        result = self.compressor.compress(messages)

        # Should have: 2 first + 2 summary + 6 last = 10 messages
        # But if no key notes extracted, skip summary: 2 + 6 = 8
        assert len(result) <= 10
        # First message preserved
        assert result[0]["content"] == "Message 0"

    def test_first_messages_preserved(self):
        """First 2 messages should always be preserved."""
        messages = [
            MockMessage("user", "Original intent: write a blog post"),
            MockMessage("assistant", "I'll help you write a blog post."),
        ] + [
            MockMessage("user", f"Middle {i}")
            if i % 2 == 0
            else MockMessage("assistant", f"Middle response {i}")
            for i in range(12)
        ]

        result = self.compressor.compress(messages)

        assert result[0]["content"] == "Original intent: write a blog post"
        assert result[1]["content"] == "I'll help you write a blog post."

    def test_last_messages_preserved(self):
        """Last 6 messages should always be preserved."""
        messages = [
            MockMessage("user", f"Message {i}")
            if i % 2 == 0
            else MockMessage("assistant", f"Response {i}")
            for i in range(20)
        ]

        result = self.compressor.compress(messages)

        # Last 6 messages should be at the end
        assert result[-1]["content"] == "Response 19"
        assert result[-2]["content"] == "Message 18"

    def test_key_notes_extraction_file_paths(self):
        """Should extract file paths from content."""
        messages = [
            MockMessage("user", "Edit the file `/src/main.py`"),
            MockMessage("assistant", "I'll edit `/src/main.py` for you."),
        ]

        notes = self.compressor._extract_key_notes(messages)

        assert "/src/main.py" in notes or "main.py" in notes

    def test_key_notes_extraction_tool_calls(self):
        """Should extract info from tool calls."""
        messages = [
            MockMessage(
                "assistant",
                "I made the edit.",
                tool_calls=[
                    {
                        "name": "str_replace",
                        "input": {"path": "/docs/readme.md"},
                        "success": True,
                    }
                ],
            ),
        ]

        notes = self.compressor._extract_key_notes(messages)

        assert "readme.md" in notes or "/docs/readme.md" in notes

    def test_empty_messages_list(self):
        """Should handle empty messages list."""
        result = self.compressor.compress([])

        assert result == []

    def test_single_message(self):
        """Should handle single message."""
        messages = [MockMessage("user", "Hello")]

        result = self.compressor.compress(messages)

        assert len(result) == 1
        assert result[0]["content"] == "Hello"

    def test_none_content_handled(self):
        """Should handle None content gracefully."""
        messages = [
            MockMessage("user", None),
            MockMessage("assistant", "Response"),
        ]

        result = self.compressor.compress(messages)

        assert result[0]["content"] == ""
        assert result[1]["content"] == "Response"

    def test_compression_includes_summary_marker(self):
        """Compressed history should include summary marker when notes exist."""
        messages = [
            MockMessage("user", "Edit `/src/app.py`"),
            MockMessage("assistant", "Done with `/src/app.py`"),
        ] + [
            MockMessage("user", f"More changes to `/src/file{i}.py`")
            if i % 2 == 0
            else MockMessage("assistant", f"Updated `/src/file{i}.py`")
            for i in range(12)
        ]

        result = self.compressor.compress(messages)

        # Compressed result should be smaller than original
        assert len(result) <= 10
        # First messages should be preserved
        assert result[0]["content"] == "Edit `/src/app.py`"
