"""
Tests for LLM Service (OpenAI SDK via OpenRouter).
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.llm_service import LLMService

# =============================================================================
# Test Fixtures
# =============================================================================


class MockChoice:
    """Mock OpenAI Choice object."""

    def __init__(self, text: str):
        self.message = MagicMock(content=text)
        self.finish_reason = "stop"


class MockChatCompletion:
    """Mock OpenAI ChatCompletion response."""

    def __init__(self, text: str):
        self.choices = [MockChoice(text)]
        self.model = "minimax/minimax-m2.5"
        self.usage = MagicMock(prompt_tokens=10, completion_tokens=20)


class MockStreamChunk:
    """Mock OpenAI streaming chunk."""

    def __init__(self, content: str | None = None, finish_reason: str | None = None):
        delta = MagicMock()
        delta.content = content
        choice = MagicMock()
        choice.delta = delta
        choice.finish_reason = finish_reason
        self.choices = [choice]
        self.usage = None


class MockAsyncStream:
    """Mock async iterator for streaming."""

    def __init__(self, chunks: list):
        self.chunks = chunks

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.chunks:
            raise StopAsyncIteration
        return self.chunks.pop(0)


@pytest.fixture
def mock_client():
    """Create a mock OpenAI client."""
    mock = MagicMock()
    mock.chat.completions.create = AsyncMock(return_value=MockChatCompletion("Test response"))
    return mock


@pytest.fixture
def llm_service(mock_client):
    """Create LLMService with mocked client."""
    with patch("services.llm_service.AsyncOpenAI", return_value=mock_client):
        service = LLMService(api_key="test-key")
        service.client = mock_client
        return service


# =============================================================================
# LLMService Tests
# =============================================================================


@pytest.mark.unit
class TestLLMServiceInit:
    """Tests for LLMService initialization."""

    def test_init_with_api_key(self):
        """Test service initializes with API key from environment."""
        with patch("services.llm_service.AsyncOpenAI") as mock_openai:
            service = LLMService(api_key="test-key")
            mock_openai.assert_called_once()
            assert service.model is not None

    def test_init_with_custom_model(self):
        """Test service can use custom model."""
        with patch("services.llm_service.AsyncOpenAI"):
            service = LLMService(model="minimax/minimax-m2.5", api_key="test-key")
            assert service.model == "minimax/minimax-m2.5"

    def test_init_without_api_key_raises(self):
        """Without any key in env or local config, init must raise."""
        with patch("services.llm_service.get_settings") as mock_settings, patch(
            "services.local_config.get_openrouter_key", return_value=""
        ):
            mock_settings.return_value.openrouter_api_key = ""
            with pytest.raises(ValueError, match="OpenRouter"):
                LLMService()


@pytest.mark.unit
class TestLLMServiceComplete:
    """Tests for complete() method."""

    @pytest.mark.asyncio
    async def test_complete_returns_text(self, llm_service, mock_client):
        """Test complete returns text response."""
        result = await llm_service.complete("Hello, AI!")

        assert result == "Test response"
        mock_client.chat.completions.create.assert_called_once()

    @pytest.mark.asyncio
    async def test_complete_with_system_prompt(self, llm_service, mock_client):
        """Test complete passes system prompt as first message."""
        await llm_service.complete("Hello", system="You are a poet.")

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        messages = call_kwargs["messages"]
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == "You are a poet."

    @pytest.mark.asyncio
    async def test_complete_with_custom_temperature(self, llm_service, mock_client):
        """Test complete uses custom temperature."""
        await llm_service.complete("Hello", temperature=0.3)

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["temperature"] == 0.3

    @pytest.mark.asyncio
    async def test_complete_with_max_tokens(self, llm_service, mock_client):
        """Test complete uses custom max_tokens."""
        await llm_service.complete("Hello", max_tokens=500)

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["max_tokens"] == 500

    @pytest.mark.asyncio
    async def test_complete_with_stop_sequences(self, llm_service, mock_client):
        """Test complete passes stop sequences."""
        await llm_service.complete("Hello", stop=["STOP", "END"])

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["stop"] == ["STOP", "END"]

    @pytest.mark.asyncio
    async def test_complete_uses_default_system(self, llm_service, mock_client):
        """Test complete uses default system prompt when none provided."""
        await llm_service.complete("Hello")

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        messages = call_kwargs["messages"]
        assert messages[0]["role"] == "system"
        assert "writing assistant" in messages[0]["content"].lower()

    @pytest.mark.asyncio
    async def test_complete_handles_api_error(self, llm_service, mock_client):
        """Test complete raises on API error."""
        mock_client.chat.completions.create.side_effect = Exception("API Error")

        with pytest.raises(Exception, match="API Error"):
            await llm_service.complete("Hello")


@pytest.mark.unit
class TestLLMServiceStream:
    """Tests for stream() method."""

    @pytest.mark.asyncio
    async def test_stream_yields_text_chunks(self, llm_service, mock_client):
        """Test stream yields text chunks."""
        chunks = [
            MockStreamChunk(content="Hello "),
            MockStreamChunk(content="World!"),
            MockStreamChunk(content=None, finish_reason="stop"),
        ]
        mock_client.chat.completions.create = AsyncMock(return_value=MockAsyncStream(chunks))

        collected = []
        async for chunk in llm_service.stream("Hello"):
            collected.append(chunk)

        assert collected == ["Hello ", "World!"]

    @pytest.mark.asyncio
    async def test_stream_with_system_prompt(self, llm_service, mock_client):
        """Test stream passes system prompt as first message."""
        chunks = [MockStreamChunk(content="Hi", finish_reason="stop")]
        mock_client.chat.completions.create = AsyncMock(return_value=MockAsyncStream(chunks))

        async for _ in llm_service.stream("Hello", system="Be brief"):
            pass

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        messages = call_kwargs["messages"]
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == "Be brief"

    @pytest.mark.asyncio
    async def test_stream_with_custom_temperature(self, llm_service, mock_client):
        """Test stream uses custom temperature."""
        chunks = [MockStreamChunk(content="Hi", finish_reason="stop")]
        mock_client.chat.completions.create = AsyncMock(return_value=MockAsyncStream(chunks))

        async for _ in llm_service.stream("Hello", temperature=0.9):
            pass

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["temperature"] == 0.9

    @pytest.mark.asyncio
    async def test_stream_handles_error(self, llm_service, mock_client):
        """Test stream raises on error."""
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("Stream error"))

        with pytest.raises(Exception, match="Stream error"):
            async for _ in llm_service.stream("Hello"):
                pass


@pytest.mark.unit
class TestLLMServiceChat:
    """Tests for chat() method."""

    @pytest.mark.asyncio
    async def test_chat_yields_text_chunks(self, llm_service, mock_client):
        """Test chat yields text chunks."""
        chunks = [
            MockStreamChunk(content="Hello "),
            MockStreamChunk(content="World!"),
            MockStreamChunk(content=None, finish_reason="stop"),
        ]
        mock_client.chat.completions.create = AsyncMock(return_value=MockAsyncStream(chunks))

        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
            {"role": "user", "content": "How are you?"},
        ]

        collected = []
        async for chunk in llm_service.chat(messages):
            collected.append(chunk)

        assert collected == ["Hello ", "World!"]

    @pytest.mark.asyncio
    async def test_chat_passes_messages(self, llm_service, mock_client):
        """Test chat passes messages in correct format."""
        chunks = [MockStreamChunk(content="Hi", finish_reason="stop")]
        mock_client.chat.completions.create = AsyncMock(return_value=MockAsyncStream(chunks))

        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi!"},
        ]

        async for _ in llm_service.chat(messages):
            pass

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        api_messages = call_kwargs["messages"]
        # First message should be system, then the user messages
        assert api_messages[0]["role"] == "system"
        assert api_messages[1] == {"role": "user", "content": "Hello"}
        assert api_messages[2] == {"role": "assistant", "content": "Hi!"}

    @pytest.mark.asyncio
    async def test_chat_with_system_prompt(self, llm_service, mock_client):
        """Test chat passes system prompt."""
        chunks = [MockStreamChunk(content="Hi", finish_reason="stop")]
        mock_client.chat.completions.create = AsyncMock(return_value=MockAsyncStream(chunks))

        messages = [{"role": "user", "content": "Hello"}]

        async for _ in llm_service.chat(messages, system="Be helpful"):
            pass

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        api_messages = call_kwargs["messages"]
        assert api_messages[0]["role"] == "system"
        assert api_messages[0]["content"] == "Be helpful"


@pytest.mark.unit
class TestLLMServiceJSONComplete:
    """Tests for json_complete() method."""

    @pytest.mark.asyncio
    async def test_json_complete_returns_dict(self, llm_service, mock_client):
        """Test json_complete returns parsed JSON."""
        mock_client.chat.completions.create = AsyncMock(
            return_value=MockChatCompletion('{"key": "value"}')
        )
        schema = {
            "type": "object",
            "properties": {"key": {"type": "string"}},
        }

        result = await llm_service.json_complete("Get JSON", json_schema=schema)

        assert result == {"key": "value"}

    @pytest.mark.asyncio
    async def test_json_complete_uses_standard_api(self, llm_service, mock_client):
        """Test json_complete uses strict json_schema response format."""
        mock_client.chat.completions.create = AsyncMock(
            return_value=MockChatCompletion('{"key": "value"}')
        )
        schema = {"type": "object"}

        await llm_service.json_complete("Get JSON", json_schema=schema)

        mock_client.chat.completions.create.assert_called_once()
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert kwargs["response_format"]["type"] == "json_schema"
        assert kwargs["response_format"]["json_schema"]["strict"] is True
        assert kwargs["response_format"]["json_schema"]["schema"] == schema

    @pytest.mark.asyncio
    async def test_json_complete_handles_invalid_json(self, llm_service, mock_client):
        """Test json_complete raises on invalid JSON response."""
        mock_client.chat.completions.create = AsyncMock(
            return_value=MockChatCompletion("not valid json")
        )

        with pytest.raises((json.JSONDecodeError, ValueError)):
            await llm_service.json_complete("Get JSON", json_schema={"type": "object"})

    @pytest.mark.asyncio
    async def test_json_complete_handles_api_error(self, llm_service, mock_client):
        """Test json_complete raises on API error."""
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("API Error"))

        with pytest.raises(Exception, match="API Error"):
            await llm_service.json_complete("Get JSON", json_schema={"type": "object"})
