"""Tests for LLMService (multi-provider role-based resolution)."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.llm_service import LLMService

# =============================================================================
# Test Fixtures
# =============================================================================


class MockChoice:
    def __init__(self, text: str):
        self.message = MagicMock(content=text)
        self.finish_reason = "stop"


class MockChatCompletion:
    def __init__(self, text: str):
        self.choices = [MockChoice(text)]
        self.model = "gpt-5.1"
        self.usage = MagicMock(prompt_tokens=10, completion_tokens=20)


class MockStreamChunk:
    def __init__(self, content: str | None = None, finish_reason: str | None = None):
        delta = MagicMock()
        delta.content = content
        choice = MagicMock()
        choice.delta = delta
        choice.finish_reason = finish_reason
        self.choices = [choice]
        self.usage = None


class MockAsyncStream:
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
    mock = MagicMock()
    mock.chat.completions.create = AsyncMock(return_value=MockChatCompletion("Test response"))
    return mock


def _patch_provider(mock_client, provider_id="openai", model="gpt-5.1"):
    """Patch the provider resolution helpers used by LLMService."""
    return (
        patch("services.llm_service.active_provider_id", return_value=provider_id),
        patch("services.llm_service.provider_api_key", return_value="sk-stored"),
        patch("services.llm_service.role_model", return_value=model),
        patch("services.llm_service.build_client", return_value=mock_client),
    )


@pytest.fixture
def llm_service(mock_client):
    patches = _patch_provider(mock_client)
    for p in patches:
        p.start()
    try:
        service = LLMService(api_key="test-key")
        service.client = mock_client
        yield service
    finally:
        for p in patches:
            p.stop()


# =============================================================================
# Init tests
# =============================================================================


@pytest.mark.unit
class TestLLMServiceInit:
    def test_init_with_api_key(self, mock_client):
        patches = _patch_provider(mock_client)
        for p in patches:
            p.start()
        try:
            service = LLMService(api_key="test-key")
            assert service.model == "gpt-5.1"
            assert service.provider_id == "openai"
        finally:
            for p in patches:
                p.stop()

    def test_init_with_custom_model(self, mock_client):
        patches = _patch_provider(mock_client)
        for p in patches:
            p.start()
        try:
            service = LLMService(model="gpt-5-mini", api_key="test-key")
            assert service.model == "gpt-5-mini"
        finally:
            for p in patches:
                p.stop()

    def test_init_without_provider_raises(self):
        with patch("services.llm_service.active_provider_id", return_value=None):
            with pytest.raises(ValueError, match="No LLM provider configured"):
                LLMService()


# =============================================================================
# complete() tests
# =============================================================================


@pytest.mark.unit
class TestLLMServiceComplete:
    @pytest.mark.asyncio
    async def test_complete_returns_text(self, llm_service, mock_client):
        result = await llm_service.complete("Hello, AI!")
        assert result == "Test response"
        mock_client.chat.completions.create.assert_called_once()

    @pytest.mark.asyncio
    async def test_complete_with_system_prompt(self, llm_service, mock_client):
        await llm_service.complete("Hello", system="You are a poet.")
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert kwargs["messages"][0]["role"] == "system"
        assert kwargs["messages"][0]["content"] == "You are a poet."

    @pytest.mark.asyncio
    async def test_complete_with_custom_temperature(self, llm_service, mock_client):
        await llm_service.complete("Hello", temperature=0.3)
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert kwargs["temperature"] == 0.3

    @pytest.mark.asyncio
    async def test_complete_with_max_tokens(self, llm_service, mock_client):
        await llm_service.complete("Hello", max_tokens=500)
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert kwargs["max_tokens"] == 500

    @pytest.mark.asyncio
    async def test_complete_with_stop_sequences(self, llm_service, mock_client):
        await llm_service.complete("Hello", stop=["STOP", "END"])
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert kwargs["stop"] == ["STOP", "END"]

    @pytest.mark.asyncio
    async def test_complete_uses_default_system(self, llm_service, mock_client):
        await llm_service.complete("Hello")
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert kwargs["messages"][0]["role"] == "system"
        assert "writing assistant" in kwargs["messages"][0]["content"].lower()

    @pytest.mark.asyncio
    async def test_complete_handles_api_error(self, llm_service, mock_client):
        mock_client.chat.completions.create.side_effect = Exception("API Error")
        with pytest.raises(Exception, match="API Error"):
            await llm_service.complete("Hello")


# =============================================================================
# stream() tests
# =============================================================================


@pytest.mark.unit
class TestLLMServiceStream:
    @pytest.mark.asyncio
    async def test_stream_yields_text_chunks(self, llm_service, mock_client):
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
        chunks = [MockStreamChunk(content="Hi", finish_reason="stop")]
        mock_client.chat.completions.create = AsyncMock(return_value=MockAsyncStream(chunks))
        async for _ in llm_service.stream("Hello", system="Be brief"):
            pass
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert kwargs["messages"][0]["content"] == "Be brief"

    @pytest.mark.asyncio
    async def test_stream_with_custom_temperature(self, llm_service, mock_client):
        chunks = [MockStreamChunk(content="Hi", finish_reason="stop")]
        mock_client.chat.completions.create = AsyncMock(return_value=MockAsyncStream(chunks))
        async for _ in llm_service.stream("Hello", temperature=0.9):
            pass
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert kwargs["temperature"] == 0.9

    @pytest.mark.asyncio
    async def test_stream_handles_error(self, llm_service, mock_client):
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("Stream error"))
        with pytest.raises(Exception, match="Stream error"):
            async for _ in llm_service.stream("Hello"):
                pass


# =============================================================================
# chat() tests
# =============================================================================


@pytest.mark.unit
class TestLLMServiceChat:
    @pytest.mark.asyncio
    async def test_chat_yields_text_chunks(self, llm_service, mock_client):
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
        chunks = [MockStreamChunk(content="Hi", finish_reason="stop")]
        mock_client.chat.completions.create = AsyncMock(return_value=MockAsyncStream(chunks))
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi!"},
        ]
        async for _ in llm_service.chat(messages):
            pass
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        api_messages = kwargs["messages"]
        assert api_messages[0]["role"] == "system"
        assert api_messages[1] == {"role": "user", "content": "Hello"}
        assert api_messages[2] == {"role": "assistant", "content": "Hi!"}

    @pytest.mark.asyncio
    async def test_chat_with_system_prompt(self, llm_service, mock_client):
        chunks = [MockStreamChunk(content="Hi", finish_reason="stop")]
        mock_client.chat.completions.create = AsyncMock(return_value=MockAsyncStream(chunks))
        messages = [{"role": "user", "content": "Hello"}]
        async for _ in llm_service.chat(messages, system="Be helpful"):
            pass
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert kwargs["messages"][0]["content"] == "Be helpful"


# =============================================================================
# json_complete() tests
# =============================================================================


@pytest.mark.unit
class TestLLMServiceJSONComplete:
    @pytest.mark.asyncio
    async def test_json_complete_returns_dict(self, llm_service, mock_client):
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
        mock_client.chat.completions.create = AsyncMock(
            return_value=MockChatCompletion("not valid json")
        )
        with pytest.raises((json.JSONDecodeError, ValueError)):
            await llm_service.json_complete("Get JSON", json_schema={"type": "object"})

    @pytest.mark.asyncio
    async def test_json_complete_handles_api_error(self, llm_service, mock_client):
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("API Error"))
        with pytest.raises(Exception, match="API Error"):
            await llm_service.json_complete("Get JSON", json_schema={"type": "object"})
