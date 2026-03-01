"""HTML utilities."""

import html as html_module
import re

# Matches <div> or <span> tags containing data-code or data-latex attributes.
# These are TipTap atom nodes (mermaid charts, block/inline math) that store
# content in HTML attributes rather than as text children.
_DATA_CONTENT_ATTR_RE = re.compile(
    r"<(div|span)\s[^>]*?data-(code|latex)=\"([^\"]*)\"[^>]*?>",
    re.IGNORECASE,
)


def _extract_data_content(html: str) -> str:
    """Replace atom-node tags with their data-code/data-latex attribute values.

    TipTap stores mermaid/math content in data attributes:
      <div data-type="mermaid-chart" data-code="graph TD; A-->B" ...></div>
      <div data-type="block-math" data-latex="E=mc^2" ...></div>
      <span data-type="inline-math" data-latex="x^2" ...></span>

    This extracts those attribute values so they survive tag stripping.
    """

    def _replace(match: re.Match) -> str:
        content = match.group(3)
        return " " + html_module.unescape(content) + " "

    return _DATA_CONTENT_ATTR_RE.sub(_replace, html)


def strip_html_tags(html: str) -> str:
    """Strip HTML tags and return plain text.

    Used to make search results more readable.
    Preserves content from data-code (mermaid) and data-latex (math) attributes.
    """
    if not html:
        return ""

    # Extract content from data attributes BEFORE stripping tags
    text = _extract_data_content(html)

    # Remove HTML tags
    text = re.sub(r"<[^>]+>", " ", text)

    # Decode all HTML entities
    text = html_module.unescape(text)

    # Clean up whitespace
    text = re.sub(r"\s+", " ", text).strip()

    return text
