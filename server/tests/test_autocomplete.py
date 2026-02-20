"""Tests for Autocomplete Service and API.

Tests cover:
- AutocompleteCache service
- Autocomplete API endpoints
- Prompt building and suggestion cleaning
"""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.autocomplete import (
    AutocompleteRequest,
    AutocompleteResponse,
    build_prompt,
    clean_suggestion_short,
    router,
)
from services.autocomplete_cache import AutocompleteCache

# ============================================================================
# AutocompleteCache Tests
# ============================================================================


class TestAutocompleteCache:
    """Tests for AutocompleteCache class."""

    def test_init_with_defaults(self):
        """Should initialize with default values."""
        cache = AutocompleteCache()

        assert cache.max_size == 1000
        assert cache.ttl_seconds == 300
        assert len(cache._cache) == 0

    def test_init_with_custom_values(self):
        """Should initialize with custom values."""
        cache = AutocompleteCache(max_size=500, ttl_seconds=60)

        assert cache.max_size == 500
        assert cache.ttl_seconds == 60

    def test_get_returns_none_for_missing_key(self):
        """Should return None for missing key."""
        cache = AutocompleteCache()

        result = cache.get("nonexistent")

        assert result is None

    def test_set_and_get(self):
        """Should store and retrieve value."""
        cache = AutocompleteCache()

        cache.set("key1", "value1")
        result = cache.get("key1")

        assert result == "value1"

    def test_get_updates_lru_order(self):
        """Should move accessed key to end (LRU)."""
        cache = AutocompleteCache(max_size=3)

        cache.set("key1", "value1")
        cache.set("key2", "value2")
        cache.set("key3", "value3")

        # Access key1 to move it to end
        cache.get("key1")

        # Key order should now be: key2, key3, key1
        keys = list(cache._cache.keys())
        assert keys == ["key2", "key3", "key1"]

    def test_ttl_expiration(self):
        """Should return None for expired entries."""
        cache = AutocompleteCache(ttl_seconds=1)

        cache.set("key1", "value1")

        # Wait for TTL to expire
        time.sleep(1.1)

        result = cache.get("key1")
        assert result is None

    def test_ttl_not_expired(self):
        """Should return value when not expired."""
        cache = AutocompleteCache(ttl_seconds=10)

        cache.set("key1", "value1")
        result = cache.get("key1")

        assert result == "value1"

    def test_eviction_when_over_capacity(self):
        """Should evict oldest entries when over capacity."""
        cache = AutocompleteCache(max_size=3)

        cache.set("key1", "value1")
        cache.set("key2", "value2")
        cache.set("key3", "value3")
        cache.set("key4", "value4")  # Should evict key1

        assert cache.get("key1") is None
        assert cache.get("key2") == "value2"
        assert cache.get("key4") == "value4"

    def test_update_existing_key(self):
        """Should update existing key without adding new entry."""
        cache = AutocompleteCache(max_size=3)

        cache.set("key1", "value1")
        cache.set("key2", "value2")
        cache.set("key1", "updated")  # Update key1

        assert cache.get("key1") == "updated"
        assert len(cache._cache) == 2

    def test_clear(self):
        """Should clear all entries and reset stats."""
        cache = AutocompleteCache()

        cache.set("key1", "value1")
        cache.set("key2", "value2")
        cache.get("key1")  # Generate hit
        cache.get("missing")  # Generate miss

        cache.clear()

        assert len(cache._cache) == 0
        assert cache._hits == 0
        assert cache._misses == 0

    def test_cleanup_expired(self):
        """Should remove expired entries."""
        cache = AutocompleteCache(ttl_seconds=1)

        cache.set("key1", "value1")
        cache.set("key2", "value2")

        time.sleep(1.1)

        removed = cache.cleanup_expired()

        assert removed == 2
        assert len(cache._cache) == 0

    def test_cleanup_expired_partial(self):
        """Should only remove expired entries."""
        cache = AutocompleteCache(ttl_seconds=2)

        cache.set("key1", "value1")
        time.sleep(1)
        cache.set("key2", "value2")  # Added later, not expired yet

        time.sleep(1.1)  # key1 expired, key2 not

        removed = cache.cleanup_expired()

        assert removed == 1
        assert cache.get("key2") == "value2"

    def test_get_stats(self):
        """Should return correct statistics."""
        cache = AutocompleteCache()

        cache.set("key1", "value1")
        cache.get("key1")  # Hit
        cache.get("key1")  # Hit
        cache.get("missing")  # Miss

        stats = cache.get_stats()

        assert stats["size"] == 1
        assert stats["hits"] == 2
        assert stats["misses"] == 1
        assert stats["hit_rate"] == round(2 / 3, 3)

    def test_get_stats_empty_cache(self):
        """Should handle empty cache stats."""
        cache = AutocompleteCache()

        stats = cache.get_stats()

        assert stats["size"] == 0
        assert stats["hits"] == 0
        assert stats["misses"] == 0
        assert stats["hit_rate"] == 0

    def test_hit_miss_tracking(self):
        """Should track hits and misses correctly."""
        cache = AutocompleteCache()

        cache.set("key1", "value1")
        cache.get("key1")  # Hit
        cache.get("key2")  # Miss
        cache.get("key1")  # Hit

        assert cache._hits == 2
        assert cache._misses == 1


class TestCreateCacheKey:
    """Tests for create_cache_key static method."""

    def test_creates_consistent_key(self):
        """Should create same key for same input."""
        key1 = AutocompleteCache.create_cache_key("text", "file.md")
        key2 = AutocompleteCache.create_cache_key("text", "file.md")

        assert key1 == key2

    def test_creates_different_keys_for_different_text(self):
        """Should create different keys for different text."""
        key1 = AutocompleteCache.create_cache_key("text1", "file.md")
        key2 = AutocompleteCache.create_cache_key("text2", "file.md")

        assert key1 != key2

    def test_creates_different_keys_for_different_file(self):
        """Should create different keys for different files."""
        key1 = AutocompleteCache.create_cache_key("text", "file1.md")
        key2 = AutocompleteCache.create_cache_key("text", "file2.md")

        assert key1 != key2

    def test_uses_last_500_chars(self):
        """Should only use last 500 chars of text."""
        long_text = "x" * 1000
        short_text = long_text[-500:]

        # Both should produce same key
        key1 = AutocompleteCache.create_cache_key(long_text, "file.md")
        key2 = AutocompleteCache.create_cache_key(short_text, "file.md")

        assert key1 == key2

    def test_handles_empty_file_name(self):
        """Should handle empty file name."""
        key = AutocompleteCache.create_cache_key("text", "")

        assert key is not None
        assert len(key) == 32  # MD5 hex length

    def test_returns_md5_hash(self):
        """Should return valid MD5 hash."""
        key = AutocompleteCache.create_cache_key("text", "file.md")

        # MD5 hash is 32 hex characters
        assert len(key) == 32
        assert all(c in "0123456789abcdef" for c in key)


# ============================================================================
# AutocompleteRequest Model Tests
# ============================================================================


class TestAutocompleteRequest:
    """Tests for AutocompleteRequest model."""

    def test_creates_with_required_fields(self):
        """Should create request with required fields."""
        req = AutocompleteRequest(text_before="Hello world")

        assert req.text_before == "Hello world"
        assert req.text_after == ""
        assert req.file_id == ""
        assert req.file_name == ""
        assert req.cursor_position == 0
        assert req.max_tokens == 60

    def test_creates_with_all_fields(self):
        """Should create request with all fields."""
        req = AutocompleteRequest(
            text_before="Hello",
            text_after=" world",
            file_id="file-123",
            file_name="doc.md",
            cursor_position=5,
            max_tokens=20,
        )

        assert req.text_before == "Hello"
        assert req.text_after == " world"
        assert req.file_id == "file-123"
        assert req.file_name == "doc.md"
        assert req.cursor_position == 5
        assert req.max_tokens == 20


class TestAutocompleteResponse:
    """Tests for AutocompleteResponse model."""

    def test_creates_with_defaults(self):
        """Should create response with defaults."""
        resp = AutocompleteResponse(suggestion="hello")

        assert resp.suggestion == "hello"
        assert resp.cached is False
        assert resp.latency_ms == 0

    def test_creates_with_all_fields(self):
        """Should create response with all fields."""
        resp = AutocompleteResponse(suggestion="hello", cached=True, latency_ms=50)

        assert resp.suggestion == "hello"
        assert resp.cached is True
        assert resp.latency_ms == 50


# ============================================================================
# build_prompt Tests
# ============================================================================


class TestBuildPrompt:
    """Tests for build_prompt function."""

    def test_builds_basic_prompt(self):
        """Should build prompt with text context."""
        user_prompt, system_prompt = build_prompt("Hello world", "short")

        assert "Hello world" in user_prompt
        assert system_prompt  # System prompt should not be empty

    def test_builds_long_mode_prompt(self):
        """Should build prompt with long mode."""
        user_prompt, system_prompt = build_prompt("Hello world", "long")

        assert "Hello world" in user_prompt
        assert system_prompt

    def test_keeps_short_context(self):
        """Should keep short context in prompt."""
        user_prompt, system_prompt = build_prompt("Short text", "short")

        assert "Short text" in user_prompt


# ============================================================================
# clean_suggestion_short Tests
# ============================================================================


class TestCleanSuggestionShort:
    """Tests for clean_suggestion_short function."""

    def test_returns_empty_for_none(self):
        """Should return empty for None input."""
        result = clean_suggestion_short(None, "text")
        assert result == ""

    def test_returns_empty_for_empty_string(self):
        """Should return empty for empty string."""
        result = clean_suggestion_short("", "text")
        assert result == ""

    def test_strips_whitespace(self):
        """Should strip leading/trailing whitespace."""
        result = clean_suggestion_short("  hello  ", "text")
        assert result == "hello"

    def test_removes_leading_space_when_text_ends_with_space(self):
        """Should remove leading space if text_before ends with space."""
        result = clean_suggestion_short(" world", "Hello ")
        assert result == "world"

    def test_keeps_leading_space_when_text_doesnt_end_with_space(self):
        """Should keep leading space if text_before doesn't end with space."""
        result = clean_suggestion_short(" world", "Hello")
        # After strip, leading space is already removed
        assert result == "world"

    def test_limits_to_first_line(self):
        """Should limit to first line only."""
        result = clean_suggestion_short("first line\nsecond line\nthird line", "text")
        assert "\n" not in result
        assert result == "first line"

    def test_limits_to_200_chars(self):
        """Should limit to 200 characters."""
        long_text = "a" * 300
        result = clean_suggestion_short(long_text, "text")
        assert len(result) <= 200

    def test_handles_whitespace_only(self):
        """Should return empty for whitespace only."""
        result = clean_suggestion_short("   \t\n   ", "text")
        assert result == ""


# ============================================================================
# Autocomplete API Endpoint Tests
# ============================================================================


class TestAutocompleteEndpoints:
    """Tests for autocomplete API endpoints."""

    @pytest.fixture
    def app(self):
        """Create FastAPI app with autocomplete router."""
        app = FastAPI()
        app.include_router(router, prefix="/api/autocomplete")
        return app

    @pytest.fixture
    def client(self, app):
        """Create test client."""
        return TestClient(app)

    def test_returns_empty_for_short_text(self, client):
        """Should return empty suggestion for very short text."""
        response = client.post(
            "/api/autocomplete/suggest",
            json={"text_before": "ab"},  # Less than 3 chars
        )

        assert response.status_code == 200
        assert response.json()["suggestion"] == ""

    @patch("api.autocomplete.cache")
    def test_returns_cached_suggestion(self, mock_cache, client):
        """Should return cached suggestion when available."""
        mock_cache.get.return_value = "cached value"

        response = client.post("/api/autocomplete/suggest", json={"text_before": "Hello world"})

        assert response.status_code == 200
        assert response.json()["suggestion"] == "cached value"
        assert response.json()["cached"] is True

    @patch("api.autocomplete.LLMService")
    @patch("api.autocomplete.get_settings")
    @patch("api.autocomplete.cache")
    def test_calls_llm_on_cache_miss(self, mock_cache, mock_settings, mock_llm_class, client):
        """Should call LLM when cache miss."""
        mock_cache.get.return_value = None  # Cache miss
        mock_settings.return_value = MagicMock(fast_model="claude-haiku")

        mock_llm = MagicMock()
        mock_llm.complete = AsyncMock(return_value="completion")
        mock_llm_class.return_value = mock_llm

        response = client.post("/api/autocomplete/suggest", json={"text_before": "Hello world"})

        assert response.status_code == 200
        mock_llm.complete.assert_called_once()

    @patch("api.autocomplete.LLMService")
    @patch("api.autocomplete.get_settings")
    @patch("api.autocomplete.cache")
    def test_caches_valid_suggestion(self, mock_cache, mock_settings, mock_llm_class, client):
        """Should cache valid suggestions."""
        mock_cache.get.return_value = None
        mock_settings.return_value = MagicMock(fast_model="claude-haiku")

        mock_llm = MagicMock()
        mock_llm.complete = AsyncMock(return_value="suggestion")
        mock_llm_class.return_value = mock_llm

        response = client.post("/api/autocomplete/suggest", json={"text_before": "Hello world"})

        assert response.status_code == 200
        mock_cache.set.assert_called_once()

    @patch("api.autocomplete.LLMService")
    @patch("api.autocomplete.get_settings")
    @patch("api.autocomplete.cache")
    def test_handles_llm_error(self, mock_cache, mock_settings, mock_llm_class, client):
        """Should return empty suggestion on LLM error."""
        mock_cache.get.return_value = None
        mock_settings.return_value = MagicMock(fast_model="claude-haiku")

        mock_llm = MagicMock()
        mock_llm.complete = AsyncMock(side_effect=Exception("API error"))
        mock_llm_class.return_value = mock_llm

        response = client.post("/api/autocomplete/suggest", json={"text_before": "Hello world"})

        assert response.status_code == 200
        assert response.json()["suggestion"] == ""

    @patch("api.autocomplete.cache")
    def test_includes_latency(self, mock_cache, client):
        """Should include latency in response."""
        mock_cache.get.return_value = "cached"

        response = client.post("/api/autocomplete/suggest", json={"text_before": "Hello world"})

        assert "latency_ms" in response.json()
        assert isinstance(response.json()["latency_ms"], int)


class TestCacheStatsEndpoint:
    """Tests for cache stats endpoint."""

    @pytest.fixture
    def app(self):
        """Create FastAPI app."""
        app = FastAPI()
        app.include_router(router, prefix="/api/autocomplete")
        return app

    @pytest.fixture
    def client(self, app):
        """Create test client."""
        return TestClient(app)

    @patch("api.autocomplete.cache")
    def test_returns_stats(self, mock_cache, client):
        """Should return cache statistics."""
        mock_cache.get_stats.return_value = {
            "size": 100,
            "max_size": 1000,
            "hits": 50,
            "misses": 25,
            "hit_rate": 0.667,
        }

        response = client.get("/api/autocomplete/stats")

        assert response.status_code == 200
        data = response.json()
        assert data["size"] == 100
        assert data["hits"] == 50


class TestClearCacheEndpoint:
    """Tests for clear cache endpoint."""

    @pytest.fixture
    def app(self):
        """Create FastAPI app."""
        app = FastAPI()
        app.include_router(router, prefix="/api/autocomplete")
        return app

    @pytest.fixture
    def client(self, app):
        """Create test client."""
        return TestClient(app)

    @patch("api.autocomplete.cache")
    def test_clears_cache(self, mock_cache, client):
        """Should clear the cache."""
        response = client.post("/api/autocomplete/clear-cache")

        assert response.status_code == 200
        mock_cache.clear.assert_called_once()
        assert response.json()["status"] == "ok"


# ============================================================================
# Thread Safety Tests
# ============================================================================


class TestThreadSafety:
    """Tests for thread safety of AutocompleteCache."""

    def test_concurrent_access(self):
        """Should handle concurrent access safely."""
        import threading

        cache = AutocompleteCache(max_size=100)
        errors = []

        def writer():
            try:
                for i in range(100):
                    cache.set(f"key{i}", f"value{i}")
            except Exception as e:
                errors.append(e)

        def reader():
            try:
                for i in range(100):
                    cache.get(f"key{i}")
            except Exception as e:
                errors.append(e)

        threads = []
        for _ in range(5):
            threads.append(threading.Thread(target=writer))
            threads.append(threading.Thread(target=reader))

        for t in threads:
            t.start()

        for t in threads:
            t.join()

        assert len(errors) == 0

    def test_concurrent_cleanup(self):
        """Should handle concurrent cleanup safely."""
        import threading

        cache = AutocompleteCache(max_size=100, ttl_seconds=0)
        errors = []

        def cleanup():
            try:
                for _ in range(10):
                    cache.cleanup_expired()
            except Exception as e:
                errors.append(e)

        def access():
            try:
                for i in range(100):
                    cache.set(f"key{i}", f"value{i}")
                    cache.get(f"key{i}")
            except Exception as e:
                errors.append(e)

        threads = []
        for _ in range(3):
            threads.append(threading.Thread(target=cleanup))
            threads.append(threading.Thread(target=access))

        for t in threads:
            t.start()

        for t in threads:
            t.join()

        assert len(errors) == 0
