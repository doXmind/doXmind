"""
Tests for LLM Service.
"""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.llm_service import LLMService

# =============================================================================
# Test Fixtures
# =============================================================================


class MockContentBlock:
    """Mock Anthropic ContentBlock."""

    def __init__(self, text: str):
        self.text = text
        self.type = "text"


class MockMessage:
    """Mock Anthropic Message response."""

    def __init__(self, text: str):
        self.content = [MockContentBlock(text)]
        self.model = "claude-3-5-sonnet-20241022"
        self.stop_reason = "end_turn"


class MockStreamManager:
    """Mock Anthropic stream context manager."""

    def __init__(self, texts: list[str]):
        self.texts = texts

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    @property
    def text_stream(self):
        return self._text_stream()

    async def _text_stream(self):
        for text in self.texts:
            yield text


@pytest.fixture
def mock_client():
    """Create a mock Anthropic client."""
    mock = MagicMock()
    mock.messages.create = AsyncMock(return_value=MockMessage("Test response"))
    mock.messages.stream = MagicMock(
        return_value=MockStreamManager(["Hello ", "World!"])
    )
    mock.beta.messages.create = AsyncMock(
        return_value=MockMessage('{"key": "value"}')
    )
    return mock


@pytest.fixture
def llm_service(mock_client):
    """Create LLMService with mocked client."""
    with patch("services.llm_service.AsyncAnthropic", return_value=mock_client):
        service = LLMService()
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
        with patch("services.llm_service.AsyncAnthropic") as mock_anthropic:
            service = LLMService()
            mock_anthropic.assert_called_once()
            assert service.model is not None

    def test_init_with_custom_model(self):
        """Test service can use custom model."""
        with patch("services.llm_service.AsyncAnthropic"):
            service = LLMService(model="claude-3-opus-20240229")
            assert service.model == "claude-3-opus-20240229"

    def test_init_without_api_key_raises(self):
        """Test service raises error when API key is missing."""
        with patch("services.llm_service.get_settings") as mock_settings:
            mock_settings.return_value.anthropic_api_key = None
            with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
                LLMService()


@pytest.mark.unit
class TestLLMServiceComplete:
    """Tests for complete() method."""

    @pytest.mark.asyncio
    async def test_complete_returns_text(self, llm_service, mock_client):
        """Test complete returns text response."""
        result = await llm_service.complete("Hello, AI!")

        assert result == "Test response"
        mock_client.messages.create.assert_called_once()

    @pytest.mark.asyncio
    async def test_complete_with_system_prompt(self, llm_service, mock_client):
        """Test complete passes system prompt."""
        await llm_service.complete("Hello", system="You are a poet.")

        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert call_kwargs["system"] == "You are a poet."

    @pytest.mark.asyncio
    async def test_complete_with_custom_temperature(self, llm_service, mock_client):
        """Test complete uses custom temperature."""
        await llm_service.complete("Hello", temperature=0.3)

        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert call_kwargs["temperature"] == 0.3

    @pytest.mark.asyncio
    async def test_complete_with_max_tokens(self, llm_service, mock_client):
        """Test complete uses custom max_tokens."""
        await llm_service.complete("Hello", max_tokens=500)

        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert call_kwargs["max_tokens"] == 500

    @pytest.mark.asyncio
    async def test_complete_with_stop_sequences(self, llm_service, mock_client):
        """Test complete passes stop sequences."""
        await llm_service.complete("Hello", stop=["STOP", "END"])

        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert call_kwargs["stop_sequences"] == ["STOP", "END"]

    @pytest.mark.asyncio
    async def test_complete_uses_default_system(self, llm_service, mock_client):
        """Test complete uses default system prompt when none provided."""
        await llm_service.complete("Hello")

        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert "writing assistant" in call_kwargs["system"].lower()

    @pytest.mark.asyncio
    async def test_complete_handles_api_error(self, llm_service, mock_client):
        """Test complete raises on API error."""
        mock_client.messages.create.side_effect = Exception("API Error")

        with pytest.raises(Exception, match="API Error"):
            await llm_service.complete("Hello")


@pytest.mark.unit
class TestLLMServiceStream:
    """Tests for stream() method."""

    @pytest.mark.asyncio
    async def test_stream_yields_text_chunks(self, llm_service, mock_client):
        """Test stream yields text chunks."""
        chunks = []
        async for chunk in llm_service.stream("Hello"):
            chunks.append(chunk)

        assert chunks == ["Hello ", "World!"]

    @pytest.mark.asyncio
    async def test_stream_with_system_prompt(self, llm_service, mock_client):
        """Test stream passes system prompt."""
        async for _ in llm_service.stream("Hello", system="Be brief"):
            pass

        call_kwargs = mock_client.messages.stream.call_args.kwargs
        assert call_kwargs["system"] == "Be brief"

    @pytest.mark.asyncio
    async def test_stream_with_custom_temperature(self, llm_service, mock_client):
        """Test stream uses custom temperature."""
        async for _ in llm_service.stream("Hello", temperature=0.9):
            pass

        call_kwargs = mock_client.messages.stream.call_args.kwargs
        assert call_kwargs["temperature"] == 0.9

    @pytest.mark.asyncio
    async def test_stream_handles_error(self, llm_service, mock_client):
        """Test stream raises on error."""

        class ErrorStream:
            async def __aenter__(self):
                raise Exception("Stream error")

            async def __aexit__(self, *args):
                pass

        mock_client.messages.stream.return_value = ErrorStream()

        with pytest.raises(Exception, match="Stream error"):
            async for _ in llm_service.stream("Hello"):
                pass


@pytest.mark.unit
class TestLLMServiceChat:
    """Tests for chat() method."""

    @pytest.mark.asyncio
    async def test_chat_yields_text_chunks(self, llm_service, mock_client):
        """Test chat yields text chunks."""
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
            {"role": "user", "content": "How are you?"},
        ]

        chunks = []
        async for chunk in llm_service.chat(messages):
            chunks.append(chunk)

        assert chunks == ["Hello ", "World!"]

    @pytest.mark.asyncio
    async def test_chat_passes_messages(self, llm_service, mock_client):
        """Test chat passes messages in correct format."""
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi!"},
        ]

        async for _ in llm_service.chat(messages):
            pass

        call_kwargs = mock_client.messages.stream.call_args.kwargs
        assert call_kwargs["messages"] == messages

    @pytest.mark.asyncio
    async def test_chat_with_system_prompt(self, llm_service, mock_client):
        """Test chat passes system prompt."""
        messages = [{"role": "user", "content": "Hello"}]

        async for _ in llm_service.chat(messages, system="Be helpful"):
            pass

        call_kwargs = mock_client.messages.stream.call_args.kwargs
        assert call_kwargs["system"] == "Be helpful"


@pytest.mark.unit
class TestLLMServiceJSONComplete:
    """Tests for json_complete() method."""

    @pytest.mark.asyncio
    async def test_json_complete_returns_dict(self, llm_service, mock_client):
        """Test json_complete returns parsed JSON."""
        schema = {
            "type": "object",
            "properties": {"key": {"type": "string"}},
        }

        result = await llm_service.json_complete("Get JSON", json_schema=schema)

        assert result == {"key": "value"}

    @pytest.mark.asyncio
    async def test_json_complete_passes_schema(self, llm_service, mock_client):
        """Test json_complete passes JSON schema."""
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}},
        }

        await llm_service.json_complete("Get JSON", json_schema=schema)

        call_kwargs = mock_client.beta.messages.create.call_args.kwargs
        assert call_kwargs["output_format"]["type"] == "json_schema"
        assert call_kwargs["output_format"]["schema"] == schema

    @pytest.mark.asyncio
    async def test_json_complete_uses_beta_api(self, llm_service, mock_client):
        """Test json_complete uses beta structured outputs."""
        schema = {"type": "object"}

        await llm_service.json_complete("Get JSON", json_schema=schema)

        call_kwargs = mock_client.beta.messages.create.call_args.kwargs
        assert "structured-outputs" in call_kwargs["betas"][0]

    @pytest.mark.asyncio
    async def test_json_complete_with_system_prompt(self, llm_service, mock_client):
        """Test json_complete passes system prompt."""
        schema = {"type": "object"}

        await llm_service.json_complete(
            "Get JSON", json_schema=schema, system="Return valid JSON"
        )

        call_kwargs = mock_client.beta.messages.create.call_args.kwargs
        assert call_kwargs["system"] == "Return valid JSON"

    @pytest.mark.asyncio
    async def test_json_complete_handles_invalid_json(self, llm_service, mock_client):
        """Test json_complete raises on invalid JSON response."""
        mock_client.beta.messages.create.return_value = MockMessage("not valid json")

        with pytest.raises((json.JSONDecodeError, ValueError)):
            await llm_service.json_complete(
                "Get JSON", json_schema={"type": "object"}
            )

    @pytest.mark.asyncio
    async def test_json_complete_handles_api_error(self, llm_service, mock_client):
        """Test json_complete raises on API error."""
        mock_client.beta.messages.create.side_effect = Exception("API Error")

        with pytest.raises(Exception, match="API Error"):
            await llm_service.json_complete(
                "Get JSON", json_schema={"type": "object"}
            )
