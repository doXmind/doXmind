"""Tests for Writing Agent.

These tests use mocks to avoid actual API calls to OpenRouter.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.writing_agent import WritingAgent

# ============================================================================
# Mock Helpers (OpenAI streaming format)
# ============================================================================


class MockToolCallDelta:
    """Mock OpenAI tool call delta."""

    def __init__(self, index: int, tool_id: str = None, name: str = None, arguments: str = None):
        self.index = index
        self.id = tool_id
        self.function = MagicMock()
        self.function.name = name
        self.function.arguments = arguments


class MockDelta:
    """Mock OpenAI delta object."""

    def __init__(self, content: str | None = None, tool_calls: list | None = None):
        self.content = content
        self.tool_calls = tool_calls


class MockChoice:
    """Mock OpenAI streaming choice."""

    def __init__(self, delta: MockDelta, finish_reason: str | None = None):
        self.delta = delta
        self.finish_reason = finish_reason


class MockStreamChunk:
    """Mock OpenAI streaming chunk."""

    def __init__(self, choices: list | None = None, usage=None):
        self.choices = choices or []
        self.usage = usage


class MockAsyncStream:
    """Mock async iterator for OpenAI streaming."""

    def __init__(self, chunks: list):
        self.chunks = chunks

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.chunks:
            raise StopAsyncIteration
        return self.chunks.pop(0)


def create_text_stream_chunks(text: str) -> list:
    """Create OpenAI stream chunks for a simple text response."""
    return [
        MockStreamChunk(choices=[MockChoice(delta=MockDelta(content=text))]),
        MockStreamChunk(choices=[MockChoice(delta=MockDelta(), finish_reason="stop")]),
    ]


def create_tool_use_chunks(tool_name: str, tool_id: str, tool_input: dict) -> list:
    """Create OpenAI stream chunks for a tool use."""
    input_json = json.dumps(tool_input)
    return [
        # First chunk: tool call start with id and name
        MockStreamChunk(
            choices=[
                MockChoice(
                    delta=MockDelta(
                        tool_calls=[
                            MockToolCallDelta(
                                index=0, tool_id=tool_id, name=tool_name, arguments=""
                            )
                        ]
                    )
                )
            ]
        ),
        # Second chunk: arguments
        MockStreamChunk(
            choices=[
                MockChoice(
                    delta=MockDelta(tool_calls=[MockToolCallDelta(index=0, arguments=input_json)])
                )
            ]
        ),
        # Finish
        MockStreamChunk(choices=[MockChoice(delta=MockDelta(), finish_reason="stop")]),
    ]


# ============================================================================
# WritingAgent Initialization Tests
# ============================================================================


class TestWritingAgentInit:
    """Tests for WritingAgent initialization."""

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    def test_init_with_default_mode(self, mock_openai, mock_settings):
        """Should initialize with default edit mode."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )

        agent = WritingAgent()

        assert agent.mode == "edit"
        assert agent.kb_attachments == []

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    def test_init_with_analyze_mode(self, mock_openai, mock_settings):
        """Should initialize with analyze mode."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )

        agent = WritingAgent(mode="analyze")

        assert agent.mode == "analyze"

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    def test_init_with_kb_attachments(self, mock_openai, mock_settings):
        """Should store KB attachments."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )
        attachments = [{"id": "att-1", "name": "doc.pdf"}]

        agent = WritingAgent(kb_attachments=attachments)

        assert agent.kb_attachments == attachments

    def test_init_without_api_key_raises(self):
        """Should raise when no key is available anywhere."""
        with patch("agents.writing_agent.get_settings") as mock_settings, patch(
            "services.local_config.get_openrouter_key", return_value=""
        ):
            mock_settings.return_value = MagicMock(
                openrouter_api_key="",
                default_model="google/gemini-3.1-flash-lite-preview",
                openrouter_base_url="https://openrouter.ai/api/v1",
                openrouter_headers={},
                max_output_tokens=8192,
            )
            with pytest.raises(ValueError, match="OpenRouter"):
                WritingAgent()


# ============================================================================
# Message Building Tests
# ============================================================================


class TestMessageBuilding:
    """Tests for message building methods."""

    @pytest.mark.asyncio
    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    async def test_build_messages_simple(self, mock_openai, mock_settings):
        """Should build simple text messages."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )
        agent = WritingAgent()

        messages = await agent._build_messages("Hello")

        assert len(messages) == 1
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == "Hello"

    @pytest.mark.asyncio
    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    async def test_build_messages_with_history(self, mock_openai, mock_settings):
        """Should include history in messages."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )
        agent = WritingAgent()
        history = [
            {"role": "user", "content": "Previous question"},
            {"role": "assistant", "content": "Previous answer"},
        ]

        messages = await agent._build_messages("New question", history=history)

        assert len(messages) == 3
        assert messages[0]["content"] == "Previous question"
        assert messages[1]["content"] == "Previous answer"
        assert messages[2]["content"] == "New question"

    @pytest.mark.asyncio
    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    async def test_build_messages_with_images(self, mock_openai, mock_settings):
        """Should build multimodal messages with images."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )
        agent = WritingAgent()
        images = [{"base64": "iVBORw0KGgo=", "mediaType": "image/png"}]

        messages = await agent._build_messages("Describe this image", images=images)

        assert len(messages) == 1
        assert isinstance(messages[0]["content"], list)
        # First should be image_url, last should be text
        assert messages[0]["content"][0]["type"] == "image_url"
        assert messages[0]["content"][-1]["type"] == "text"

    @pytest.mark.asyncio
    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    async def test_build_multimodal_content_multiple_images(self, mock_openai, mock_settings):
        """Should add labels for multiple images."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )
        agent = WritingAgent()
        images = [
            {"base64": "abc", "mediaType": "image/png", "alt": "First"},
            {"base64": "def", "mediaType": "image/png", "alt": "Second"},
        ]

        content = await agent._build_multimodal_content("Compare these", images)

        # Should have: image1, label1, image2, label2, text
        assert len(content) == 5
        assert content[1]["type"] == "text"
        assert "Image 1" in content[1]["text"]
        assert content[3]["type"] == "text"
        assert "Image 2" in content[3]["text"]


# ============================================================================
# KB Context Tests
# ============================================================================


class TestKBContext:
    """Tests for KB context building."""

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    def test_build_kb_context_returns_none_without_attachments(self, mock_openai, mock_settings):
        """Should return None when no attachments."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )
        agent = WritingAgent()

        context = agent._build_kb_context("conv-123")

        assert context is None

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    def test_build_kb_context_returns_none_without_conversation_id(
        self, mock_openai, mock_settings
    ):
        """Should return None when no conversation ID."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )
        agent = WritingAgent(kb_attachments=[{"id": "att-1"}])

        context = agent._build_kb_context(None)

        assert context is None

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    def test_build_kb_context_returns_context(self, mock_openai, mock_settings):
        """Should return context when both attachments and conversation ID present."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )
        attachments = [{"id": "att-1", "name": "doc.pdf"}]
        agent = WritingAgent(kb_attachments=attachments)

        context = agent._build_kb_context("conv-123")

        assert context is not None
        assert context["conversation_id"] == "conv-123"
        assert context["attachments"] == attachments


# ============================================================================
# Streaming Tests
# ============================================================================


class TestStreaming:
    """Tests for streaming functionality."""

    @pytest.mark.asyncio
    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    async def test_stream_yields_text_events(self, mock_openai, mock_settings):
        """Should yield text events from stream."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )

        # Create mock stream with OpenAI format
        chunks = create_text_stream_chunks("Hello, world!")
        mock_stream = MockAsyncStream(chunks)
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream)
        mock_openai.return_value = mock_client

        agent = WritingAgent()
        files = [{"id": "file-1", "name": "doc.md", "content": "Test content"}]

        collected_events = []
        async for event in agent.stream("Test message", files):
            collected_events.append(event)

        # Should have text event
        text_events = [e for e in collected_events if e.get("type") == "text"]
        assert len(text_events) > 0
        assert text_events[0]["content"] == "Hello, world!"

    @pytest.mark.asyncio
    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    async def test_stream_handles_error(self, mock_openai, mock_settings):
        """Should yield error event on exception."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("API error"))
        mock_openai.return_value = mock_client

        agent = WritingAgent()
        files = [{"id": "file-1", "name": "doc.md", "content": "Test"}]

        collected_events = []
        async for event in agent.stream("Test", files):
            collected_events.append(event)

        # Should have error event
        error_events = [e for e in collected_events if e.get("type") == "error"]
        assert len(error_events) == 1
        assert "API error" in error_events[0]["content"]

    @pytest.mark.asyncio
    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    async def test_stream_marks_first_file_as_current(self, mock_openai, mock_settings):
        """Should mark first file as current."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )

        chunks = create_text_stream_chunks("Done")
        mock_stream = MockAsyncStream(chunks)
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream)
        mock_openai.return_value = mock_client

        agent = WritingAgent()
        files = [
            {"id": "file-1", "name": "doc1.md", "content": "Content 1"},
            {"id": "file-2", "name": "doc2.md", "content": "Content 2"},
        ]

        async for _ in agent.stream("Test", files):
            pass

        # First file should be marked as current
        assert files[0].get("is_current") is True


# ============================================================================
# Run Method Tests
# ============================================================================


class TestRunMethod:
    """Tests for the run convenience method."""

    @pytest.mark.asyncio
    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncOpenAI")
    async def test_run_collects_response_and_edits(self, mock_openai, mock_settings):
        """Should collect full response and edits."""
        mock_settings.return_value = MagicMock(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.ai/api/v1",
            default_model="minimax/minimax-m2.5",
            max_output_tokens=4096,
        )

        # Mock stream to yield text events
        chunks = create_text_stream_chunks("Hello world!")
        mock_stream = MockAsyncStream(chunks)
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream)
        mock_openai.return_value = mock_client

        agent = WritingAgent()
        files = [{"id": "file-1", "name": "doc.md", "content": "Test"}]

        result = await agent.run("Test", files)

        assert "response" in result
        assert "edits" in result
        assert "Hello " in result["response"]
