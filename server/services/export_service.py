"""Export service for converting Markdown to PDF and DOCX.

This module provides multi-format export with a unified HTML parsing layer
to avoid code duplication between formats.
"""

import io
import os
from dataclasses import dataclass, field
from enum import Enum

import markdown
from bs4 import BeautifulSoup
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from fpdf import FPDF

# ============================================================================
# Document Node Model (Intermediate Representation)
# ============================================================================

class NodeType(Enum):
    """Types of document nodes."""
    TEXT = "text"
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    CODE_BLOCK = "code_block"
    BLOCKQUOTE = "blockquote"
    LIST = "list"
    LIST_ITEM = "list_item"
    TABLE = "table"
    TABLE_ROW = "table_row"
    TABLE_CELL = "table_cell"
    HORIZONTAL_RULE = "hr"
    INLINE_BOLD = "bold"
    INLINE_ITALIC = "italic"
    INLINE_CODE = "code"
    INLINE_LINK = "link"


@dataclass
class DocumentNode:
    """Represents a node in the document tree."""
    node_type: NodeType
    content: str = ""
    children: list["DocumentNode"] = field(default_factory=list)

    # Type-specific attributes
    level: int = 1  # For headings (1-6)
    ordered: bool = False  # For lists
    is_header: bool = False  # For table cells
    url: str = ""  # For links


# ============================================================================
# HTML Parser (converts HTML to DocumentNode tree)
# ============================================================================

class HTMLToDocumentParser:
    """Parses HTML into a DocumentNode tree."""

    def parse(self, html: str) -> list[DocumentNode]:
        """Parse HTML string into document nodes."""
        soup = BeautifulSoup(html, 'html.parser')
        return self._parse_children(soup)

    def _parse_children(self, element) -> list[DocumentNode]:
        """Parse children of an element."""
        nodes = []
        for child in element.children:
            node = self._parse_element(child)
            if node:
                nodes.append(node)
        return nodes

    def _parse_element(self, element) -> DocumentNode | None:
        """Parse a single element into a DocumentNode."""
        if element.name is None:
            # Text node
            text = str(element).strip()
            if text:
                return DocumentNode(NodeType.TEXT, content=text)
            return None

        name = element.name

        # Headings
        if name in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
            level = int(name[1])
            return DocumentNode(
                NodeType.HEADING,
                content=element.get_text().strip(),
                level=level
            )

        # Paragraph
        if name == 'p':
            return DocumentNode(
                NodeType.PARAGRAPH,
                children=self._parse_inline_elements(element)
            )

        # Code block
        if name == 'pre':
            return DocumentNode(
                NodeType.CODE_BLOCK,
                content=element.get_text()
            )

        # Blockquote
        if name == 'blockquote':
            return DocumentNode(
                NodeType.BLOCKQUOTE,
                content=element.get_text().strip()
            )

        # Lists
        if name in ['ul', 'ol']:
            return DocumentNode(
                NodeType.LIST,
                ordered=(name == 'ol'),
                children=self._parse_list_items(element)
            )

        # Table
        if name == 'table':
            return DocumentNode(
                NodeType.TABLE,
                children=self._parse_table_rows(element)
            )

        # Horizontal rule
        if name == 'hr':
            return DocumentNode(NodeType.HORIZONTAL_RULE)

        # Div - recurse
        if name == 'div':
            children = self._parse_children(element)
            if len(children) == 1:
                return children[0]
            elif children:
                # Wrap in paragraph if multiple children
                return DocumentNode(NodeType.PARAGRAPH, children=children)

        return None

    def _parse_inline_elements(self, element) -> list[DocumentNode]:
        """Parse inline elements (bold, italic, code, links)."""
        nodes = []
        for child in element.children:
            if child.name is None:
                text = str(child)
                if text:
                    nodes.append(DocumentNode(NodeType.TEXT, content=text))
            elif child.name in ['strong', 'b']:
                nodes.append(DocumentNode(
                    NodeType.INLINE_BOLD,
                    content=child.get_text()
                ))
            elif child.name in ['em', 'i']:
                nodes.append(DocumentNode(
                    NodeType.INLINE_ITALIC,
                    content=child.get_text()
                ))
            elif child.name == 'code':
                nodes.append(DocumentNode(
                    NodeType.INLINE_CODE,
                    content=child.get_text()
                ))
            elif child.name == 'a':
                nodes.append(DocumentNode(
                    NodeType.INLINE_LINK,
                    content=child.get_text(),
                    url=child.get('href', '')
                ))
            elif child.name == 'br':
                nodes.append(DocumentNode(NodeType.TEXT, content='\n'))
            else:
                # Recurse for other elements
                nodes.extend(self._parse_inline_elements(child))
        return nodes

    def _parse_list_items(self, element) -> list[DocumentNode]:
        """Parse list items."""
        items = []
        for li in element.find_all('li', recursive=False):
            # Get direct text content
            text_parts = []
            nested_lists = []

            for child in li.children:
                if child.name is None:
                    text_parts.append(str(child))
                elif child.name in ['ul', 'ol']:
                    nested_lists.append(self._parse_element(child))
                elif child.name not in ['ul', 'ol']:
                    text_parts.append(child.get_text())

            item = DocumentNode(
                NodeType.LIST_ITEM,
                content=''.join(text_parts).strip(),
                children=[n for n in nested_lists if n]
            )
            items.append(item)
        return items

    def _parse_table_rows(self, element) -> list[DocumentNode]:
        """Parse table rows."""
        rows = []
        for tr in element.find_all('tr'):
            cells = []
            for cell in tr.find_all(['th', 'td']):
                cells.append(DocumentNode(
                    NodeType.TABLE_CELL,
                    content=cell.get_text().strip(),
                    is_header=(cell.name == 'th')
                ))
            if cells:
                rows.append(DocumentNode(NodeType.TABLE_ROW, children=cells))
        return rows


# ============================================================================
# PDF Renderer
# ============================================================================

class PDFRenderer:
    """Renders DocumentNodes to PDF."""

    def __init__(self):
        self._unicode_font = None
        self._unicode_font_path = None
        self._find_unicode_font()

    def _find_unicode_font(self):
        """Find a suitable Unicode font on the system."""
        # First try to find fonts by scanning directories (more reliable for Linux/Docker)
        font_path = self._scan_for_cjk_font()
        if font_path:
            self._unicode_font_path = font_path
            self._unicode_font = "CJK Font"
            return

        # Fallback to specific file names
        font_candidates = [
            # Linux (fonts-noto-cjk package) - various possible names
            ('NotoSansCJK-Regular.ttc', 'Noto Sans CJK'),
            ('NotoSansCJKsc-Regular.ttc', 'Noto Sans CJK SC'),
            ('NotoSansCJKsc-Regular.otf', 'Noto Sans CJK SC'),
            ('NotoSansSC-Regular.otf', 'Noto Sans SC'),
            ('NotoSansSC-Regular.ttf', 'Noto Sans SC'),
            # Windows
            ('msyh.ttc', 'Microsoft YaHei'),
            ('msyhbd.ttc', 'Microsoft YaHei Bold'),
            ('simhei.ttf', 'SimHei'),
            ('simsun.ttc', 'SimSun'),
            # macOS
            ('PingFang.ttc', 'PingFang SC'),
            ('STHeiti Light.ttc', 'STHeiti'),
            # Linux fallbacks
            ('DroidSansFallbackFull.ttf', 'Droid Sans Fallback'),
            ('DejaVuSans.ttf', 'DejaVu Sans'),
        ]

        for font_file, font_name in font_candidates:
            path = self._get_system_font_path(font_file)
            if path:
                self._unicode_font = font_name
                self._unicode_font_path = path
                break

    def _scan_for_cjk_font(self) -> str | None:
        """Scan font directories for any CJK-capable font."""
        font_dirs = [
            # Linux - where fonts-noto-cjk installs fonts
            '/usr/share/fonts/opentype/noto',
            '/usr/share/fonts/truetype/noto',
            '/usr/share/fonts/noto-cjk',
            '/usr/share/fonts/opentype',
            '/usr/share/fonts/truetype',
            '/usr/share/fonts',
        ]

        # Patterns that indicate CJK support
        cjk_patterns = ['notosanscjk', 'notoserifcjk', 'notosanssc', 'notosc', 'cjk']

        for font_dir in font_dirs:
            if not os.path.exists(font_dir):
                continue
            for root, _dirs, files in os.walk(font_dir):
                for filename in files:
                    lower_name = filename.lower()
                    # Check if it's a font file with CJK support
                    if lower_name.endswith(('.ttc', '.ttf', '.otf')):
                        for pattern in cjk_patterns:
                            if pattern in lower_name:
                                return os.path.join(root, filename)
        return None

    def _get_system_font_path(self, font_name: str) -> str | None:
        """Get the path to a system font file."""
        font_dirs = []

        if os.name == 'nt':
            font_dirs.append(os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts'))

        font_dirs.extend([
            # macOS
            '/System/Library/Fonts',
            '/Library/Fonts',
            os.path.expanduser('~/Library/Fonts'),
            # Linux - common font directories
            '/usr/share/fonts/opentype/noto',
            '/usr/share/fonts/truetype/noto',
            '/usr/share/fonts/noto-cjk',
            '/usr/share/fonts/opentype',
            '/usr/share/fonts/truetype',
            '/usr/share/fonts',
            '/usr/local/share/fonts',
            os.path.expanduser('~/.fonts'),
        ])

        font_name_lower = font_name.lower()

        for font_dir in font_dirs:
            if os.path.exists(font_dir):
                # Direct path check
                font_path = os.path.join(font_dir, font_name)
                if os.path.exists(font_path):
                    return font_path
                # Walk and check with case-insensitive matching
                for root, _dirs, files in os.walk(font_dir):
                    for filename in files:
                        if filename.lower() == font_name_lower:
                            return os.path.join(root, filename)
        return None

    def render(self, nodes: list[DocumentNode]) -> bytes:
        """Render document nodes to PDF bytes."""
        pdf = FPDF()
        pdf.set_auto_page_break(auto=True, margin=15)

        # Add Unicode font if available
        if self._unicode_font_path:
            pdf.add_font("unicode", style="", fname=self._unicode_font_path)
            pdf.add_font("unicode", style="B", fname=self._unicode_font_path)
            pdf.add_font("unicode", style="I", fname=self._unicode_font_path)
            font = "unicode"
        else:
            font = "Helvetica"

        pdf.add_page()
        pdf.set_font(font, size=11)

        for node in nodes:
            self._render_node(pdf, node, font)

        return pdf.output()

    def _render_node(self, pdf: FPDF, node: DocumentNode, font: str, level: int = 0):
        """Render a single node to the PDF."""
        if node.node_type == NodeType.TEXT:
            pdf.set_font(font, size=11)
            pdf.multi_cell(0, 6, node.content)
            pdf.ln(2)

        elif node.node_type == NodeType.HEADING:
            sizes = {1: 20, 2: 16, 3: 14, 4: 12, 5: 12, 6: 12}
            size = sizes.get(node.level, 12)
            pdf.set_font(font, "B", size)
            pdf.set_text_color(26, 26, 26)
            pdf.multi_cell(0, size / 2, node.content)
            pdf.ln(4 if node.level <= 2 else 2)
            pdf.set_text_color(0)

        elif node.node_type == NodeType.PARAGRAPH:
            pdf.set_font(font, size=11)
            text = self._get_paragraph_text(node)
            pdf.multi_cell(0, 6, text)
            pdf.ln(3)

        elif node.node_type == NodeType.CODE_BLOCK:
            pdf.set_font(font, size=9)
            pdf.set_fill_color(245, 245, 245)
            pdf.set_x(pdf.l_margin + 5)
            pdf.multi_cell(0, 5, node.content, fill=True)
            pdf.set_font(font, size=11)
            pdf.ln(3)

        elif node.node_type == NodeType.BLOCKQUOTE:
            pdf.set_font(font, "I", 11)
            pdf.set_text_color(102, 102, 102)
            pdf.set_x(pdf.l_margin + 10)
            pdf.multi_cell(0, 6, node.content)
            pdf.set_text_color(0)
            pdf.ln(3)

        elif node.node_type == NodeType.LIST:
            self._render_list(pdf, node, font, level)
            pdf.ln(2)

        elif node.node_type == NodeType.TABLE:
            self._render_table(pdf, node, font)
            pdf.ln(3)

        elif node.node_type == NodeType.HORIZONTAL_RULE:
            pdf.set_draw_color(200, 200, 200)
            y = pdf.get_y()
            pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
            pdf.ln(5)

    def _get_paragraph_text(self, node: DocumentNode) -> str:
        """Extract text from paragraph with inline elements."""
        parts = []
        for child in node.children:
            parts.append(child.content)
        return ''.join(parts) if parts else node.content

    def _render_list(self, pdf: FPDF, node: DocumentNode, font: str, level: int = 0):
        """Render a list to the PDF."""
        pdf.set_font(font, size=11)
        indent = 10 + (level * 10)
        counter = 1

        for item in node.children:
            if item.node_type == NodeType.LIST_ITEM:
                prefix = f"{counter}. " if node.ordered else "- "
                counter += 1
                pdf.set_x(pdf.l_margin + indent)
                pdf.multi_cell(0, 6, prefix + item.content)

                # Handle nested lists
                for nested in item.children:
                    if nested.node_type == NodeType.LIST:
                        self._render_list(pdf, nested, font, level + 1)

    def _render_table(self, pdf: FPDF, node: DocumentNode, font: str):
        """Render a table to the PDF."""
        if not node.children:
            return

        first_row = node.children[0]
        col_count = len(first_row.children)
        if col_count == 0:
            return

        available_width = pdf.w - pdf.l_margin - pdf.r_margin
        col_width = available_width / col_count

        pdf.set_font(font, size=10)

        for i, row in enumerate(node.children):
            for j, cell in enumerate(row.children):
                if j >= col_count:
                    break

                is_header = cell.is_header or i == 0
                if is_header:
                    pdf.set_font(font, "B", 10)
                    pdf.set_fill_color(240, 240, 240)
                else:
                    pdf.set_font(font, size=10)
                    pdf.set_fill_color(255, 255, 255)

                x = pdf.l_margin + (j * col_width)
                y = pdf.get_y()
                pdf.set_xy(x, y)

                display_text = cell.content[:30] if len(cell.content) > 30 else cell.content
                pdf.cell(col_width, 6, display_text, border=1, fill=is_header)

            pdf.ln(6)


# ============================================================================
# DOCX Renderer
# ============================================================================

class DOCXRenderer:
    """Renders DocumentNodes to DOCX."""

    def render(self, nodes: list[DocumentNode]) -> bytes:
        """Render document nodes to DOCX bytes."""
        doc = Document()

        # Set default font
        style = doc.styles['Normal']
        style.font.name = 'Calibri'
        style.font.size = Pt(11)

        for node in nodes:
            self._render_node(doc, node)

        buffer = io.BytesIO()
        doc.save(buffer)
        buffer.seek(0)
        return buffer.getvalue()

    def _render_node(self, doc: Document, node: DocumentNode, level: int = 0):
        """Render a single node to the document."""
        if node.node_type == NodeType.TEXT:
            doc.add_paragraph(node.content)

        elif node.node_type == NodeType.HEADING:
            doc.add_heading(node.content, level=node.level)

        elif node.node_type == NodeType.PARAGRAPH:
            para = doc.add_paragraph()
            self._render_inline_content(para, node.children)

        elif node.node_type == NodeType.CODE_BLOCK:
            para = doc.add_paragraph()
            run = para.add_run(node.content)
            run.font.name = 'Consolas'
            run.font.size = Pt(10)
            para.paragraph_format.left_indent = Inches(0.25)

        elif node.node_type == NodeType.BLOCKQUOTE:
            para = doc.add_paragraph()
            para.paragraph_format.left_indent = Inches(0.5)
            run = para.add_run(node.content)
            run.font.italic = True
            run.font.color.rgb = RGBColor(102, 102, 102)

        elif node.node_type == NodeType.LIST:
            self._render_list(doc, node, level)

        elif node.node_type == NodeType.TABLE:
            self._render_table(doc, node)

        elif node.node_type == NodeType.HORIZONTAL_RULE:
            para = doc.add_paragraph()
            para.add_run('_' * 50)

    def _render_inline_content(self, para, children: list[DocumentNode]):
        """Render inline content to a paragraph."""
        for child in children:
            if child.node_type == NodeType.TEXT:
                para.add_run(child.content)
            elif child.node_type == NodeType.INLINE_BOLD:
                run = para.add_run(child.content)
                run.bold = True
            elif child.node_type == NodeType.INLINE_ITALIC:
                run = para.add_run(child.content)
                run.italic = True
            elif child.node_type == NodeType.INLINE_CODE:
                run = para.add_run(child.content)
                run.font.name = 'Consolas'
                run.font.size = Pt(10)
            elif child.node_type == NodeType.INLINE_LINK:
                run = para.add_run(child.content)
                run.font.color.rgb = RGBColor(0, 102, 204)
                run.underline = True

    def _render_list(self, doc: Document, node: DocumentNode, level: int = 0):
        """Render a list to the document."""
        counter = 1
        for item in node.children:
            if item.node_type == NodeType.LIST_ITEM:
                prefix = f"{counter}. " if node.ordered else "- "
                counter += 1
                para = doc.add_paragraph()
                para.paragraph_format.left_indent = Inches(0.25 * (level + 1))
                para.add_run(prefix + item.content)

                for nested in item.children:
                    if nested.node_type == NodeType.LIST:
                        self._render_list(doc, nested, level + 1)

    def _render_table(self, doc: Document, node: DocumentNode):
        """Render a table to the document."""
        if not node.children:
            return

        col_count = len(node.children[0].children)
        if col_count == 0:
            return

        table = doc.add_table(rows=len(node.children), cols=col_count)
        table.style = 'Table Grid'

        for i, row in enumerate(node.children):
            for j, cell in enumerate(row.children):
                if j < col_count:
                    table_cell = table.rows[i].cells[j]
                    table_cell.text = cell.content

                    if cell.is_header:
                        for para in table_cell.paragraphs:
                            for run in para.runs:
                                run.bold = True


# ============================================================================
# Export Service (Public Interface)
# ============================================================================

class ExportService:
    """Service for exporting content to various formats."""

    def __init__(self):
        self.md = markdown.Markdown(extensions=['tables', 'fenced_code', 'toc'])
        self.parser = HTMLToDocumentParser()
        self.pdf_renderer = PDFRenderer()
        self.docx_renderer = DOCXRenderer()

    def export_markdown(self, content: str, filename: str) -> bytes:  # noqa: ARG002
        """Export content as Markdown."""
        return content.encode('utf-8')

    def export_pdf(self, content: str, filename: str) -> bytes:  # noqa: ARG002
        """Export content as PDF."""
        self.md.reset()
        html = self.md.convert(content)
        nodes = self.parser.parse(html)
        return self.pdf_renderer.render(nodes)

    def export_docx(self, content: str, filename: str) -> bytes:  # noqa: ARG002
        """Export content as DOCX."""
        self.md.reset()
        html = self.md.convert(content)
        nodes = self.parser.parse(html)
        return self.docx_renderer.render(nodes)


# Singleton instance
export_service = ExportService()
