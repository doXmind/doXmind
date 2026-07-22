"""Neutral, derived Markdown-to-HTML export rendering."""

from __future__ import annotations

import markdown


def markdown_to_html(markdown_source: str) -> str:
    """Render a disposable HTML projection for an explicit export.

    The output contains no editor schema, hidden source sentinel, or TipTap-era
    ``data-type`` attributes. Raw HTML follows Python-Markdown's ordinary
    passthrough behavior; the Markdown file remains the only source model.
    """
    return markdown.markdown(
        markdown_source,
        extensions=["tables", "fenced_code", "sane_lists"],
    )
