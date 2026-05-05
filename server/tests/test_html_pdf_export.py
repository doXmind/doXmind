"""Regression tests for Markdown HTML -> PDF export."""

from __future__ import annotations

import base64
import io
import struct
import zlib

import pymupdf

from services.html_pdf_export import export_html_pdf


def _make_solid_png(width: int, height: int, rgba: tuple[int, int, int, int]) -> bytes:
    """Build a tiny valid PNG so we can exercise the Archive fallback."""

    raw = bytearray()
    for _ in range(height):
        raw.append(0)  # no filter
        for _ in range(width):
            raw.extend(rgba)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _text_from_pdf(pdf: bytes) -> str:
    with pymupdf.open(stream=io.BytesIO(pdf), filetype="pdf") as doc:
        return "\n".join(page.get_text() for page in doc)


def test_export_html_pdf_contains_visible_document_text() -> None:
    pdf = export_html_pdf(
        """
        <article class="ProseMirror">
          <h1>Export Test</h1>
          <p>Hello <strong>real</strong> PDF.</p>
          <ul><li>First item</li><li>Second item</li></ul>
        </article>
        """
    )

    assert pdf.startswith(b"%PDF-")
    text = _text_from_pdf(pdf)
    assert "Export Test" in text
    assert "Hello real PDF." in text
    assert "First item" in text
    assert "Second item" in text


def test_html_pdf_endpoint_returns_extractable_pdf(sync_client) -> None:
    response = sync_client.post(
        "/api/export/html-pdf",
        json={
            "title": "Notes",
            "html": "<h1>Endpoint Export</h1><p>Backend generated content.</p>",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.content.startswith(b"%PDF-")
    text = _text_from_pdf(response.content)
    assert "Endpoint Export" in text
    assert "Backend generated content." in text


def test_export_html_pdf_embeds_inline_data_url_image() -> None:
    png = _make_solid_png(48, 48, (220, 38, 38, 255))
    data_url = "data:image/png;base64," + base64.b64encode(png).decode("ascii")

    pdf = export_html_pdf(
        f"""
        <article class="ProseMirror">
          <p>before</p>
          <img src="{data_url}" alt="" />
          <p>after</p>
        </article>
        """
    )

    assert pdf.startswith(b"%PDF-")
    with pymupdf.open(stream=io.BytesIO(pdf), filetype="pdf") as doc:
        page = doc[0]
        text = page.get_text()
        assert "before" in text
        assert "after" in text
        # PyMuPDF's "[image]" placeholder appears when the image fails to
        # load — our archive rewrite should keep it out.
        assert "[image]" not in text
        assert len(page.get_images()) == 1


def test_export_html_pdf_honours_img_width_height_attributes_as_points() -> None:
    """Math export sizes inline <img> via width/height attributes — Story
    treats those as pt (1 attr unit = 1pt), not as CSS pixels. If this
    contract changes upstream the math export will silently regress to the
    old "huge/faded" rendering, so lock it down."""

    png = _make_solid_png(200, 40, (220, 38, 38, 255))
    data_url = "data:image/png;base64," + base64.b64encode(png).decode("ascii")

    pdf = export_html_pdf(
        f"""
        <article class="ProseMirror">
          <p>before <img src="{data_url}" alt="x" width="50" height="10"> after</p>
        </article>
        """
    )

    assert pdf.startswith(b"%PDF-")
    with pymupdf.open(stream=io.BytesIO(pdf), filetype="pdf") as doc:
        page = doc[0]
        rects = []
        for img in page.get_images(full=True):
            rects.extend(page.get_image_rects(img[0]))
        assert rects, "expected one image to be placed on the page"
        rect = rects[0]
        # Allow a tiny tolerance for sub-pixel rounding by Story.
        assert abs(rect.width - 50) < 1.5, f"image width was {rect.width}pt"
        assert abs(rect.height - 10) < 1.5, f"image height was {rect.height}pt"


def test_export_html_pdf_renders_flattened_lists_inline_with_hanging_indent() -> None:
    """Lists are flattened by the frontend into `<p class="pdf-list-item">`
    blocks with hanging-indent inline styles, because Story hardcodes a
    ~23pt left indent on `<ul>` / `<ol>` and ignores `padding-left` /
    `margin-left` on those tags.

    The critical correctness property is that **marker and content share a
    line** — an earlier attempt used `display: inline-block` on the marker
    span, which Story treats as a line-break boundary, so the bullet ended
    up alone on a line above its text. This test pins down:

    1. Marker glyph and the start of the item content land on the SAME
       text line (same y bbox).
    2. The marker sits at the page text origin x (no parasitic Story
       indent on top of our hanging-indent geometry).
    3. Nested-level markers sit one indent step further right.
    4. Both checkbox glyphs survive Story's font lookup."""

    pdf = export_html_pdf(
        """
        <article class="ProseMirror">
          <p>baseline</p>
          <p class="pdf-list-item" style="padding-left:18pt; text-indent:-18pt; margin:0 0 4pt"><span class="pdf-list-marker">•</span> Bullet alpha</p>
          <p class="pdf-list-item" style="padding-left:36pt; text-indent:-18pt; margin:0 0 4pt"><span class="pdf-list-marker">•</span> Nested bullet</p>
          <p class="pdf-list-item" style="padding-left:18pt; text-indent:-18pt; margin:0 0 4pt"><span class="pdf-list-marker">1.</span> Ordered alpha</p>
          <p class="pdf-list-item" style="padding-left:18pt; text-indent:-18pt; margin:0 0 4pt"><span class="pdf-list-marker">☑</span> Task done</p>
          <p class="pdf-list-item" style="padding-left:18pt; text-indent:-18pt; margin:0 0 4pt"><span class="pdf-list-marker">☐</span> Task open</p>
        </article>
        """
    )

    # Walk lines; for each line, capture (y, [(x, text)…]) so we can assert
    # both same-line and same-y co-location of marker + content.
    lines: list[tuple[float, list[tuple[float, str]]]] = []
    with pymupdf.open(stream=io.BytesIO(pdf), filetype="pdf") as doc:
        for block in doc[0].get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                pieces = [
                    (s["bbox"][0], s["text"]) for s in line.get("spans", []) if s["text"].strip()
                ]
                if pieces:
                    lines.append((line["bbox"][1], pieces))

    baseline_x = next(
        x for _, pieces in lines for x, t in pieces if t.strip() == "baseline"
    )

    def line_containing(needle: str) -> list[tuple[float, str]]:
        for _, pieces in lines:
            joined = "".join(t for _, t in pieces)
            if needle in joined:
                return pieces
        raise AssertionError(f"expected text {needle!r} in PDF; lines={lines}")

    # (1) Marker and its content land in the same Story line for every kind.
    for marker, content in [
        ("•", "Bullet alpha"),
        ("1.", "Ordered alpha"),
        ("☑", "Task done"),
        ("☐", "Task open"),
    ]:
        pieces = line_containing(content)
        joined = "".join(t for _, t in pieces)
        assert marker in joined, (
            f"marker {marker!r} not on the same line as {content!r}: {pieces}"
        )

    # (2) Top-level markers sit flush at the page text origin x.
    for _marker, content in [
        ("•", "Bullet alpha"),
        ("1.", "Ordered alpha"),
        ("☑", "Task done"),
        ("☐", "Task open"),
    ]:
        pieces = line_containing(content)
        first_x = pieces[0][0]
        assert abs(first_x - baseline_x) < 0.5, (
            f"line for {content!r} starts at x={first_x}, expected ~{baseline_x}"
        )

    # (3) Nested bullet's marker is one indent step further right than the
    # outer — depth-1 padding-left took effect.
    nested_pieces = line_containing("Nested bullet")
    nested_x = nested_pieces[0][0]
    assert nested_x - baseline_x > 15  # ~LIST_INDENT_PT (18pt) minus tolerance


def test_export_html_pdf_renders_web_bookmark_card() -> None:
    """The fallback rendering for web bookmarks is a 2-col `<table>` card
    with the URL as the only `<a>`. Pin the rendered PDF properties:

    1. Title + description + URL all show up in the PDF text layer.
    2. The URL appears in the text layer exactly ONCE — not three times,
       which would happen if the editor's `<a>`-wrapped flex card crept
       back in (Story would emit "Title", "Description", and "URL" each as
       its own line of styled hyperlink text).
    3. The URL `<a href>` produces a `/Link` annotation pointing at the
       URL, so the user can click it from the PDF reader.
    """

    pdf = export_html_pdf(
        """
        <article class="ProseMirror">
          <table class="pdf-bookmark">
            <tbody>
              <tr>
                <td class="pdf-bookmark-content">
                  <div class="pdf-bookmark-title">doXmind</div>
                  <div class="pdf-bookmark-desc">An AI-native writing editor.</div>
                  <div class="pdf-bookmark-url">
                    <a class="pdf-bookmark-url-text" href="https://doxmind.com">https://doxmind.com</a>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </article>
        """
    )

    text = _text_from_pdf(pdf)
    assert "doXmind" in text
    assert "An AI-native writing editor." in text
    assert text.count("https://doxmind.com") == 1, (
        f"URL should appear exactly once; got text={text!r}"
    )

    # Open the rendered PDF and confirm the URL anchor became a Link annot.
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        uris = [
            link.get("uri")
            for page in doc
            for link in page.get_links()
        ]
    assert "https://doxmind.com" in uris, f"expected /Link to URL; got {uris!r}"


def test_export_html_pdf_emits_link_annotation_for_image_inside_anchor() -> None:
    """The preferred bookmark path emits a `<figure><a><img></a></figure>`
    where the `<img>` is the rasterised rounded card. Verify the entire
    image area becomes a clickable Link annotation pointing at the URL —
    that's the whole reason we switched the backend to `write_with_links`.
    """
    # 1x1 transparent PNG (real bytes; the rasterised card would be much
    # larger but for the link-annotation property only the anchor matters).
    # Build a real 700x120 white PNG — Story drops 1×1 placeholders entirely,
    # which would mask the alignment bug we're testing for.
    def _make_white_png(w: int, h: int) -> bytes:
        def _chunk(typ: bytes, data: bytes) -> bytes:
            return (
                struct.pack(">I", len(data))
                + typ
                + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
            )

        sig = b"\x89PNG\r\n\x1a\n"
        ihdr = _chunk(
            b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
        )
        scanline = b"\x00" + b"\xff\xff\xff" * w
        idat = _chunk(b"IDAT", zlib.compress(scanline * h))
        iend = _chunk(b"IEND", b"")
        return sig + ihdr + idat + iend

    card_png = _make_white_png(700, 120)
    data_url = f"data:image/png;base64,{base64.b64encode(card_png).decode()}"
    pdf = export_html_pdf(
        f"""
        <article class="ProseMirror">
          <figure class="pdf-bookmark-figure">
            <a href="https://doxmind.com">
              <img src="{data_url}" width="240" height="80" alt="bookmark">
            </a>
          </figure>
        </article>
        """
    )

    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        page = doc[0]
        annots = [
            link
            for link in page.get_links()
            if link.get("uri") == "https://doxmind.com"
        ]
        image_rects: list[pymupdf.Rect] = []
        for img in page.get_images(full=True):
            for r in page.get_image_rects(img[0]):
                image_rects.append(r)

    assert annots, "expected at least one /Link annotation for the bookmark URL"
    assert image_rects, "test fixture should render at least one image"

    # The CRITICAL property: the non-degenerate link annotation must align
    # with the rendered image rect — otherwise PDF readers only register
    # clicks on the small intersection at the top of the image (which was
    # the bug `_retarget_image_anchor_links` exists to fix).
    image_rect = image_rects[0]
    big_links = [
        link for link in annots
        if link.get("from") and link["from"].width >= 20 and link["from"].height >= 20
    ]
    assert big_links, f"expected an image-sized link rect, got {annots!r}"
    link_rect = big_links[0]["from"]
    assert abs(link_rect.x0 - image_rect.x0) < 1.0, (
        f"link x0={link_rect.x0} should match image x0={image_rect.x0}"
    )
    assert abs(link_rect.y0 - image_rect.y0) < 1.0, (
        f"link y0={link_rect.y0} should match image y0={image_rect.y0} "
        f"(off by ~{image_rect.y0 - link_rect.y0:.1f}pt — image-anchor bug?)"
    )
    assert abs(link_rect.width - image_rect.width) < 1.0
    assert abs(link_rect.height - image_rect.height) < 1.0


def test_export_html_pdf_keeps_code_block_content_without_editor_chrome() -> None:
    pdf = export_html_pdf(
        """
        <article class="ProseMirror">
          <div class="pdf-code-block" data-language="typescript">
            <div class="pdf-code-block-language">TypeScript</div>
            <pre class="pdf-code-block-pre"><code>const dir = dirname(markdownPath);
return `${dir}/${base}.doxmind`;</code></pre>
          </div>
        </article>
        """
    )

    text = _text_from_pdf(pdf)
    assert "TypeScript" in text
    assert "const dir = dirname(markdownPath);" in text
    assert "return `" in text
    assert "Copy code" not in text
