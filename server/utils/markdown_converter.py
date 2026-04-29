"""HTML-to-Markdown converter for local preview/search.

Converts TipTap HTML content to clean markdown, handling atom blocks
(mermaid charts, math blocks) that store content in data attributes.

This produces the cached `content_markdown` column used by local previews,
search, and import/export flows.
"""

import html as html_module
import re

from markdownify import MarkdownConverter

# ---------------------------------------------------------------------------
# Atom-block extraction (mirrors frontend extractAtomBlocks logic)
# ---------------------------------------------------------------------------

# Mermaid: <div ... data-type="mermaid-chart" ... data-code="..." ...></div>
_MERMAID_RE = re.compile(
    r'<div\s(?=[^>]*data-type="mermaid-chart")[^>]*></div>',
    re.IGNORECASE,
)

# Block math: <div ... data-type="block-math" ... data-latex="..." ...></div>
_BLOCK_MATH_RE = re.compile(
    r'<div\s(?=[^>]*data-type="block-math")[^>]*></div>',
    re.IGNORECASE,
)

# Inline math: <span ... data-type="inline-math" ... data-latex="..." ...></span>
_INLINE_MATH_RE = re.compile(
    r'<span\s(?=[^>]*data-type="inline-math")[^>]*></span>',
    re.IGNORECASE,
)

_DATA_CODE_RE = re.compile(r'data-code="([^"]*)"')
_DATA_LATEX_RE = re.compile(r'data-latex="([^"]*)"')


def _decode_html_entities(s: str) -> str:
    """Decode HTML entities commonly found in TipTap data attributes."""
    return html_module.unescape(s)


def _extract_atom_blocks(html_content: str) -> tuple[str, dict[str, str]]:
    """Extract mermaid/math atom blocks before markdownify conversion.

    Replaces atom-block elements with unique placeholders, stores the
    markdown-fenced content for restoration after conversion.

    Returns:
        Tuple of (modified HTML, placeholder->markdown dict)
    """
    blocks: dict[str, str] = {}
    counter = 0

    def _replace_mermaid(match: re.Match) -> str:
        nonlocal counter
        code_match = _DATA_CODE_RE.search(match.group(0))
        if not code_match:
            return match.group(0)
        placeholder = f"DXMATOM{counter}XEND"
        counter += 1
        code = _decode_html_entities(code_match.group(1))
        blocks[placeholder] = f"```mermaid\n{code}\n```"
        return f"<p>{placeholder}</p>"

    def _replace_block_math(match: re.Match) -> str:
        nonlocal counter
        latex_match = _DATA_LATEX_RE.search(match.group(0))
        if not latex_match:
            return match.group(0)
        placeholder = f"DXMATOM{counter}XEND"
        counter += 1
        latex = _decode_html_entities(latex_match.group(1))
        blocks[placeholder] = f"$$\n{latex}\n$$"
        return f"<p>{placeholder}</p>"

    def _replace_inline_math(match: re.Match) -> str:
        nonlocal counter
        latex_match = _DATA_LATEX_RE.search(match.group(0))
        if not latex_match:
            return match.group(0)
        placeholder = f"DXMATOM{counter}XEND"
        counter += 1
        latex = _decode_html_entities(latex_match.group(1))
        blocks[placeholder] = f"${latex}$"
        return placeholder

    html_content = _MERMAID_RE.sub(_replace_mermaid, html_content)
    html_content = _BLOCK_MATH_RE.sub(_replace_block_math, html_content)
    html_content = _INLINE_MATH_RE.sub(_replace_inline_math, html_content)

    return html_content, blocks


def _restore_atom_blocks(markdown: str, blocks: dict[str, str]) -> str:
    """Restore atom block placeholders with their actual markdown content."""
    for placeholder, content in blocks.items():
        markdown = markdown.replace(placeholder, content)
    return markdown


# ---------------------------------------------------------------------------
# Custom markdownify converter
# ---------------------------------------------------------------------------


class _TipTapConverter(MarkdownConverter):
    """Custom converter that handles TipTap-specific HTML patterns."""

    def convert_pre(self, el, text, *args, **kwargs):
        """Handle <pre> elements: extract language from <code> child class."""
        code_el = el.find("code")
        if code_el:
            classes = code_el.get("class") or []
            if isinstance(classes, str):
                classes = classes.split()
            lang = ""
            for cls in classes:
                if cls.startswith("language-"):
                    lang = cls[len("language-") :]
                    break
            code_text = code_el.get_text()
            # Ensure trailing newline inside fence
            if code_text and not code_text.endswith("\n"):
                code_text += "\n"
            return f"\n\n```{lang}\n{code_text}```\n\n"
        return super().convert_pre(el, text, *args, **kwargs)


def _get_code_language(el) -> str | None:
    """Extract language from code block class attribute."""
    classes = el.get("class") or []
    if isinstance(classes, str):
        classes = classes.split()
    for cls in classes:
        if cls.startswith("language-"):
            return cls[len("language-") :]
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def html_to_markdown(html_content: str) -> str:
    """Convert TipTap HTML to clean markdown.

    Handles:
    - Mermaid charts (data-code attribute)
    - Block math (data-latex attribute)
    - Inline math (data-latex attribute)
    - Code blocks with language classes
    - Standard HTML elements via markdownify

    Args:
        html_content: TipTap HTML content

    Returns:
        Clean markdown string with trailing whitespace stripped per line
    """
    if not html_content or not html_content.strip():
        return ""

    # Phase 1: Extract atom blocks before markdownify (same as frontend)
    processed_html, atom_blocks = _extract_atom_blocks(html_content)

    # Phase 2: Convert with markdownify
    markdown = _TipTapConverter(
        heading_style="ATX",
        bullets="-",
        code_language_callback=_get_code_language,
    ).convert(processed_html)

    # Phase 3: Restore atom block placeholders
    markdown = _restore_atom_blocks(markdown, atom_blocks)

    # Phase 4: Clean up — strip trailing whitespace per line (matches frontend)
    markdown = "\n".join(line.rstrip() for line in markdown.split("\n"))

    # Collapse excessive blank lines (3+ → 2)
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)

    return markdown.strip()
