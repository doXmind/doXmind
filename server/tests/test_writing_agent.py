"""Tests for Writing Agent.

These tests use mocks to avoid actual API calls to Anthropic.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from agents.writing_agent import WritingAgent

# ============================================================================
# Mock Helpers
# ============================================================================


class MockContentBlock:
    """Mock content block for streaming."""

    def __init__(self, block_type: str, **kwargs):
        self.type = block_type
        for key, value in kwargs.items():
            setattr(self, key, value)


class MockDelta:
    """Mock delta for streaming."""

    def __init__(self, delta_type: str, **kwargs):
        self.type = delta_type
        for key, value in kwargs.items():
            setattr(self, key, value)


class MockStreamEvent:
    """Mock stream event."""

    def __init__(self, event_type: str, **kwargs):
        self.type = event_type
        for key, value in kwargs.items():
            setattr(self, key, value)


class MockStreamContext:
    """Mock async stream context manager."""

    def __init__(self, events: list):
        self.events = events

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.events:
            raise StopAsyncIteration
        return self.events.pop(0)


def create_text_stream_events(text: str) -> list:
    """Create stream events for a simple text response."""
    return [
        MockStreamEvent(
            "content_block_start",
            content_block=MockContentBlock("text")
        ),
        MockStreamEvent(
            "content_block_delta",
            delta=MockDelta("text_delta", text=text)
        ),
        MockStreamEvent("content_block_stop"),
    ]


def create_tool_use_events(tool_name: str, tool_id: str, tool_input: dict) -> list:
    """Create stream events for a tool use."""
    input_json = json.dumps(tool_input)
    return [
        MockStreamEvent(
            "content_block_start",
            content_block=MockContentBlock("tool_use", id=tool_id, name=tool_name)
        ),
        MockStreamEvent(
            "content_block_delta",
            delta=MockDelta("input_json_delta", partial_json=input_json)
        ),
        MockStreamEvent("content_block_stop"),
    ]


def create_thinking_events(thinking_text: str) -> list:
    """Create stream events for thinking content."""
    return [
        MockStreamEvent(
            "content_block_start",
            content_block=MockContentBlock("thinking")
        ),
        MockStreamEvent(
            "content_block_delta",
            delta=MockDelta("thinking_delta", thinking=thinking_text)
        ),
        MockStreamEvent("content_block_stop"),
    ]


# ============================================================================
# WritingAgent Initialization Tests
# ============================================================================


class TestWritingAgentInit:
    """Tests for WritingAgent initialization."""

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncAnthropic")
    def test_init_with_default_mode(self, mock_anthropic, mock_settings):
        """Should initialize with default edit mode."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )

        agent = WritingAgent()

        assert agent.mode == "edit"
        assert agent.enable_thinking is False
        assert agent.kb_attachments == []

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncAnthropic")
    def test_init_with_analyze_mode(self, mock_anthropic, mock_settings):
        """Should initialize with analyze mode."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )

        agent = WritingAgent(mode="analyze")

        assert agent.mode == "analyze"

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncAnthropic")
    def test_init_with_thinking_enabled(self, mock_anthropic, mock_settings):
        """Should enable thinking when specified."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )

        agent = WritingAgent(enable_thinking=True)

        assert agent.enable_thinking is True

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncAnthropic")
    def test_init_with_kb_attachments(self, mock_anthropic, mock_settings):
        """Should store KB attachments."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )
        attachments = [{"id": "att-1", "name": "doc.pdf"}]

        agent = WritingAgent(kb_attachments=attachments)

        assert agent.kb_attachments == attachments

    @patch("agents.writing_agent.get_settings")
    def test_init_without_api_key_raises(self, mock_settings):
        """Should raise error when API key is missing."""
        mock_settings.return_value = MagicMock(anthropic_api_key=None)

        with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
            WritingAgent()


# ============================================================================
# Message Building Tests
# ============================================================================


class TestMessageBuilding:
    """Tests for message building methods."""

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncAnthropic")
    def test_build_messages_simple(self, mock_anthropic, mock_settings):
        """Should build simple text messages."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )
        agent = WritingAgent()

        messages = agent._build_messages("Hello")

        assert len(messages) == 1
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == "Hello"

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncAnthropic")
    def test_build_messages_with_history(self, mock_anthropic, mock_settings):
        """Should include history in messages."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )
        agent = WritingAgent()
        history = [
            {"role": "user", "content": "Previous question"},
            {"role": "assistant", "content": "Previous answer"}
        ]

        messages = agent._build_messages("New question", history=history)

        assert len(messages) == 3
        assert messages[0]["content"] == "Previous question"
        assert messages[1]["content"] == "Previous answer"
        assert messages[2]["content"] == "New question"

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncAnthropic")
    def test_build_messages_with_images(self, mock_anthropic, mock_settings):
        """Should build multimodal messages with images."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )
        agent = WritingAgent()
        images = [{
            "base64": "iVBORw0KGgo=",
            "mediaType": "image/png"
        }]

        messages = agent._build_messages("Describe this image", images=images)

        assert len(messages) == 1
        assert isinstance(messages[0]["content"], list)
        # First should be image, last should be text
        assert messages[0]["content"][0]["type"] == "image"
        assert messages[0]["content"][-1]["type"] == "text"

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncAnthropic")
    def test_build_multimodal_content_multiple_images(
        self, mock_anthropic, mock_settings
    ):
        """Should add labels for multiple images."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )
        agent = WritingAgent()
        images = [
            {"base64": "abc", "mediaType": "image/png", "alt": "First"},
            {"base64": "def", "mediaType": "image/png", "alt": "Second"},
        ]

        content = agent._build_multimodal_content("Compare these", images)

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
    @patch("agents.writing_agent.AsyncAnthropic")
    def test_build_kb_context_returns_none_without_attachments(
        self, mock_anthropic, mock_settings
    ):
        """Should return None when no attachments."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )
        agent = WritingAgent()

        context = agent._build_kb_context("conv-123")

        assert context is None

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncAnthropic")
    def test_build_kb_context_returns_none_without_conversation_id(
        self, mock_anthropic, mock_settings
    ):
        """Should return None when no conversation ID."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )
        agent = WritingAgent(kb_attachments=[{"id": "att-1"}])

        context = agent._build_kb_context(None)

        assert context is None

    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncAnthropic")
    def test_build_kb_context_returns_context(self, mock_anthropic, mock_settings):
        """Should return context when both attachments and conversation ID present."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
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
    @patch("agents.writing_agent.AsyncAnthropic")
    async def test_stream_yields_text_events(self, mock_anthropic, mock_settings):
        """Should yield text events from stream."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )

        # Create mock stream
        events = create_text_stream_events("Hello, world!")
        mock_stream = MockStreamContext(events)
        mock_client = MagicMock()
        mock_client.messages.stream.return_value = mock_stream
        mock_anthropic.return_value = mock_client

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
    @patch("agents.writing_agent.AsyncAnthropic")
    async def test_stream_yields_thinking_events(self, mock_anthropic, mock_settings):
        """Should yield thinking events when enabled."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )

        # Create thinking + text events
        events = create_thinking_events("Let me think...") + create_text_stream_events("Answer")
        mock_stream = MockStreamContext(events)
        mock_client = MagicMock()
        mock_client.messages.stream.return_value = mock_stream
        mock_anthropic.return_value = mock_client

        agent = WritingAgent(enable_thinking=True)
        files = [{"id": "file-1", "name": "doc.md", "content": "Test"}]

        collected_events = []
        async for event in agent.stream("Test", files):
            collected_events.append(event)

        # Should have thinking events
        thinking_events = [e for e in collected_events if e.get("type") == "thinking"]
        assert len(thinking_events) > 0

    @pytest.mark.asyncio
    @patch("agents.writing_agent.get_settings")
    @patch("agents.writing_agent.AsyncAnthropic")
    async def test_stream_handles_error(self, mock_anthropic, mock_settings):
        """Should yield error event on exception."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )

        mock_client = MagicMock()
        mock_client.messages.stream.side_effect = Exception("API error")
        mock_anthropic.return_value = mock_client

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
    @patch("agents.writing_agent.AsyncAnthropic")
    async def test_stream_marks_first_file_as_current(
        self, mock_anthropic, mock_settings
    ):
        """Should mark first file as current."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )

        events = create_text_stream_events("Done")
        mock_stream = MockStreamContext(events)
        mock_client = MagicMock()
        mock_client.messages.stream.return_value = mock_stream
        mock_anthropic.return_value = mock_client

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
    @patch("agents.writing_agent.AsyncAnthropic")
    async def test_run_collects_response_and_edits(
        self, mock_anthropic, mock_settings
    ):
        """Should collect full response and edits."""
        mock_settings.return_value = MagicMock(
            anthropic_api_key="test-key",
            default_model="claude-3-5-sonnet-20241022",
            max_output_tokens=4096
        )

        # Mock stream to yield text events
        events = create_text_stream_events("Hello ") + create_text_stream_events("world!")
        mock_stream = MockStreamContext(events)
        mock_client = MagicMock()
        mock_client.messages.stream.return_value = mock_stream
        mock_anthropic.return_value = mock_client

        agent = WritingAgent()
        files = [{"id": "file-1", "name": "doc.md", "content": "Test"}]

        result = await agent.run("Test", files)

        assert "response" in result
        assert "edits" in result
        assert "Hello " in result["response"]
