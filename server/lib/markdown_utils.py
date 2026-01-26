"""Markdown utilities matching frontend behavior.

This module provides markdown-to-plain-text conversion that produces
identical output to the frontend's markdownToPlainText() function
in src/lib/markdown.ts.

This is critical for diff view position matching - the backend generates
search_text using this function, and the frontend uses it to find
the exact position in doc.textContent.
"""

import re


def markdown_to_plain_text(markdown: str) -> str:
    """Convert markdown to plain text matching frontend markdownToPlainText().

    Must produce identical output to src/lib/markdown.ts:markdownToPlainText()
    for 100% match consistency between backend validation and frontend diff view.

    The conversion simulates ProseMirror's doc.textContent behavior:
    - Removes all markdown formatting markers
    - Concatenates text without block separators (no newlines between paragraphs)
    - Preserves content within code blocks

    Args:
        markdown: Markdown formatted string

    Returns:
        Plain text string suitable for matching against doc.textContent
    """
    if not markdown:
        return ""

    text = markdown

    # Remove code fences (preserve content)
    # Match ```language or just ```
    text = re.sub(r"```[\w]*\n?", "", text)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE)

    # Remove inline code backticks but keep content
    text = re.sub(r"`([^`]+)`", r"\1", text)

    # Remove bold/italic markers (order matters - do ** before *)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)  # **bold**
    text = re.sub(r"__([^_]+)__", r"\1", text)  # __bold__
    text = re.sub(r"\*([^*]+)\*", r"\1", text)  # *italic*
    text = re.sub(r"(?<![a-zA-Z])_([^_]+)_(?![a-zA-Z])", r"\1", text)  # _italic_ (not in words)
    text = re.sub(r"~~([^~]+)~~", r"\1", text)  # ~~strikethrough~~

    # Remove images first: ![alt](url) -> alt (must be before links)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)

    # Remove links, keep text: [text](url) -> text
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)

    # Remove reference-style links: [text][ref] -> text
    text = re.sub(r"\[([^\]]+)\]\[[^\]]*\]", r"\1", text)

    # Remove link definitions: [ref]: url
    text = re.sub(r"^\[[^\]]+\]:\s*\S+.*$", "", text, flags=re.MULTILINE)

    # Remove headings markers: # ## ### etc
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)

    # Remove blockquote markers
    text = re.sub(r"^>\s*", "", text, flags=re.MULTILINE)

    # Remove list markers: - * + and 1. 2. etc
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)

    # Remove horizontal rules
    text = re.sub(r"^[-*_]{3,}\s*$", "", text, flags=re.MULTILINE)

    # Remove HTML tags (simple removal)
    text = re.sub(r"<[^>]+>", "", text)

    # Collapse multiple newlines to none (matching doc.textContent behavior)
    # ProseMirror's doc.textContent concatenates text nodes without separators
    text = re.sub(r"\n+", "", text)

    # Collapse multiple spaces to single
    text = re.sub(r" +", " ", text)

    # Trim leading/trailing whitespace
    return text.strip()
