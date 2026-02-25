"""Tests for Edit API endpoints."""

import json
from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient

# ============================================================================
# Custom Edit Tests
# ============================================================================


class TestCustomEdit:
    """Tests for POST /api/edit/custom."""

    @pytest.mark.asyncio
    async def test_custom_edit_returns_sse_format(self, client: AsyncClient):
        """Should return Server-Sent Events format."""
        with patch("api.edit.LLMService") as MockLLM:
            mock_llm = MagicMock()

            async def mock_stream(*args, **kwargs):
                yield "Custom result"

            mock_llm.stream = mock_stream
            MockLLM.return_value = mock_llm

            response = await client.post(
                "/api/edit/custom", json={"text": "Original", "instruction": "Make it funny"}
            )

            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")

    @pytest.mark.asyncio
    async def test_custom_edit_passes_instruction(self, client: AsyncClient):
        """Should pass user instruction to LLM."""
        with patch("api.edit.LLMService") as MockLLM:
            mock_llm = MagicMock()
            captured_prompts = []

            async def mock_stream(user=None, **kwargs):
                captured_prompts.append(user)
                yield "Result"

            mock_llm.stream = mock_stream
            MockLLM.return_value = mock_llm

            await client.post(
                "/api/edit/custom", json={"text": "Original text", "instruction": "Add more emojis"}
            )

            assert len(captured_prompts) == 1
            assert "Add more emojis" in captured_prompts[0]
            assert "Original text" in captured_prompts[0]

    @pytest.mark.asyncio
    async def test_custom_edit_streams_response(self, client: AsyncClient):
        """Should stream text chunks."""
        with patch("api.edit.LLMService") as MockLLM:
            mock_llm = MagicMock()

            async def mock_stream(*args, **kwargs):
                yield "Part 1"
                yield " Part 2"

            mock_llm.stream = mock_stream
            MockLLM.return_value = mock_llm

            response = await client.post(
                "/api/edit/custom", json={"text": "Test", "instruction": "Edit this"}
            )

            assert response.status_code == 200
            content = response.text

            # Should have multiple data events
            lines = [line for line in content.strip().split("\n") if line.startswith("data: ")]
            text_events = []
            for line in lines:
                data = line[6:]
                if data != "[DONE]":
                    event = json.loads(data)
                    if "text" in event:
                        text_events.append(event["text"])

            assert len(text_events) >= 2

    @pytest.mark.asyncio
    async def test_custom_edit_includes_done_marker(self, client: AsyncClient):
        """Should include [DONE] marker."""
        with patch("api.edit.LLMService") as MockLLM:
            mock_llm = MagicMock()

            async def mock_stream(*args, **kwargs):
                yield "Result"

            mock_llm.stream = mock_stream
            MockLLM.return_value = mock_llm

            response = await client.post(
                "/api/edit/custom", json={"text": "Test", "instruction": "Edit"}
            )

            assert "data: [DONE]" in response.text

    @pytest.mark.asyncio
    async def test_custom_edit_handles_error(self, client: AsyncClient):
        """Should return error event on failure."""
        with patch("api.edit.LLMService") as MockLLM:
            mock_llm = MagicMock()

            async def mock_stream(*args, **kwargs):
                raise Exception("API error")
                yield

            mock_llm.stream = mock_stream
            MockLLM.return_value = mock_llm

            response = await client.post(
                "/api/edit/custom", json={"text": "Test", "instruction": "Edit"}
            )

            assert response.status_code == 200
            assert "error" in response.text.lower()

    @pytest.mark.asyncio
    async def test_custom_edit_uses_moderate_temperature(self, client: AsyncClient):
        """Should use moderate temperature for custom edits."""
        with patch("api.edit.LLMService") as MockLLM:
            mock_llm = MagicMock()
            captured_kwargs = []

            async def mock_stream(*args, **kwargs):
                captured_kwargs.append(kwargs)
                yield "Result"

            mock_llm.stream = mock_stream
            MockLLM.return_value = mock_llm

            await client.post(
                "/api/edit/custom", json={"text": "Test", "instruction": "Make creative"}
            )

            assert len(captured_kwargs) == 1
            assert captured_kwargs[0].get("temperature") == 0.5


# ============================================================================
# Request Validation Tests
# ============================================================================


class TestRequestValidation:
    """Tests for request validation."""

    @pytest.mark.asyncio
    async def test_custom_edit_requires_text(self, client: AsyncClient):
        """Should reject request without text."""
        response = await client.post("/api/edit/custom", json={"instruction": "Edit this"})

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_custom_edit_requires_instruction(self, client: AsyncClient):
        """Should reject request without instruction."""
        response = await client.post("/api/edit/custom", json={"text": "Test text"})

        assert response.status_code == 422


# ============================================================================
# Edit Prompts Tests
# ============================================================================


class TestEditPrompts:
    """Tests for EDIT_ACTIONS configuration (migrated from prompts module)."""

    def test_all_edit_actions_have_prompts(self):
        """Should have prompts for all expected actions."""
        from prompts.domains.edit import EDIT_ACTIONS

        expected_actions = [
            "fix-grammar",
            "improve",
            "simplify",
            "expand",
            "shorten",
            "translate-en",
            "translate-zh",
            "translate-es",
            "translate-fr",
            "translate-de",
            "translate-ja",
            "professional",
            "casual",
            "friendly",
            "confident",
        ]

        for action in expected_actions:
            assert action in EDIT_ACTIONS, f"Missing config for action: {action}"
            assert "instruction" in EDIT_ACTIONS[action], (
                f"Missing instruction for action: {action}"
            )
            assert len(EDIT_ACTIONS[action]["instruction"]) > 0, (
                f"Empty instruction for action: {action}"
            )

    def test_prompts_have_temperature(self):
        """Action configs should have temperature settings."""
        from prompts.domains.edit import EDIT_ACTIONS

        for action, config in EDIT_ACTIONS.items():
            assert "temperature" in config, f"Missing temperature for action: {action}"
            assert 0 <= config["temperature"] <= 1, f"Invalid temperature for action: {action}"
