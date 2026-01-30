"""RAG Service using PostgreSQL pgvector for vector storage.

This module provides vector search capabilities using pgvector extension:
- Document chunks (for cross-file search)
- Sentence-level chunks (for in-document search)
- Knowledge base attachments (for conversation-scoped search)

Requires: PostgreSQL with pgvector extension enabled
"""

import asyncio
import hashlib
import json
import logging
import re
from abc import ABC, abstractmethod
from enum import Enum
from typing import Any

import openai
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from services.document_detector import DocumentType, DocumentTypeDetector

logger = logging.getLogger(__name__)


# ============================================================================
# HTML Utilities
# ============================================================================

def strip_html_tags(html: str) -> str:
    """Strip HTML tags and return plain text.

    Used to make search results more readable.
    """
    if not html:
        return ""

    # Remove HTML tags
    text = re.sub(r"<[^>]+>", " ", html)

    # Decode common HTML entities
    text = text.replace("&nbsp;", " ")
    text = text.replace("&lt;", "<")
    text = text.replace("&gt;", ">")
    text = text.replace("&amp;", "&")
    text = text.replace("&quot;", '"')
    text = text.replace("&#39;", "'")

    # Clean up whitespace
    text = re.sub(r"\s+", " ", text).strip()

    return text


# ============================================================================
# Hybrid Search Utilities
# ============================================================================

def reciprocal_rank_fusion(
    semantic_results: list[dict],
    keyword_results: list[dict],
    k: int = 60,
    semantic_weight: float = 0.7,
    keyword_weight: float = 0.3
) -> list[dict]:
    """Combine semantic and keyword search results using Reciprocal Rank Fusion.

    RRF Score = sum(weight / (k + rank))

    This algorithm effectively merges results from multiple retrieval methods,
    giving higher scores to documents that appear in both result sets.

    Args:
        semantic_results: Results from vector similarity search
        keyword_results: Results from full-text keyword search
        k: RRF constant (default 60, prevents high-ranked items from dominating)
        semantic_weight: Weight for semantic search results (0-1)
        keyword_weight: Weight for keyword search results (0-1)

    Returns:
        Fused and sorted list of results
    """
    scores: dict[str, dict] = {}

    # Score semantic results
    for rank, result in enumerate(semantic_results, 1):
        doc_id = result["id"]
        scores[doc_id] = {
            "doc": result,
            "score": semantic_weight / (k + rank),
            "semantic_rank": rank,
            "keyword_rank": None
        }

    # Score keyword results
    for rank, result in enumerate(keyword_results, 1):
        doc_id = result["id"]
        if doc_id not in scores:
            scores[doc_id] = {
                "doc": result,
                "score": 0,
                "semantic_rank": None,
                "keyword_rank": rank
            }
        else:
            scores[doc_id]["keyword_rank"] = rank
        scores[doc_id]["score"] += keyword_weight / (k + rank)

    # Sort by combined score
    sorted_results = sorted(
        scores.values(),
        key=lambda x: x["score"],
        reverse=True
    )

    # Return documents with RRF metadata
    return [
        {
            **item["doc"],
            "rrf_score": item["score"],
            "semantic_rank": item["semantic_rank"],
            "keyword_rank": item["keyword_rank"]
        }
        for item in sorted_results
    ]

# Embedding dimension for text-embedding-3-small
EMBEDDING_DIMENSION = 1536


# ============================================================================
# Chunking Strategies
# ============================================================================

class ChunkingStrategy(ABC):
    """Abstract base class for text chunking strategies."""

    @abstractmethod
    def chunk(self, text: str) -> list[str]:
        """Split text into chunks."""
        pass


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
                        chunk = chunk[:last_sep + 1]
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
            text = re.sub(rf"<h{i}[^>]*>(.*?)</h{i}>", rf"{'#' * i} \1\n", text, flags=re.DOTALL | re.IGNORECASE)

        # Convert HTML tables to markdown-style rows (each row on its own line)
        def convert_table_row(match: re.Match) -> str:
            row_html = match.group(1)
            # Extract cell contents
            cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, flags=re.DOTALL | re.IGNORECASE)
            if cells:
                # Strip HTML from cells and join with |
                clean_cells = [re.sub(r"<[^>]+>", "", cell).strip() for cell in cells]
                return "| " + " | ".join(clean_cells) + " |\n"
            return ""

        text = re.sub(r"<tr[^>]*>(.*?)</tr>", convert_table_row, text, flags=re.DOTALL | re.IGNORECASE)

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
        text = re.sub(r"<pre[^>]*><code[^>]*>(.*?)</code></pre>", r"```\n\1\n```", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<code[^>]*>(.*?)</code>", r"`\1`", text, flags=re.DOTALL | re.IGNORECASE)

        # Convert bold/italic
        text = re.sub(r"<strong[^>]*>(.*?)</strong>", r"**\1**", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<b[^>]*>(.*?)</b>", r"**\1**", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<em[^>]*>(.*?)</em>", r"*\1*", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<i[^>]*>(.*?)</i>", r"*\1*", text, flags=re.DOTALL | re.IGNORECASE)

        # Convert links
        text = re.sub(r"<a[^>]*href=[\"']([^\"']*)[\"'][^>]*>(.*?)</a>", r"[\2](\1)", text, flags=re.DOTALL | re.IGNORECASE)

        # Remove remaining HTML tags
        text = re.sub(r"<[^>]+>", "", text)

        # Decode HTML entities
        text = text.replace("&nbsp;", " ")
        text = text.replace("&lt;", "<")
        text = text.replace("&gt;", ">")
        text = text.replace("&amp;", "&")
        text = text.replace("&quot;", '"')
        text = text.replace("&#39;", "'")

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
                current_section = {
                    "header": header_text,
                    "level": level,
                    "content": []
                }
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
        overlap_ratio: float = 0.0  # No overlap - cleaner search results
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
                    return text[:idx + 1].strip()
            # Fall back to word boundary
            idx = text.rfind(" ")
            if idx > len(text) // 2:
                return text[:idx].strip()
        else:
            # For prefix text, try to start at a sentence boundary
            for sep in [". ", "。", "! ", "? ", "\n"]:
                idx = text.find(sep)
                if idx >= 0 and idx < len(text) // 2:
                    return text[idx + 1:].strip()
            # Fall back to word boundary
            idx = text.find(" ")
            if idx >= 0 and idx < len(text) // 2:
                return text[idx + 1:].strip()

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
        preserve_tables: bool = True
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
                current_section = {
                    "level": level,
                    "title": title,
                    "content": line + "\n"
                }
            else:
                current_section["content"] += line + "\n"

        # Don't forget the last section
        if current_section["content"].strip():
            sections.append(current_section)

        return sections

    def _process_section(
        self,
        section: dict[str, Any],
        protected_blocks: dict[str, str]
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
                    current_text_chunk = f"{current_text_chunk}\n\n{para}" if current_text_chunk else para
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
        self,
        chunks: list[str],
        protected_blocks: dict[str, str]
    ) -> list[str]:
        """Restore protected blocks in chunks."""
        final_chunks: list[str] = []

        for chunk in chunks:
            # Restore protected blocks
            for placeholder, original in protected_blocks.items():
                chunk = chunk.replace(placeholder, original)

            if chunk.strip():
                final_chunks.append(chunk.strip())

        return final_chunks


# Default strategies
# Use MarkdownSentenceChunkingStrategy for both document and in-document search
# This ensures consistent structure-aware chunking (headers, lists, sentences, code, tables)
DEFAULT_CHUNK_STRATEGY = MarkdownSentenceChunkingStrategy()
SENTENCE_CHUNK_STRATEGY = MarkdownSentenceChunkingStrategy()  # Section-aware for in-document search
LEGACY_SENTENCE_STRATEGY = SentenceChunkingStrategy()  # Kept for backwards compatibility
LEGACY_OVERLAP_STRATEGY = OverlapChunkingStrategy()  # Kept for backwards compatibility
SEMANTIC_CHUNK_STRATEGY = SemanticChunkingStrategy()
RECURSIVE_MARKDOWN_STRATEGY = RecursiveMarkdownChunkingStrategy()


# ============================================================================
# Chunking Strategy Selection
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
        strategy_type: ChunkingStrategyType | None = None
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
                overlap_ratio=self.settings.chunk_overlap / self.settings.chunk_size
            )
        elif doc_type == DocumentType.CODE:
            # For code, use semantic chunking which respects function boundaries
            return SemanticChunkingStrategy(
                max_chunk_size=self.settings.chunk_size,
                min_chunk_size=getattr(self.settings, "semantic_min_chunk_size", 200),
                overlap_ratio=self.settings.chunk_overlap / self.settings.chunk_size
            )
        else:
            # Default: semantic chunking for general text
            return SemanticChunkingStrategy(
                max_chunk_size=self.settings.chunk_size,
                min_chunk_size=getattr(self.settings, "semantic_min_chunk_size", 200),
                overlap_ratio=self.settings.chunk_overlap / self.settings.chunk_size
            )

    def _create_strategy(
        self,
        strategy_type: ChunkingStrategyType
    ) -> ChunkingStrategy:
        """Create a strategy by explicit type."""
        if strategy_type == ChunkingStrategyType.OVERLAP:
            return OverlapChunkingStrategy(
                chunk_size=self.settings.chunk_size,
                overlap=self.settings.chunk_overlap
            )
        elif strategy_type == ChunkingStrategyType.SENTENCE:
            return SentenceChunkingStrategy(
                min_length=self.settings.sentence_min_length
            )
        elif strategy_type == ChunkingStrategyType.SEMANTIC:
            return SemanticChunkingStrategy(
                max_chunk_size=self.settings.chunk_size,
                min_chunk_size=getattr(self.settings, "semantic_min_chunk_size", 200),
                overlap_ratio=self.settings.chunk_overlap / self.settings.chunk_size
            )
        elif strategy_type == ChunkingStrategyType.RECURSIVE_MARKDOWN:
            return RecursiveMarkdownChunkingStrategy(
                max_chunk_size=getattr(self.settings, "markdown_max_chunk_size", 2000),
                overlap_ratio=self.settings.chunk_overlap / self.settings.chunk_size
            )
        else:
            # Fallback to default
            return DEFAULT_CHUNK_STRATEGY


# Default factory instance
DEFAULT_STRATEGY_FACTORY = ChunkingStrategyFactory()


# ============================================================================
# Embedding Functions
# ============================================================================

async def get_embedding(text_content: str) -> list[float]:
    """Generate embedding vector for text using OpenAI."""
    settings = get_settings()

    if not settings.openai_api_key:
        raise RuntimeError("OpenAI API key required for pgvector embeddings")

    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=text_content
    )
    return response.data[0].embedding


async def _embed_single_batch_with_retry(
    client: openai.AsyncOpenAI,
    texts: list[str],
    batch_index: int,
    semaphore: asyncio.Semaphore,
    max_retries: int,
    retry_delay: float,
    retry_backoff: float,
) -> tuple[int, list[list[float]]]:
    """Embed a single batch with retry logic and concurrency control.

    Args:
        client: OpenAI async client
        texts: List of texts to embed
        batch_index: Index of this batch (for result ordering)
        semaphore: Concurrency limiter
        max_retries: Maximum retry attempts
        retry_delay: Initial delay between retries (seconds)
        retry_backoff: Exponential backoff multiplier

    Returns:
        Tuple of (batch_index, embeddings) for proper ordering

    Raises:
        RuntimeError: After all retries exhausted
    """
    async with semaphore:
        for attempt in range(max_retries):
            try:
                response = await client.embeddings.create(
                    model="text-embedding-3-small",
                    input=texts
                )
                return (batch_index, [item.embedding for item in response.data])

            except openai.RateLimitError as e:
                if attempt < max_retries - 1:
                    delay = retry_delay * (retry_backoff ** attempt)
                    logger.warning(
                        f"Embedding batch {batch_index} rate limited, "
                        f"retrying in {delay:.1f}s (attempt {attempt + 1}/{max_retries})"
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        f"Embedding batch {batch_index} failed after {max_retries} retries"
                    )
                    raise RuntimeError(f"Embedding rate limit exceeded: {e}") from e

            except openai.APIConnectionError as e:
                if attempt < max_retries - 1:
                    delay = retry_delay * (retry_backoff ** attempt)
                    logger.warning(
                        f"Embedding batch {batch_index} connection error, "
                        f"retrying in {delay:.1f}s (attempt {attempt + 1}/{max_retries})"
                    )
                    await asyncio.sleep(delay)
                else:
                    raise RuntimeError(f"Embedding connection failed: {e}") from e

            except openai.APIStatusError as e:
                # Don't retry on client errors (400-499 except rate limit)
                if 400 <= e.status_code < 500 and e.status_code != 429:
                    raise RuntimeError(f"Embedding API error: {e}") from e

                if attempt < max_retries - 1:
                    delay = retry_delay * (retry_backoff ** attempt)
                    logger.warning(
                        f"Embedding batch {batch_index} API error ({e.status_code}), "
                        f"retrying in {delay:.1f}s"
                    )
                    await asyncio.sleep(delay)
                else:
                    raise RuntimeError(f"Embedding API failed: {e}") from e

    # Should never reach here, but satisfy type checker
    raise RuntimeError("Unexpected error in embedding batch")


async def _batch_embeddings_parallel(
    client: openai.AsyncOpenAI,
    texts: list[str],
    batch_size: int,
    max_concurrent: int,
    max_retries: int,
    retry_delay: float,
    retry_backoff: float,
) -> list[list[float]]:
    """Process embeddings in parallel batches with concurrency control.

    Args:
        client: OpenAI async client
        texts: All texts to embed
        batch_size: Number of texts per API call
        max_concurrent: Maximum concurrent API calls
        max_retries: Maximum retry attempts per batch
        retry_delay: Initial retry delay (seconds)
        retry_backoff: Exponential backoff multiplier

    Returns:
        List of embeddings in same order as input texts
    """
    # Split texts into batches
    batches = [texts[i:i + batch_size] for i in range(0, len(texts), batch_size)]

    if len(batches) == 1:
        # Single batch: skip overhead of parallel processing
        _, embeddings = await _embed_single_batch_with_retry(
            client, batches[0], 0, asyncio.Semaphore(1),
            max_retries, retry_delay, retry_backoff
        )
        return embeddings

    logger.info(
        f"Processing {len(texts)} texts in {len(batches)} batches "
        f"(batch_size={batch_size}, max_concurrent={max_concurrent})"
    )

    # Create semaphore for concurrency control
    semaphore = asyncio.Semaphore(max_concurrent)

    # Create tasks for all batches
    tasks = [
        _embed_single_batch_with_retry(
            client, batch, i, semaphore,
            max_retries, retry_delay, retry_backoff
        )
        for i, batch in enumerate(batches)
    ]

    # Run all tasks concurrently (semaphore limits actual concurrency)
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Check for errors
    errors = [r for r in results if isinstance(r, Exception)]
    if errors:
        # Log all errors but raise the first one
        for e in errors:
            logger.error(f"Batch embedding error: {e}")
        raise errors[0]

    # Sort results by batch index and flatten
    sorted_results = sorted(results, key=lambda x: x[0])
    all_embeddings = []
    for _, embeddings in sorted_results:
        all_embeddings.extend(embeddings)

    return all_embeddings


async def get_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for multiple texts in parallel batches.

    Splits large text lists into smaller batches and processes them
    in parallel with concurrency control and retry logic.

    Args:
        texts: List of texts to embed

    Returns:
        List of embeddings in same order as input texts

    Raises:
        RuntimeError: If OpenAI API key is missing or API calls fail
    """
    if not texts:
        return []

    settings = get_settings()

    if not settings.openai_api_key:
        raise RuntimeError("OpenAI API key required for pgvector embeddings")

    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)

    return await _batch_embeddings_parallel(
        client=client,
        texts=texts,
        batch_size=settings.embedding_batch_size,
        max_concurrent=settings.embedding_max_concurrent,
        max_retries=settings.embedding_max_retries,
        retry_delay=settings.embedding_retry_delay,
        retry_backoff=settings.embedding_retry_backoff,
    )


# ============================================================================
# Database Initialization
# ============================================================================

async def init_pgvector(db: AsyncSession):
    """Initialize pgvector extension and create vector table.

    Should be called once at application startup.
    """
    settings = get_settings()

    if not settings.pgvector_enabled:
        logger.info("pgvector is disabled via PGVECTOR_ENABLED=false")
        return

    try:
        # Create pgvector extension
        await db.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

        # Check if vectors table exists with wrong column type (e.g., TEXT instead of VECTOR)
        # This can happen if tests created the table with a mock schema
        result = await db.execute(text("""
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'vectors' AND column_name = 'embedding'
        """))
        row = result.fetchone()

        if row and row[0] == 'text':
            # Table exists with wrong type, drop and recreate
            logger.warning("Vectors table has TEXT embedding column, recreating with VECTOR type")
            await db.execute(text("DROP TABLE IF EXISTS vectors CASCADE"))

        # Create vectors table for storing all embeddings
        await db.execute(text(f"""
            CREATE TABLE IF NOT EXISTS vectors (
                id VARCHAR(255) PRIMARY KEY,
                content TEXT NOT NULL,
                embedding VECTOR({EMBEDDING_DIMENSION}),
                chunk_type VARCHAR(50) NOT NULL,
                file_id VARCHAR(36),
                conversation_id VARCHAR(36),
                attachment_id VARCHAR(36),
                filename VARCHAR(255),
                chunk_index INTEGER,
                total_chunks INTEGER,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))

        # Create indexes for efficient querying
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_vectors_file_id ON vectors(file_id)"
        ))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_vectors_conversation_id ON vectors(conversation_id)"
        ))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_vectors_chunk_type ON vectors(chunk_type)"
        ))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_vectors_attachment_id ON vectors(attachment_id)"
        ))

        # Create HNSW index for vector similarity search (cosine distance)
        await db.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_vectors_embedding
            ON vectors USING hnsw (embedding vector_cosine_ops)
        """))

        # =====================================================================
        # Full-Text Search Setup (for Hybrid Search)
        # =====================================================================

        # Add tsvector column for keyword search (if not exists)
        await db.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'vectors' AND column_name = 'search_vector'
                ) THEN
                    ALTER TABLE vectors ADD COLUMN search_vector tsvector;
                END IF;
            END $$;
        """))

        # Create GIN index for fast full-text search
        await db.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_vectors_search_vector
            ON vectors USING GIN (search_vector)
        """))

        # Create trigger function to auto-update tsvector on content changes
        await db.execute(text("""
            CREATE OR REPLACE FUNCTION vectors_search_vector_update() RETURNS trigger AS $$
            BEGIN
                NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, ''));
                RETURN NEW;
            END
            $$ LANGUAGE plpgsql;
        """))

        # Create trigger (drop first to avoid duplicate)
        await db.execute(text("""
            DROP TRIGGER IF EXISTS vectors_search_vector_trigger ON vectors;
        """))
        await db.execute(text("""
            CREATE TRIGGER vectors_search_vector_trigger
            BEFORE INSERT OR UPDATE ON vectors
            FOR EACH ROW EXECUTE FUNCTION vectors_search_vector_update();
        """))

        # Populate search_vector for existing rows that don't have it
        await db.execute(text("""
            UPDATE vectors
            SET search_vector = to_tsvector('english', COALESCE(content, ''))
            WHERE search_vector IS NULL
        """))

        await db.commit()
        logger.info("pgvector initialized successfully with full-text search support")

    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to initialize pgvector: {e}")
        raise


# ============================================================================
# RAG Service
# ============================================================================

class RAGService:
    """RAG service using PostgreSQL pgvector.

    Provides methods for indexing and searching documents using
    vector similarity search in PostgreSQL.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    # -------------------------------------------------------------------------
    # Document Indexing (Chunk-level)
    # -------------------------------------------------------------------------

    async def index_file(
        self,
        file_id: str,
        content: str,
        metadata: dict[str, Any] | None = None,
        strategy: ChunkingStrategy | None = None
    ):
        """Index a file's content at chunk level with position tracking."""
        try:
            # Skip indexing if content is essentially empty
            plain_content = strip_html_tags(content)
            if not plain_content or len(plain_content) < 10:
                logger.info(f"Skipping index for file {file_id}: content too short")
                await self.delete_file(file_id)  # Clean up any existing vectors
                return

            await self.delete_file(file_id)

            strategy = strategy or DEFAULT_CHUNK_STRATEGY
            chunks = strategy.chunk(content)

            if not chunks:
                return

            # Find positions of each chunk in original content for highlighting
            chunk_positions = self._find_chunk_positions(content, chunks)

            # Get embeddings in batch
            embeddings = await get_embeddings_batch(chunks)

            # Insert chunks with embeddings and position metadata
            base_metadata = metadata or {}

            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=False)):
                chunk_id = f"{file_id}_{i}"
                start_pos, end_pos = chunk_positions[i]

                # Include position in metadata for highlighting
                chunk_metadata = {
                    **base_metadata,
                    "start": start_pos,
                    "end": end_pos,
                }
                metadata_json = json.dumps(chunk_metadata)

                await self.db.execute(
                    text("""
                        INSERT INTO vectors (id, content, embedding, chunk_type, file_id, chunk_index, metadata)
                        VALUES (:id, :content, :embedding, 'document', :file_id, :chunk_index, CAST(:metadata AS jsonb))
                        ON CONFLICT (id) DO UPDATE SET
                            content = EXCLUDED.content,
                            embedding = EXCLUDED.embedding,
                            metadata = EXCLUDED.metadata
                    """),
                    {
                        "id": chunk_id,
                        "content": chunk,
                        "embedding": str(embedding),
                        "file_id": file_id,
                        "chunk_index": i,
                        "metadata": metadata_json
                    }
                )

            await self.db.commit()
            logger.info(f"Indexed {len(chunks)} chunks for file {file_id}")

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to index file {file_id}: {e}")
            raise

    def _find_chunk_positions(
        self, content: str, chunks: list[str]
    ) -> list[tuple[int, int]]:
        """Find start/end positions of each chunk in the original content.

        Uses sequential search to handle overlapping chunks correctly.
        Returns list of (start, end) tuples for each chunk.
        """
        positions: list[tuple[int, int]] = []
        search_start = 0

        for chunk in chunks:
            # Normalize whitespace for matching
            chunk_normalized = " ".join(chunk.split())

            # Try exact match first
            pos = content.find(chunk, search_start)

            if pos == -1:
                # Try normalized matching (handles whitespace differences)
                # Search in a window around expected position
                window_start = max(0, search_start - 100)
                window_end = min(len(content), search_start + len(chunk) + 500)
                window = content[window_start:window_end]
                window_normalized = " ".join(window.split())

                # Find chunk in normalized window
                norm_pos = window_normalized.find(chunk_normalized)
                # Map back to original position (approximate) or use search_start as fallback
                pos = window_start + norm_pos if norm_pos != -1 else search_start

            end_pos = pos + len(chunk)
            positions.append((pos, end_pos))

            # Move search start for next chunk (allow some overlap)
            search_start = max(search_start, pos + len(chunk) // 2)

        return positions

    async def search(
        self,
        query: str,
        file_ids: list[str] | None = None,
        top_k: int = 5,
        user_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Search for relevant document chunks using cosine similarity.

        Args:
            query: Search query text
            file_ids: Optional list of file IDs to search within
            top_k: Maximum number of results to return
            user_id: Optional user ID to filter results (only return user's files)
        """
        try:
            query_embedding = await get_embedding(query)

            # Build query with optional file and user filters
            params: dict[str, Any] = {"embedding": str(query_embedding), "limit": top_k}

            # Base conditions
            conditions = ["chunk_type = 'document'"]

            if file_ids:
                conditions.append("file_id = ANY(:file_ids)")
                params["file_ids"] = file_ids

            if user_id:
                # Filter by user_id in metadata, also include vectors without user_id for backward compatibility
                conditions.append("(metadata->>'user_id' = :user_id OR metadata->>'user_id' IS NULL)")
                params["user_id"] = user_id

            where_clause = " AND ".join(conditions)

            result = await self.db.execute(
                text(f"""
                    SELECT id, content, file_id, chunk_index, metadata,
                           1 - (embedding <=> :embedding) as score
                    FROM vectors
                    WHERE {where_clause}
                    ORDER BY embedding <=> :embedding
                    LIMIT :limit
                """),
                params
            )

            rows = result.fetchall()
            results = []
            for row in rows:
                # Strip HTML tags for readable content
                plain_content = strip_html_tags(row.content)

                # Skip empty content
                if not plain_content or len(plain_content) < 3:
                    continue

                distance = 1 - row.score

                # Filter out low relevance results (distance > 0.7 means < 30% similarity)
                if distance > 0.7:
                    continue

                results.append({
                    "id": row.id,
                    "content": plain_content,
                    "metadata": {"file_id": row.file_id, "chunk_index": row.chunk_index, **(row.metadata or {})},
                    "distance": distance
                })

            return results

        except Exception as e:
            logger.error(f"Search error: {e}")
            return []

    # -------------------------------------------------------------------------
    # Hybrid Search Methods
    # -------------------------------------------------------------------------

    async def _keyword_search(
        self,
        query: str,
        chunk_type: str = "document",
        file_ids: list[str] | None = None,
        user_id: str | None = None,
        top_k: int = 15
    ) -> list[dict[str, Any]]:
        """Full-text keyword search using PostgreSQL tsvector.

        Uses ts_rank_cd for ranking, which considers document length
        and position of matches.

        Args:
            query: Search query text
            chunk_type: Type of chunks to search ('document', 'sentence', 'kb')
            file_ids: Optional list of file IDs to search within
            user_id: Optional user ID to filter results
            top_k: Maximum number of results to return
        """
        try:
            params: dict[str, Any] = {"query": query, "limit": top_k}
            conditions = [f"chunk_type = '{chunk_type}'"]

            if file_ids:
                conditions.append("file_id = ANY(:file_ids)")
                params["file_ids"] = file_ids

            if user_id:
                conditions.append(
                    "(metadata->>'user_id' = :user_id OR metadata->>'user_id' IS NULL)"
                )
                params["user_id"] = user_id

            # Require search_vector to exist and match
            conditions.append("search_vector IS NOT NULL")
            conditions.append("search_vector @@ plainto_tsquery('english', :query)")

            where_clause = " AND ".join(conditions)

            result = await self.db.execute(
                text(f"""
                    SELECT id, content, file_id, chunk_index, metadata,
                           ts_rank_cd(search_vector, plainto_tsquery('english', :query)) as rank
                    FROM vectors
                    WHERE {where_clause}
                    ORDER BY rank DESC
                    LIMIT :limit
                """),
                params
            )

            rows = result.fetchall()
            results = []
            for row in rows:
                # Strip HTML tags for readable content
                plain_content = strip_html_tags(row.content)

                # Skip empty content
                if not plain_content or len(plain_content) < 3:
                    continue

                results.append({
                    "id": row.id,
                    "content": plain_content,
                    "metadata": {
                        "file_id": row.file_id,
                        "chunk_index": row.chunk_index,
                        **(row.metadata or {})
                    },
                    "keyword_rank": row.rank
                })

            return results

        except Exception as e:
            logger.error(f"Keyword search error: {e}")
            return []

    async def hybrid_search(
        self,
        query: str,
        file_ids: list[str] | None = None,
        top_k: int = 5,
        user_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Hybrid search combining semantic (vector) and keyword (BM25) search.

        Uses Reciprocal Rank Fusion (RRF) to combine results from both
        retrieval methods. This handles both semantic similarity and
        exact keyword matches (proper nouns, technical terms).

        Args:
            query: Search query text
            file_ids: Optional list of file IDs to search within
            top_k: Maximum number of results to return
            user_id: Optional user ID to filter results
        """
        import asyncio

        settings = get_settings()

        # Check if hybrid search is enabled
        if not getattr(settings, "hybrid_search_enabled", True):
            return await self.search(query, file_ids, top_k, user_id)

        # Fetch more candidates for fusion (3x the requested top_k)
        expanded_k = top_k * 3

        # Run semantic and keyword searches in parallel
        semantic_task = self.search(query, file_ids, expanded_k, user_id)
        keyword_task = self._keyword_search(query, "document", file_ids, user_id, expanded_k)

        semantic_results, keyword_results = await asyncio.gather(
            semantic_task, keyword_task
        )

        # If no keyword results, fall back to semantic only
        if not keyword_results:
            return semantic_results[:top_k]

        # Fuse results using RRF
        fused = reciprocal_rank_fusion(
            semantic_results,
            keyword_results,
            k=getattr(settings, "rrf_k", 60),
            semantic_weight=getattr(settings, "semantic_weight", 0.7),
            keyword_weight=getattr(settings, "keyword_weight", 0.3)
        )

        logger.info(
            f"Hybrid search: {len(semantic_results)} semantic, "
            f"{len(keyword_results)} keyword, {len(fused)} fused"
        )

        return fused[:top_k]

    async def hybrid_search_with_rerank(
        self,
        query: str,
        file_ids: list[str] | None = None,
        top_k: int = 5,
        user_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Hybrid search with GPT-based reranking for improved relevance.

        1. Performs hybrid search to get initial candidates
        2. Reranks candidates using GPT with structured outputs
        3. Returns top-k most relevant results

        Args:
            query: Search query text
            file_ids: Optional list of file IDs to search within
            top_k: Maximum number of results to return
            user_id: Optional user ID to filter results
        """
        settings = get_settings()

        # Get more candidates for reranking
        candidates_k = getattr(settings, "reranking_candidates", 20)

        # Get initial candidates via hybrid search
        candidates = await self.hybrid_search(
            query, file_ids, candidates_k, user_id
        )

        # Rerank if enabled and we have candidates
        if getattr(settings, "reranking_enabled", False) and len(candidates) > 1:
            try:
                from services.reranker_service import GPTReranker
                reranker = GPTReranker()
                candidates = await reranker.rerank(query, candidates, top_k)
                logger.info(f"Reranked {len(candidates)} candidates")
            except Exception as e:
                logger.warning(f"Reranking failed, using hybrid results: {e}")

        return candidates[:top_k]

    async def delete_file(self, file_id: str):
        """Delete all vectors for a file."""
        try:
            result = await self.db.execute(
                text("DELETE FROM vectors WHERE file_id = :file_id"),
                {"file_id": file_id}
            )
            await self.db.commit()
            if result.rowcount > 0:
                logger.info(f"Deleted {result.rowcount} chunks for file {file_id}")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to delete file {file_id}: {e}")

    # -------------------------------------------------------------------------
    # Sentence-level Indexing
    # -------------------------------------------------------------------------

    async def index_file_sentences(
        self,
        file_id: str,
        content: str,
        metadata: dict[str, Any] | None = None
    ):
        """Index a file at sentence level for precise in-document search."""
        try:
            await self._delete_sentence_chunks(file_id)

            sentences = SENTENCE_CHUNK_STRATEGY.chunk(content)
            if not sentences:
                return

            embeddings = await get_embeddings_batch(sentences)

            # Serialize metadata to JSON string for asyncpg JSONB support
            metadata_json = json.dumps(metadata or {})

            for i, (sentence, embedding) in enumerate(zip(sentences, embeddings, strict=False)):
                chunk_id = f"{file_id}_sent_{i}"
                await self.db.execute(
                    text("""
                        INSERT INTO vectors (id, content, embedding, chunk_type, file_id, chunk_index, metadata)
                        VALUES (:id, :content, :embedding, 'sentence', :file_id, :chunk_index, CAST(:metadata AS jsonb))
                        ON CONFLICT (id) DO UPDATE SET
                            content = EXCLUDED.content,
                            embedding = EXCLUDED.embedding,
                            metadata = EXCLUDED.metadata
                    """),
                    {
                        "id": chunk_id,
                        "content": sentence,
                        "embedding": str(embedding),
                        "file_id": file_id,
                        "chunk_index": i,
                        "metadata": metadata_json
                    }
                )

            await self.db.commit()
            # Log chunk samples for debugging
            if sentences:
                samples = [s[:50] + "..." if len(s) > 50 else s for s in sentences[:3]]
                logger.info(
                    f"Indexed {len(sentences)} markdown chunks for file {file_id}. "
                    f"Samples: {samples}"
                )
            else:
                logger.info(f"No chunks to index for file {file_id}")

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to index sentences for file {file_id}: {e}")
            raise

    async def search_sentences(
        self,
        query: str,
        file_id: str,
        top_k: int = 10,
        min_score: float = 0.3,
        use_hybrid: bool = True
    ) -> list[dict[str, Any]]:
        """Search for relevant sentences within a specific file.

        Args:
            query: Search query text
            file_id: File to search within
            top_k: Maximum number of results
            min_score: Minimum similarity score (0-1)
            use_hybrid: Use hybrid search (semantic + keyword with RRF)
        """
        if use_hybrid:
            return await self._hybrid_search_sentences(query, file_id, top_k, min_score)
        return await self._semantic_search_sentences(query, file_id, top_k, min_score)

    async def _semantic_search_sentences(
        self,
        query: str,
        file_id: str,
        top_k: int = 10,
        min_score: float = 0.3
    ) -> list[dict[str, Any]]:
        """Pure semantic (vector) search for sentences."""
        try:
            query_embedding = await get_embedding(query)

            result = await self.db.execute(
                text("""
                    SELECT id, content, chunk_index, metadata,
                           1 - (embedding <=> :embedding) as score
                    FROM vectors
                    WHERE chunk_type = 'sentence'
                      AND file_id = :file_id
                    ORDER BY embedding <=> :embedding
                    LIMIT :limit
                """),
                {"embedding": str(query_embedding), "file_id": file_id, "limit": top_k * 2}
            )

            rows = result.fetchall()
            results = []
            for row in rows:
                if row.score < min_score:
                    continue
                # Strip HTML tags for readable content
                plain_content = strip_html_tags(row.content)
                if not plain_content or len(plain_content) < 3:
                    continue
                results.append({
                    "id": row.id,
                    "content": plain_content,
                    "metadata": {"file_id": file_id, "chunk_index": row.chunk_index, **(row.metadata or {})},
                    "distance": 1 - row.score
                })

            return results[:top_k]

        except Exception as e:
            logger.error(f"Semantic sentence search error: {e}")
            return []

    async def _keyword_search_sentences(
        self,
        query: str,
        file_id: str,
        top_k: int = 15
    ) -> list[dict[str, Any]]:
        """Full-text keyword search for sentences within a file."""
        try:
            result = await self.db.execute(
                text("""
                    SELECT id, content, chunk_index, metadata,
                           ts_rank_cd(search_vector, plainto_tsquery('english', :query)) as rank
                    FROM vectors
                    WHERE chunk_type = 'sentence'
                      AND file_id = :file_id
                      AND search_vector IS NOT NULL
                      AND search_vector @@ plainto_tsquery('english', :query)
                    ORDER BY rank DESC
                    LIMIT :limit
                """),
                {"query": query, "file_id": file_id, "limit": top_k}
            )

            rows = result.fetchall()
            results = []
            for row in rows:
                plain_content = strip_html_tags(row.content)
                if not plain_content or len(plain_content) < 3:
                    continue
                results.append({
                    "id": row.id,
                    "content": plain_content,
                    "metadata": {"file_id": file_id, "chunk_index": row.chunk_index, **(row.metadata or {})},
                    "keyword_rank": row.rank
                })

            return results

        except Exception as e:
            logger.error(f"Keyword sentence search error: {e}")
            return []

    async def _hybrid_search_sentences(
        self,
        query: str,
        file_id: str,
        top_k: int = 10,
        min_score: float = 0.3
    ) -> list[dict[str, Any]]:
        """Hybrid search for sentences combining semantic and keyword search.

        Uses RRF (Reciprocal Rank Fusion) to combine results.
        """
        import asyncio

        settings = get_settings()

        # Fetch more candidates for fusion
        expanded_k = top_k * 3

        # Run semantic and keyword searches in parallel
        semantic_task = self._semantic_search_sentences(query, file_id, expanded_k, min_score)
        keyword_task = self._keyword_search_sentences(query, file_id, expanded_k)

        semantic_results, keyword_results = await asyncio.gather(
            semantic_task, keyword_task
        )

        # If no keyword results, fall back to semantic only
        if not keyword_results:
            logger.info(f"Hybrid sentence search: {len(semantic_results)} semantic only (no keyword matches)")
            return semantic_results[:top_k]

        # Fuse results using RRF
        fused = reciprocal_rank_fusion(
            semantic_results,
            keyword_results,
            k=getattr(settings, "rrf_k", 60),
            semantic_weight=getattr(settings, "semantic_weight", 0.7),
            keyword_weight=getattr(settings, "keyword_weight", 0.3)
        )

        logger.info(
            f"Hybrid sentence search: {len(semantic_results)} semantic, "
            f"{len(keyword_results)} keyword, {len(fused)} fused"
        )

        return fused[:top_k]

    async def _delete_sentence_chunks(self, file_id: str):
        """Delete sentence-level chunks for a file."""
        try:
            result = await self.db.execute(
                text("DELETE FROM vectors WHERE file_id = :file_id AND chunk_type = 'sentence'"),
                {"file_id": file_id}
            )
            await self.db.commit()
            if result.rowcount > 0:
                logger.info(f"Deleted {result.rowcount} sentence chunks for file {file_id}")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to delete sentence chunks for {file_id}: {e}")

    # -------------------------------------------------------------------------
    # Knowledge Base Methods
    # -------------------------------------------------------------------------

    async def index_kb_attachment(
        self,
        attachment_id: str,
        conversation_id: str,
        content: str,
        filename: str,
        strategy: ChunkingStrategy | None = None
    ) -> int:
        """Index a knowledge base attachment.

        Args:
            attachment_id: Unique attachment ID
            conversation_id: Conversation this attachment belongs to
            content: Text content to index
            filename: Original filename (used for strategy auto-detection)
            strategy: Optional chunking strategy. If None, auto-detects.
        """
        try:
            await self.delete_kb_attachment(attachment_id)

            # Auto-detect strategy if not provided
            if strategy is None:
                strategy = DEFAULT_STRATEGY_FACTORY.get_strategy(content, filename)

            chunks = strategy.chunk(content)
            if not chunks:
                return 0

            embeddings = await get_embeddings_batch(chunks)
            total_chunks = len(chunks)

            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=False)):
                chunk_id = f"kb_{attachment_id}_{i}"
                await self.db.execute(
                    text("""
                        INSERT INTO vectors (id, content, embedding, chunk_type, conversation_id, attachment_id, filename, chunk_index, total_chunks)
                        VALUES (:id, :content, :embedding, 'kb', :conversation_id, :attachment_id, :filename, :chunk_index, :total_chunks)
                        ON CONFLICT (id) DO UPDATE SET
                            content = EXCLUDED.content,
                            embedding = EXCLUDED.embedding
                    """),
                    {
                        "id": chunk_id,
                        "content": chunk,
                        "embedding": str(embedding),
                        "conversation_id": conversation_id,
                        "attachment_id": attachment_id,
                        "filename": filename,
                        "chunk_index": i,
                        "total_chunks": total_chunks
                    }
                )

            await self.db.commit()
            logger.info(f"Indexed {total_chunks} KB chunks for attachment {attachment_id}")
            return total_chunks

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to index KB attachment {attachment_id}: {e}")
            raise

    async def search_kb(
        self,
        conversation_id: str,
        query: str,
        top_k: int = 5
    ) -> list[dict[str, Any]]:
        """Search within a conversation's knowledge base."""
        try:
            query_embedding = await get_embedding(query)

            result = await self.db.execute(
                text("""
                    SELECT id, content, attachment_id, filename, chunk_index, total_chunks,
                           1 - (embedding <=> :embedding) as score
                    FROM vectors
                    WHERE chunk_type = 'kb'
                      AND conversation_id = :conversation_id
                    ORDER BY embedding <=> :embedding
                    LIMIT :limit
                """),
                {"embedding": str(query_embedding), "conversation_id": conversation_id, "limit": top_k}
            )

            rows = result.fetchall()
            return [
                {
                    "id": row.id,
                    "content": row.content,
                    "metadata": {
                        "attachment_id": row.attachment_id,
                        "filename": row.filename,
                        "chunk_index": row.chunk_index,
                        "total_chunks": row.total_chunks
                    },
                    "score": row.score,
                    "source_file": row.filename
                }
                for row in rows
            ]

        except Exception as e:
            logger.error(f"KB search error: {e}")
            return []

    async def delete_kb_attachment(self, attachment_id: str):
        """Delete all vector chunks for a KB attachment."""
        try:
            result = await self.db.execute(
                text("DELETE FROM vectors WHERE attachment_id = :attachment_id"),
                {"attachment_id": attachment_id}
            )
            await self.db.commit()
            if result.rowcount > 0:
                logger.info(f"Deleted {result.rowcount} KB chunks for attachment {attachment_id}")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to delete KB attachment {attachment_id}: {e}")

    async def get_kb_document_content(
        self,
        attachment_id: str,
        start_chunk: int = 0,
        end_chunk: int | None = None
    ) -> dict[str, Any]:
        """Get ordered content chunks from a KB attachment."""
        try:
            result = await self.db.execute(
                text("""
                    SELECT content, filename, chunk_index, total_chunks
                    FROM vectors
                    WHERE attachment_id = :attachment_id
                    ORDER BY chunk_index
                """),
                {"attachment_id": attachment_id}
            )

            rows = result.fetchall()
            if not rows:
                return {"content": "", "total_chunks": 0, "filename": "Unknown", "chunks_returned": 0}

            total_chunks = rows[0].total_chunks or len(rows)
            filename = rows[0].filename or "Unknown"

            # Apply slice
            rows = rows[start_chunk:end_chunk] if end_chunk is not None else rows[start_chunk:]

            content = "\n\n".join([row.content for row in rows])

            return {
                "content": content,
                "total_chunks": total_chunks,
                "filename": filename,
                "chunks_returned": len(rows)
            }

        except Exception as e:
            logger.error(f"Failed to get KB document content: {e}")
            return {"content": "", "total_chunks": 0, "filename": "Unknown", "chunks_returned": 0}

    # -------------------------------------------------------------------------
    # Utility Methods
    # -------------------------------------------------------------------------

    @staticmethod
    def generate_id(text_content: str) -> str:
        """Generate a unique ID for a text chunk."""
        return hashlib.md5(text_content.encode()).hexdigest()[:16]
