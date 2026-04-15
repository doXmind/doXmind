"""Token counting helpers — local desktop edition.

Approximates with tiktoken's cl100k_base encoder (works for OpenRouter Claude
and Gemini routes well enough for budgeting). Falls back to a char-based
heuristic if tiktoken isn't installed.
"""

from functools import lru_cache


@lru_cache(maxsize=1)
def _get_encoder():
    try:
        import tiktoken

        return tiktoken.get_encoding("cl100k_base")
    except Exception:
        return None


def count_tokens(text: str) -> int:
    if not text:
        return 0
    enc = _get_encoder()
    if enc is None:
        return max(1, len(text) // 4)
    try:
        return len(enc.encode(text))
    except Exception:
        return max(1, len(text) // 4)


def truncate_to_token_limit(text: str, max_tokens: int) -> str:
    if not text or max_tokens <= 0:
        return ""
    enc = _get_encoder()
    if enc is None:
        approx = max_tokens * 4
        return text[:approx]
    try:
        ids = enc.encode(text)
        if len(ids) <= max_tokens:
            return text
        return enc.decode(ids[:max_tokens])
    except Exception:
        return text[: max_tokens * 4]
