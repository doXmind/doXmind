"""Export service for converting Markdown to PDF and DOCX."""

import io
import os
from typing import Literal
import markdown
from fpdf import FPDF
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.style import WD_STYLE_TYPE
from bs4 import BeautifulSoup


def get_system_font_path(font_name: str) -> str | None:
    """Get the path to a system font file.

    Args:
        font_name: Name of the font file (e.g., 'msyh.ttc' for Microsoft YaHei)

    Returns:
        Full path to the font file, or None if not found
    """
    # Common font directories
    font_dirs = []

    # Windows
    if os.name == 'nt':
        font_dirs.append(os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts'))

    # macOS
    font_dirs.extend([
        '/System/Library/Fonts',
        '/Library/Fonts',
        os.path.expanduser('~/Library/Fonts'),
    ])

    # Linux
    font_dirs.extend([
        '/usr/share/fonts',
        '/usr/local/share/fonts',
        os.path.expanduser('~/.fonts'),
    ])

    for font_dir in font_dirs:
        if os.path.exists(font_dir):
            font_path = os.path.join(font_dir, font_name)
            if os.path.exists(font_path):
                return font_path
            # Also check subdirectories
            for root, dirs, files in os.walk(font_dir):
                if font_name in files:
                    return os.path.join(root, font_name)

    return None


class ExportService:
    """Service for exporting content to various formats."""

    def __init__(self):
        """Initialize the export service."""
        self.md = markdown.Markdown(
            extensions=['tables', 'fenced_code', 'toc']
        )
        # Find a suitable Unicode font
        self._unicode_font = None
        self._unicode_font_path = None

        # Try common CJK fonts
        font_candidates = [
            ('msyh.ttc', 'Microsoft YaHei'),      # Windows
            ('msyhbd.ttc', 'Microsoft YaHei Bold'),
            ('simhei.ttf', 'SimHei'),              # Windows fallback
            ('simsun.ttc', 'SimSun'),              # Windows fallback
            ('PingFang.ttc', 'PingFang SC'),       # macOS
            ('STHeiti Light.ttc', 'STHeiti'),      # macOS fallback
            ('NotoSansCJK-Regular.ttc', 'Noto Sans CJK'),  # Linux
            ('DroidSansFallbackFull.ttf', 'Droid Sans Fallback'),  # Linux fallback
        ]

        for font_file, font_name in font_candidates:
            path = get_system_font_path(font_file)
            if path:
                self._unicode_font = font_name
                self._unicode_font_path = path
                break

    def export_markdown(self, content: str, filename: str) -> bytes:
        """Export content as Markdown.

        Args:
            content: The markdown content
            filename: The filename (used for reference)

        Returns:
            The markdown content as bytes
        """
        return content.encode('utf-8')

    def export_pdf(self, content: str, filename: str) -> bytes:
        """Export content as PDF using fpdf2.

        Args:
            content: The markdown content
            filename: The filename (used for reference)

        Returns:
            The PDF content as bytes
        """
        # Convert markdown to HTML first
        self.md.reset()
        html_content = self.md.convert(content)

        # Parse HTML
        soup = BeautifulSoup(html_content, 'html.parser')

        # Create PDF with Unicode support
        pdf = FPDF()
        pdf.set_auto_page_break(auto=True, margin=15)

        # Add Unicode font if available
        if self._unicode_font_path:
            pdf.add_font("unicode", style="", fname=self._unicode_font_path)
            pdf.add_font("unicode", style="B", fname=self._unicode_font_path)
            pdf.add_font("unicode", style="I", fname=self._unicode_font_path)
            default_font = "unicode"
        else:
            default_font = "Helvetica"

        pdf.add_page()
        pdf.set_font(default_font, size=11)

        # Process HTML elements
        self._process_html_to_pdf(soup, pdf, default_font)

        # Output to bytes
        return pdf.output()

    def _process_html_to_pdf(self, soup: BeautifulSoup, pdf: FPDF, font: str = "Helvetica"):
        """Process HTML elements and add them to the PDF.

        Args:
            soup: BeautifulSoup object containing parsed HTML
            pdf: FPDF object
            font: Font family to use
        """
        for element in soup.children:
            if element.name is None:
                # Text node
                text = str(element).strip()
                if text:
                    pdf.set_font(font, size=11)
                    pdf.multi_cell(0, 6, text)
                    pdf.ln(2)
            elif element.name == 'h1':
                pdf.set_font(font, "B", 20)
                pdf.set_text_color(26, 26, 26)
                pdf.multi_cell(0, 10, element.get_text().strip())
                pdf.ln(4)
                pdf.set_text_color(0)
            elif element.name == 'h2':
                pdf.set_font(font, "B", 16)
                pdf.set_text_color(26, 26, 26)
                pdf.multi_cell(0, 8, element.get_text().strip())
                pdf.ln(3)
                pdf.set_text_color(0)
            elif element.name == 'h3':
                pdf.set_font(font, "B", 14)
                pdf.set_text_color(26, 26, 26)
                pdf.multi_cell(0, 7, element.get_text().strip())
                pdf.ln(2)
                pdf.set_text_color(0)
            elif element.name in ['h4', 'h5', 'h6']:
                pdf.set_font(font, "B", 12)
                pdf.set_text_color(26, 26, 26)
                pdf.multi_cell(0, 6, element.get_text().strip())
                pdf.ln(2)
                pdf.set_text_color(0)
            elif element.name == 'p':
                pdf.set_font(font, size=11)
                text = element.get_text().strip()
                pdf.multi_cell(0, 6, text)
                pdf.ln(3)
            elif element.name == 'pre':
                # Code block
                pdf.set_font(font, size=9)
                pdf.set_fill_color(245, 245, 245)
                code_text = element.get_text()
                # Add some padding
                pdf.set_x(pdf.l_margin + 5)
                pdf.multi_cell(0, 5, code_text, fill=True)
                pdf.set_font(font, size=11)
                pdf.ln(3)
            elif element.name == 'blockquote':
                pdf.set_font(font, "I", 11)
                pdf.set_text_color(102, 102, 102)
                pdf.set_x(pdf.l_margin + 10)
                pdf.multi_cell(0, 6, element.get_text().strip())
                pdf.set_text_color(0)
                pdf.ln(3)
            elif element.name == 'ul':
                self._add_list_to_pdf(element, pdf, font, ordered=False)
                pdf.ln(2)
            elif element.name == 'ol':
                self._add_list_to_pdf(element, pdf, font, ordered=True)
                pdf.ln(2)
            elif element.name == 'table':
                self._add_table_to_pdf(element, pdf, font)
                pdf.ln(3)
            elif element.name == 'hr':
                pdf.set_draw_color(200, 200, 200)
                y = pdf.get_y()
                pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
                pdf.ln(5)
            elif element.name == 'div':
                # Recurse into divs
                self._process_html_to_pdf(element, pdf, font)

    def _add_list_to_pdf(self, element, pdf: FPDF, font: str, ordered: bool = False, level: int = 0):
        """Add a list to the PDF.

        Args:
            element: BeautifulSoup list element
            pdf: FPDF object
            font: Font family to use
            ordered: Whether the list is ordered
            level: Nesting level
        """
        pdf.set_font(font, size=11)
        counter = 1
        indent = 10 + (level * 10)

        for li in element.find_all('li', recursive=False):
            # Get direct text content
            text = ''
            for child in li.children:
                if child.name is None:
                    text += str(child)
                elif child.name not in ['ul', 'ol']:
                    text += child.get_text()

            text = text.strip()

            # Create bullet/number
            if ordered:
                prefix = f"{counter}. "
                counter += 1
            else:
                prefix = "- "  # Use ASCII dash instead of bullet

            pdf.set_x(pdf.l_margin + indent)
            pdf.multi_cell(0, 6, prefix + text)

            # Handle nested lists
            for nested in li.find_all(['ul', 'ol'], recursive=False):
                self._add_list_to_pdf(nested, pdf, font, ordered=nested.name == 'ol', level=level + 1)

    def _add_table_to_pdf(self, element, pdf: FPDF, font: str):
        """Add a table to the PDF.

        Args:
            element: BeautifulSoup table element
            pdf: FPDF object
            font: Font family to use
        """
        rows = element.find_all('tr')
        if not rows:
            return

        # Determine columns
        first_row = rows[0]
        headers = first_row.find_all(['th', 'td'])
        col_count = len(headers)
        if col_count == 0:
            return

        # Calculate column width
        available_width = pdf.w - pdf.l_margin - pdf.r_margin
        col_width = available_width / col_count

        pdf.set_font(font, size=10)

        for i, row in enumerate(rows):
            cells = row.find_all(['th', 'td'])

            for j, cell in enumerate(cells):
                if j >= col_count:
                    break

                is_header = cell.name == 'th' or i == 0
                cell_text = cell.get_text().strip()

                # Set font for header
                if is_header:
                    pdf.set_font(font, "B", 10)
                    pdf.set_fill_color(240, 240, 240)
                else:
                    pdf.set_font(font, size=10)
                    pdf.set_fill_color(255, 255, 255)

                x = pdf.l_margin + (j * col_width)
                y = pdf.get_y()

                # Draw cell border and text
                pdf.set_xy(x, y)
                # Truncate long text
                display_text = cell_text[:30] if len(cell_text) > 30 else cell_text
                pdf.cell(col_width, 6, display_text, border=1, fill=is_header)

            pdf.ln(6)

    def export_docx(self, content: str, filename: str) -> bytes:
        """Export content as DOCX using python-docx.

        Args:
            content: The markdown content
            filename: The filename (used for reference)

        Returns:
            The DOCX content as bytes
        """
        # Convert markdown to HTML first
        self.md.reset()
        html_content = self.md.convert(content)

        # Parse HTML
        soup = BeautifulSoup(html_content, 'html.parser')

        # Create document
        doc = Document()

        # Set default font
        style = doc.styles['Normal']
        style.font.name = 'Calibri'
        style.font.size = Pt(11)

        # Process HTML elements
        self._process_html_to_docx(soup, doc)

        # Save to buffer
        docx_buffer = io.BytesIO()
        doc.save(docx_buffer)
        docx_buffer.seek(0)

        return docx_buffer.getvalue()

    def _process_html_to_docx(self, soup: BeautifulSoup, doc: Document):
        """Process HTML elements and add them to the Word document.

        Args:
            soup: BeautifulSoup object containing parsed HTML
            doc: python-docx Document object
        """
        for element in soup.children:
            if element.name is None:
                # Text node
                text = str(element).strip()
                if text:
                    doc.add_paragraph(text)
            elif element.name in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
                level = int(element.name[1])
                heading = doc.add_heading(element.get_text(), level=level)
            elif element.name == 'p':
                para = doc.add_paragraph()
                self._add_inline_elements(element, para)
            elif element.name == 'pre':
                # Code block
                code_text = element.get_text()
                para = doc.add_paragraph()
                run = para.add_run(code_text)
                run.font.name = 'Consolas'
                run.font.size = Pt(10)
                # Add light gray background simulation with indentation
                para.paragraph_format.left_indent = Inches(0.25)
            elif element.name == 'blockquote':
                para = doc.add_paragraph()
                para.paragraph_format.left_indent = Inches(0.5)
                run = para.add_run(element.get_text())
                run.font.italic = True
                run.font.color.rgb = RGBColor(102, 102, 102)
            elif element.name == 'ul':
                self._add_list(element, doc, ordered=False)
            elif element.name == 'ol':
                self._add_list(element, doc, ordered=True)
            elif element.name == 'table':
                self._add_table(element, doc)
            elif element.name == 'hr':
                # Add horizontal rule as a paragraph with border
                para = doc.add_paragraph()
                para.add_run('_' * 50)
            elif element.name == 'div':
                # Recurse into divs
                self._process_html_to_docx(element, doc)

    def _add_inline_elements(self, element, paragraph):
        """Add inline elements (bold, italic, code, links) to a paragraph.

        Args:
            element: BeautifulSoup element
            paragraph: python-docx Paragraph object
        """
        for child in element.children:
            if child.name is None:
                # Plain text
                paragraph.add_run(str(child))
            elif child.name == 'strong' or child.name == 'b':
                run = paragraph.add_run(child.get_text())
                run.bold = True
            elif child.name == 'em' or child.name == 'i':
                run = paragraph.add_run(child.get_text())
                run.italic = True
            elif child.name == 'code':
                run = paragraph.add_run(child.get_text())
                run.font.name = 'Consolas'
                run.font.size = Pt(10)
            elif child.name == 'a':
                run = paragraph.add_run(child.get_text())
                run.font.color.rgb = RGBColor(0, 102, 204)
                run.underline = True
            elif child.name == 'br':
                paragraph.add_run('\n')
            else:
                # Recursively handle other elements
                self._add_inline_elements(child, paragraph)

    def _add_list(self, element, doc: Document, ordered: bool = False, level: int = 0):
        """Add a list (ordered or unordered) to the document.

        Args:
            element: BeautifulSoup list element (ul or ol)
            doc: python-docx Document object
            ordered: Whether the list is ordered
            level: Nesting level
        """
        counter = 1
        for li in element.find_all('li', recursive=False):
            # Get direct text content
            text = ''
            for child in li.children:
                if child.name is None:
                    text += str(child)
                elif child.name not in ['ul', 'ol']:
                    text += child.get_text()

            text = text.strip()

            # Create list item
            if ordered:
                prefix = f"{counter}. "
                counter += 1
            else:
                prefix = "- "

            para = doc.add_paragraph()
            para.paragraph_format.left_indent = Inches(0.25 * (level + 1))
            para.add_run(prefix + text)

            # Handle nested lists
            for nested in li.find_all(['ul', 'ol'], recursive=False):
                self._add_list(nested, doc, ordered=nested.name == 'ol', level=level + 1)

    def _add_table(self, element, doc: Document):
        """Add a table to the document.

        Args:
            element: BeautifulSoup table element
            doc: python-docx Document object
        """
        rows = element.find_all('tr')
        if not rows:
            return

        # Determine number of columns
        first_row = rows[0]
        cols = len(first_row.find_all(['th', 'td']))

        if cols == 0:
            return

        # Create table
        table = doc.add_table(rows=len(rows), cols=cols)
        table.style = 'Table Grid'

        for i, row in enumerate(rows):
            cells = row.find_all(['th', 'td'])
            for j, cell in enumerate(cells):
                if j < cols:
                    table_cell = table.rows[i].cells[j]
                    table_cell.text = cell.get_text().strip()

                    # Bold header cells
                    if cell.name == 'th':
                        for paragraph in table_cell.paragraphs:
                            for run in paragraph.runs:
                                run.bold = True


# Create singleton instance
export_service = ExportService()
