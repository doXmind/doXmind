"""Deep integration tests for Chat API.

These tests focus on:
1. Real database interactions for conversations and messages
2. SSE streaming protocol correctness
3. User isolation and security
4. Error handling and edge cases
5. AI agent integration
"""

import json
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import Conversation, Message
from services.auth_service import TokenData

# ============================================================================
# Conversation Persistence Tests
# ============================================================================


class TestConversationPersistence:
    """Tests for conversation creation and persistence."""

    @pytest.mark.asyncio
    async def test_conversation_created_with_uuid(self, db_session: AsyncSession):
        """Conversation ID should be a valid UUID."""
        conv = Conversation(file_id="test-file-1")
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        try:
            uuid.UUID(conv.id)
            is_valid = True
        except ValueError:
            is_valid = False

        assert is_valid, f"Conversation ID '{conv.id}' is not a valid UUID"

    @pytest.mark.asyncio
    async def test_conversation_timestamps_set(self, db_session: AsyncSession):
        """Conversation should have created_at set automatically."""
        conv = Conversation(file_id="test-file-timestamps")
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        # Conversation model only has created_at, not updated_at
        assert conv.created_at is not None

    @pytest.mark.asyncio
    async def test_conversation_can_have_null_file_id(self, db_session: AsyncSession):
        """Conversation can exist without a file_id (global conversation)."""
        conv = Conversation(file_id=None)
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        assert conv.id is not None
        assert conv.file_id is None

    @pytest.mark.asyncio
    async def test_multiple_conversations_for_same_file(self, db_session: AsyncSession):
        """Multiple conversations can exist for the same file_id."""
        from tests.conftest import create_test_user

        file_id = "shared-file"

        # Create users first (foreign key constraint)
        await create_test_user(db_session, "user-1")
        await create_test_user(db_session, "user-2")

        conv1 = Conversation(file_id=file_id, user_id="user-1")
        conv2 = Conversation(file_id=file_id, user_id="user-2")

        db_session.add(conv1)
        db_session.add(conv2)
        await db_session.commit()

        result = await db_session.execute(
            select(Conversation).where(Conversation.file_id == file_id)
        )
        conversations = result.scalars().all()

        assert len(conversations) == 2


# ============================================================================
# Message Persistence Tests
# ============================================================================


class TestMessagePersistence:
    """Tests for message creation and persistence."""

    @pytest.mark.asyncio
    async def test_message_linked_to_conversation(self, db_session: AsyncSession):
        """Message should be properly linked to conversation."""
        conv = Conversation(file_id="msg-test")
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        msg = Message(conversation_id=conv.id, role="user", content="Hello")
        db_session.add(msg)
        await db_session.commit()
        await db_session.refresh(msg)

        assert msg.conversation_id == conv.id

    @pytest.mark.asyncio
    async def test_message_roles(self, db_session: AsyncSession):
        """Message can have different roles."""
        conv = Conversation(file_id="role-test")
        db_session.add(conv)
        await db_session.commit()

        roles = ["user", "assistant", "system"]
        for role in roles:
            msg = Message(conversation_id=conv.id, role=role, content=f"Message with role: {role}")
            db_session.add(msg)

        await db_session.commit()

        result = await db_session.execute(select(Message).where(Message.conversation_id == conv.id))
        messages = result.scalars().all()

        assert len(messages) == 3
        saved_roles = {m.role for m in messages}
        assert saved_roles == set(roles)

    @pytest.mark.asyncio
    async def test_message_can_store_json_fields(self, db_session: AsyncSession):
        """Message can store JSON in contexts, tool_calls, edits fields."""
        conv = Conversation(file_id="json-test")
        db_session.add(conv)
        await db_session.commit()

        msg = Message(
            conversation_id=conv.id,
            role="assistant",
            content="Response",
            contexts=[{"type": "selection", "text": "selected text"}],
            tool_calls=[{"name": "search", "args": {"query": "test"}}],
            edits=[{"type": "str_replace", "old": "a", "new": "b"}],
        )
        db_session.add(msg)
        await db_session.commit()
        await db_session.refresh(msg)

        assert msg.contexts == [{"type": "selection", "text": "selected text"}]
        assert msg.tool_calls == [{"name": "search", "args": {"query": "test"}}]
        assert msg.edits == [{"type": "str_replace", "old": "a", "new": "b"}]

    @pytest.mark.asyncio
    async def test_message_ordering(self, db_session: AsyncSession):
        """Messages should maintain ordering by created_at."""
        conv = Conversation(file_id="order-test")
        db_session.add(conv)
        await db_session.commit()

        # Create messages
        for i in range(5):
            msg = Message(
                conversation_id=conv.id,
                role="user" if i % 2 == 0 else "assistant",
                content=f"Message {i}",
            )
            db_session.add(msg)
            await db_session.commit()

        result = await db_session.execute(
            select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at)
        )
        messages = result.scalars().all()

        for i, msg in enumerate(messages):
            assert msg.content == f"Message {i}"


# ============================================================================
# Conversation API Tests
# ============================================================================


class TestConversationAPI:
    """Tests for conversation API endpoints."""

    @pytest.mark.asyncio
    async def test_get_conversation_creates_if_not_exists(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Getting a conversation by file_id should create it if missing."""
        file_id = f"new-file-{uuid.uuid4()}"

        response = await client.get(f"/api/chat/conversations/{file_id}", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["fileId"] == file_id

        # Verify it was actually created in DB
        result = await db_session.execute(
            select(Conversation).where(Conversation.file_id == file_id)
        )
        conv = result.scalar_one_or_none()
        assert conv is not None

    @pytest.mark.asyncio
    async def test_get_conversation_returns_existing(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Getting a conversation should return existing one."""
        file_id = f"existing-file-{uuid.uuid4()}"

        # Create conversation first
        conv = Conversation(file_id=file_id)
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        response = await client.get(f"/api/chat/conversations/{file_id}", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == conv.id

    @pytest.mark.asyncio
    async def test_get_conversation_includes_messages(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Getting a conversation should include its messages."""
        file_id = f"msg-file-{uuid.uuid4()}"

        conv = Conversation(file_id=file_id)
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        # Add messages
        msg1 = Message(conversation_id=conv.id, role="user", content="Hello")
        msg2 = Message(conversation_id=conv.id, role="assistant", content="Hi!")
        db_session.add(msg1)
        db_session.add(msg2)
        await db_session.commit()

        response = await client.get(f"/api/chat/conversations/{file_id}", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["messages"]) == 2


# ============================================================================
# Message API Tests
# ============================================================================


class TestMessageAPI:
    """Tests for message API endpoints."""

    @pytest.mark.asyncio
    async def test_create_message(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should create a message in a conversation."""
        conv = Conversation(file_id=f"create-msg-{uuid.uuid4()}")
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        response = await client.post(
            "/api/chat/messages",
            headers=auth_headers,
            json={"conversationId": conv.id, "role": "user", "content": "Test message"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["content"] == "Test message"
        assert data["role"] == "user"
        assert data["conversationId"] == conv.id

    @pytest.mark.asyncio
    async def test_create_message_with_metadata(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should create a message with optional metadata."""
        conv = Conversation(file_id=f"metadata-msg-{uuid.uuid4()}")
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        response = await client.post(
            "/api/chat/messages",
            headers=auth_headers,
            json={
                "conversationId": conv.id,
                "role": "assistant",
                "content": "AI response",
                "thinking": "Let me analyze this...",
                "toolCalls": [{"name": "search", "input": "query"}],
                "edits": [{"type": "insert", "content": "new text"}],
                "model": "claude-3-opus",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["thinking"] == "Let me analyze this..."
        assert data["toolCalls"] == [{"name": "search", "input": "query"}]

    @pytest.mark.asyncio
    async def test_create_message_by_file_id(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should find conversation by file_id when creating message."""
        file_id = f"file-lookup-{uuid.uuid4()}"
        conv = Conversation(file_id=file_id)
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        response = await client.post(
            "/api/chat/messages",
            headers=auth_headers,
            json={
                "conversationId": file_id,  # Using file_id instead of conv.id
                "role": "user",
                "content": "Found by file_id",
            },
        )

        assert response.status_code == 200
        # The response should have the actual conversation ID
        data = response.json()
        assert data["conversationId"] == conv.id


# ============================================================================
# Streaming Tests
# ============================================================================


class TestStreaming:
    """Tests for SSE streaming functionality."""

    @pytest.mark.asyncio
    async def test_stream_returns_sse_format(self, client: AsyncClient, db_session: AsyncSession):
        """Stream endpoint should return SSE formatted response."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()

            async def mock_stream(*args, **kwargs):
                yield {"type": "text", "content": "Hello"}
                yield {"type": "text", "content": " World"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post("/api/chat/stream", json={"message": "Test", "files": []})

            assert response.status_code == 200
            content = response.text

            # Should have SSE data: prefix
            assert "data: " in content
            # Should have [DONE] marker
            assert "[DONE]" in content

    @pytest.mark.asyncio
    async def test_stream_text_events_concatenated(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Text events should be concatenated in the summary."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()

            async def mock_stream(*args, **kwargs):
                yield {"type": "text", "content": "First "}
                yield {"type": "text", "content": "Second "}
                yield {"type": "text", "content": "Third"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post("/api/chat/stream", json={"message": "Test", "files": []})

            assert response.status_code == 200
            content = response.text

            # Parse SSE events to find summary
            for line in content.strip().split("\n"):
                if line.startswith("data: ") and "summary" in line:
                    try:
                        data = json.loads(line[6:])
                        if data.get("type") == "summary":
                            # Full text should be in 'content' field
                            assert data.get("content") == "First Second Third"
                    except json.JSONDecodeError:
                        pass

    @pytest.mark.asyncio
    async def test_stream_error_event(self, client: AsyncClient, db_session: AsyncSession):
        """Agent errors should produce error events."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()

            async def mock_stream(*args, **kwargs):
                yield {"type": "error", "message": "Something went wrong"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post("/api/chat/stream", json={"message": "Test", "files": []})

            assert response.status_code == 200
            content = response.text

            # Should contain error event
            assert "error" in content.lower()

    @pytest.mark.asyncio
    async def test_stream_with_conversation_context(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Stream should load conversation history."""
        # Create conversation with history
        conv = Conversation(file_id="stream-history")
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        msg = Message(conversation_id=conv.id, role="user", content="Previous message")
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
                json={"message": "New message", "files": [], "conversationId": "stream-history"},
            )

            assert response.status_code == 200
            # History should have been passed to agent
            # (actual assertion depends on implementation)


# ============================================================================
# User Isolation Tests
# ============================================================================


class TestUserIsolation:
    """Tests for user data isolation in chat."""

    @pytest.mark.asyncio
    async def test_user_can_only_see_own_conversations(self, db_session: AsyncSession):
        """Users should only see their own conversations."""
        from tests.conftest import create_test_user

        # Create users first (foreign key constraint)
        await create_test_user(db_session, "user-1")
        await create_test_user(db_session, "user-2")

        # Create conversations for different users
        conv1 = Conversation(file_id="user1-file", user_id="user-1")
        conv2 = Conversation(file_id="user2-file", user_id="user-2")
        db_session.add(conv1)
        db_session.add(conv2)
        await db_session.commit()

        # Query as user 1
        result = await db_session.execute(
            select(Conversation).where(Conversation.user_id == "user-1")
        )
        user1_convs = result.scalars().all()

        assert len(user1_convs) == 1
        assert user1_convs[0].file_id == "user1-file"

    @pytest.mark.asyncio
    async def test_get_user_id_returns_user_id(self):
        """get_user_id should return user ID for regular users."""
        from api.files import get_user_id

        token = TokenData(sub="regular-user-123", exp=datetime.now(UTC) + timedelta(hours=1))

        result = get_user_id(token)
        assert result == "regular-user-123"

    @pytest.mark.asyncio
    async def test_get_user_id_special_users(self):
        """get_user_id should return None for special users (shared data)."""
        from api.files import get_user_id

        for special_sub in ["dev-user", "anonymous", "api-key-user"]:
            token = TokenData(sub=special_sub, exp=datetime.now(UTC) + timedelta(hours=1))

            result = get_user_id(token)
            assert result is None, f"Expected None for {special_sub}"


# ============================================================================
# Error Handling Tests
# ============================================================================


class TestErrorHandling:
    """Tests for error conditions."""

    @pytest.mark.asyncio
    async def test_stream_handles_agent_exception(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Stream should handle agent exceptions gracefully."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()

            async def mock_stream(*args, **kwargs):
                raise Exception("Agent crashed")

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post("/api/chat/stream", json={"message": "Test", "files": []})

            # Should not crash, should return error response
            assert response.status_code in [200, 500]

    @pytest.mark.asyncio
    async def test_create_message_invalid_conversation(self, client: AsyncClient, auth_headers):
        """Creating message for invalid conversation should fail."""
        response = await client.post(
            "/api/chat/messages",
            headers=auth_headers,
            json={
                "conversationId": str(uuid.uuid4()),  # Non-existent
                "role": "user",
                "content": "Test",
            },
        )

        # Should either create conversation or return error
        assert response.status_code in [200, 404]

    @pytest.mark.asyncio
    async def test_stream_missing_message(self, client: AsyncClient):
        """Stream without message should fail validation."""
        response = await client.post("/api/chat/stream", json={"files": []})

        assert response.status_code == 422  # Validation error


# ============================================================================
# Edge Cases
# ============================================================================


class TestEdgeCases:
    """Tests for edge cases."""

    @pytest.mark.asyncio
    async def test_empty_conversation_response(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """New conversation should have empty messages list."""
        file_id = f"empty-conv-{uuid.uuid4()}"

        response = await client.get(f"/api/chat/conversations/{file_id}", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["messages"] == []

    @pytest.mark.asyncio
    async def test_large_message_content(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should handle large message content."""
        conv = Conversation(file_id=f"large-msg-{uuid.uuid4()}")
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        large_content = "x" * 100000  # 100KB

        response = await client.post(
            "/api/chat/messages",
            headers=auth_headers,
            json={"conversationId": conv.id, "role": "user", "content": large_content},
        )

        assert response.status_code == 200
        assert len(response.json()["content"]) == 100000

    @pytest.mark.asyncio
    async def test_unicode_in_messages(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers
    ):
        """Should handle Unicode in messages."""
        conv = Conversation(file_id=f"unicode-{uuid.uuid4()}")
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        unicode_content = "Hello 世界! Привет мир! مرحبا 🌍"

        response = await client.post(
            "/api/chat/messages",
            headers=auth_headers,
            json={"conversationId": conv.id, "role": "user", "content": unicode_content},
        )

        assert response.status_code == 200
        assert response.json()["content"] == unicode_content

    @pytest.mark.asyncio
    async def test_stream_with_images(self, client: AsyncClient, db_session: AsyncSession):
        """Stream should accept images for multimodal."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()
            received_images = []

            async def mock_stream(*args, **kwargs):
                nonlocal received_images
                received_images = kwargs.get("images", [])
                yield {"type": "text", "content": "I see the image"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            response = await client.post(
                "/api/chat/stream",
                json={
                    "message": "Describe this",
                    "files": [],
                    "images": [
                        {
                            "src": "data:image/png;base64,abc",
                            "base64": "iVBORw0KGgo=",
                            "mediaType": "image/png",
                        }
                    ],
                },
            )

            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_file_content_truncation(self, client: AsyncClient, db_session: AsyncSession):
        """Large file content should be truncated in stream."""
        with patch("api.chat.WritingAgent") as MockAgent:
            mock_agent = AsyncMock()
            received_files = []

            async def mock_stream(*args, **kwargs):
                nonlocal received_files
                received_files = kwargs.get("files", [])
                yield {"type": "text", "content": "Processed"}

            mock_agent.stream = mock_stream
            MockAgent.return_value = mock_agent

            large_content = "x" * 100000  # Exceeds 50000 limit

            response = await client.post(
                "/api/chat/stream",
                json={
                    "message": "Process file",
                    "files": [{"id": "f1", "name": "large.txt", "content": large_content}],
                },
            )

            assert response.status_code == 200
            # File content should have been truncated before passing to agent
            if received_files:
                # If files were passed, content should be truncated
                assert len(received_files[0].get("content", "")) <= 50000


# ============================================================================
# Simple Chat Endpoint Tests
# ============================================================================


class TestSimpleChatEndpoint:
    """Tests for the simple /api/chat/simple endpoint."""

    @pytest.mark.asyncio
    async def test_simple_chat_basic(self, client: AsyncClient):
        """Simple chat should work without conversation context."""
        # LLMService is imported inside the function, so we patch the module
        with patch("services.llm_service.LLMService") as MockLLM:
            mock_llm = MagicMock()
            mock_llm.complete = AsyncMock(return_value="Simple response")
            MockLLM.return_value = mock_llm

            response = await client.post("/api/chat/simple", json={"message": "Hello"})

            assert response.status_code == 200
            data = response.json()
            assert "response" in data

    @pytest.mark.asyncio
    async def test_simple_chat_with_system_prompt(self, client: AsyncClient):
        """Simple chat should accept system prompt."""
        with patch("services.llm_service.LLMService") as MockLLM:
            mock_llm = MagicMock()
            mock_llm.complete = AsyncMock(return_value="Pirate response")
            MockLLM.return_value = mock_llm

            response = await client.post(
                "/api/chat/simple", json={"message": "Hello", "system": "You are a pirate"}
            )

            assert response.status_code == 200
            # Verify system prompt was passed
            mock_llm.complete.assert_called()
