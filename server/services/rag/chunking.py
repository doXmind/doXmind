"""Text chunking strategies for the RAG system.

Provides multiple strategies for splitting documents into chunks
suitable for vector embedding and search:
- OverlapChunkingStrategy: Fixed-size windows with overlap
- MarkdownSentenceChunkingStrategy: Section-aware for HTML/Markdown
- SentenceChunkingStrategy: Legacy sentence-level chunking
- SemanticChunkingStrategy: Semantic boundary-aware chunking
- RecursiveMarkdownChunkingStrategy: Hierarchical Markdown splitting
- ChunkingStrategyFactory: Auto-detection and creation
"""

import html as html_module
import logging
import re
from abc import ABC, abstractmethod
from enum import Enum
from typing import Any

from config import get_settings
from services.document_detector import DocumentType, DocumentTypeDetector
from services.token_utils import (
    SAFE_TOKEN_LIMIT,
    count_tokens,
    split_code_block_by_tokens,
    split_table_by_tokens,
    truncate_to_token_limit,
)

logger = logging.getLogger(__name__)


# ============================================================================
# Base Class
# ============================================================================


class ChunkingStrategy(ABC):
    """Abstract base class for text chunking strategies."""

    @abstractmethod
    def chunk(self, text: str) -> list[str]:
        """Split text into chunks."""
        pass


# ============================================================================
# Strategy Implementations
# ============================================================================


class OverlapChunkingStrategy(ChunkingStrategy):
    """Chunk text with overlapping windows.

    Good for general document search where context matters.
    """

    def __init__(self, chunk_size: int = 1000, overlap: int = 200):
        self.chunk_size = chunk_size
        self.overlap = overlap

    def chunk(self, text: str) -> list[str]:
        if not text.strip():
            return []

        chunks = []
        start = 0

        while start < len(text):
            end = start + self.chunk_size
            chunk = text[start:end]

            # Try to break at sentence boundary
            if end < len(text):
                for sep in ["\u3002", ".", "\n\n", "\n"]:
                    last_sep = chunk.rfind(sep)
                    if last_sep > self.chunk_size // 2:
                        chunk = chunk[: last_sep + 1]
                        end = start + last_sep + 1
                        break

            chunk = chunk.strip()
            if chunk:
                chunks.append(chunk)

            start = end - self.overlap

        return chunks


class MarkdownSentenceChunkingStrategy(ChunkingStrategy):
    """Section-aware chunking for Markdown/HTML documents.

    Leverages document structure for precise in-document search:
    1. Headers become separate chunks (with level preserved)
    2. List items are individual chunks
    3. Paragraphs are split into sentences
    4. Code blocks and tables are kept intact

    Handles both Markdown and HTML input (from TipTap editor).
    """

    def __init__(self, min_length: int = 5, max_chunk_size: int = 1000):
        """Initialize with structure-aware chunking settings.

        Args:
            min_length: Minimum chunk length (default 5, lowered to include short but meaningful content)
            max_chunk_size: Maximum chunk size before splitting into sentences
        """
        self.min_length = min_length
        self.max_chunk_size = max_chunk_size
        # Regex patterns
        self.header_pattern = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
        self.code_block_pattern = re.compile(r"```[\w]*\n[\s\S]*?```", re.MULTILINE)
        self.list_item_pattern = re.compile(r"^(\s*[-*+]|\s*\d+\.)\s+", re.MULTILINE)

    def _html_to_markdown(self, html: str) -> str:
        """Convert HTML to Markdown-like plain text, preserving structure."""
        text = html

        # Convert headers
        for i in range(1, 7):
            text = re.sub(
                rf"<h{i}[^>]*>(.*?)</h{i}>",
                rf"{'#' * i} \1\n",
                text,
                flags=re.DOTALL | re.IGNORECASE,
            )

        # Convert HTML tables to markdown-style rows (each row on its own line)
        def convert_table_row(match: re.Match) -> str:
            row_html = match.group(1)
            # Extract cell contents
            cells = re.findall(
                r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, flags=re.DOTALL | re.IGNORECASE
            )
            if cells:
                # Strip HTML from cells and join with |
                clean_cells = [re.sub(r"<[^>]+>", "", cell).strip() for cell in cells]
                return "| " + " | ".join(clean_cells) + " |\n"
            return ""

        text = re.sub(
            r"<tr[^>]*>(.*?)</tr>", convert_table_row, text, flags=re.DOTALL | re.IGNORECASE
        )

        # Remove table wrapper tags
        text = re.sub(r"</?table[^>]*>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"</?thead[^>]*>", "", text, flags=re.IGNORECASE)
        text = re.sub(r"</?tbody[^>]*>", "", text, flags=re.IGNORECASE)

        # Convert list items
        text = re.sub(r"<li[^>]*>(.*?)</li>", r"- \1\n", text, flags=re.DOTALL | re.IGNORECASE)

        # Convert paragraphs to newlines
        text = re.sub(r"<p[^>]*>(.*?)</p>", r"\1\n\n", text, flags=re.DOTALL | re.IGNORECASE)

        # Convert line breaks
        text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)

        # Convert code blocks
        text = re.sub(
            r"<pre[^>]*><code[^>]*>(.*?)</code></pre>",
            r"```\n\1\n```",
            text,
            flags=re.DOTALL | re.IGNORECASE,
        )
        text = re.sub(r"<code[^>]*>(.*?)</code>", r"`\1`", text, flags=re.DOTALL | re.IGNORECASE)

        # Convert bold/italic
        text = re.sub(
            r"<strong[^>]*>(.*?)</strong>", r"**\1**", text, flags=re.DOTALL | re.IGNORECASE
        )
        text = re.sub(r"<b[^>]*>(.*?)</b>", r"**\1**", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<em[^>]*>(.*?)</em>", r"*\1*", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<i[^>]*>(.*?)</i>", r"*\1*", text, flags=re.DOTALL | re.IGNORECASE)

        # Convert links
        text = re.sub(
            r"<a[^>]*href=[\"']([^\"']*)[\"'][^>]*>(.*?)</a>",
            r"[\2](\1)",
            text,
            flags=re.DOTALL | re.IGNORECASE,
        )

        # Remove remaining HTML tags
        text = re.sub(r"<[^>]+>", "", text)

        # Decode all HTML entities
        text = html_module.unescape(text)

        # Clean up excessive whitespace
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r"[ \t]+", " ", text)

        return text.strip()

    def chunk(self, text: str) -> list[str]:
        if not text.strip():
            return []

        # Convert HTML to Markdown if needed
        if "<" in text and ">" in text:
            text = self._html_to_markdown(text)

        chunks: list[str] = []

        # 1. Extract and protect code blocks
        code_blocks: dict[str, str] = {}
        code_block_idx = 0

        def protect_code(match: re.Match) -> str:
            nonlocal code_block_idx
            placeholder = f"__CODE_BLOCK_{code_block_idx}__"
            code_blocks[placeholder] = match.group(0)
            code_block_idx += 1
            return placeholder

        protected_text = self.code_block_pattern.sub(protect_code, text)

        # 2. Split by headers to get sections
        sections = self._split_by_headers(protected_text)

        # 3. Process each section
        for section in sections:
            section_chunks = self._process_section(section)
            chunks.extend(section_chunks)

        # 4. Restore code blocks, split by lines, clean up, and filter by min_length
        final_chunks: list[str] = []
        for chunk in chunks:
            # Check if chunk contains a code block placeholder
            has_code_block = False
            for placeholder, code in code_blocks.items():
                if placeholder in chunk:
                    has_code_block = True
                    # Split code block by lines for granular search
                    code_lines = code.split("\n")
                    for line in code_lines:
                        line = line.strip()
                        # Skip empty lines and fence markers
                        if line and not line.startswith("```"):
                            final_chunks.append(line)
                    break

            if has_code_block:
                continue

            # Final cleanup: remove any stray HTML tags
            chunk = re.sub(r"<[^>]+>", "", chunk)
            chunk = chunk.strip()

            if len(chunk) >= self.min_length:
                final_chunks.append(chunk)

        return final_chunks

    def _split_by_headers(self, text: str) -> list[dict]:
        """Split text into sections based on headers."""
        sections: list[dict] = []
        lines = text.split("\n")
        current_section: dict = {"header": None, "level": 0, "content": []}

        for line in lines:
            header_match = self.header_pattern.match(line)
            if header_match:
                # Save current section if it has content
                if current_section["content"] or current_section["header"]:
                    sections.append(current_section)

                # Start new section
                level = len(header_match.group(1))
                header_text = header_match.group(2).strip()
                current_section = {"header": header_text, "level": level, "content": []}
            else:
                current_section["content"].append(line)

        # Don't forget the last section
        if current_section["content"] or current_section["header"]:
            sections.append(current_section)

        return sections

    def _process_section(self, section: dict) -> list[str]:
        """Process a section into chunks."""
        chunks: list[str] = []

        # Add header as its own chunk (with markdown syntax preserved)
        if section["header"]:
            header_prefix = "#" * section["level"]
            chunks.append(f"{header_prefix} {section['header']}")

        # Process content
        content = "\n".join(section["content"])
        if not content.strip():
            return chunks

        # Check if content is a list
        lines = content.split("\n")
        current_list_item: list[str] = []
        in_list = False

        for line in lines:
            is_list_item = bool(self.list_item_pattern.match(line))

            if is_list_item:
                # Save previous list item if exists
                if current_list_item:
                    chunks.append("\n".join(current_list_item))
                current_list_item = [line]
                in_list = True
            elif in_list and line.strip() and line.startswith("  "):
                # Continuation of list item (indented)
                current_list_item.append(line)
            elif in_list and not line.strip():
                # Empty line - might end list or be between items
                if current_list_item:
                    chunks.append("\n".join(current_list_item))
                    current_list_item = []
                in_list = False
            else:
                # Not a list item
                if current_list_item:
                    chunks.append("\n".join(current_list_item))
                    current_list_item = []
                    in_list = False

                # Process as paragraph/text
                if line.strip():
                    # Check for code block placeholder
                    if "__CODE_BLOCK_" in line:
                        chunks.append(line.strip())
                    # Check for table
                    elif line.strip().startswith("|") and line.strip().endswith("|"):
                        # Collect entire table
                        chunks.append(line.strip())
                    else:
                        # Regular text - add as paragraph chunk
                        # Split long paragraphs into sentences
                        if len(line) > self.max_chunk_size:
                            sentences = self._split_sentences(line)
                            chunks.extend(sentences)
                        else:
                            chunks.append(line.strip())

        # Don't forget last list item
        if current_list_item:
            chunks.append("\n".join(current_list_item))

        return chunks

    def _split_sentences(self, text: str) -> list[str]:
        """Split text into sentences."""
        # Split on sentence endings
        parts = re.split(r"(?<=[.!?。！？])\s+", text)
        return [p.strip() for p in parts if p.strip() and len(p.strip()) >= self.min_length]


class SentenceChunkingStrategy(ChunkingStrategy):
    """Legacy sentence chunking strategy (kept for backwards compatibility).

    For new code, prefer MarkdownSentenceChunkingStrategy which is section-aware.

    Handles special content types:
    - Preserves code blocks as single chunks
    - Groups ASCII diagrams and tables together
    - Filters out fragments that are too short to be meaningful
    """

    # Box-drawing and table characters that indicate ASCII diagrams
    DIAGRAM_CHARS = set("│├└┘┐┌─┬┴┼▶▷◀◁►◄═║╔╗╚╝╠╣╦╩╬┃┏┓┗┛┣┫┳┻╋|+-")

    def __init__(self, min_length: int = 30, max_chunk_size: int = 500):
        self.min_length = min_length
        self.max_chunk_size = max_chunk_size

    def chunk(self, text: str) -> list[str]:
        if not text.strip():
            return []

        # 1. Extract and preserve code blocks
        code_blocks: list[tuple[int, str]] = []
        code_pattern = r"```[\s\S]*?```|`[^`\n]+`"

        def extract_code(match: re.Match) -> str:
            code_blocks.append((match.start(), match.group()))
            return f"__CODE_BLOCK_{len(code_blocks) - 1}__"

        processed_text = re.sub(code_pattern, extract_code, text)

        # 2. Strip HTML tags
        clean_text = re.sub(r"<[^>]+>", " ", processed_text)

        # 3. Split into lines first to identify diagram blocks
        lines = clean_text.split("\n")
        blocks: list[str] = []
        current_block: list[str] = []
        in_diagram = False

        for line in lines:
            is_diagram_line = self._is_diagram_line(line)

            if is_diagram_line:
                # If we were collecting non-diagram text, save it
                if current_block and not in_diagram:
                    blocks.append("\n".join(current_block))
                    current_block = []
                in_diagram = True
                current_block.append(line)
            else:
                # If we were in a diagram, save it
                if in_diagram and current_block:
                    blocks.append("\n".join(current_block))
                    current_block = []
                    in_diagram = False

                if line.strip():
                    current_block.append(line)
                elif current_block:
                    # Empty line - paragraph break
                    blocks.append("\n".join(current_block))
                    current_block = []

        if current_block:
            blocks.append("\n".join(current_block))

        # 4. Process each block into sentences
        chunks: list[str] = []
        for block in blocks:
            # Check if it's a diagram or code block placeholder
            if self._is_diagram_block(block):
                # Keep diagrams as single chunk if not too long
                if len(block) <= self.max_chunk_size:
                    chunks.append(block)
                continue

            # Check if it's a code block placeholder
            code_match = re.match(r"__CODE_BLOCK_(\d+)__", block.strip())
            if code_match:
                idx = int(code_match.group(1))
                if idx < len(code_blocks):
                    code_content = code_blocks[idx][1]
                    if len(code_content) <= self.max_chunk_size:
                        chunks.append(code_content)
                continue

            # Split normal text into sentences
            sentences = self._split_into_sentences(block)
            chunks.extend(sentences)

        # 5. Restore any remaining code block placeholders
        final_chunks: list[str] = []
        for chunk in chunks:
            restored = chunk
            for i, (_, code_content) in enumerate(code_blocks):
                placeholder = f"__CODE_BLOCK_{i}__"
                if placeholder in restored:
                    restored = restored.replace(placeholder, code_content)
            if len(restored.strip()) >= self.min_length:
                final_chunks.append(restored.strip())

        return final_chunks

    def _is_diagram_line(self, line: str) -> bool:
        """Check if a line is part of an ASCII diagram or table."""
        if not line.strip():
            return False

        # Count diagram characters
        diagram_count = sum(1 for c in line if c in self.DIAGRAM_CHARS)

        # If more than 10% of non-space chars are diagram chars, it's a diagram line
        non_space = len(line.replace(" ", ""))
        if non_space > 0 and diagram_count / non_space > 0.1:
            return True

        # Check for markdown table format
        return bool(re.match(r"^\s*\|.*\|.*$", line))

    def _is_diagram_block(self, block: str) -> bool:
        """Check if an entire block is a diagram/table."""
        lines = block.split("\n")
        if not lines:
            return False

        diagram_lines = sum(1 for line in lines if self._is_diagram_line(line))
        return diagram_lines / len(lines) > 0.5

    def _split_into_sentences(self, text: str) -> list[str]:
        """Split text into sentences with improved boundary detection."""
        # Don't split on:
        # - Numbered list markers (1. 2. etc.)
        # - Common abbreviations
        # - URLs and file paths

        # First, protect special patterns
        protected: list[tuple[str, str]] = []

        def protect(match: re.Match) -> str:
            protected.append((f"__PROT_{len(protected)}__", match.group()))
            return protected[-1][0]

        # Protect URLs
        text = re.sub(r"https?://[^\s]+", protect, text)
        # Protect file paths with extensions
        text = re.sub(r"\b[\w/\\]+\.\w{1,5}\b", protect, text)
        # Protect numbered list markers
        text = re.sub(r"(?<=\s)(\d+\.)\s", protect, text)
        # Protect common abbreviations
        text = re.sub(r"\b(e\.g\.|i\.e\.|etc\.|vs\.|Dr\.|Mr\.|Mrs\.|Ms\.)", protect, text)

        # Split on sentence endings
        # Chinese: 。！？  English: .!? followed by space or end
        parts = re.split(r"(?<=[。！？])|(?<=[.!?])(?=\s|$)", text)

        sentences: list[str] = []
        for part in parts:
            # Restore protected content
            restored = part
            for placeholder, original in protected:
                restored = restored.replace(placeholder, original)
            restored = restored.strip()
            if restored and len(restored) >= self.min_length:
                sentences.append(restored)

        return sentences


class SemanticChunkingStrategy(ChunkingStrategy):
    """Chunk text by semantic boundaries.

    Creates chunks that represent coherent semantic units by:
    - Splitting on paragraph boundaries (double newlines)
    - Merging small paragraphs to reach target size
    - Splitting large paragraphs at sentence boundaries

    Good for general document search with better semantic coherence.
    """

    def __init__(
        self,
        max_chunk_size: int = 2000,  # Larger chunks for semantic coherence
        min_chunk_size: int = 200,
        overlap_ratio: float = 0.0,  # No overlap - cleaner search results
    ):
        self.max_chunk_size = max_chunk_size
        self.min_chunk_size = min_chunk_size
        self.overlap_ratio = overlap_ratio

    def chunk(self, text: str) -> list[str]:
        if not text.strip():
            return []

        # 1. Split into paragraphs
        paragraphs = self._split_into_paragraphs(text)

        # 2. Merge small paragraphs, split large ones
        normalized_blocks = self._normalize_blocks(paragraphs)

        if not normalized_blocks:
            return []

        # 3. Add overlap between blocks
        chunks = self._add_overlap(normalized_blocks)

        return [c.strip() for c in chunks if c.strip()]

    def _split_into_paragraphs(self, text: str) -> list[str]:
        """Split text into paragraphs using double newlines."""
        raw_paragraphs = re.split(r"\n\n+", text)
        return [p.strip() for p in raw_paragraphs if p.strip()]

    def _normalize_blocks(self, paragraphs: list[str]) -> list[str]:
        """Merge small paragraphs, split large ones to reach target size."""
        blocks: list[str] = []
        current_block = ""

        for para in paragraphs:
            if len(para) > self.max_chunk_size:
                # Save current block if exists
                if current_block:
                    blocks.append(current_block.strip())
                    current_block = ""
                # Split large paragraph at sentence boundaries
                blocks.extend(self._split_large_paragraph(para))
            elif len(current_block) + len(para) + 2 <= self.max_chunk_size:
                # Merge with current block
                current_block = f"{current_block}\n\n{para}" if current_block else para
            else:
                # Save current block and start new one
                if current_block:
                    blocks.append(current_block.strip())
                current_block = para

        if current_block:
            blocks.append(current_block.strip())

        return blocks

    def _split_large_paragraph(self, text: str) -> list[str]:
        """Split a large paragraph at sentence boundaries."""
        # Sentence split pattern for both English and Chinese
        sentence_pattern = r"(?<=[.!?\u3002\uff01\uff1f])\s+"
        sentences = re.split(sentence_pattern, text)

        chunks: list[str] = []
        current_chunk = ""

        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue

            if len(current_chunk) + len(sentence) + 1 <= self.max_chunk_size:
                current_chunk = f"{current_chunk} {sentence}" if current_chunk else sentence
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = sentence

        if current_chunk:
            chunks.append(current_chunk.strip())

        return chunks

    def _add_overlap(self, blocks: list[str]) -> list[str]:
        """Add overlap between consecutive blocks for context preservation."""
        if len(blocks) <= 1:
            return blocks

        chunks_with_overlap: list[str] = []

        for i, block in enumerate(blocks):
            if i == 0:
                # First block: no prefix, add suffix from next block
                overlap_size = int(len(blocks[i + 1]) * self.overlap_ratio)
                next_prefix = blocks[i + 1][:overlap_size] if overlap_size > 0 else ""
                # Find a good break point (sentence or word boundary)
                next_prefix = self._find_break_point(next_prefix, at_end=True)
                chunk = f"{block}\n\n{next_prefix}".strip() if next_prefix else block
            elif i == len(blocks) - 1:
                # Last block: add prefix from previous block, no suffix
                overlap_size = int(len(blocks[i - 1]) * self.overlap_ratio)
                prev_suffix = blocks[i - 1][-overlap_size:] if overlap_size > 0 else ""
                prev_suffix = self._find_break_point(prev_suffix, at_end=False)
                chunk = f"{prev_suffix}\n\n{block}".strip() if prev_suffix else block
            else:
                # Middle blocks: add both prefix and suffix
                prev_overlap_size = int(len(blocks[i - 1]) * self.overlap_ratio / 2)
                next_overlap_size = int(len(blocks[i + 1]) * self.overlap_ratio / 2)

                prev_suffix = blocks[i - 1][-prev_overlap_size:] if prev_overlap_size > 0 else ""
                prev_suffix = self._find_break_point(prev_suffix, at_end=False)

                next_prefix = blocks[i + 1][:next_overlap_size] if next_overlap_size > 0 else ""
                next_prefix = self._find_break_point(next_prefix, at_end=True)

                parts = [prev_suffix, block, next_prefix]
                chunk = "\n\n".join(p for p in parts if p).strip()

            chunks_with_overlap.append(chunk)

        return chunks_with_overlap

    def _find_break_point(self, text: str, at_end: bool) -> str:
        """Find a natural break point (sentence or word boundary)."""
        if not text:
            return ""

        if at_end:
            # For suffix text, try to end at a sentence boundary
            for sep in [". ", "。", "! ", "? ", "\n"]:
                idx = text.rfind(sep)
                if idx > len(text) // 2:
                    return text[: idx + 1].strip()
            # Fall back to word boundary
            idx = text.rfind(" ")
            if idx > len(text) // 2:
                return text[:idx].strip()
        else:
            # For prefix text, try to start at a sentence boundary
            for sep in [". ", "。", "! ", "? ", "\n"]:
                idx = text.find(sep)
                if idx >= 0 and idx < len(text) // 2:
                    return text[idx + 1 :].strip()
            # Fall back to word boundary
            idx = text.find(" ")
            if idx >= 0 and idx < len(text) // 2:
                return text[idx + 1 :].strip()

        return text.strip()


class RecursiveMarkdownChunkingStrategy(ChunkingStrategy):
    """Recursively chunk Markdown documents while preserving structure.

    Splits hierarchically:
    1. Top-level sections (# H1)
    2. Sub-sections (## H2, ### H3, etc.)
    3. Paragraphs within sections
    4. Sentences (fallback for oversized content)

    Special handling:
    - Code blocks are ALWAYS kept intact (never split, regardless of size)
    - Tables are ALWAYS kept together (never split, regardless of size)
    - Regular text is split at sentence boundaries when exceeding max_chunk_size

    Good for structured documents (Markdown, documentation).
    """

    def __init__(
        self,
        max_chunk_size: int = 2000,  # Max size for TEXT chunks (not code/tables)
        min_chunk_size: int = 200,
        overlap_ratio: float = 0.0,  # No overlap - cleaner search results
        preserve_code_blocks: bool = True,
        preserve_tables: bool = True,
    ):
        self.max_chunk_size = max_chunk_size
        self.min_chunk_size = min_chunk_size
        self.overlap_ratio = overlap_ratio
        self.preserve_code_blocks = preserve_code_blocks
        self.preserve_tables = preserve_tables

        # Patterns for Markdown elements
        self.header_pattern = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
        self.code_block_pattern = re.compile(r"```[\w]*\n[\s\S]*?```", re.MULTILINE)
        self.table_pattern = re.compile(r"(\|[^\n]+\|\n)+", re.MULTILINE)

    def chunk(self, text: str) -> list[str]:
        if not text.strip():
            return []

        # 1. Extract and protect special blocks (code blocks, tables)
        protected_blocks, text_with_placeholders = self._protect_special_blocks(text)

        # 2. Split by headers recursively
        sections = self._split_by_headers(text_with_placeholders)

        # 3. Process each section
        chunks: list[str] = []
        for section in sections:
            section_chunks = self._process_section(section, protected_blocks)
            chunks.extend(section_chunks)

        # 4. Restore protected blocks
        final_chunks = self._restore_protected_blocks(chunks, protected_blocks)

        return [c.strip() for c in final_chunks if c.strip()]

    def _protect_special_blocks(self, text: str) -> tuple[dict[str, str], str]:
        """Extract code blocks and tables, replace with placeholders."""
        protected: dict[str, str] = {}
        result = text

        # Protect code blocks
        if self.preserve_code_blocks:
            for i, match in enumerate(self.code_block_pattern.finditer(text)):
                placeholder = f"__CODE_BLOCK_{i}__"
                protected[placeholder] = match.group(0)
                result = result.replace(match.group(0), placeholder, 1)

        # Protect tables
        if self.preserve_tables:
            for i, match in enumerate(self.table_pattern.finditer(result)):
                placeholder = f"__TABLE_{i}__"
                protected[placeholder] = match.group(0)
                result = result.replace(match.group(0), placeholder, 1)

        return protected, result

    def _split_by_headers(self, text: str) -> list[dict[str, Any]]:
        """Split text into sections based on headers."""
        sections: list[dict[str, Any]] = []
        current_section: dict[str, Any] = {"level": 0, "title": "", "content": ""}

        lines = text.split("\n")
        for line in lines:
            header_match = self.header_pattern.match(line)
            if header_match:
                # Save current section if it has content
                if current_section["content"].strip():
                    sections.append(current_section)

                # Start new section
                level = len(header_match.group(1))
                title = header_match.group(2)
                current_section = {"level": level, "title": title, "content": line + "\n"}
            else:
                current_section["content"] += line + "\n"

        # Don't forget the last section
        if current_section["content"].strip():
            sections.append(current_section)

        return sections

    def _process_section(
        self, section: dict[str, Any], protected_blocks: dict[str, str]
    ) -> list[str]:
        """Process a section, splitting text while keeping code/tables intact.

        Key behavior:
        - Code blocks and tables are ALWAYS emitted as separate chunks
        - Text content is merged/split based on max_chunk_size
        - Text is split at sentence boundaries when needed
        """
        content = section["content"]

        # Split by paragraphs (double newline)
        paragraphs = re.split(r"\n\n+", content)
        chunks: list[str] = []
        current_text_chunk = ""

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            # Check if this paragraph contains a protected block (code/table)
            has_protected = any(placeholder in para for placeholder in protected_blocks)

            if has_protected:
                # First, flush any accumulated text
                if current_text_chunk:
                    chunks.append(current_text_chunk.strip())
                    current_text_chunk = ""

                # Emit the protected block as its own chunk (never split)
                chunks.append(para)
            else:
                # Regular text paragraph - apply size limits
                if len(current_text_chunk) + len(para) + 2 <= self.max_chunk_size:
                    # Fits in current chunk
                    current_text_chunk = (
                        f"{current_text_chunk}\n\n{para}" if current_text_chunk else para
                    )
                else:
                    # Doesn't fit - flush current and handle this paragraph
                    if current_text_chunk:
                        chunks.append(current_text_chunk.strip())

                    # Check if paragraph itself is too large
                    if len(para) > self.max_chunk_size:
                        # Split large paragraph at sentence boundaries
                        chunks.extend(self._split_paragraph(para))
                        current_text_chunk = ""
                    else:
                        current_text_chunk = para

        # Don't forget the last text chunk
        if current_text_chunk:
            chunks.append(current_text_chunk.strip())

        return chunks

    def _split_paragraph(self, text: str) -> list[str]:
        """Split an oversized paragraph by sentences."""
        sentence_pattern = r"(?<=[.!?\u3002\uff01\uff1f])\s+"
        sentences = re.split(sentence_pattern, text)

        chunks: list[str] = []
        current = ""

        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue

            if len(current) + len(sentence) + 1 <= self.max_chunk_size:
                current = f"{current} {sentence}" if current else sentence
            else:
                if current:
                    chunks.append(current.strip())
                current = sentence

        if current:
            chunks.append(current.strip())

        return chunks

    def _restore_protected_blocks(
        self, chunks: list[str], protected_blocks: dict[str, str]
    ) -> list[str]:
        """Restore protected blocks in chunks, splitting oversized ones.

        Checks token count after restoration and splits code blocks/tables
        that exceed the embedding API token limit.
        """
        final_chunks: list[str] = []

        for chunk in chunks:
            # Restore protected blocks
            for placeholder, original in protected_blocks.items():
                if placeholder in chunk:
                    # Check if the original block exceeds token limit
                    token_count = count_tokens(original)
                    if token_count > SAFE_TOKEN_LIMIT:
                        # Split oversized block
                        logger.warning(
                            f"Protected block exceeds token limit ({token_count} tokens), splitting"
                        )
                        if placeholder.startswith("__CODE_BLOCK_"):
                            sub_chunks = split_code_block_by_tokens(original)
                        elif placeholder.startswith("__TABLE_"):
                            sub_chunks = split_table_by_tokens(original)
                        else:
                            # Fallback: truncate
                            sub_chunks = [truncate_to_token_limit(original)]

                        # Replace placeholder with first sub-chunk, add rest as new chunks
                        chunk = chunk.replace(placeholder, sub_chunks[0])
                        final_chunks.append(chunk.strip())
                        final_chunks.extend(sub_chunks[1:])
                        chunk = ""  # Already added
                        break
                    else:
                        chunk = chunk.replace(placeholder, original)

            if chunk and chunk.strip():
                final_chunks.append(chunk.strip())

        return final_chunks


# ============================================================================
# Default Strategy Instances
# ============================================================================

# Use MarkdownSentenceChunkingStrategy for both document and in-document search
# This ensures consistent structure-aware chunking (headers, lists, sentences, code, tables)
DEFAULT_CHUNK_STRATEGY = MarkdownSentenceChunkingStrategy()
SENTENCE_CHUNK_STRATEGY = MarkdownSentenceChunkingStrategy()  # Section-aware for in-document search
LEGACY_SENTENCE_STRATEGY = SentenceChunkingStrategy()  # Kept for backwards compatibility
LEGACY_OVERLAP_STRATEGY = OverlapChunkingStrategy()  # Kept for backwards compatibility
SEMANTIC_CHUNK_STRATEGY = SemanticChunkingStrategy()
RECURSIVE_MARKDOWN_STRATEGY = RecursiveMarkdownChunkingStrategy()


# ============================================================================
# Strategy Selection
# ============================================================================


class ChunkingStrategyType(Enum):
    """Enumeration of available chunking strategies."""

    OVERLAP = "overlap"  # Fixed-size windows with overlap
    SENTENCE = "sentence"  # Sentence-level for highlighting
    SEMANTIC = "semantic"  # Semantic boundaries with overlap
    RECURSIVE_MARKDOWN = "recursive_markdown"  # Markdown-aware hierarchical
    AUTO = "auto"  # Automatic detection based on content


class ChunkingStrategyFactory:
    """Factory for creating appropriate chunking strategies.

    Supports both automatic detection and explicit strategy selection.

    Example:
        >>> factory = ChunkingStrategyFactory()
        >>> strategy = factory.get_strategy(content, filename="readme.md")
        >>> chunks = strategy.chunk(content)
    """

    def __init__(self):
        self.detector = DocumentTypeDetector()
        self._settings = None

    @property
    def settings(self):
        """Lazy load settings to avoid circular imports."""
        if self._settings is None:
            self._settings = get_settings()
        return self._settings

    def get_strategy(
        self,
        content: str,
        filename: str | None = None,
        strategy_type: ChunkingStrategyType | None = None,
    ) -> ChunkingStrategy:
        """Get the optimal chunking strategy for content.

        Args:
            content: Document content to be chunked
            filename: Optional filename for type hints (extension-based)
            strategy_type: Explicit strategy override. If None or AUTO,
                          automatically detects the best strategy.

        Returns:
            Appropriate ChunkingStrategy instance configured with settings
        """
        # If explicit strategy requested, use it
        if strategy_type and strategy_type != ChunkingStrategyType.AUTO:
            return self._create_strategy(strategy_type)

        # Check settings for default strategy preference
        settings_strategy = getattr(self.settings, "chunking_strategy", "auto")
        if settings_strategy != "auto":
            try:
                explicit_type = ChunkingStrategyType(settings_strategy)
                if explicit_type != ChunkingStrategyType.AUTO:
                    return self._create_strategy(explicit_type)
            except ValueError:
                pass  # Invalid setting, fall through to auto-detection

        # Auto-detect document type
        doc_type = self.detector.detect(content, filename)

        if doc_type == DocumentType.MARKDOWN:
            return RecursiveMarkdownChunkingStrategy(
                max_chunk_size=getattr(self.settings, "markdown_max_chunk_size", 2000),
                overlap_ratio=self.settings.chunk_overlap / self.settings.chunk_size,
            )
        elif doc_type == DocumentType.CODE:
            # For code, use semantic chunking which respects function boundaries
            return SemanticChunkingStrategy(
                max_chunk_size=self.settings.chunk_size,
                min_chunk_size=getattr(self.settings, "semantic_min_chunk_size", 200),
                overlap_ratio=self.settings.chunk_overlap / self.settings.chunk_size,
            )
        else:
            # Default: semantic chunking for general text
            return SemanticChunkingStrategy(
                max_chunk_size=self.settings.chunk_size,
                min_chunk_size=getattr(self.settings, "semantic_min_chunk_size", 200),
                overlap_ratio=self.settings.chunk_overlap / self.settings.chunk_size,
            )

    def _create_strategy(self, strategy_type: ChunkingStrategyType) -> ChunkingStrategy:
        """Create a strategy by explicit type."""
        if strategy_type == ChunkingStrategyType.OVERLAP:
            return OverlapChunkingStrategy(
                chunk_size=self.settings.chunk_size, overlap=self.settings.chunk_overlap
            )
        elif strategy_type == ChunkingStrategyType.SENTENCE:
            return SentenceChunkingStrategy(min_length=self.settings.sentence_min_length)
        elif strategy_type == ChunkingStrategyType.SEMANTIC:
            return SemanticChunkingStrategy(
                max_chunk_size=self.settings.chunk_size,
                min_chunk_size=getattr(self.settings, "semantic_min_chunk_size", 200),
                overlap_ratio=self.settings.chunk_overlap / self.settings.chunk_size,
            )
        elif strategy_type == ChunkingStrategyType.RECURSIVE_MARKDOWN:
            return RecursiveMarkdownChunkingStrategy(
                max_chunk_size=getattr(self.settings, "markdown_max_chunk_size", 2000),
                overlap_ratio=self.settings.chunk_overlap / self.settings.chunk_size,
            )
        else:
            # Fallback to default
            return DEFAULT_CHUNK_STRATEGY


# Default factory instance
DEFAULT_STRATEGY_FACTORY = ChunkingStrategyFactory()
