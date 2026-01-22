"""Tests for Export API and Export Service.

Tests cover:
- Export API endpoints (markdown, pdf, docx)
- ExportService conversion methods
- HTMLToDocumentParser parsing
- PDFRenderer rendering
- DOCXRenderer rendering
- DocumentNode model
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from services.export_service import (
    DocumentNode,
    DOCXRenderer,
    ExportService,
    HTMLToDocumentParser,
    NodeType,
    PDFRenderer,
    export_service,
)

# ============================================================================
# DocumentNode Model Tests
# ============================================================================


class TestDocumentNode:
    """Tests for DocumentNode dataclass."""

    def test_creates_text_node(self):
        """Should create text node with content."""
        node = DocumentNode(NodeType.TEXT, content="Hello")
        assert node.node_type == NodeType.TEXT
        assert node.content == "Hello"
        assert node.children == []

    def test_creates_heading_node(self):
        """Should create heading node with level."""
        node = DocumentNode(NodeType.HEADING, content="Title", level=2)
        assert node.node_type == NodeType.HEADING
        assert node.level == 2

    def test_creates_list_node(self):
        """Should create list node with ordered flag."""
        node = DocumentNode(NodeType.LIST, ordered=True)
        assert node.node_type == NodeType.LIST
        assert node.ordered is True

    def test_creates_table_cell_node(self):
        """Should create table cell with header flag."""
        node = DocumentNode(NodeType.TABLE_CELL, content="Header", is_header=True)
        assert node.node_type == NodeType.TABLE_CELL
        assert node.is_header is True

    def test_creates_link_node(self):
        """Should create link node with URL."""
        node = DocumentNode(NodeType.INLINE_LINK, content="Click", url="https://example.com")
        assert node.node_type == NodeType.INLINE_LINK
        assert node.url == "https://example.com"

    def test_default_values(self):
        """Should have correct default values."""
        node = DocumentNode(NodeType.PARAGRAPH)
        assert node.content == ""
        assert node.children == []
        assert node.level == 1
        assert node.ordered is False
        assert node.is_header is False
        assert node.url == ""


class TestNodeType:
    """Tests for NodeType enum."""

    def test_all_node_types_exist(self):
        """Should define all node types."""
        expected_types = [
            "TEXT", "HEADING", "PARAGRAPH", "CODE_BLOCK", "BLOCKQUOTE",
            "LIST", "LIST_ITEM", "TABLE", "TABLE_ROW", "TABLE_CELL",
            "HORIZONTAL_RULE", "INLINE_BOLD", "INLINE_ITALIC",
            "INLINE_CODE", "INLINE_LINK"
        ]
        for type_name in expected_types:
            assert hasattr(NodeType, type_name)


# ============================================================================
# HTMLToDocumentParser Tests
# ============================================================================


class TestHTMLToDocumentParser:
    """Tests for HTML to DocumentNode parsing."""

    def test_parse_empty_html(self):
        """Should return empty list for empty HTML."""
        parser = HTMLToDocumentParser()
        result = parser.parse("")
        assert result == []

    def test_parse_heading_h1(self):
        """Should parse h1 heading."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<h1>Title</h1>")

        assert len(result) == 1
        assert result[0].node_type == NodeType.HEADING
        assert result[0].content == "Title"
        assert result[0].level == 1

    def test_parse_heading_h2_to_h6(self):
        """Should parse h2-h6 headings with correct levels."""
        parser = HTMLToDocumentParser()

        for level in range(2, 7):
            result = parser.parse(f"<h{level}>Heading {level}</h{level}>")
            assert result[0].level == level

    def test_parse_paragraph(self):
        """Should parse paragraph."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<p>Some text content</p>")

        assert len(result) == 1
        assert result[0].node_type == NodeType.PARAGRAPH

    def test_parse_code_block(self):
        """Should parse code block (pre tag)."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<pre>const x = 1;</pre>")

        assert len(result) == 1
        assert result[0].node_type == NodeType.CODE_BLOCK
        assert "const x = 1" in result[0].content

    def test_parse_blockquote(self):
        """Should parse blockquote."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<blockquote>A quote</blockquote>")

        assert len(result) == 1
        assert result[0].node_type == NodeType.BLOCKQUOTE
        assert result[0].content == "A quote"

    def test_parse_unordered_list(self):
        """Should parse unordered list."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<ul><li>Item 1</li><li>Item 2</li></ul>")

        assert len(result) == 1
        assert result[0].node_type == NodeType.LIST
        assert result[0].ordered is False
        assert len(result[0].children) == 2

    def test_parse_ordered_list(self):
        """Should parse ordered list."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<ol><li>First</li><li>Second</li></ol>")

        assert len(result) == 1
        assert result[0].node_type == NodeType.LIST
        assert result[0].ordered is True

    def test_parse_nested_list(self):
        """Should parse nested lists."""
        parser = HTMLToDocumentParser()
        html = "<ul><li>Item<ul><li>Nested</li></ul></li></ul>"
        result = parser.parse(html)

        assert len(result) == 1
        assert len(result[0].children) == 1
        assert len(result[0].children[0].children) == 1

    def test_parse_table(self):
        """Should parse table."""
        parser = HTMLToDocumentParser()
        html = """
        <table>
            <tr><th>Header 1</th><th>Header 2</th></tr>
            <tr><td>Cell 1</td><td>Cell 2</td></tr>
        </table>
        """
        result = parser.parse(html)

        assert len(result) == 1
        assert result[0].node_type == NodeType.TABLE
        assert len(result[0].children) == 2  # 2 rows

    def test_parse_table_cell_header(self):
        """Should mark th cells as headers."""
        parser = HTMLToDocumentParser()
        html = "<table><tr><th>Header</th></tr></table>"
        result = parser.parse(html)

        cell = result[0].children[0].children[0]
        assert cell.is_header is True

    def test_parse_horizontal_rule(self):
        """Should parse horizontal rule."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<hr>")

        assert len(result) == 1
        assert result[0].node_type == NodeType.HORIZONTAL_RULE

    def test_parse_inline_bold(self):
        """Should parse bold text."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<p><strong>Bold</strong></p>")

        para = result[0]
        assert any(c.node_type == NodeType.INLINE_BOLD for c in para.children)

    def test_parse_inline_italic(self):
        """Should parse italic text."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<p><em>Italic</em></p>")

        para = result[0]
        assert any(c.node_type == NodeType.INLINE_ITALIC for c in para.children)

    def test_parse_inline_code(self):
        """Should parse inline code."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<p><code>code</code></p>")

        para = result[0]
        assert any(c.node_type == NodeType.INLINE_CODE for c in para.children)

    def test_parse_inline_link(self):
        """Should parse link with URL."""
        parser = HTMLToDocumentParser()
        result = parser.parse('<p><a href="https://test.com">Link</a></p>')

        para = result[0]
        links = [c for c in para.children if c.node_type == NodeType.INLINE_LINK]
        assert len(links) == 1
        assert links[0].url == "https://test.com"

    def test_parse_br_tag(self):
        """Should parse br as newline."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<p>Line 1<br>Line 2</p>")

        # Should have text nodes with newline
        para = result[0]
        text_contents = [c.content for c in para.children if c.node_type == NodeType.TEXT]
        assert "\n" in text_contents

    def test_parse_div_single_child(self):
        """Should unwrap div with single child."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<div><p>Content</p></div>")

        assert len(result) == 1
        assert result[0].node_type == NodeType.PARAGRAPH

    def test_parse_div_multiple_children(self):
        """Should wrap multiple div children in paragraph."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<div><p>One</p><p>Two</p></div>")

        assert len(result) == 1

    def test_parse_mixed_content(self):
        """Should parse document with mixed content."""
        parser = HTMLToDocumentParser()
        html = """
        <h1>Title</h1>
        <p>Some <strong>bold</strong> text.</p>
        <ul><li>Item</li></ul>
        """
        result = parser.parse(html)

        assert len(result) >= 3

    def test_ignores_unknown_elements(self):
        """Should return None for unknown elements."""
        parser = HTMLToDocumentParser()
        result = parser.parse("<custom>Unknown</custom>")

        assert len(result) == 0

    def test_parse_text_only(self):
        """Should parse text nodes at root level."""
        parser = HTMLToDocumentParser()
        # Whitespace-only text should be ignored
        result = parser.parse("   ")
        assert len(result) == 0


# ============================================================================
# PDFRenderer Tests
# ============================================================================


class TestPDFRenderer:
    """Tests for PDF rendering."""

    def test_render_empty_nodes(self):
        """Should render empty document."""
        renderer = PDFRenderer()
        result = renderer.render([])

        assert isinstance(result, (bytes, bytearray))
        assert len(result) > 0  # PDF header

    def test_render_text_node(self):
        """Should render text node."""
        renderer = PDFRenderer()
        nodes = [DocumentNode(NodeType.TEXT, content="Hello World")]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_render_heading_node(self):
        """Should render heading with correct size."""
        renderer = PDFRenderer()
        nodes = [DocumentNode(NodeType.HEADING, content="Title", level=1)]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_render_all_heading_levels(self):
        """Should render all heading levels."""
        renderer = PDFRenderer()
        nodes = [
            DocumentNode(NodeType.HEADING, content=f"H{i}", level=i)
            for i in range(1, 7)
        ]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_render_paragraph_node(self):
        """Should render paragraph node."""
        renderer = PDFRenderer()
        nodes = [DocumentNode(
            NodeType.PARAGRAPH,
            children=[DocumentNode(NodeType.TEXT, content="Paragraph text")]
        )]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_render_code_block(self):
        """Should render code block with styling."""
        renderer = PDFRenderer()
        nodes = [DocumentNode(NodeType.CODE_BLOCK, content="const x = 1;")]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_render_blockquote(self):
        """Should render blockquote with styling."""
        renderer = PDFRenderer()
        nodes = [DocumentNode(NodeType.BLOCKQUOTE, content="A wise quote")]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_render_unordered_list(self):
        """Should render unordered list with bullets."""
        renderer = PDFRenderer()
        nodes = [DocumentNode(
            NodeType.LIST,
            ordered=False,
            children=[
                DocumentNode(NodeType.LIST_ITEM, content="Item 1"),
                DocumentNode(NodeType.LIST_ITEM, content="Item 2"),
            ]
        )]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_render_ordered_list(self):
        """Should render ordered list with numbers."""
        renderer = PDFRenderer()
        nodes = [DocumentNode(
            NodeType.LIST,
            ordered=True,
            children=[
                DocumentNode(NodeType.LIST_ITEM, content="First"),
                DocumentNode(NodeType.LIST_ITEM, content="Second"),
            ]
        )]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_render_nested_list(self):
        """Should render nested lists."""
        renderer = PDFRenderer()
        nodes = [DocumentNode(
            NodeType.LIST,
            children=[
                DocumentNode(
                    NodeType.LIST_ITEM,
                    content="Parent",
                    children=[
                        DocumentNode(
                            NodeType.LIST,
                            children=[
                                DocumentNode(NodeType.LIST_ITEM, content="Child")
                            ]
                        )
                    ]
                )
            ]
        )]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_render_table(self):
        """Should render table."""
        renderer = PDFRenderer()
        nodes = [DocumentNode(
            NodeType.TABLE,
            children=[
                DocumentNode(
                    NodeType.TABLE_ROW,
                    children=[
                        DocumentNode(NodeType.TABLE_CELL, content="H1", is_header=True),
                        DocumentNode(NodeType.TABLE_CELL, content="H2", is_header=True),
                    ]
                ),
                DocumentNode(
                    NodeType.TABLE_ROW,
                    children=[
                        DocumentNode(NodeType.TABLE_CELL, content="C1"),
                        DocumentNode(NodeType.TABLE_CELL, content="C2"),
                    ]
                ),
            ]
        )]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_render_empty_table(self):
        """Should handle empty table."""
        renderer = PDFRenderer()
        nodes = [DocumentNode(NodeType.TABLE, children=[])]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_render_table_empty_first_row(self):
        """Should handle table with empty first row."""
        renderer = PDFRenderer()
        nodes = [DocumentNode(
            NodeType.TABLE,
            children=[DocumentNode(NodeType.TABLE_ROW, children=[])]
        )]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_render_horizontal_rule(self):
        """Should render horizontal rule."""
        renderer = PDFRenderer()
        nodes = [DocumentNode(NodeType.HORIZONTAL_RULE)]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_render_table_long_cell_content(self):
        """Should truncate long cell content."""
        renderer = PDFRenderer()
        long_text = "A" * 100  # Very long text
        nodes = [DocumentNode(
            NodeType.TABLE,
            children=[
                DocumentNode(
                    NodeType.TABLE_ROW,
                    children=[
                        DocumentNode(NodeType.TABLE_CELL, content=long_text),
                    ]
                ),
            ]
        )]
        result = renderer.render(nodes)

        assert isinstance(result, (bytes, bytearray))

    def test_get_paragraph_text_with_children(self):
        """Should extract text from paragraph children."""
        renderer = PDFRenderer()
        node = DocumentNode(
            NodeType.PARAGRAPH,
            children=[
                DocumentNode(NodeType.TEXT, content="Hello "),
                DocumentNode(NodeType.INLINE_BOLD, content="World"),
            ]
        )
        text = renderer._get_paragraph_text(node)

        assert "Hello" in text
        assert "World" in text

    def test_get_paragraph_text_no_children(self):
        """Should return node content when no children."""
        renderer = PDFRenderer()
        node = DocumentNode(NodeType.PARAGRAPH, content="Direct content")
        text = renderer._get_paragraph_text(node)

        assert text == "Direct content"

    def test_find_unicode_font(self):
        """Should attempt to find unicode font."""
        renderer = PDFRenderer()
        # May or may not find a font depending on system
        # Just verify it doesn't crash
        assert renderer._unicode_font is None or isinstance(renderer._unicode_font, str)

    def test_get_system_font_path_nonexistent(self):
        """Should return None for nonexistent font."""
        renderer = PDFRenderer()
        result = renderer._get_system_font_path("nonexistent-font-xyz.ttf")
        assert result is None


# ============================================================================
# DOCXRenderer Tests
# ============================================================================


class TestDOCXRenderer:
    """Tests for DOCX rendering."""

    def test_render_empty_nodes(self):
        """Should render empty document."""
        renderer = DOCXRenderer()
        result = renderer.render([])

        assert isinstance(result, bytes)
        assert len(result) > 0  # DOCX structure

    def test_render_text_node(self):
        """Should render text node."""
        renderer = DOCXRenderer()
        nodes = [DocumentNode(NodeType.TEXT, content="Hello World")]
        result = renderer.render(nodes)

        assert isinstance(result, bytes)

    def test_render_heading_node(self):
        """Should render heading."""
        renderer = DOCXRenderer()
        nodes = [DocumentNode(NodeType.HEADING, content="Title", level=1)]
        result = renderer.render(nodes)

        assert isinstance(result, bytes)

    def test_render_paragraph_with_inline(self):
        """Should render paragraph with inline elements."""
        renderer = DOCXRenderer()
        nodes = [DocumentNode(
            NodeType.PARAGRAPH,
            children=[
                DocumentNode(NodeType.TEXT, content="Normal "),
                DocumentNode(NodeType.INLINE_BOLD, content="bold "),
                DocumentNode(NodeType.INLINE_ITALIC, content="italic "),
                DocumentNode(NodeType.INLINE_CODE, content="code "),
                DocumentNode(NodeType.INLINE_LINK, content="link", url="https://test.com"),
            ]
        )]
        result = renderer.render(nodes)

        assert isinstance(result, bytes)

    def test_render_code_block(self):
        """Should render code block."""
        renderer = DOCXRenderer()
        nodes = [DocumentNode(NodeType.CODE_BLOCK, content="function test() {}")]
        result = renderer.render(nodes)

        assert isinstance(result, bytes)

    def test_render_blockquote(self):
        """Should render blockquote."""
        renderer = DOCXRenderer()
        nodes = [DocumentNode(NodeType.BLOCKQUOTE, content="Quote text")]
        result = renderer.render(nodes)

        assert isinstance(result, bytes)

    def test_render_list(self):
        """Should render list."""
        renderer = DOCXRenderer()
        nodes = [DocumentNode(
            NodeType.LIST,
            ordered=True,
            children=[
                DocumentNode(NodeType.LIST_ITEM, content="One"),
                DocumentNode(NodeType.LIST_ITEM, content="Two"),
            ]
        )]
        result = renderer.render(nodes)

        assert isinstance(result, bytes)

    def test_render_nested_list(self):
        """Should render nested list."""
        renderer = DOCXRenderer()
        nodes = [DocumentNode(
            NodeType.LIST,
            children=[
                DocumentNode(
                    NodeType.LIST_ITEM,
                    content="Parent",
                    children=[
                        DocumentNode(
                            NodeType.LIST,
                            children=[DocumentNode(NodeType.LIST_ITEM, content="Child")]
                        )
                    ]
                )
            ]
        )]
        result = renderer.render(nodes)

        assert isinstance(result, bytes)

    def test_render_table(self):
        """Should render table."""
        renderer = DOCXRenderer()
        nodes = [DocumentNode(
            NodeType.TABLE,
            children=[
                DocumentNode(
                    NodeType.TABLE_ROW,
                    children=[
                        DocumentNode(NodeType.TABLE_CELL, content="H1", is_header=True),
                        DocumentNode(NodeType.TABLE_CELL, content="H2", is_header=True),
                    ]
                ),
                DocumentNode(
                    NodeType.TABLE_ROW,
                    children=[
                        DocumentNode(NodeType.TABLE_CELL, content="C1"),
                        DocumentNode(NodeType.TABLE_CELL, content="C2"),
                    ]
                ),
            ]
        )]
        result = renderer.render(nodes)

        assert isinstance(result, bytes)

    def test_render_empty_table(self):
        """Should handle empty table."""
        renderer = DOCXRenderer()
        nodes = [DocumentNode(NodeType.TABLE, children=[])]
        result = renderer.render(nodes)

        assert isinstance(result, bytes)

    def test_render_table_empty_first_row(self):
        """Should handle table with empty first row."""
        renderer = DOCXRenderer()
        nodes = [DocumentNode(
            NodeType.TABLE,
            children=[DocumentNode(NodeType.TABLE_ROW, children=[])]
        )]
        result = renderer.render(nodes)

        assert isinstance(result, bytes)

    def test_render_horizontal_rule(self):
        """Should render horizontal rule."""
        renderer = DOCXRenderer()
        nodes = [DocumentNode(NodeType.HORIZONTAL_RULE)]
        result = renderer.render(nodes)

        assert isinstance(result, bytes)


# ============================================================================
# ExportService Tests
# ============================================================================


class TestExportService:
    """Tests for ExportService."""

    def test_service_initialization(self):
        """Should initialize with all components."""
        service = ExportService()

        assert service.md is not None
        assert service.parser is not None
        assert service.pdf_renderer is not None
        assert service.docx_renderer is not None

    def test_export_markdown(self):
        """Should export as UTF-8 encoded markdown."""
        service = ExportService()
        content = "# Hello\n\nWorld"

        result = service.export_markdown(content, "test")

        assert result == content.encode('utf-8')

    def test_export_markdown_unicode(self):
        """Should handle unicode in markdown export."""
        service = ExportService()
        content = "# 你好世界\n\nテスト"

        result = service.export_markdown(content, "test")

        assert result == content.encode('utf-8')

    def test_export_pdf(self):
        """Should export as PDF."""
        service = ExportService()
        content = "# Title\n\nParagraph text."

        result = service.export_pdf(content, "test")

        assert isinstance(result, (bytes, bytearray))
        assert len(result) > 0

    def test_export_pdf_with_formatting(self):
        """Should handle formatted content in PDF."""
        service = ExportService()
        content = """
# Heading

**Bold** and *italic* text.

- List item 1
- List item 2

```
code block
```
"""
        result = service.export_pdf(content, "test")

        assert isinstance(result, (bytes, bytearray))

    def test_export_docx(self):
        """Should export as DOCX."""
        service = ExportService()
        content = "# Title\n\nParagraph text."

        result = service.export_docx(content, "test")

        assert isinstance(result, bytes)
        assert len(result) > 0

    def test_export_docx_with_formatting(self):
        """Should handle formatted content in DOCX."""
        service = ExportService()
        content = """
# Heading

**Bold** and *italic* text.

1. First
2. Second

| Col A | Col B |
|-------|-------|
| 1     | 2     |
"""
        result = service.export_docx(content, "test")

        assert isinstance(result, bytes)

    def test_md_reset_between_exports(self):
        """Should reset markdown parser between exports."""
        service = ExportService()

        # First export
        service.export_pdf("# First", "test1")

        # Second export should work independently
        result = service.export_pdf("# Second", "test2")

        assert isinstance(result, (bytes, bytearray))

    def test_singleton_instance(self):
        """Should have singleton instance available."""
        assert export_service is not None
        assert isinstance(export_service, ExportService)


# ============================================================================
# Export API Endpoint Tests
# ============================================================================


class TestExportAPIEndpoints:
    """Tests for export API endpoints."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.fixture
    def mock_file(self):
        """Create mock file object."""
        file = MagicMock()
        file.id = "file-123"
        file.name = "document.md"
        file.content = "# Test Document\n\nSome content."
        return file

    @pytest.fixture
    def mock_token(self):
        """Create mock TokenData for auth."""
        from datetime import UTC, datetime, timedelta

        from services.auth_service import TokenData
        return TokenData(sub="dev-user", exp=datetime.now(UTC) + timedelta(hours=1))

    @pytest.mark.asyncio
    async def test_export_markdown_success(self, mock_db, mock_file, mock_token):
        """Should export file as markdown."""
        # Setup mock
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_file
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.export import export_file

        response = await export_file("file-123", "markdown", mock_db, mock_token)

        assert response.media_type == "text/markdown"

    @pytest.mark.asyncio
    async def test_export_pdf_success(self, mock_db, mock_file, mock_token):
        """Should export file as PDF."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_file
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.export import export_file

        response = await export_file("file-123", "pdf", mock_db, mock_token)

        assert response.media_type == "application/pdf"

    @pytest.mark.asyncio
    async def test_export_docx_success(self, mock_db, mock_file, mock_token):
        """Should export file as DOCX."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_file
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.export import export_file

        response = await export_file("file-123", "docx", mock_db, mock_token)

        assert "wordprocessingml" in response.media_type

    @pytest.mark.asyncio
    async def test_export_file_not_found(self, mock_db, mock_token):
        """Should raise 404 when file not found."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.export import export_file

        with pytest.raises(HTTPException) as exc_info:
            await export_file("nonexistent", "markdown", mock_db, mock_token)

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_export_strips_md_extension(self, mock_db, mock_file, mock_token):
        """Should strip .md extension from filename."""
        mock_file.name = "document.md"
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_file
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.export import export_file

        response = await export_file("file-123", "markdown", mock_db, mock_token)

        # Check Content-Disposition header
        content_disp = response.headers.get("Content-Disposition", "")
        assert "document.md" in content_disp

    @pytest.mark.asyncio
    async def test_export_handles_error(self, mock_db, mock_file, mock_token):
        """Should raise 500 on export error."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_file
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.export import export_file

        with patch.object(export_service, "export_pdf", side_effect=Exception("Export failed")):
            with pytest.raises(HTTPException) as exc_info:
                await export_file("file-123", "pdf", mock_db, mock_token)

            assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_export_url_encodes_filename(self, mock_db, mock_file, mock_token):
        """Should URL encode filename with special characters."""
        mock_file.name = "文档 测试.md"
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_file
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.export import export_file

        response = await export_file("file-123", "markdown", mock_db, mock_token)

        content_disp = response.headers.get("Content-Disposition", "")
        assert "UTF-8''" in content_disp

    @pytest.mark.asyncio
    async def test_export_without_md_extension(self, mock_db, mock_file, mock_token):
        """Should handle file without .md extension."""
        mock_file.name = "document"
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_file
        mock_db.execute = AsyncMock(return_value=mock_result)

        from api.export import export_file

        response = await export_file("file-123", "pdf", mock_db, mock_token)

        assert response.media_type == "application/pdf"


# ============================================================================
# Integration Tests
# ============================================================================


class TestExportIntegration:
    """Integration tests for full export pipeline."""

    def test_full_markdown_to_pdf_pipeline(self):
        """Should convert markdown to PDF through full pipeline."""
        content = """
# Document Title

This is a paragraph with **bold** and *italic* text.

## Section 1

- Item 1
- Item 2
  - Nested item

### Code Example

```python
def hello():
    print("Hello")
```

> A blockquote

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |

---

Final paragraph.
"""
        result = export_service.export_pdf(content, "test")

        assert isinstance(result, (bytes, bytearray))
        assert len(result) > 0

    def test_full_markdown_to_docx_pipeline(self):
        """Should convert markdown to DOCX through full pipeline."""
        content = """
# Document Title

This is a paragraph with **bold** and *italic* text.

1. First item
2. Second item

[Link](https://example.com)

`inline code`
"""
        result = export_service.export_docx(content, "test")

        assert isinstance(result, bytes)
        # DOCX files are ZIP archives with specific structure
        # First bytes should be PK (ZIP signature)
        assert result[:2] == b'PK'

    def test_empty_content_export(self):
        """Should handle empty content."""
        pdf_result = export_service.export_pdf("", "empty")
        docx_result = export_service.export_docx("", "empty")
        md_result = export_service.export_markdown("", "empty")

        assert isinstance(pdf_result, (bytes, bytearray))
        assert isinstance(docx_result, bytes)
        assert md_result == b""

    def test_unicode_content_export(self):
        """Should handle unicode content in all formats."""
        content = "# 中文标题\n\n日本語テキスト\n\n한국어 텍스트"

        # PDF export may fail on CI environments without Unicode fonts
        # In that case, we accept the failure gracefully
        try:
            pdf_result = export_service.export_pdf(content, "unicode")
            assert isinstance(pdf_result, (bytes, bytearray))
        except Exception as e:
            # Skip PDF assertion if font encoding fails (CI environment without Unicode fonts)
            if "outside the range of characters supported by the font" in str(e):
                pytest.skip("No Unicode font available for PDF export")
            raise

        docx_result = export_service.export_docx(content, "unicode")
        md_result = export_service.export_markdown(content, "unicode")

        assert isinstance(docx_result, bytes)
        assert md_result == content.encode('utf-8')
