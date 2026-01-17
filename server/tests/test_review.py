"""Tests for Review API endpoint.

Tests the AI-powered text review functionality.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.review import (
    REVIEW_JSON_SCHEMA,
    REVIEW_SYSTEM_PROMPT,
    TextReviewRequest,
    router,
)


# ============================================================================
# TextReviewRequest Model Tests
# ============================================================================


class TestTextReviewRequest:
    """Tests for TextReviewRequest model."""

    def test_creates_with_required_fields(self):
        """Should create request with required fields."""
        req = TextReviewRequest(content="Test content", file_id="file-123")

        assert req.content == "Test content"
        assert req.file_id == "file-123"
        assert req.language == "en"  # Default

    def test_creates_with_custom_language(self):
        """Should allow custom language."""
        req = TextReviewRequest(
            content="Test",
            file_id="file-123",
            language="zh"
        )

        assert req.language == "zh"

    def test_allows_none_language(self):
        """Should allow None as language."""
        req = TextReviewRequest(
            content="Test",
            file_id="file-123",
            language=None
        )

        assert req.language is None


# ============================================================================
# System Prompt Tests
# ============================================================================


class TestSystemPrompt:
    """Tests for the review system prompt."""

    def test_system_prompt_contains_categories(self):
        """Should mention all review categories."""
        categories = ["correctness", "clarity", "tone", "engagement"]

        for cat in categories:
            assert cat in REVIEW_SYSTEM_PROMPT.lower()

    def test_system_prompt_contains_required_fields(self):
        """Should mention required output fields."""
        required_fields = [
            "category", "type", "original_text", "replacement",
            "explanation", "start_offset", "end_offset"
        ]

        for field in required_fields:
            assert field in REVIEW_SYSTEM_PROMPT


# ============================================================================
# JSON Schema Tests
# ============================================================================


class TestJSONSchema:
    """Tests for the review JSON schema."""

    def test_schema_has_suggestions_array(self):
        """Should have suggestions array property."""
        assert "suggestions" in REVIEW_JSON_SCHEMA["properties"]
        assert REVIEW_JSON_SCHEMA["properties"]["suggestions"]["type"] == "array"

    def test_schema_has_summary(self):
        """Should have summary property."""
        assert "summary" in REVIEW_JSON_SCHEMA["properties"]
        assert REVIEW_JSON_SCHEMA["properties"]["summary"]["type"] == "string"

    def test_suggestion_item_has_required_fields(self):
        """Should require all fields in suggestion item."""
        item_schema = REVIEW_JSON_SCHEMA["properties"]["suggestions"]["items"]
        required = item_schema["required"]

        expected_required = [
            "category", "type", "original_text", "replacement",
            "explanation", "start_offset", "end_offset"
        ]

        for field in expected_required:
            assert field in required

    def test_category_enum_values(self):
        """Should restrict category to valid values."""
        item_schema = REVIEW_JSON_SCHEMA["properties"]["suggestions"]["items"]
        category_prop = item_schema["properties"]["category"]

        assert "enum" in category_prop
        assert set(category_prop["enum"]) == {"correctness", "clarity", "tone", "engagement"}


# ============================================================================
# Review Endpoint Tests
# ============================================================================


class TestReviewEndpoint:
    """Tests for the review_text endpoint."""

    @pytest.fixture
    def app(self):
        """Create FastAPI app with review router."""
        app = FastAPI()
        app.include_router(router, prefix="/api/review")
        return app

    @pytest.fixture
    def client(self, app):
        """Create test client."""
        return TestClient(app)

    def test_short_document_returns_empty_suggestions(self, client):
        """Should return empty suggestions for very short documents."""
        response = client.post(
            "/api/review",
            json={"content": "Short", "file_id": "file-123"}
        )

        assert response.status_code == 200

        # Parse SSE response
        lines = response.text.strip().split("\n")
        events = []
        for line in lines:
            if line.startswith("data: ") and line != "data: [DONE]":
                data = line[6:]
                events.append(json.loads(data))

        # Should have result with empty suggestions
        result_events = [e for e in events if "result" in e]
        assert len(result_events) == 1
        assert result_events[0]["result"]["suggestions"] == []
        assert "too short" in result_events[0]["result"]["summary"].lower()

    @patch("api.review.LLMService")
    @patch("api.review.get_settings")
    def test_successful_review(self, mock_settings, mock_llm_class, client):
        """Should return suggestions from LLM."""
        mock_settings.return_value = MagicMock(default_model="claude-3-5-sonnet-20241022")

        # Mock LLM response
        mock_llm = MagicMock()
        mock_llm.json_complete = AsyncMock(return_value={
            "suggestions": [
                {
                    "category": "correctness",
                    "type": "spelling_error",
                    "original_text": "teh",
                    "replacement": "the",
                    "explanation": "Spelling error",
                    "start_offset": 0,
                    "end_offset": 3
                }
            ],
            "summary": "Found 1 spelling error."
        })
        mock_llm_class.return_value = mock_llm

        response = client.post(
            "/api/review",
            json={"content": "teh quick brown fox jumps over the lazy dog", "file_id": "file-123"}
        )

        assert response.status_code == 200

        # Parse response
        lines = response.text.strip().split("\n")
        events = []
        for line in lines:
            if line.startswith("data: ") and line != "data: [DONE]":
                events.append(json.loads(line[6:]))

        # Should have analyzing status
        status_events = [e for e in events if "status" in e]
        assert len(status_events) == 1
        assert status_events[0]["status"] == "analyzing"

        # Should have result
        result_events = [e for e in events if "result" in e]
        assert len(result_events) == 1
        assert len(result_events[0]["result"]["suggestions"]) == 1

    @patch("api.review.LLMService")
    @patch("api.review.get_settings")
    def test_validates_suggestion_positions(self, mock_settings, mock_llm_class, client):
        """Should validate and correct suggestion positions."""
        mock_settings.return_value = MagicMock(default_model="claude-3-5-sonnet-20241022")

        content = "The quick brown fox jumps over the lazy dog."

        # Mock LLM with incorrect position but valid text
        mock_llm = MagicMock()
        mock_llm.json_complete = AsyncMock(return_value={
            "suggestions": [
                {
                    "category": "engagement",
                    "type": "word_choice",
                    "original_text": "quick",
                    "replacement": "swift",
                    "explanation": "More engaging word",
                    "start_offset": 100,  # Wrong position
                    "end_offset": 105
                }
            ],
            "summary": "Review complete."
        })
        mock_llm_class.return_value = mock_llm

        response = client.post(
            "/api/review",
            json={"content": content, "file_id": "file-123"}
        )

        assert response.status_code == 200

        # Parse and verify position was corrected
        lines = response.text.strip().split("\n")
        for line in lines:
            if line.startswith("data: ") and "result" in line:
                data = json.loads(line[6:])
                if "result" in data and data["result"]["suggestions"]:
                    suggestion = data["result"]["suggestions"][0]
                    # Position should be corrected to actual location of "quick"
                    assert suggestion["start_offset"] == 4  # "The " = 4 chars
                    assert suggestion["end_offset"] == 9

    @patch("api.review.LLMService")
    @patch("api.review.get_settings")
    def test_filters_invalid_suggestions(self, mock_settings, mock_llm_class, client):
        """Should filter out suggestions with non-existent text."""
        mock_settings.return_value = MagicMock(default_model="claude-3-5-sonnet-20241022")

        content = "The quick brown fox."

        # Mock LLM with non-existent text
        mock_llm = MagicMock()
        mock_llm.json_complete = AsyncMock(return_value={
            "suggestions": [
                {
                    "category": "clarity",
                    "type": "unclear",
                    "original_text": "nonexistent text",
                    "replacement": "clear text",
                    "explanation": "This text doesn't exist",
                    "start_offset": 0,
                    "end_offset": 16
                }
            ],
            "summary": "Review complete."
        })
        mock_llm_class.return_value = mock_llm

        response = client.post(
            "/api/review",
            json={"content": content, "file_id": "file-123"}
        )

        assert response.status_code == 200

        # Parse and verify suggestion was filtered
        lines = response.text.strip().split("\n")
        for line in lines:
            if line.startswith("data: ") and "result" in line:
                data = json.loads(line[6:])
                if "result" in data:
                    assert len(data["result"]["suggestions"]) == 0

    @patch("api.review.LLMService")
    @patch("api.review.get_settings")
    def test_handles_llm_error(self, mock_settings, mock_llm_class, client):
        """Should return error event when LLM fails."""
        mock_settings.return_value = MagicMock(default_model="claude-3-5-sonnet-20241022")

        mock_llm = MagicMock()
        mock_llm.json_complete = AsyncMock(side_effect=Exception("API error"))
        mock_llm_class.return_value = mock_llm

        response = client.post(
            "/api/review",
            json={"content": "A long enough document for review testing purposes.", "file_id": "file-123"}
        )

        assert response.status_code == 200

        # Parse and verify error
        lines = response.text.strip().split("\n")
        error_found = False
        for line in lines:
            if line.startswith("data: ") and "error" in line:
                data = json.loads(line[6:])
                if "error" in data:
                    error_found = True
                    assert "API error" in data["error"]

        assert error_found

    @patch("api.review.LLMService")
    @patch("api.review.get_settings")
    def test_validates_position_in_bounds(self, mock_settings, mock_llm_class, client):
        """Should handle suggestions with valid positions."""
        mock_settings.return_value = MagicMock(default_model="claude-3-5-sonnet-20241022")

        content = "The quick brown fox jumps."

        # Mock LLM with correct position
        mock_llm = MagicMock()
        mock_llm.json_complete = AsyncMock(return_value={
            "suggestions": [
                {
                    "category": "correctness",
                    "type": "typo",
                    "original_text": "quick",
                    "replacement": "swift",
                    "explanation": "Better word",
                    "start_offset": 4,
                    "end_offset": 9
                }
            ],
            "summary": "Review complete."
        })
        mock_llm_class.return_value = mock_llm

        response = client.post(
            "/api/review",
            json={"content": content, "file_id": "file-123"}
        )

        assert response.status_code == 200

        # Should keep suggestion with valid position
        lines = response.text.strip().split("\n")
        for line in lines:
            if line.startswith("data: ") and "result" in line:
                data = json.loads(line[6:])
                if "result" in data:
                    assert len(data["result"]["suggestions"]) == 1

    @patch("api.review.LLMService")
    @patch("api.review.get_settings")
    def test_handles_negative_positions(self, mock_settings, mock_llm_class, client):
        """Should handle suggestions with negative positions."""
        mock_settings.return_value = MagicMock(default_model="claude-3-5-sonnet-20241022")

        content = "Test content for review with negative positions."

        # Mock LLM with negative position
        mock_llm = MagicMock()
        mock_llm.json_complete = AsyncMock(return_value={
            "suggestions": [
                {
                    "category": "clarity",
                    "type": "unclear",
                    "original_text": "Test",
                    "replacement": "Example",
                    "explanation": "Clearer word",
                    "start_offset": -1,
                    "end_offset": 4
                }
            ],
            "summary": "Review complete."
        })
        mock_llm_class.return_value = mock_llm

        response = client.post(
            "/api/review",
            json={"content": content, "file_id": "file-123"}
        )

        # Should correct the position
        assert response.status_code == 200

    @patch("api.review.LLMService")
    @patch("api.review.get_settings")
    def test_handles_empty_suggestions(self, mock_settings, mock_llm_class, client):
        """Should handle empty suggestions from LLM."""
        mock_settings.return_value = MagicMock(default_model="claude-3-5-sonnet-20241022")

        mock_llm = MagicMock()
        mock_llm.json_complete = AsyncMock(return_value={
            "suggestions": [],
            "summary": "No issues found."
        })
        mock_llm_class.return_value = mock_llm

        response = client.post(
            "/api/review",
            json={"content": "A perfectly written document with no issues.", "file_id": "file-123"}
        )

        assert response.status_code == 200

        lines = response.text.strip().split("\n")
        for line in lines:
            if line.startswith("data: ") and "result" in line:
                data = json.loads(line[6:])
                if "result" in data:
                    assert data["result"]["suggestions"] == []
                    assert data["result"]["summary"] == "No issues found."

    def test_response_headers(self, client):
        """Should set correct SSE headers."""
        response = client.post(
            "/api/review",
            json={"content": "Short", "file_id": "file-123"}
        )

        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")

    @patch("api.review.LLMService")
    @patch("api.review.get_settings")
    def test_includes_done_event(self, mock_settings, mock_llm_class, client):
        """Should end stream with [DONE] event."""
        mock_settings.return_value = MagicMock(default_model="claude-3-5-sonnet-20241022")

        mock_llm = MagicMock()
        mock_llm.json_complete = AsyncMock(return_value={
            "suggestions": [],
            "summary": "Review complete."
        })
        mock_llm_class.return_value = mock_llm

        response = client.post(
            "/api/review",
            json={"content": "A document long enough for review.", "file_id": "file-123"}
        )

        assert "data: [DONE]" in response.text

    @patch("api.review.LLMService")
    @patch("api.review.get_settings")
    def test_handles_missing_summary(self, mock_settings, mock_llm_class, client):
        """Should provide default summary if missing."""
        mock_settings.return_value = MagicMock(default_model="claude-3-5-sonnet-20241022")

        mock_llm = MagicMock()
        mock_llm.json_complete = AsyncMock(return_value={
            "suggestions": []
            # Missing summary
        })
        mock_llm_class.return_value = mock_llm

        response = client.post(
            "/api/review",
            json={"content": "A document for testing missing summary field.", "file_id": "file-123"}
        )

        assert response.status_code == 200

        lines = response.text.strip().split("\n")
        for line in lines:
            if line.startswith("data: ") and "result" in line:
                data = json.loads(line[6:])
                if "result" in data:
                    assert data["result"]["summary"] == "Review complete."


# ============================================================================
# Edge Cases
# ============================================================================


class TestEdgeCases:
    """Tests for edge cases."""

    @pytest.fixture
    def app(self):
        """Create FastAPI app with review router."""
        app = FastAPI()
        app.include_router(router, prefix="/api/review")
        return app

    @pytest.fixture
    def client(self, app):
        """Create test client."""
        return TestClient(app)

    def test_whitespace_only_content(self, client):
        """Should handle whitespace-only content."""
        response = client.post(
            "/api/review",
            json={"content": "   \n\t\n   ", "file_id": "file-123"}
        )

        assert response.status_code == 200

        # Should be treated as too short
        lines = response.text.strip().split("\n")
        for line in lines:
            if line.startswith("data: ") and "result" in line:
                data = json.loads(line[6:])
                if "result" in data:
                    assert data["result"]["suggestions"] == []

    def test_exactly_20_chars(self, client):
        """Should handle exactly 20 character content."""
        content = "12345678901234567890"  # Exactly 20 chars

        response = client.post(
            "/api/review",
            json={"content": content, "file_id": "file-123"}
        )

        # Should be treated as too short (strip makes it still short)
        assert response.status_code == 200

    @patch("api.review.LLMService")
    @patch("api.review.get_settings")
    def test_unicode_content(self, mock_settings, mock_llm_class, client):
        """Should handle unicode content."""
        mock_settings.return_value = MagicMock(default_model="claude-3-5-sonnet-20241022")

        mock_llm = MagicMock()
        mock_llm.json_complete = AsyncMock(return_value={
            "suggestions": [],
            "summary": "No issues."
        })
        mock_llm_class.return_value = mock_llm

        response = client.post(
            "/api/review",
            json={"content": "这是一段中文内容，用于测试Unicode支持。", "file_id": "file-123"}
        )

        assert response.status_code == 200
