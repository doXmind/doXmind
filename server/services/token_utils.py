"""Token counting utilities.

This module provides token counting and text truncation helpers
used by autocomplete context assembly and other services.
"""

import logging

import tiktoken

logger = logging.getLogger(__name__)

# cl100k_base encoding (used by GPT-4, Claude tokenizer is similar enough)
TOKEN_ENCODING = "cl100k_base"
MAX_TOKENS = 8192
SAFE_TOKEN_LIMIT = 8000  # Leave buffer for safety

# Cache the encoding for performance
_encoding: tiktoken.Encoding | None = None


def get_encoding() -> tiktoken.Encoding:
    """Get cached tiktoken encoding."""
    global _encoding
    if _encoding is None:
        _encoding = tiktoken.get_encoding(TOKEN_ENCODING)
    return _encoding


def count_tokens(text: str) -> int:
    """Count tokens in text using tiktoken.

    Args:
        text: Text to count tokens for

    Returns:
        Number of tokens in the text
    """
    if not text:
        return 0
    encoding = get_encoding()
    return len(encoding.encode(text))


def truncate_to_token_limit(text: str, max_tokens: int = SAFE_TOKEN_LIMIT) -> str:
    """Truncate text to fit within token limit.

    Args:
        text: Text to truncate
        max_tokens: Maximum allowed tokens (default: 8000)

    Returns:
        Truncated text that fits within the limit
    """
    if not text:
        return text

    encoding = get_encoding()
    tokens = encoding.encode(text)

    if len(tokens) <= max_tokens:
        return text

    # Truncate and decode
    truncated_tokens = tokens[:max_tokens]
    truncated_text = encoding.decode(truncated_tokens)

    logger.warning(
        f"Truncated text from {len(tokens)} to {max_tokens} tokens "
        f"({len(text)} to {len(truncated_text)} chars)"
    )

    return truncated_text


def split_text_by_tokens(
    text: str,
    max_tokens: int = SAFE_TOKEN_LIMIT,
    overlap_tokens: int = 100,
) -> list[str]:
    """Split text into chunks that fit within token limit.

    Used as fallback when character-based chunking produces oversized chunks.

    Args:
        text: Text to split
        max_tokens: Maximum tokens per chunk (default: 8000)
        overlap_tokens: Token overlap between chunks for context (default: 100)

    Returns:
        List of text chunks, each within the token limit
    """
    if not text:
        return []

    encoding = get_encoding()
    tokens = encoding.encode(text)

    if len(tokens) <= max_tokens:
        return [text]

    chunks = []
    start = 0

    while start < len(tokens):
        end = min(start + max_tokens, len(tokens))
        chunk_tokens = tokens[start:end]
        chunk_text = encoding.decode(chunk_tokens)
        chunks.append(chunk_text)

        # Move start forward, accounting for overlap
        start = end - overlap_tokens if end < len(tokens) else end

    logger.info(f"Split {len(tokens)} tokens into {len(chunks)} chunks")
    return chunks


def validate_chunks_tokens(chunks: list[str]) -> tuple[list[str], list[int]]:
    """Validate and fix chunks that exceed token limits.

    Args:
        chunks: List of text chunks to validate

    Returns:
        Tuple of (valid_chunks, indices_of_split_chunks)
        - valid_chunks: All chunks guaranteed to be within token limits
        - indices_of_split_chunks: Original indices of chunks that were split
    """
    valid_chunks: list[str] = []
    split_indices: list[int] = []

    for i, chunk in enumerate(chunks):
        token_count = count_tokens(chunk)

        if token_count <= SAFE_TOKEN_LIMIT:
            valid_chunks.append(chunk)
        else:
            # Split oversized chunk
            split_indices.append(i)
            sub_chunks = split_text_by_tokens(chunk)
            valid_chunks.extend(sub_chunks)
            logger.warning(
                f"Chunk {i} exceeded token limit ({token_count} tokens), "
                f"split into {len(sub_chunks)} sub-chunks"
            )

    return valid_chunks, split_indices


def split_code_block_by_tokens(
    code_block: str,
    max_tokens: int = SAFE_TOKEN_LIMIT,
) -> list[str]:
    """Split an oversized code block at line boundaries.

    Preserves code fence markers (```) in each chunk.

    Args:
        code_block: Code block text (with ``` markers)
        max_tokens: Maximum tokens per chunk

    Returns:
        List of code block chunks, each within token limit
    """
    # Extract language hint and content
    lines = code_block.split("\n")
    if not lines:
        return [code_block]

    # Check if it starts with code fence
    has_fence = lines[0].startswith("```")
    language_hint = lines[0] if has_fence else "```"
    content_lines = lines[1:-1] if has_fence and lines[-1] == "```" else lines

    if not content_lines:
        return [code_block]

    # Check if whole block fits
    if count_tokens(code_block) <= max_tokens:
        return [code_block]

    # Split at line boundaries
    chunks = []
    current_lines: list[str] = []
    # Reserve tokens for fence markers
    fence_overhead = count_tokens(f"{language_hint}\n\n```")
    effective_max = max_tokens - fence_overhead - 50  # Extra buffer

    current_tokens = 0

    for line in content_lines:
        line_tokens = count_tokens(line + "\n")

        if current_tokens + line_tokens > effective_max and current_lines:
            # Finalize current chunk
            chunk_content = "\n".join(current_lines)
            chunk = f"{language_hint}\n{chunk_content}\n```"
            chunks.append(chunk)

            current_lines = [line]
            current_tokens = line_tokens
        else:
            current_lines.append(line)
            current_tokens += line_tokens

    # Don't forget the last chunk
    if current_lines:
        chunk_content = "\n".join(current_lines)
        chunk = f"{language_hint}\n{chunk_content}\n```"
        chunks.append(chunk)

    logger.info(f"Split code block into {len(chunks)} chunks")
    return chunks


def split_table_by_tokens(
    table: str,
    max_tokens: int = SAFE_TOKEN_LIMIT,
) -> list[str]:
    """Split an oversized table at row boundaries.

    Preserves header rows in each chunk for context.

    Args:
        table: Markdown table text
        max_tokens: Maximum tokens per chunk

    Returns:
        List of table chunks, each within token limit
    """
    lines = table.strip().split("\n")
    if len(lines) <= 2:
        return [table]

    # Check if whole table fits
    if count_tokens(table) <= max_tokens:
        return [table]

    # Identify header (first line) and separator (second line with dashes)
    header_lines: list[str] = []
    data_lines: list[str] = []

    for i, line in enumerate(lines):
        if i == 0 or i == 1 and "|" in line and "-" in line:
            header_lines.append(line)
        else:
            data_lines.append(line)

    if not data_lines:
        return [table]

    # Reserve tokens for header
    header_text = "\n".join(header_lines)
    header_tokens = count_tokens(header_text + "\n")
    effective_max = max_tokens - header_tokens - 50  # Buffer

    # Split data rows
    chunks = []
    current_rows: list[str] = []
    current_tokens = 0

    for row in data_lines:
        row_tokens = count_tokens(row + "\n")

        if current_tokens + row_tokens > effective_max and current_rows:
            # Finalize current chunk
            chunk = header_text + "\n" + "\n".join(current_rows)
            chunks.append(chunk)

            current_rows = [row]
            current_tokens = row_tokens
        else:
            current_rows.append(row)
            current_tokens += row_tokens

    # Don't forget the last chunk
    if current_rows:
        chunk = header_text + "\n" + "\n".join(current_rows)
        chunks.append(chunk)

    logger.info(f"Split table into {len(chunks)} chunks")
    return chunks
