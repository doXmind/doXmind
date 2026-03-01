"""Tests for HTML utility functions."""

from utils.html import _extract_data_content, strip_html_tags


class TestExtractDataContent:
    """Tests for _extract_data_content helper."""

    def test_mermaid_chart(self):
        html = '<div data-type="mermaid-chart" data-code="graph TD" class="mermaid-chart"></div>'
        result = _extract_data_content(html)
        assert "graph TD" in result

    def test_mermaid_with_html_entities(self):
        html = '<div data-type="mermaid-chart" data-code="A --&gt; B&#10;B --&gt; C" class="mermaid-chart"></div>'
        result = _extract_data_content(html)
        assert "A --> B" in result
        assert "B --> C" in result

    def test_block_math(self):
        html = '<div data-type="block-math" data-latex="E=mc^2" class="block-math"></div>'
        result = _extract_data_content(html)
        assert "E=mc^2" in result

    def test_inline_math(self):
        html = '<span data-type="inline-math" data-latex="x^2 + y^2" class="inline-math"></span>'
        result = _extract_data_content(html)
        assert "x^2 + y^2" in result

    def test_no_data_attributes(self):
        html = "<p>Hello <b>world</b></p>"
        result = _extract_data_content(html)
        assert result == html  # unchanged

    def test_attribute_order_data_code_first(self):
        html = (
            '<div data-code="flowchart LR" data-type="mermaid-chart" class="mermaid-chart"></div>'
        )
        result = _extract_data_content(html)
        assert "flowchart LR" in result


class TestStripHtmlTags:
    """Tests for strip_html_tags function."""

    def test_basic_stripping(self):
        assert strip_html_tags("<p>Hello <b>world</b></p>") == "Hello world"

    def test_empty_input(self):
        assert strip_html_tags("") == ""
        assert strip_html_tags(None) == ""

    def test_mermaid_content_preserved(self):
        html = '<div data-type="mermaid-chart" data-code="graph TD&#10;    A[Start] --&gt; B[End]" class="mermaid-chart"></div>'
        result = strip_html_tags(html)
        assert "graph TD" in result
        assert "Start" in result
        assert "End" in result

    def test_block_math_content_preserved(self):
        html = '<div data-type="block-math" data-latex="E=mc^2" class="block-math"></div>'
        result = strip_html_tags(html)
        assert "E=mc^2" in result

    def test_inline_math_content_preserved(self):
        html = '<p>See <span data-type="inline-math" data-latex="x^2 + y^2" class="inline-math"></span> here</p>'
        result = strip_html_tags(html)
        assert "x^2 + y^2" in result
        assert "See" in result
        assert "here" in result

    def test_mixed_content(self):
        html = (
            "<p>Before</p>"
            '<div data-type="mermaid-chart" data-code="flowchart LR" class="mermaid-chart"></div>'
            "<p>After</p>"
        )
        result = strip_html_tags(html)
        assert "Before" in result
        assert "flowchart LR" in result
        assert "After" in result

    def test_mermaid_graph_in_data_code(self):
        """Mermaid data-code attribute should be extracted as plain text."""
        html = (
            '<div data-type="mermaid-chart" '
            'data-code="graph TD&#10;    A[Start] --&gt; B[End]" '
            'class="mermaid-chart"></div>'
        )
        result = strip_html_tags(html)
        assert "graph TD" in result
        assert "Start" in result

    def test_html_entities_decoded(self):
        assert strip_html_tags("<p>&amp; &lt; &gt;</p>") == "& < >"
