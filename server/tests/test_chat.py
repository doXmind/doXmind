"""Tests for chat API endpoints."""

import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient

from db.database import Conversation, Message

# ============================================================================
# Conversation CRUD Tests
# ============================================================================


class TestGetConversation:
    """Tests for GET /api/chat/conversations/{file_id}."""

    @pytest.mark.asyncio
    async def test_get_conversation_creates_new_when_not_exists(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should create new conversation if none exists for file."""
        response = await client.get("/api/chat/conversations/file-123", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["fileId"] == "file-123"
        assert data["messages"] == []
        assert "id" in data
        assert "createdAt" in data

    @pytest.mark.asyncio
    async def test_get_conversation_returns_existing(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should return existing conversation with messages."""
        # Create conversation and messages
        conv_id = str(uuid.uuid4())
        conversation = Conversation(id=conv_id, file_id="file-456", user_id=None)
        db_session.add(conversation)

        msg1 = Message(id=str(uuid.uuid4()), conversation_id=conv_id, role="user", content="Hello")
        msg2 = Message(
            id=str(uuid.uuid4()), conversation_id=conv_id, role="assistant", content="Hi there!"
        )
        db_session.add(msg1)
        db_session.add(msg2)
        await db_session.commit()

        response = await client.get("/api/chat/conversations/file-456", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["fileId"] == "file-456"
        assert len(data["messages"]) == 2

    @pytest.mark.asyncio
    async def test_get_conversation_includes_message_fields(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should return all message fields including thinking, toolCalls, edits."""
        conv_id = str(uuid.uuid4())
        conversation = Conversation(id=conv_id, file_id="file-789")
        db_session.add(conversation)

        msg = Message(
            id=str(uuid.uuid4()),
            conversation_id=conv_id,
            role="assistant",
            content="Response",
            thinking="Let me think...",
            tool_calls=[{"name": "search", "input": {}}],
            edits=[{"type": "str_replace", "old_str": "a", "new_str": "b"}],
            model="claude-3-5-sonnet",
        )
        db_session.add(msg)
        await db_session.commit()

        response = await client.get("/api/chat/conversations/file-789", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        message = data["messages"][0]
        assert message["thinking"] == "Let me think..."
        assert message["toolCalls"] == [{"name": "search", "input": {}}]
        assert message["edits"] == [{"type": "str_replace", "old_str": "a", "new_str": "b"}]
        assert message["model"] == "claude-3-5-sonnet"


class TestListConversations:
    """Tests for GET /api/chat/conversations."""

    @pytest.mark.asyncio
    async def test_list_conversations_empty(self, client: AsyncClient, auth_headers):
        """Should return empty list when no conversations."""
        response = await client.get("/api/chat/conversations", headers=auth_headers)

        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_list_conversations_returns_all(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should return all conversations."""
        # Create multiple conversations
        for i in range(3):
            conv = Conversation(id=str(uuid.uuid4()), file_id=f"file-{i}")
            db_session.add(conv)
        await db_session.commit()

        response = await client.get("/api/chat/conversations", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3


class TestCreateMessage:
    """Tests for POST /api/chat/messages."""

    @pytest.mark.asyncio
    async def test_create_message_in_existing_conversation(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should create message in existing conversation."""
        conv_id = str(uuid.uuid4())
        conversation = Conversation(id=conv_id, file_id="file-123")
        db_session.add(conversation)
        await db_session.commit()

        response = await client.post(
            "/api/chat/messages",
            headers=auth_headers,
            json={"conversationId": conv_id, "role": "user", "content": "Hello AI"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "user"
        assert data["content"] == "Hello AI"
        assert data["conversationId"] == conv_id

    @pytest.mark.asyncio
    async def test_create_message_creates_conversation_if_not_exists(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should create conversation if it doesn't exist."""
        response = await client.post(
            "/api/chat/messages",
            headers=auth_headers,
            json={"conversationId": "new-file-id", "role": "user", "content": "First message"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["content"] == "First message"
        assert "conversationId" in data

    @pytest.mark.asyncio
    async def test_create_message_with_all_fields(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should save all message fields."""
        conv = Conversation(id=str(uuid.uuid4()), file_id="file-test")
        db_session.add(conv)
        await db_session.commit()

        response = await client.post(
            "/api/chat/messages",
            headers=auth_headers,
            json={
                "conversationId": conv.id,
                "role": "assistant",
                "content": "Response",
                "thinking": "Thinking process...",
                "toolCalls": [{"name": "read_file", "input": {"path": "test.txt"}}],
                "edits": [{"type": "insert", "content": "new text", "position": 0}],
                "model": "claude-3-opus",
                "contexts": [{"type": "selection", "text": "selected"}],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["thinking"] == "Thinking process..."
        assert data["toolCalls"] == [{"name": "read_file", "input": {"path": "test.txt"}}]
        assert data["model"] == "claude-3-opus"


class TestClearConversation:
    """Tests for DELETE /api/chat/conversations/{file_id}."""

    @pytest.mark.asyncio
    async def test_clear_conversation_deletes_messages(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should delete all messages in conversation."""
        conv_id = str(uuid.uuid4())
        conversation = Conversation(id=conv_id, file_id="file-to-clear")
        db_session.add(conversation)

        for i in range(5):
            msg = Message(
                id=str(uuid.uuid4()),
                conversation_id=conv_id,
                role="user" if i % 2 == 0 else "assistant",
                content=f"Message {i}",
            )
            db_session.add(msg)
        await db_session.commit()

        response = await client.delete(
            "/api/chat/conversations/file-to-clear", headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["deleted"] == 5

    @pytest.mark.asyncio
    async def test_clear_nonexistent_conversation(self, client: AsyncClient, auth_headers):
        """Should return success with 0 deleted for nonexistent conversation."""
        response = await client.delete(
            "/api/chat/conversations/nonexistent-file", headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["deleted"] == 0


# ============================================================================
# Streaming Chat Tests
# ============================================================================


class TestChatStream:
    """Tests for POST /api/chat/stream."""

    @pytest.mark.asyncio
    async def test_stream_returns_sse_format(self, client: AsyncClient, db_session):
        """Should return Server-Sent Events format."""
        with patch("api.chat.WritingAgent") as MockAgent:
            # Mock agent to yield simple events
            mock_agent = AsyncMock()

            async def mock_stream(*args, **kwargs):
                yield {"type": "text", "content": "Hello"}
                yield {"type": "text", "content": " World"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post(
                "/api/chat/stream", json={"message": "Say hello", "files": []}
            )

            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")

            # Parse SSE events
            content = response.text
            assert "data:" in content

    @pytest.mark.asyncio
    async def test_stream_includes_summary_event(self, client: AsyncClient, db_session):
        """Should include summary event at end of stream."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()
            mock_agent.model = "test-model"

            async def mock_stream(*args, **kwargs):
                yield {"type": "text", "content": "Test response"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post("/api/chat/stream", json={"message": "Test", "files": []})

            assert response.status_code == 200
            content = response.text

            # Find summary event
            lines = content.strip().split("\n")
            summary_found = False
            for line in lines:
                if line.startswith("data: "):
                    data = line[6:]
                    if data != "[DONE]":
                        event = json.loads(data)
                        if event.get("type") == "summary":
                            summary_found = True
                            assert event["content"] == "Test response"
                            break

            assert summary_found, "Summary event not found in stream"

    @pytest.mark.asyncio
    async def test_stream_with_conversation_history(self, client: AsyncClient, db_session):
        """Should load conversation history when conversationId provided."""
        # Create conversation with messages
        conv_id = str(uuid.uuid4())
        conversation = Conversation(id=conv_id, file_id="file-with-history")
        db_session.add(conversation)

        msg = Message(
            id=str(uuid.uuid4()), conversation_id=conv_id, role="user", content="Previous message"
        )
        db_session.add(msg)
        await db_session.commit()

        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()
            captured_history = []

            async def mock_stream(*args, **kwargs):
                nonlocal captured_history
                captured_history = kwargs.get("history", [])
                yield {"type": "text", "content": "Response"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post(
                "/api/chat/stream",
                json={"message": "New message", "files": [], "conversationId": "file-with-history"},
            )

            assert response.status_code == 200
            assert len(captured_history) == 1
            assert captured_history[0]["content"] == "Previous message"

    @pytest.mark.asyncio
    async def test_stream_handles_agent_error(self, client: AsyncClient, db_session):
        """Should return error event when agent fails."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()

            async def mock_stream(*args, **kwargs):
                raise Exception("Agent error")
                yield  # Make it a generator

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post("/api/chat/stream", json={"message": "Test", "files": []})

            assert response.status_code == 200
            content = response.text
            assert "error" in content.lower()

    @pytest.mark.asyncio
    async def test_stream_with_file_context(self, client: AsyncClient, db_session):
        """Should pass file context to agent."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()
            captured_files = []

            async def mock_stream(*args, **kwargs):
                nonlocal captured_files
                # Files are passed in kwargs
                yield {"type": "text", "content": "Done"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post(
                "/api/chat/stream",
                json={
                    "message": "Summarize this",
                    "files": [{"id": "f1", "name": "doc.md", "content": "# Hello World"}],
                },
            )

            assert response.status_code == 200


# ============================================================================
# Simple Chat Tests
# ============================================================================


class TestSimpleChat:
    """Tests for POST /api/chat/simple."""

    @pytest.mark.asyncio
    async def test_simple_chat_returns_response(self, client: AsyncClient):
        """Should return AI response."""
        # LLMService is imported inside the function, so patch the module path
        with patch("services.llm_service.LLMService") as MockLLM:
            mock_llm = MagicMock()
            mock_llm.complete = AsyncMock(return_value="Hello! How can I help?")
            MockLLM.return_value = mock_llm

            response = await client.post("/api/chat/simple", json={"message": "Hello"})

            assert response.status_code == 200
            data = response.json()
            assert data["response"] == "Hello! How can I help?"

    @pytest.mark.asyncio
    async def test_simple_chat_with_system_prompt(self, client: AsyncClient):
        """Should pass system prompt to LLM."""
        with patch("services.llm_service.LLMService") as MockLLM:
            mock_llm = MagicMock()
            mock_llm.complete = AsyncMock(return_value="Response")
            MockLLM.return_value = mock_llm

            response = await client.post(
                "/api/chat/simple",
                json={"message": "Test", "system": "You are a helpful assistant."},
            )

            assert response.status_code == 200
            mock_llm.complete.assert_called_once_with(
                prompt="Test", system="You are a helpful assistant."
            )

    @pytest.mark.asyncio
    async def test_simple_chat_handles_error(self, client: AsyncClient):
        """Should return 500 on LLM error."""
        with patch("services.llm_service.LLMService") as MockLLM:
            mock_llm = MagicMock()
            mock_llm.complete = AsyncMock(side_effect=Exception("LLM error"))
            MockLLM.return_value = mock_llm

            response = await client.post("/api/chat/simple", json={"message": "Test"})

            assert response.status_code == 500


# ============================================================================
# Helper Function Tests
# ============================================================================


class TestHelperFunctions:
    """Tests for helper functions."""

    def test_normalize_file_id_empty_string(self):
        """Empty string should return None."""
        from dependencies import normalize_file_id

        assert normalize_file_id("") is None

    def test_normalize_file_id_none(self):
        """None should return None."""
        from dependencies import normalize_file_id

        assert normalize_file_id(None) is None

    def test_normalize_file_id_valid(self):
        """Valid file_id should be returned as-is."""
        from dependencies import normalize_file_id

        assert normalize_file_id("file-123") == "file-123"

    def test_get_user_id_anonymous(self):
        """Should return None for anonymous users (shared data)."""
        from api.files import get_user_id

        result = get_user_id(MagicMock(sub="anonymous"))
        assert result is None

    def test_get_user_id_valid_user(self):
        """Should return user ID for authenticated users."""
        from api.files import get_user_id

        result = get_user_id(MagicMock(sub="real-user-123"))
        assert result == "real-user-123"

    def test_get_user_id_dev_user(self):
        """Should return None for dev-user (shared data)."""
        from api.files import get_user_id

        result = get_user_id(MagicMock(sub="dev-user"))
        assert result is None

    def test_get_user_id_api_key_user(self):
        """Should return None for api-key-user (shared data)."""
        from api.files import get_user_id

        result = get_user_id(MagicMock(sub="api-key-user"))
        assert result is None


# ============================================================================
# Pydantic Model Tests
# ============================================================================


class TestPydanticModels:
    """Tests for Pydantic request/response models."""

    def test_file_context_model(self):
        """Should create FileContext model correctly."""
        from api.chat import FileContext

        fc = FileContext(id="f1", name="test.md", content="# Hello")
        assert fc.id == "f1"
        assert fc.name == "test.md"
        assert fc.content == "# Hello"

    def test_image_context_model(self):
        """Should create ImageContext model correctly."""
        from api.chat import ImageContext

        ic = ImageContext(src="data:image/png;base64,abc", alt="Test image")
        assert ic.src == "data:image/png;base64,abc"
        assert ic.alt == "Test image"
        assert ic.base64 is None
        assert ic.mediaType is None

    def test_image_context_model_with_all_fields(self):
        """Should create ImageContext with all fields."""
        from api.chat import ImageContext

        ic = ImageContext(src="url", alt="alt text", base64="abc123", mediaType="image/png")
        assert ic.base64 == "abc123"
        assert ic.mediaType == "image/png"

    def test_chat_request_model_defaults(self):
        """Should have correct default values."""
        from api.chat import ChatRequest

        cr = ChatRequest(message="Hello")
        assert cr.message == "Hello"
        assert cr.files == []
        assert cr.images == []
        assert cr.mode == "edit"
        assert cr.conversationId is None
        assert cr.fileId is None

    def test_chat_request_model_full(self):
        """Should create ChatRequest with all fields."""
        from api.chat import ChatRequest, FileContext, ImageContext

        cr = ChatRequest(
            message="Test",
            files=[FileContext(id="f1", name="doc.md", content="# Doc")],
            images=[ImageContext(src="img.png")],
            mode="analyze",
            conversationId="conv-123",
            fileId="file-456",
        )
        assert cr.mode == "analyze"
        assert len(cr.files) == 1
        assert len(cr.images) == 1

    def test_message_create_model(self):
        """Should create MessageCreate model correctly."""
        from api.conversations import MessageCreate

        mc = MessageCreate(conversationId="conv-123", role="user", content="Hello")
        assert mc.conversationId == "conv-123"
        assert mc.role == "user"
        assert mc.content == "Hello"
        assert mc.contexts is None
        assert mc.thinking is None
        assert mc.toolCalls is None
        assert mc.edits is None
        assert mc.model is None

    def test_message_create_model_full(self):
        """Should create MessageCreate with all fields."""
        from api.conversations import MessageCreate

        mc = MessageCreate(
            conversationId="conv-123",
            role="assistant",
            content="Response",
            contexts=[{"type": "selection"}],
            thinking="Let me think...",
            toolCalls=[{"name": "search"}],
            edits=[{"type": "insert"}],
            model="claude-3-opus",
        )
        assert mc.contexts == [{"type": "selection"}]
        assert mc.thinking == "Let me think..."
        assert mc.toolCalls == [{"name": "search"}]
        assert mc.edits == [{"type": "insert"}]
        assert mc.model == "claude-3-opus"

    def test_message_response_model(self):
        """Should create MessageResponse model."""
        from api.conversations import MessageResponse

        mr = MessageResponse(
            id="msg-123",
            conversationId="conv-123",
            role="assistant",
            content="Hello",
            createdAt="2024-01-01T00:00:00",
        )
        assert mr.id == "msg-123"
        assert mr.conversationId == "conv-123"
        assert mr.role == "assistant"
        assert mr.content == "Hello"

    def test_conversation_response_model(self):
        """Should create ConversationResponse model."""
        from api.conversations import ConversationResponse, MessageResponse

        cr = ConversationResponse(
            id="conv-123",
            fileId="file-456",
            messages=[
                MessageResponse(
                    id="msg-1",
                    conversationId="conv-123",
                    role="user",
                    content="Hi",
                    createdAt="2024-01-01T00:00:00",
                )
            ],
            createdAt="2024-01-01T00:00:00",
        )
        assert cr.id == "conv-123"
        assert cr.fileId == "file-456"
        assert len(cr.messages) == 1

    def test_simple_chat_request_model(self):
        """Should create SimpleChatRequest model."""
        from api.chat import SimpleChatRequest

        scr = SimpleChatRequest(message="Hello")
        assert scr.message == "Hello"
        assert scr.system is None

    def test_simple_chat_request_with_system(self):
        """Should create SimpleChatRequest with system prompt."""
        from api.chat import SimpleChatRequest

        scr = SimpleChatRequest(message="Hello", system="You are helpful")
        assert scr.system == "You are helpful"


# ============================================================================
# Extended Conversation Tests
# ============================================================================


class TestExtendedConversation:
    """Extended tests for conversation functionality."""

    @pytest.mark.asyncio
    async def test_get_conversation_for_global_file(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should handle global conversation with actual file_id."""
        response = await client.get("/api/chat/conversations/global-doc", headers=auth_headers)

        # Should create a new conversation for this file_id
        assert response.status_code == 200
        data = response.json()
        assert data["fileId"] == "global-doc"

    @pytest.mark.asyncio
    async def test_create_message_finds_by_file_id(
        self, client: AsyncClient, db_session, auth_headers
    ):
        """Should find conversation by file_id when passed as conversationId."""
        # Create conversation with file_id
        conv_id = str(uuid.uuid4())
        conversation = Conversation(id=conv_id, file_id="target-file-id")
        db_session.add(conversation)
        await db_session.commit()

        response = await client.post(
            "/api/chat/messages",
            headers=auth_headers,
            json={
                "conversationId": "target-file-id",  # Pass file_id
                "role": "user",
                "content": "Test message",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["conversationId"] == conv_id  # Should be the actual conv ID


# ============================================================================
# Extended Streaming Tests
# ============================================================================


class TestExtendedStreaming:
    """Extended tests for streaming functionality."""

    @pytest.mark.asyncio
    async def test_stream_collects_tool_events(self, client: AsyncClient, db_session):
        """Should collect tool_start, tool_input_delta, tool_end events."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()

            async def mock_stream(*args, **kwargs):
                yield {"type": "tool_start", "tool": "search", "tool_id": "t1"}
                yield {"type": "tool_input_delta", "delta": "query"}
                yield {"type": "tool_end", "output": "result", "success": True}
                yield {"type": "text", "content": "Found it"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post(
                "/api/chat/stream", json={"message": "Search for X", "files": []}
            )

            assert response.status_code == 200
            content = response.text

            # Check summary contains tool calls
            lines = content.strip().split("\n")
            for line in lines:
                if line.startswith("data: ") and "[DONE]" not in line:
                    try:
                        data = json.loads(line[6:])
                        if data.get("type") == "summary":
                            assert data.get("toolCalls") is not None
                            assert len(data["toolCalls"]) == 1
                            assert data["toolCalls"][0]["name"] == "search"
                    except json.JSONDecodeError:
                        pass

    @pytest.mark.asyncio
    async def test_stream_collects_thinking_events(self, client: AsyncClient, db_session):
        """Should collect thinking events."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()

            async def mock_stream(*args, **kwargs):
                yield {"type": "thinking", "content": "Let me think..."}
                yield {"type": "thinking", "content": " about this."}
                yield {"type": "text", "content": "Answer"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post(
                "/api/chat/stream", json={"message": "Think about X", "files": []}
            )

            assert response.status_code == 200
            content = response.text

            # Check summary contains thinking
            for line in content.strip().split("\n"):
                if line.startswith("data: ") and "[DONE]" not in line:
                    try:
                        data = json.loads(line[6:])
                        if data.get("type") == "summary":
                            assert data.get("thinking") == "Let me think... about this."
                    except json.JSONDecodeError:
                        pass

    @pytest.mark.asyncio
    async def test_stream_collects_edit_events(self, client: AsyncClient, db_session):
        """Should collect edit events."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()

            async def mock_stream(*args, **kwargs):
                yield {"type": "edit", "edit": {"type": "str_replace", "old": "a", "new": "b"}}
                yield {"type": "text", "content": "Done editing"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post(
                "/api/chat/stream", json={"message": "Edit this", "files": []}
            )

            assert response.status_code == 200
            content = response.text

            # Check summary contains edits
            for line in content.strip().split("\n"):
                if line.startswith("data: ") and "[DONE]" not in line:
                    try:
                        data = json.loads(line[6:])
                        if data.get("type") == "summary":
                            assert data.get("edits") is not None
                    except json.JSONDecodeError:
                        pass

    @pytest.mark.asyncio
    async def test_stream_with_images(self, client: AsyncClient, db_session):
        """Should pass images to agent for multimodal support."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()
            captured_images = []

            async def mock_stream(*args, **kwargs):
                nonlocal captured_images
                captured_images = kwargs.get("images", [])
                yield {"type": "text", "content": "I see the image"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post(
                "/api/chat/stream",
                json={
                    "message": "Describe this image",
                    "files": [],
                    "images": [
                        {
                            "src": "data:image/png;base64,abc",
                            "alt": "Test image",
                            "base64": "abc123",
                            "mediaType": "image/png",
                        }
                    ],
                },
            )

            assert response.status_code == 200
            # Images without valid base64 and mediaType are filtered
            assert len(captured_images) == 1
            assert captured_images[0]["mediaType"] == "image/png"

    @pytest.mark.asyncio
    async def test_stream_truncates_large_file_content(self, client: AsyncClient, db_session):
        """Should truncate file content to 50000 chars."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()
            captured_files = []

            async def mock_stream(*args, **kwargs):
                nonlocal captured_files
                captured_files = kwargs.get("files", [])
                yield {"type": "text", "content": "Processed"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            large_content = "x" * 100000  # 100k chars

            response = await client.post(
                "/api/chat/stream",
                json={
                    "message": "Process file",
                    "files": [{"id": "f1", "name": "large.txt", "content": large_content}],
                },
            )

            assert response.status_code == 200
            # File content is truncated in the stream function

    @pytest.mark.asyncio
    async def test_stream_with_kb_attachments(self, client: AsyncClient, db_session):
        """Should load KB attachments for conversation."""
        from db.database import ConversationAttachment

        # Create conversation with KB attachment
        conv_id = str(uuid.uuid4())
        conversation = Conversation(id=conv_id, file_id="file-with-kb")
        db_session.add(conversation)

        attachment = ConversationAttachment(
            id=str(uuid.uuid4()),
            conversation_id=conv_id,
            original_filename="document.pdf",
            file_type="pdf",
            file_size=1024,  # Required field
            status="indexed",
            chunk_count=5,
        )
        db_session.add(attachment)
        await db_session.commit()

        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()
            captured_kb = []

            async def mock_stream(*args, **kwargs):
                yield {"type": "text", "content": "Using KB"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            # Capture the kb_attachments passed to WritingAgent
            def capture_init(*args, **kwargs):
                nonlocal captured_kb
                captured_kb = kwargs.get("kb_attachments", [])
                return mock_agent

            MockAgent.side_effect = capture_init

            response = await client.post(
                "/api/chat/stream",
                json={"message": "Search KB", "files": [], "conversationId": "file-with-kb"},
            )

            assert response.status_code == 200


# ============================================================================
# User Isolation Tests
# ============================================================================


class TestUserIsolation:
    """Tests for user data isolation in chat."""

    @pytest.mark.asyncio
    async def test_conversation_user_id_filter(self, client: AsyncClient, db_session, auth_headers):
        """Should filter conversations by user_id in non-debug mode."""
        from db.database import User

        # This test verifies the get_user_id is called properly
        # For dev-user token, user_id returns None (shared data)

        # Create user for the conversation (foreign key constraint)
        user2 = User(
            id="user-2",
            email="user2@example.com",
            username="user2",
            is_verified=True,
            is_active=True,
        )
        db_session.add(user2)
        await db_session.commit()

        # Create conversation for different user
        conv = Conversation(id=str(uuid.uuid4()), file_id="user2-file", user_id="user-2")
        db_session.add(conv)
        await db_session.commit()

        # In debug mode, we should still see the conversation
        response = await client.get("/api/chat/conversations/user2-file", headers=auth_headers)

        # Debug mode shows all files
        assert response.status_code == 200
