"""
Autocomplete Cache Service

Thread-safe LRU cache with TTL support for autocomplete suggestions.
Reduces API calls and improves response latency.
"""

import hashlib
import threading
import time
from collections import OrderedDict


class AutocompleteCache:
    """Thread-safe LRU cache with TTL support for autocomplete suggestions."""

    def __init__(self, max_size: int = 1000, ttl_seconds: int = 300):
        """
        Initialize the cache.

        Args:
            max_size: Maximum number of entries to store
            ttl_seconds: Time-to-live for cache entries in seconds
        """
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self._cache: OrderedDict[str, tuple[str, float]] = OrderedDict()
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0

    def get(self, key: str) -> str | None:
        """
        Get value from cache if exists and not expired.

        Args:
            key: Cache key

        Returns:
            Cached suggestion or None if not found/expired
        """
        with self._lock:
            if key not in self._cache:
                self._misses += 1
                return None

            value, timestamp = self._cache[key]

            # Check TTL
            if time.time() - timestamp > self.ttl_seconds:
                del self._cache[key]
                self._misses += 1
                return None

            # Move to end (LRU update)
            self._cache.move_to_end(key)
            self._hits += 1
            return value

    def set(self, key: str, value: str) -> None:
        """
        Set value in cache.

        Args:
            key: Cache key
            value: Suggestion to cache
        """
        with self._lock:
            # Update existing entry
            if key in self._cache:
                self._cache.move_to_end(key)

            self._cache[key] = (value, time.time())

            # Evict oldest entries if over capacity
            while len(self._cache) > self.max_size:
                self._cache.popitem(last=False)

    def clear(self) -> None:
        """Clear all cache entries."""
        with self._lock:
            self._cache.clear()
            self._hits = 0
            self._misses = 0

    def cleanup_expired(self) -> int:
        """
        Remove expired entries.

        Returns:
            Count of removed entries
        """
        removed = 0
        current_time = time.time()

        with self._lock:
            expired_keys = [
                key
                for key, (_, timestamp) in self._cache.items()
                if current_time - timestamp > self.ttl_seconds
            ]
            for key in expired_keys:
                del self._cache[key]
                removed += 1

        return removed

    def get_stats(self) -> dict:
        """
        Get cache statistics.

        Returns:
            Dictionary with cache stats
        """
        with self._lock:
            total = self._hits + self._misses
            hit_rate = self._hits / total if total > 0 else 0
            return {
                "size": len(self._cache),
                "max_size": self.max_size,
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": round(hit_rate, 3),
            }

    @staticmethod
    def create_cache_key(text_before: str, file_name: str = "", extra: str = "") -> str:
        """
        Create a cache key from the context.

        Uses the last 500 characters of text_before for the key,
        as similar contexts should produce similar completions.

        Args:
            text_before: Text before cursor
            file_name: Optional file name for context
            extra: Optional extra data (e.g., mode, open files) for cache key

        Returns:
            MD5 hash of the context
        """
        # Use last 500 chars as they're most relevant for completion
        context = text_before[-500:] if len(text_before) > 500 else text_before
        key_string = f"{context}|{file_name}|{extra}"
        return hashlib.md5(key_string.encode()).hexdigest()
