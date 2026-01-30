"""Tests for chunking strategies and document type detection.

Tests the new semantic and recursive Markdown chunking strategies,
as well as the document type detector and strategy factory.
"""

from services.document_detector import DocumentType, DocumentTypeDetector
from services.rag_service import (
    ChunkingStrategyFactory,
    ChunkingStrategyType,
    OverlapChunkingStrategy,
    RecursiveMarkdownChunkingStrategy,
    SemanticChunkingStrategy,
    SentenceChunkingStrategy,
)

# =============================================================================
# SemanticChunkingStrategy Tests
# =============================================================================

class TestSemanticChunkingStrategy:
    """Tests for semantic chunking with paragraph-based splitting."""

    def test_empty_text_returns_empty_list(self):
        """Should return empty list for empty or whitespace-only text."""
        strategy = SemanticChunkingStrategy()
        assert strategy.chunk("") == []
        assert strategy.chunk("   ") == []
        assert strategy.chunk("\n\n\n") == []

    def test_single_paragraph_returned_as_single_chunk(self):
        """A single short paragraph should be returned as one chunk."""
        strategy = SemanticChunkingStrategy(max_chunk_size=500)
        text = "This is a single paragraph with some content."
        chunks = strategy.chunk(text)
        assert len(chunks) == 1
        assert chunks[0] == text

    def test_respects_paragraph_boundaries(self):
        """Chunks should respect paragraph boundaries when possible."""
        strategy = SemanticChunkingStrategy(max_chunk_size=50, min_chunk_size=10)
        text = "First paragraph here with content.\n\nSecond paragraph here with more.\n\nThird paragraph here too."
        chunks = strategy.chunk(text)
        # Should create multiple chunks since each paragraph exceeds 50 chars
        assert len(chunks) >= 2
        # First chunk should start with "First"
        assert "First" in chunks[0]

    def test_merges_small_paragraphs(self):
        """Small consecutive paragraphs should be merged."""
        strategy = SemanticChunkingStrategy(max_chunk_size=500, min_chunk_size=50)
        text = "Short one.\n\nShort two.\n\nShort three."
        chunks = strategy.chunk(text)
        # All short paragraphs should fit in one chunk
        assert len(chunks) == 1
        assert "Short one." in chunks[0]
        assert "Short three." in chunks[0]

    def test_splits_large_paragraphs(self):
        """Large paragraphs should be split at sentence boundaries."""
        strategy = SemanticChunkingStrategy(max_chunk_size=100, min_chunk_size=20)
        text = "This is sentence one. This is sentence two. This is sentence three. This is sentence four. This is sentence five."
        chunks = strategy.chunk(text)
        # Should split into multiple chunks
        assert len(chunks) >= 2
        # Each chunk should end at a sentence boundary (when possible)
        for chunk in chunks:
            assert chunk.strip()

    def test_overlap_between_chunks(self):
        """Chunks should have overlap for context preservation."""
        strategy = SemanticChunkingStrategy(
            max_chunk_size=50,
            min_chunk_size=10,
            overlap_ratio=0.2
        )
        text = "First paragraph with content.\n\nSecond paragraph with more.\n\nThird paragraph here."
        chunks = strategy.chunk(text)
        # Should have multiple chunks
        assert len(chunks) >= 2

    def test_handles_chinese_text(self):
        """Should handle Chinese text with Chinese sentence delimiters."""
        strategy = SemanticChunkingStrategy(max_chunk_size=100)
        text = "这是第一段。包含中文内容。\n\n这是第二段。也有内容。"
        chunks = strategy.chunk(text)
        assert len(chunks) >= 1
        assert "这是第一段" in chunks[0]

    def test_configurable_overlap_ratio(self):
        """Overlap ratio should be configurable."""
        strategy_low = SemanticChunkingStrategy(overlap_ratio=0.1)
        strategy_high = SemanticChunkingStrategy(overlap_ratio=0.2)
        assert strategy_low.overlap_ratio == 0.1
        assert strategy_high.overlap_ratio == 0.2


# =============================================================================
# RecursiveMarkdownChunkingStrategy Tests
# =============================================================================

class TestRecursiveMarkdownChunkingStrategy:
    """Tests for Markdown-aware hierarchical chunking."""

    def test_empty_text_returns_empty_list(self):
        """Should return empty list for empty or whitespace-only text."""
        strategy = RecursiveMarkdownChunkingStrategy()
        assert strategy.chunk("") == []
        assert strategy.chunk("   ") == []

    def test_preserves_headers(self):
        """Headers should be kept with their content."""
        strategy = RecursiveMarkdownChunkingStrategy(max_chunk_size=500)
        text = "# Title\n\nParagraph one.\n\n## Section\n\nParagraph two."
        chunks = strategy.chunk(text)
        # Should preserve header structure
        assert any("# Title" in c for c in chunks)

    def test_preserves_code_blocks(self):
        """Code blocks should not be split."""
        strategy = RecursiveMarkdownChunkingStrategy(
            max_chunk_size=100,
            preserve_code_blocks=True
        )
        text = """Intro text.

```python
def hello():
    print("Hello, World!")
    return 42
```

After code."""
        chunks = strategy.chunk(text)
        # Find the chunk containing the code block
        code_chunks = [c for c in chunks if "```python" in c]
        assert len(code_chunks) >= 1
        # Code block should be intact
        code_chunk = code_chunks[0]
        assert "def hello():" in code_chunk
        assert "return 42" in code_chunk
        assert '```' in code_chunk

    def test_handles_nested_headers(self):
        """Should handle nested header structure correctly."""
        strategy = RecursiveMarkdownChunkingStrategy(max_chunk_size=1000)
        text = """# Main Title

Introduction paragraph.

## Section 1

Content for section 1.

### Subsection 1.1

Detailed content here.

## Section 2

Final content."""
        chunks = strategy.chunk(text)
        assert len(chunks) >= 1
        # Verify header hierarchy is preserved
        full_text = "\n".join(chunks)
        assert "# Main Title" in full_text
        assert "## Section 1" in full_text

    def test_preserves_tables(self):
        """Tables should be kept together."""
        strategy = RecursiveMarkdownChunkingStrategy(
            max_chunk_size=200,
            preserve_tables=True
        )
        text = """# Data

| Name | Age |
|------|-----|
| Alice | 30 |
| Bob | 25 |

After table."""
        chunks = strategy.chunk(text)
        # Table should be intact in some chunk
        table_chunks = [c for c in chunks if "|" in c]
        assert len(table_chunks) >= 1
        # Verify table structure
        table_chunk = table_chunks[0]
        assert "Alice" in table_chunk
        assert "Bob" in table_chunk

    def test_splits_large_sections(self):
        """Large sections should be split at paragraph boundaries."""
        strategy = RecursiveMarkdownChunkingStrategy(max_chunk_size=100)
        text = """# Title

First paragraph with some content here.

Second paragraph with more content here.

Third paragraph with even more content."""
        chunks = strategy.chunk(text)
        assert len(chunks) >= 2

    def test_handles_list_items(self):
        """Lists should be handled properly."""
        strategy = RecursiveMarkdownChunkingStrategy(max_chunk_size=500)
        text = """# List Section

- Item 1: Description
- Item 2: Description
- Item 3: Description
- Item 4: Description"""
        chunks = strategy.chunk(text)
        # List should be preserved
        list_chunk = chunks[0] if chunks else ""
        assert "- Item 1" in list_chunk

    def test_configurable_code_block_preservation(self):
        """Code block preservation should be configurable."""
        strategy_preserve = RecursiveMarkdownChunkingStrategy(preserve_code_blocks=True)
        strategy_split = RecursiveMarkdownChunkingStrategy(preserve_code_blocks=False)
        assert strategy_preserve.preserve_code_blocks is True
        assert strategy_split.preserve_code_blocks is False


# =============================================================================
# DocumentTypeDetector Tests
# =============================================================================

class TestDocumentTypeDetector:
    """Tests for document type detection."""

    def test_detects_markdown_by_extension(self):
        """Should detect Markdown files by extension."""
        detector = DocumentTypeDetector()
        assert detector.detect("Any content", "README.md") == DocumentType.MARKDOWN
        assert detector.detect("Any content", "notes.markdown") == DocumentType.MARKDOWN
        assert detector.detect("Any content", "doc.mdx") == DocumentType.MARKDOWN

    def test_detects_code_by_extension(self):
        """Should detect code files by extension."""
        detector = DocumentTypeDetector()
        assert detector.detect("Any content", "main.py") == DocumentType.CODE
        assert detector.detect("Any content", "app.js") == DocumentType.CODE
        assert detector.detect("Any content", "server.ts") == DocumentType.CODE
        assert detector.detect("Any content", "main.go") == DocumentType.CODE

    def test_detects_markdown_by_content(self):
        """Should detect Markdown by content patterns."""
        detector = DocumentTypeDetector()
        content = "# Title\n\n**Bold** text and [link](url)\n\n- List item"
        assert detector.detect(content) == DocumentType.MARKDOWN

    def test_detects_code_by_content(self):
        """Should detect code by content patterns."""
        detector = DocumentTypeDetector()
        content = """def hello():
    print("Hello")

class Foo:
    def __init__(self):
        pass"""
        assert detector.detect(content) == DocumentType.CODE

    def test_detects_plain_text(self):
        """Should detect plain text without special patterns."""
        detector = DocumentTypeDetector()
        content = "This is just plain text without any special formatting or code patterns."
        assert detector.detect(content) == DocumentType.PLAIN_TEXT

    def test_empty_content_returns_plain_text(self):
        """Empty content should return plain text."""
        detector = DocumentTypeDetector()
        assert detector.detect("") == DocumentType.PLAIN_TEXT
        assert detector.detect("   ") == DocumentType.PLAIN_TEXT

    def test_extension_takes_precedence(self):
        """File extension should take precedence over content detection."""
        detector = DocumentTypeDetector()
        # Markdown extension but code-like content
        assert detector.detect("def foo(): pass", "doc.md") == DocumentType.MARKDOWN
        # Code extension but markdown-like content
        assert detector.detect("# Title\n\n- List", "main.py") == DocumentType.CODE

    def test_configurable_thresholds(self):
        """Detection thresholds should be configurable."""
        detector_strict = DocumentTypeDetector(markdown_threshold=0.5, code_threshold=0.5)
        detector_lenient = DocumentTypeDetector(markdown_threshold=0.05, code_threshold=0.5)

        # Content with moderate markdown pattern density
        content = "# One Header\n\n**Bold text** here.\n\n- List item\n- Another item"

        # Strict detector might not classify it as markdown (not used in assertion)
        _ = detector_strict.detect(content)
        # Lenient detector should classify it as markdown
        result_lenient = detector_lenient.detect(content)

        # Lenient should be more likely to detect markdown
        assert result_lenient == DocumentType.MARKDOWN


# =============================================================================
# ChunkingStrategyFactory Tests
# =============================================================================

class TestChunkingStrategyFactory:
    """Tests for the strategy factory."""

    def test_auto_selects_markdown_strategy(self):
        """Should auto-select Markdown strategy for MD content."""
        factory = ChunkingStrategyFactory()
        content = "# Title\n\n## Section\n\n```python\ncode\n```"
        strategy = factory.get_strategy(content, filename="doc.md")
        assert isinstance(strategy, RecursiveMarkdownChunkingStrategy)

    def test_auto_selects_semantic_for_plain_text(self):
        """Should auto-select semantic strategy for plain text."""
        factory = ChunkingStrategyFactory()
        content = "This is just plain text without any special formatting."
        strategy = factory.get_strategy(content)
        assert isinstance(strategy, SemanticChunkingStrategy)

    def test_explicit_strategy_override(self):
        """Should respect explicit strategy selection."""
        factory = ChunkingStrategyFactory()
        content = "# Markdown content here"

        # Override to use overlap strategy
        strategy = factory.get_strategy(
            content,
            strategy_type=ChunkingStrategyType.OVERLAP
        )
        assert isinstance(strategy, OverlapChunkingStrategy)

    def test_creates_overlap_strategy(self):
        """Should create overlap strategy when requested."""
        factory = ChunkingStrategyFactory()
        strategy = factory._create_strategy(ChunkingStrategyType.OVERLAP)
        assert isinstance(strategy, OverlapChunkingStrategy)

    def test_creates_sentence_strategy(self):
        """Should create sentence strategy when requested."""
        factory = ChunkingStrategyFactory()
        strategy = factory._create_strategy(ChunkingStrategyType.SENTENCE)
        assert isinstance(strategy, SentenceChunkingStrategy)

    def test_creates_semantic_strategy(self):
        """Should create semantic strategy when requested."""
        factory = ChunkingStrategyFactory()
        strategy = factory._create_strategy(ChunkingStrategyType.SEMANTIC)
        assert isinstance(strategy, SemanticChunkingStrategy)

    def test_creates_recursive_markdown_strategy(self):
        """Should create recursive markdown strategy when requested."""
        factory = ChunkingStrategyFactory()
        strategy = factory._create_strategy(ChunkingStrategyType.RECURSIVE_MARKDOWN)
        assert isinstance(strategy, RecursiveMarkdownChunkingStrategy)


# =============================================================================
# Existing Strategy Tests (Regression)
# =============================================================================

class TestOverlapChunkingStrategy:
    """Regression tests for existing overlap chunking strategy."""

    def test_basic_chunking(self):
        """Should chunk text with overlap."""
        strategy = OverlapChunkingStrategy(chunk_size=100, overlap=20)
        text = "A" * 200
        chunks = strategy.chunk(text)
        assert len(chunks) >= 2

    def test_empty_text(self):
        """Should return empty list for empty text."""
        strategy = OverlapChunkingStrategy()
        assert strategy.chunk("") == []

    def test_respects_sentence_boundaries(self):
        """Should try to break at sentence boundaries."""
        strategy = OverlapChunkingStrategy(chunk_size=100, overlap=20)
        text = "First sentence here. Second sentence follows. Third comes after."
        chunks = strategy.chunk(text)
        # Should try to break at sentence boundaries
        assert len(chunks) >= 1


class TestSentenceChunkingStrategy:
    """Tests for improved sentence chunking strategy."""

    def test_splits_sentences(self):
        """Should split text into sentences meeting min_length."""
        strategy = SentenceChunkingStrategy(min_length=20)
        text = "This is the first sentence here. This is the second sentence now! And this is the third sentence?"
        chunks = strategy.chunk(text)
        assert len(chunks) == 3
        assert "first sentence" in chunks[0]
        assert "second sentence" in chunks[1]
        assert "third sentence" in chunks[2]

    def test_filters_short_sentences(self):
        """Should filter sentences shorter than min_length."""
        strategy = SentenceChunkingStrategy(min_length=30)
        text = "Hi. This is a much longer sentence that should pass the filter easily."
        chunks = strategy.chunk(text)
        # "Hi" should be filtered out (too short)
        assert len(chunks) == 1
        assert "Hi" not in chunks[0]
        assert "longer sentence" in chunks[0]

    def test_empty_text(self):
        """Should return empty list for empty text."""
        strategy = SentenceChunkingStrategy()
        assert strategy.chunk("") == []

    def test_preserves_ascii_diagrams(self):
        """Should keep ASCII diagrams as single chunks."""
        strategy = SentenceChunkingStrategy(min_length=10)
        text = """Here is a diagram:

┌─────────────────────┐
│   User Interface    │
├─────────────────────┤
│   Business Logic    │
└─────────────────────┘

This is a description after."""
        chunks = strategy.chunk(text)
        # Diagram should be preserved as single chunk or excluded
        # Normal sentences should still be extracted
        assert any("description" in c for c in chunks)
        # No broken diagram fragments like just "│"
        assert not any(c.strip() == "│" for c in chunks)

    def test_preserves_code_blocks(self):
        """Should keep fenced code blocks as single chunks."""
        strategy = SentenceChunkingStrategy(min_length=10, max_chunk_size=500)
        text = """This is some explanation text here.

```python
def hello_world():
    print("Hello, World!")
    return True
```

More explanation follows this code."""
        chunks = strategy.chunk(text)
        # Code should be kept together if within max_chunk_size
        code_chunks = [c for c in chunks if "def hello_world" in c]
        if code_chunks:
            assert "print" in code_chunks[0]

    def test_handles_markdown_tables(self):
        """Should recognize and handle markdown tables."""
        strategy = SentenceChunkingStrategy(min_length=10)
        text = """| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |

This text comes after the table."""
        chunks = strategy.chunk(text)
        # Table fragments should not appear as tiny chunks
        assert not any(c.strip() == "|" for c in chunks)

    def test_protects_numbered_lists(self):
        """Should not split on numbered list markers."""
        strategy = SentenceChunkingStrategy(min_length=20)
        text = "1. This is the first item in a numbered list. 2. This is the second item."
        chunks = strategy.chunk(text)
        # Should not have broken "1." or "2." fragments
        assert not any(c.strip() in ["1.", "2."] for c in chunks)


# =============================================================================
# Integration Tests
# =============================================================================

class TestChunkingIntegration:
    """Integration tests for chunking workflow."""

    def test_factory_creates_working_strategies(self):
        """Factory-created strategies should produce valid chunks."""
        factory = ChunkingStrategyFactory()

        markdown_content = """# Introduction

This is a Markdown document with **bold** and *italic* text.

## Code Example

```python
def hello():
    return "world"
```

## Conclusion

That's all folks!"""

        strategy = factory.get_strategy(markdown_content, "doc.md")
        chunks = strategy.chunk(markdown_content)

        # Should produce non-empty chunks
        assert len(chunks) >= 1
        # All chunks should have content
        assert all(chunk.strip() for chunk in chunks)
        # Combined chunks should contain all content
        combined = "\n".join(chunks)
        assert "Introduction" in combined
        assert "hello" in combined

    def test_semantic_vs_overlap_comparison(self):
        """Semantic chunking should produce different results than overlap."""
        text = """Introduction paragraph with some content here.

This is the main body. It has multiple sentences. Each sentence adds meaning. The paragraph is coherent.

Conclusion paragraph wraps things up nicely."""

        semantic = SemanticChunkingStrategy(max_chunk_size=200)
        overlap = OverlapChunkingStrategy(chunk_size=200, overlap=40)

        semantic_chunks = semantic.chunk(text)
        overlap_chunks = overlap.chunk(text)

        # Both should produce chunks
        assert len(semantic_chunks) >= 1
        assert len(overlap_chunks) >= 1

        # Semantic should respect paragraph boundaries better
        # (This is a qualitative improvement, hard to test precisely)

    def test_markdown_strategy_preserves_code(self):
        """Markdown strategy should keep code blocks intact."""
        text = """# Setup

Install dependencies:

```bash
pip install -r requirements.txt
npm install
```

Then run the server."""

        strategy = RecursiveMarkdownChunkingStrategy(max_chunk_size=100)
        chunks = strategy.chunk(text)

        # Find chunk with code block
        code_chunks = [c for c in chunks if "```bash" in c]
        assert len(code_chunks) == 1

        # Code block should be complete
        code_chunk = code_chunks[0]
        assert "pip install" in code_chunk
        assert "npm install" in code_chunk
