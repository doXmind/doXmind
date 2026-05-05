"""HTML-to-PDF export for Markdown documents.

The desktop shell handles save dialogs and filesystem writes. The actual PDF
layout happens here with PyMuPDF so export does not depend on WebView print
permissions, macOS print dialogs, or screen capture.

PyMuPDF's Story renderer can't fetch external image URLs and can't decode
inline ``data:`` image URLs directly. The frontend always submits images as
``data:`` URLs (regular images and rasterised mermaid diagrams alike); we
extract them into a PyMuPDF Archive and rewrite the ``src`` attributes to
reference archive keys before feeding the HTML into Story.
"""

from __future__ import annotations

import base64
import logging
import re
import tempfile
from pathlib import Path

import pymupdf

logger = logging.getLogger(__name__)


class HtmlPdfExportError(RuntimeError):
    """Raised when PyMuPDF cannot produce a usable PDF."""


_PAGE_RECT = pymupdf.paper_rect("a4")
_CONTENT_RECT = pymupdf.Rect(
    52,
    48,
    _PAGE_RECT.width - 52,
    _PAGE_RECT.height - 56,
)

_EXPORT_CSS = """
body {
  font-family: sans-serif;
  font-size: 11pt;
  line-height: 1.5;
  color: #1f2933;
}
h1, h2, h3, h4 {
  font-weight: 700;
  line-height: 1.22;
  margin: 0 0 10pt;
  color: #111827;
}
h1 { font-size: 25pt; margin-top: 0; }
h2 { font-size: 18pt; margin-top: 18pt; }
h3 { font-size: 14pt; margin-top: 14pt; }
p { margin: 0 0 9pt; }
/* Lists are flattened to `<p class="pdf-list-item">` blocks by the frontend
   (see transformLists in pdf-export-html.ts) because Story's `<ul>`/`<ol>`
   renderer hardcodes a ~23pt left indent and ignores `padding-left` on those
   tags. Story DOES honour padding-left + text-indent on <p>, so we use a
   hanging indent + a fixed-width marker <span> to render bullet, ordered,
   and task lists with consistent alignment.
   These rules are mostly cosmetic — geometry lives in inline styles. */
.pdf-list-item {
  color: inherit;
}
.pdf-list-marker {
  color: inherit;
}
/* Defensive fallback: if any <ul>/<ol> slips past the frontend rewrite, give
   it a minimal block style so it at least doesn't pile a giant indent on top
   of Story's own ~23pt default. */
ul, ol { margin: 0 0 10pt; padding-left: 0; }
li { margin: 0 0 4pt; }
li > p { margin: 0; }
blockquote {
  margin: 8pt 0 10pt;
  padding: 6pt 10pt;
  border-left: 3pt solid #d1d5db;
  color: #4b5563;
}
pre {
  margin: 8pt 0 10pt;
  padding: 8pt;
  background: #f3f4f6;
  color: #111827;
  font-family: monospace;
  font-size: 9pt;
  white-space: pre-wrap;
}
code {
  font-family: monospace;
  background: #f3f4f6;
  color: #111827;
}
.pdf-code-block {
  margin: 10pt 0 12pt;
}
.pdf-code-block-language {
  margin: 0;
  padding: 5pt 8pt;
  background: #e5e7eb;
  color: #374151;
  font-size: 8.5pt;
  font-weight: 700;
}
.pdf-code-block-pre {
  margin: 0;
  padding: 8pt;
  background: #f3f4f6;
  color: #111827;
  font-family: monospace;
  font-size: 9pt;
  white-space: pre-wrap;
}
.pdf-code-block-pre code {
  background: transparent;
}
.pdf-math-block {
  margin: 10pt 0 12pt;
  padding: 8pt 10pt;
  background: #f8fafc;
  color: #111827;
  font-family: monospace;
  font-size: 10pt;
  text-align: center;
  white-space: pre-wrap;
}
.pdf-math-block code {
  background: transparent;
}
.pdf-math-inline {
  font-family: monospace;
  background: #f3f4f6;
  color: #111827;
  padding: 0 3pt;
}
/* Typeset inline math: emitted by transformMathBlocks when the MathML
   tree only used `mi`/`mn`/`mo`/`msup`/`msub` (no fractions, roots,
   etc.). The `<i>` tags around identifiers and the `<sup>`/`<sub>`
   tags for scripts give us real typeset math without relying on a
   bitmap. Slightly serif-ish font for math feel; padding around binary
   operators handled inline by mathmlToInlineHtml. */
.pdf-math-inline-typeset {
  font-family: serif;
  color: #111827;
  /* Letter-spacing 0 keeps `a + b` from spreading; KaTeX's spacing rules
     are baked into the source via mspace which we render as a single
     space. */
}
.pdf-math-inline-typeset i {
  font-style: italic;
}
.pdf-math-image {
  margin: 10pt 0 12pt;
  text-align: center;
}
.pdf-math-image-img {
  max-width: 100%;
}
.pdf-math-inline-img {
  /* Default; the rasteriser emits a per-image inline
     `style="vertical-align: -<descender>pt"` so each equation's baseline
     lands on the surrounding text baseline. Inline style wins over this
     class rule, but we keep the class declaration in place so images
     missing the per-image override still get a sane default. */
  vertical-align: baseline;
}
.pdf-mermaid {
  margin: 10pt 0 12pt;
  text-align: center;
}
.pdf-mermaid img {
  max-width: 100%;
  height: auto;
}
.pdf-mermaid-fallback {
  margin: 10pt 0 12pt;
  padding: 8pt;
  background: #f3f4f6;
  font-family: monospace;
  font-size: 9pt;
  white-space: pre-wrap;
}
.pdf-mermaid-placeholder {
  margin: 10pt 0 12pt;
  color: #6b7280;
  font-style: italic;
}
.pdf-toggle {
  margin: 8pt 0 10pt;
  padding: 0 0 0 10pt;
  border-left: 2pt solid #d1d5db;
}
.pdf-toggle-summary {
  font-weight: 600;
  margin: 0 0 4pt;
  color: #111827;
}
.pdf-toggle-summary p {
  margin: 0;
}
.pdf-toggle-body {
  margin: 0;
  color: #1f2933;
}
.pdf-callout {
  margin: 10pt 0 12pt;
  padding: 8pt 10pt;
  background: #f3f4f6;
  border-left: 3pt solid #9ca3af;
}
.pdf-callout-emoji {
  font-size: 13pt;
  margin-right: 6pt;
}
.pdf-callout-content p {
  margin: 0 0 6pt;
}
.pdf-callout-content p:last-child {
  margin-bottom: 0;
}
/* Web bookmark — preferred path is a rasterised <figure> wrapping the
   editor card as a PNG (rounded corners, OG thumbnail, exact typography).
   Story has no `border-radius`, so a CSS-only card can never match the
   editor look. The 2-col table styles below are the fallback used when
   capture fails (CORS-tainted OG image, etc.). */
.pdf-bookmark-figure {
  margin: 10pt 0 12pt;
}
.pdf-bookmark-figure img {
  max-width: 100%;
  height: auto;
}
.pdf-bookmark {
  width: 100%;
  margin: 10pt 0 12pt;
  border: 0.6pt solid #d1d5db;
  border-collapse: collapse;
  background: #ffffff;
}
/* The global `th, td { border: ... }` rule above must NOT apply inside the
   bookmark card — those cells are layout cells, not data cells. */
.pdf-bookmark td {
  border: 0;
  padding: 0;
  vertical-align: middle;
}
.pdf-bookmark-content {
  padding: 9pt 12pt;
}
.pdf-bookmark-title {
  font-size: 11pt;
  font-weight: 700;
  color: #111827;
  line-height: 1.3;
  margin-bottom: 3pt;
}
.pdf-bookmark-desc {
  font-size: 9.5pt;
  color: #4b5563;
  line-height: 1.4;
  margin-bottom: 6pt;
}
.pdf-bookmark-url {
  font-size: 9pt;
  color: #6b7280;
}
.pdf-bookmark-favicon {
  width: 10pt;
  height: 10pt;
  vertical-align: middle;
}
.pdf-bookmark-url-text {
  color: #6b7280;
  text-decoration: none;
}
.pdf-bookmark-thumb {
  padding: 0;
  width: 140pt;
}
.pdf-bookmark-thumb-img {
  width: 140pt;
  height: 100pt;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 8pt 0 12pt;
}
th, td {
  border: 0.6pt solid #d1d5db;
  padding: 5pt 6pt;
  vertical-align: top;
}
th {
  background: #f3f4f6;
  font-weight: 700;
}
table.pdf-columns {
  width: 100%;
  border-collapse: collapse;
  margin: 8pt 0 10pt;
}
table.pdf-columns td.pdf-column {
  border: 0;
  padding: 0 6pt;
  vertical-align: top;
}
img, svg {
  max-width: 100%;
  height: auto;
}
hr {
  border: 0;
  border-top: 0.8pt solid #d1d5db;
  margin: 14pt 0;
}
.ProseMirror {
  width: auto;
  max-width: none;
}
"""


_DATA_URL_IMG_RE = re.compile(
    r"""(?x)
    src\s*=\s*
    (?P<quote>["'])
    data:(?P<mime>image/[a-zA-Z0-9+\-.]+);base64,
    (?P<payload>[A-Za-z0-9+/=\s]+?)
    (?P=quote)
    """,
    re.IGNORECASE,
)

_EXT_BY_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/tiff": "tif",
}


def _extract_data_url_images(html: str) -> tuple[str, list[tuple[bytes, str]]]:
    """Pull inline ``data:`` image URLs out of the HTML.

    Returns the rewritten HTML (with ``src`` pointing at archive-relative
    keys) and a list of ``(bytes, key)`` archive entries. Unsupported or
    malformed data URLs are left in place; PyMuPDF will fall back to its
    "[image]" text placeholder for those.
    """

    items: list[tuple[bytes, str]] = []
    counter = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal counter
        quote = match.group("quote")
        mime = match.group("mime").lower().strip()
        payload = re.sub(r"\s+", "", match.group("payload"))
        try:
            raw = base64.b64decode(payload, validate=False)
        except (ValueError, base64.binascii.Error):
            return match.group(0)
        if not raw:
            return match.group(0)
        ext = _EXT_BY_MIME.get(mime, "bin")
        counter += 1
        name = f"_pdfimg_{counter:04d}.{ext}"
        items.append((raw, name))
        return f"src={quote}{name}{quote}"

    rewritten = _DATA_URL_IMG_RE.sub(replace, html)
    return rewritten, items


# Anything taller than a typical text line (≈ 11pt at 11pt body) and not a
# zero-width sentinel is treated as an image-anchor link. Bookmark cards
# render at 80pt+ tall, regular images at varying heights — both should be
# repositioned to the actual image rect. Text-link rects live well below
# this threshold so they pass through untouched.
_IMAGE_ANCHOR_HEIGHT_THRESHOLD_PT = 20.0


def _retarget_image_anchor_links(page: pymupdf.Page) -> None:
    """Reattach broken image-anchor link rects to the actual image rect.

    See `export_html_pdf` for why this is needed: MuPDF Story's
    `write_with_links` derives the link rect from the anchor's cursor
    position when it opens, which sits above the image when the anchor's
    only content is `<img>`. We walk the page's image XObjects, match
    each oversized link to the rendered image with the same width/height
    (within 2pt rounding tolerance), and rewrite the link rect via
    `update_link`.

    Multiple images with identical dimensions (e.g. several bookmark cards
    on one page) are paired by render order — bookmarks emit images in
    HTML order, and so do their link annotations.
    """
    image_rects: list[pymupdf.Rect] = []
    for img in page.get_images(full=True):
        xref = img[0]
        for r in page.get_image_rects(xref):
            image_rects.append(r)
    if not image_rects:
        return
    # Sort by y so we pair top-to-bottom — same order Story uses when
    # emitting the link annotations.
    image_rects.sort(key=lambda r: (r.y0, r.x0))

    used: set[int] = set()
    for link in page.get_links():
        rect = link.get("from")
        if rect is None or rect.width <= 0 or rect.height < _IMAGE_ANCHOR_HEIGHT_THRESHOLD_PT:
            continue
        match_idx: int | None = None
        for i, ir in enumerate(image_rects):
            if i in used:
                continue
            if abs(ir.width - rect.width) < 2 and abs(ir.height - rect.height) < 2:
                match_idx = i
                break
        if match_idx is None:
            continue
        used.add(match_idx)
        link["from"] = image_rects[match_idx]
        page.update_link(link)


def export_html_pdf(html: str) -> bytes:
    """Render editor HTML into PDF bytes using PyMuPDF Story."""

    if not html or not html.strip():
        raise HtmlPdfExportError("HTML body is empty")

    rewritten_html, image_items = _extract_data_url_images(html)
    archive: pymupdf.Archive | None = None
    if image_items:
        archive = pymupdf.Archive()
        for raw, name in image_items:
            try:
                archive.add((raw, name))
            except Exception:
                logger.warning("Failed to add image %s to PDF archive", name, exc_info=True)

    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp_path = tmp.name

        document_html = (
            "<!doctype html>"
            "<html><head><meta charset='utf-8'></head>"
            f"<body><main class='doxmind-export'>{rewritten_html}</main></body></html>"
        )
        story_kwargs: dict[str, object] = {"user_css": _EXPORT_CSS}
        if archive is not None:
            story_kwargs["archive"] = archive
        story = pymupdf.Story(document_html, **story_kwargs)

        def rectfn(_rect_num: int, _filled: bool):
            return _PAGE_RECT, _CONTENT_RECT, pymupdf.Matrix(1, 1)

        # `write_with_links` emits the same layout as `write()` AND attaches
        # `/Link` annotations for every `<a href>` it encounters. Plain
        # `write()` drops `<a href>` to text-only styling and produces zero
        # link annotations, leaving the entire bookmark card un-clickable.
        #
        # Caveat we have to work around: for `<a><img></a>` (the bookmark
        # path), MuPDF Story computes the link rect from the anchor's
        # text-cursor position at the moment the anchor opens — NOT from the
        # rect of the image inside it. The result is an annotation rect
        # offset some y-amount above where the image actually lands on the
        # page (verified empirically: a fixed 48pt + per-block content
        # delta). _retarget_image_anchor_links walks the rendered page,
        # finds the actual image rect for each oversized link annotation,
        # and rewrites the annotation in place. Text-anchor links are not
        # affected by this bug and are left alone.
        doc = story.write_with_links(rectfn)
        try:
            for page in doc:
                _retarget_image_anchor_links(page)
            doc.save(tmp_path)
        finally:
            doc.close()

        pdf = Path(tmp_path).read_bytes()
        if not pdf.startswith(b"%PDF-"):
            raise HtmlPdfExportError("PyMuPDF did not return a PDF payload")
        return pdf
    except Exception as exc:
        if isinstance(exc, HtmlPdfExportError):
            raise
        raise HtmlPdfExportError(str(exc)) from exc
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)
