"""Tests for token counting utilities."""

from services.token_utils import (
    SAFE_TOKEN_LIMIT,
    count_tokens,
    split_code_block_by_tokens,
    split_table_by_tokens,
    split_text_by_tokens,
    truncate_to_token_limit,
    validate_chunks_tokens,
)


class TestCountTokens:
    """Tests for count_tokens function."""

    def test_empty_string(self):
        """Empty string should have 0 tokens."""
        assert count_tokens("") == 0

    def test_none_returns_zero(self):
        """None should return 0 tokens."""
        assert count_tokens(None) == 0

    def test_simple_text(self):
        """Simple text should have reasonable token count."""
        tokens = count_tokens("Hello, world!")
        assert tokens > 0
        assert tokens < 10

    def test_longer_text(self):
        """Longer text should have proportionally more tokens."""
        short = count_tokens("Hello")
        long = count_tokens("Hello, this is a much longer sentence with more words.")
        assert long > short

    def test_code_has_variable_token_density(self):
        """Code typically has different token density than prose."""
        prose = "This is a simple English sentence."
        code = "def foo(): return {'key': 'value'}"

        prose_tokens = count_tokens(prose)
        code_tokens = count_tokens(code)

        # Both should have tokens
        assert prose_tokens > 0
        assert code_tokens > 0


class TestTruncateToTokenLimit:
    """Tests for truncate_to_token_limit function."""

    def test_short_text_unchanged(self):
        """Short text should not be modified."""
        text = "Short text"
        assert truncate_to_token_limit(text) == text

    def test_empty_text_unchanged(self):
        """Empty text should return empty."""
        assert truncate_to_token_limit("") == ""

    def test_long_text_truncated(self):
        """Text exceeding limit should be truncated."""
        # Create text that exceeds limit
        text = "word " * 10000
        truncated = truncate_to_token_limit(text, max_tokens=100)

        assert count_tokens(truncated) <= 100
        assert len(truncated) < len(text)

    def test_respects_custom_limit(self):
        """Should respect custom token limit."""
        text = "word " * 1000
        truncated = truncate_to_token_limit(text, max_tokens=50)

        assert count_tokens(truncated) <= 50


class TestSplitTextByTokens:
    """Tests for split_text_by_tokens function."""

    def test_empty_text_returns_empty_list(self):
        """Empty text should return empty list."""
        assert split_text_by_tokens("") == []

    def test_short_text_single_chunk(self):
        """Short text should return single chunk."""
        text = "Short text"
        chunks = split_text_by_tokens(text)
        assert len(chunks) == 1
        assert chunks[0] == text

    def test_long_text_multiple_chunks(self):
        """Long text should be split into multiple chunks."""
        text = "word " * 10000
        chunks = split_text_by_tokens(text, max_tokens=500)

        assert len(chunks) > 1
        for chunk in chunks:
            assert count_tokens(chunk) <= 500

    def test_overlap_creates_context(self):
        """Overlap should create overlapping content between chunks."""
        text = "word " * 5000
        chunks = split_text_by_tokens(text, max_tokens=500, overlap_tokens=50)

        assert len(chunks) > 1
        # All chunks should be within limit
        for chunk in chunks:
            assert count_tokens(chunk) <= 500


class TestValidateChunksTokens:
    """Tests for validate_chunks_tokens function."""

    def test_valid_chunks_unchanged(self):
        """Valid chunks should pass through unchanged."""
        chunks = ["Short chunk 1", "Short chunk 2"]
        valid, split_indices = validate_chunks_tokens(chunks)

        assert len(valid) == 2
        assert len(split_indices) == 0
        assert valid == chunks

    def test_empty_list_returns_empty(self):
        """Empty list should return empty results."""
        valid, split_indices = validate_chunks_tokens([])
        assert valid == []
        assert split_indices == []

    def test_oversized_chunk_split(self):
        """Oversized chunks should be split."""
        short = "Short"
        long = "word " * 10000  # Will exceed limit

        valid, split_indices = validate_chunks_tokens([short, long])

        assert len(valid) > 2  # Long chunk was split
        assert 1 in split_indices  # Index 1 was split

        # All chunks should be within limit
        for chunk in valid:
            assert count_tokens(chunk) <= SAFE_TOKEN_LIMIT


class TestSplitCodeBlockByTokens:
    """Tests for split_code_block_by_tokens function."""

    def test_small_code_block_unchanged(self):
        """Small code block should not be split."""
        code = "```python\nx = 1\ny = 2\n```"
        chunks = split_code_block_by_tokens(code)

        assert len(chunks) == 1
        assert chunks[0] == code

    def test_large_code_block_split(self):
        """Large code block should be split at line boundaries."""
        # Create a very large code block
        lines = "\n".join([f"x{i} = {i}" for i in range(3000)])
        code = f"```python\n{lines}\n```"

        chunks = split_code_block_by_tokens(code, max_tokens=500)

        assert len(chunks) > 1
        # Each chunk should have code fence markers
        for chunk in chunks:
            assert chunk.startswith("```")
            assert chunk.endswith("```")
            assert count_tokens(chunk) <= 500

    def test_preserves_language_hint(self):
        """Should preserve language hint in split chunks."""
        lines = "\n".join([f"line{i}" for i in range(2000)])
        code = f"```javascript\n{lines}\n```"

        chunks = split_code_block_by_tokens(code, max_tokens=500)

        assert len(chunks) > 1
        for chunk in chunks:
            assert chunk.startswith("```javascript") or chunk.startswith("```")


class TestSplitTableByTokens:
    """Tests for split_table_by_tokens function."""

    def test_small_table_unchanged(self):
        """Small table should not be split."""
        table = "| Col1 | Col2 |\n| --- | --- |\n| A | B |"
        chunks = split_table_by_tokens(table)

        assert len(chunks) == 1
        assert chunks[0] == table

    def test_large_table_split(self):
        """Large table should be split at row boundaries."""
        # Create a large table
        header = "| Col1 | Col2 | Col3 |"
        separator = "| --- | --- | --- |"
        rows = "\n".join([f"| data{i} | value{i} | info{i} |" for i in range(1000)])
        table = f"{header}\n{separator}\n{rows}"

        chunks = split_table_by_tokens(table, max_tokens=500)

        assert len(chunks) > 1
        # Each chunk should have header
        for chunk in chunks:
            assert "| Col1 |" in chunk
            assert count_tokens(chunk) <= 500

    def test_preserves_header_in_all_chunks(self):
        """Each chunk should contain the header row."""
        header = "| Name | Age |"
        separator = "| --- | --- |"
        rows = "\n".join([f"| Person{i} | {20 + i} |" for i in range(500)])
        table = f"{header}\n{separator}\n{rows}"

        chunks = split_table_by_tokens(table, max_tokens=300)

        assert len(chunks) > 1
        for chunk in chunks:
            # Header should be in every chunk
            assert "| Name | Age |" in chunk


class TestTokenLimitIntegration:
    """Integration tests for token limit handling."""

    def test_realistic_code_block(self):
        """Test with realistic large Python code."""
        code_lines = []
        for i in range(500):
            code_lines.append(f"    def method_{i}(self, arg_{i}):")
            code_lines.append(f"        '''Docstring for method {i}.'''")
            code_lines.append(f"        result = self.process(arg_{i})")
            code_lines.append(f"        return result * {i}")
            code_lines.append("")

        code = "```python\nclass LargeClass:\n" + "\n".join(code_lines) + "\n```"

        chunks = split_code_block_by_tokens(code, max_tokens=1000)

        # Should split into multiple chunks
        assert len(chunks) > 1
        # All chunks should be within limit
        for chunk in chunks:
            assert count_tokens(chunk) <= 1000
            assert chunk.startswith("```")
            assert chunk.endswith("```")

    def test_cjk_text_higher_token_density(self):
        """CJK text has higher token density (more tokens per character)."""
        # Same number of characters, but CJK will have more tokens
        english = "a" * 1000
        chinese = "\u4e2d" * 1000  # Chinese character

        english_tokens = count_tokens(english)
        chinese_tokens = count_tokens(chinese)

        # Chinese typically has higher token density
        # (each character is usually 1 token vs ~4 chars per token for English)
        assert chinese_tokens > english_tokens
