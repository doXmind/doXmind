"""Tests for content_sanitizer module.

Unit tests for the sanitize_content function, plus integration tests that
verify the full bug-fix flow: content with problematic characters is sanitized
before reaching PostgreSQL, and list_files (which uses safe_substr) never 500s.
"""

import hashlib
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import File, FileVersion
from services.content_sanitizer import sanitize_content

# =============================================================================
# Unit tests — sanitize_content function
# =============================================================================


@pytest.mark.unit
class TestSanitizeContent:
    """Test sanitize_content strips unsafe characters while preserving valid ones."""

    def test_none_passthrough(self):
        assert sanitize_content(None) is None

    def test_empty_string(self):
        assert sanitize_content("") == ""

    def test_normal_ascii(self):
        text = "Hello, world! 123"
        assert sanitize_content(text) == text

    def test_preserves_tab_newline_cr(self):
        text = "line1\tcolumn2\nline2\r\nline3"
        assert sanitize_content(text) == text

    def test_removes_null_byte(self):
        assert sanitize_content("hello\x00world") == "helloworld"

    def test_removes_control_chars(self):
        # \x01-\x08, \x0B, \x0C, \x0E-\x1F
        text = "a\x01b\x02c\x07d\x08e\x0bf\x0cg\x0eh\x1fi"
        assert sanitize_content(text) == "abcdefghi"

    def test_preserves_cjk(self):
        text = "你好世界 こんにちは 안녕하세요"
        assert sanitize_content(text) == text

    def test_preserves_emoji(self):
        text = "Hello 🌍🎉👍 World"
        assert sanitize_content(text) == text

    def test_preserves_arabic_cyrillic(self):
        text = "مرحبا Привет"
        assert sanitize_content(text) == text

    def test_removes_lone_surrogates(self):
        # Lone surrogates \uD800-\uDFFF — these can only appear in
        # Python strings via explicit construction, not from valid UTF-8
        text = "hello\ud800world"
        result = sanitize_content(text)
        assert "\ud800" not in result
        assert result == "helloworld"

    def test_removes_unicode_noncharacters(self):
        text = "hello\ufffeworld\uffff!"
        assert sanitize_content(text) == "helloworld!"

    def test_idempotency(self):
        text = "hello\x00\x01world\ufffe"
        first = sanitize_content(text)
        second = sanitize_content(first)
        assert first == second == "helloworld"

    def test_mixed_valid_and_invalid(self):
        text = "你好\x00Hello\x01🌍\ufffeWorld\n"
        assert sanitize_content(text) == "你好Hello🌍World\n"

    def test_large_content_preserved(self):
        # Ensure sanitization works on content larger than TOAST boundary (~4KB)
        text = "A" * 10000 + "\n" + "你好" * 1000
        assert sanitize_content(text) == text

    def test_large_content_with_nulls(self):
        text = "A" * 5000 + "\x00" + "B" * 5000
        result = sanitize_content(text)
        assert len(result) == 10000
        assert "\x00" not in result


# =============================================================================
# Integration tests — API endpoint sanitization (the actual bug scenario)
# =============================================================================


@pytest.mark.unit
class TestCreateFileSanitizesContent:
    """POST /api/files/ should strip unsafe chars before writing to PostgreSQL."""

    async def test_create_file_strips_null_bytes(self, client: AsyncClient):
        """Null bytes in content should be stripped — the #1 cause of the corruption bug."""
        response = await client.post(
            "/api/files/",
            json={"name": "null-byte-doc", "content": "Hello\x00World"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["content"] == "HelloWorld"
        assert "\x00" not in data["content"]

    async def test_create_file_strips_control_chars(self, client: AsyncClient):
        """Control characters should be stripped to prevent encoding issues."""
        response = await client.post(
            "/api/files/",
            json={"name": "ctrl-char-doc", "content": "Line\x01One\x07Two"},
        )
        assert response.status_code == 200
        assert response.json()["content"] == "LineOneTwo"

    async def test_create_file_preserves_valid_unicode(self, client: AsyncClient):
        """CJK, emoji, newlines, tabs must survive sanitization."""
        content = "你好\tWorld\n🌍 Привет"
        response = await client.post(
            "/api/files/",
            json={"name": "unicode-doc", "content": content},
        )
        assert response.status_code == 200
        assert response.json()["content"] == content

    async def test_create_file_content_hash_matches_sanitized(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """content_hash should be computed on sanitized content, not raw input."""
        raw = "abc\x00def"
        sanitized = "abcdef"
        expected_hash = hashlib.sha256(sanitized.encode("utf-8")).hexdigest()

        response = await client.post(
            "/api/files/",
            json={"name": "hash-test", "content": raw},
        )
        assert response.status_code == 200
        file_id = response.json()["id"]

        # Verify hash via direct DB query (content_hash is not in API response)
        result = await db_session.execute(select(File.content_hash).where(File.id == file_id))
        stored_hash = result.scalar()
        assert stored_hash == expected_hash


@pytest.mark.unit
class TestListFilesAfterSanitization:
    """GET /api/files/ uses safe_substr — should never 500 on any stored content.

    This is the exact bug scenario: list_files calls substr(content, 1, 1000)
    which hung or threw CharacterNotInRepertoireError on corrupted content.
    """

    async def test_list_files_after_creating_with_null_bytes(self, client: AsyncClient):
        """The original bug: create file with nulls → list_files → 500."""
        # Create a file whose raw content would have caused the old bug
        await client.post(
            "/api/files/",
            json={"name": "problematic", "content": "Hello\x00World\x00!"},
        )

        # This is the call that used to 500
        response = await client.get("/api/files/")
        assert response.status_code == 200
        files = response.json()
        assert len(files) == 1
        assert files[0]["name"] == "problematic"

    async def test_list_files_with_large_cjk_content(self, client: AsyncClient):
        """CJK content > TOAST boundary (~4KB) caused corruption at ~4005 bytes."""
        # Simulate the real-world scenario: large CJK document
        content = "你好世界" * 2000  # ~8000 CJK chars = ~24KB UTF-8
        await client.post(
            "/api/files/",
            json={"name": "large-cjk", "content": content},
        )

        response = await client.get("/api/files/")
        assert response.status_code == 200
        files = response.json()
        assert len(files) == 1
        assert files[0]["name"] == "large-cjk"

    async def test_list_files_with_mixed_problematic_content(self, client: AsyncClient):
        """Mix of null bytes, control chars, and CJK — the worst case."""
        content = "标题\x00" + "内容" * 1000 + "\x01\x07结尾"
        await client.post(
            "/api/files/",
            json={"name": "mixed-bad", "content": content},
        )

        response = await client.get("/api/files/")
        assert response.status_code == 200
        assert len(response.json()) == 1


@pytest.mark.unit
class TestUpdateFileSanitizesContent:
    """PUT /api/files/{id} goes through ORM event listener → should sanitize."""

    async def test_update_file_strips_null_bytes(self, client: AsyncClient):
        """Updating content with null bytes should sanitize via ORM event."""
        # Create clean file
        create_resp = await client.post(
            "/api/files/",
            json={"name": "update-test", "content": "clean content"},
        )
        file_id = create_resp.json()["id"]

        # Update with problematic content
        update_resp = await client.put(
            f"/api/files/{file_id}",
            json={"content": "updated\x00content\x01here"},
        )
        assert update_resp.status_code == 200

        # Verify stored content is sanitized
        get_resp = await client.get(f"/api/files/{file_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["content"] == "updatedcontenthere"

    async def test_list_files_after_update_with_bad_content(self, client: AsyncClient):
        """list_files should work after updating a file with bad chars."""
        create_resp = await client.post(
            "/api/files/",
            json={"name": "update-list-test", "content": "original"},
        )
        file_id = create_resp.json()["id"]

        # Update with content that would have caused TOAST corruption
        await client.put(
            f"/api/files/{file_id}",
            json={"content": "A" * 5000 + "\x00" + "B" * 5000},
        )

        # list_files must not 500
        response = await client.get("/api/files/")
        assert response.status_code == 200


@pytest.mark.unit
class TestORMEventListenerSanitization:
    """SQLAlchemy before_insert/before_update events should auto-sanitize content."""

    async def test_orm_insert_sanitizes_file(self, db_session: AsyncSession):
        """db.add(File) with bad content → event listener strips it."""
        file = File(
            id=str(uuid.uuid4()),
            name="orm-test",
            content="hello\x00world\x01!",
        )
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        assert file.content == "helloworld!"
        assert "\x00" not in file.content

    async def test_orm_update_sanitizes_file(self, db_session: AsyncSession):
        """Modifying file.content via ORM → event listener strips bad chars."""
        file = File(
            id=str(uuid.uuid4()),
            name="orm-update-test",
            content="clean",
        )
        db_session.add(file)
        await db_session.commit()

        # Update with bad content
        file.content = "updated\x00value"
        await db_session.commit()
        await db_session.refresh(file)

        assert file.content == "updatedvalue"

    async def test_orm_insert_sanitizes_file_version(self, db_session: AsyncSession):
        """FileVersion content should also be sanitized by event listener."""
        file = File(
            id=str(uuid.uuid4()),
            name="version-test",
            content="clean content",
        )
        db_session.add(file)
        await db_session.commit()

        version = FileVersion(
            id=str(uuid.uuid4()),
            file_id=file.id,
            content="version\x00content\x01here",
            edit_type="manual",
        )
        db_session.add(version)
        await db_session.commit()
        await db_session.refresh(version)

        assert version.content == "versioncontenthere"

    async def test_orm_preserves_valid_content(self, db_session: AsyncSession):
        """Event listener should not alter content that has no bad chars."""
        content = "# 标题\n\n你好世界 🌍\n\n- Item 1\n- Item 2\n"
        file = File(
            id=str(uuid.uuid4()),
            name="valid-content-test",
            content=content,
        )
        db_session.add(file)
        await db_session.commit()
        await db_session.refresh(file)

        assert file.content == content


@pytest.mark.unit
class TestSafeSubstrWithSanitizedContent:
    """Verify safe_substr works correctly on sanitized content in the DB."""

    async def test_safe_substr_on_clean_content(self, db_session: AsyncSession):
        """safe_substr should return correct preview for clean content."""
        content = "A" * 2000
        file_id = str(uuid.uuid4())

        await db_session.execute(
            insert(File).values(
                id=file_id,
                name="substr-test",
                content=content,
            )
        )
        await db_session.commit()

        result = await db_session.execute(
            text("SELECT safe_substr(content, 1, 1000) FROM files WHERE id = :id"),
            {"id": file_id},
        )
        preview = result.scalar()
        assert preview == "A" * 1000

    async def test_safe_substr_on_cjk_content(self, db_session: AsyncSession):
        """safe_substr should handle CJK content without encoding errors."""
        content = "你好" * 1000  # 2000 CJK chars
        file_id = str(uuid.uuid4())

        await db_session.execute(
            insert(File).values(
                id=file_id,
                name="cjk-substr-test",
                content=content,
            )
        )
        await db_session.commit()

        result = await db_session.execute(
            text("SELECT safe_substr(content, 1, 1000) FROM files WHERE id = :id"),
            {"id": file_id},
        )
        preview = result.scalar()
        assert len(preview) == 1000
        assert preview == ("你好" * 500)
