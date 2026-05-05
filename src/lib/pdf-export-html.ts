"use client";

/**
 * Editor HTML → static export HTML.
 *
 * The PDF backend (PyMuPDF Story) only understands a small subset of HTML
 * and has no DOM/JS — interactive node-view chrome, KaTeX-rendered math,
 * embedded mermaid SVGs (especially with foreignObject HTML labels), and
 * any non-data: image URL all break it. This module walks the live editor
 * HTML and rewrites each problem block into stable, semantic markup the
 * backend can actually render.
 *
 * Math, mermaid, and web-bookmark blocks are rasterised against the live
 * DOM by the export orchestrator (see markdown-pdf-export.ts) and arrive
 * here with the PNG data URL stashed on `data-pdf-png` of the outer
 * wrapper; this module just swaps each wrapper out for an `<img>`. Images
 * are still fetched async here because their URLs (Tauri asset,
 * /api/images, external) only resolve inside the webview.
 */

const DATA_URL_RE = /^data:/i;

function languageFromCodeBlock(wrapper: Element, codeHost: Element): string | null {
  const languageClass = Array.from(codeHost.classList).find((name) => name.startsWith("language-"));
  if (languageClass) {
    return languageClass.slice("language-".length);
  }

  const headerText = wrapper.querySelector<HTMLElement>(".code-block-header")?.innerText?.trim();
  if (!headerText) return null;
  return headerText
    .replace(/\b(copy code|copied)\b/gi, "")
    .replace(/[^\w#+.-]+/g, " ")
    .trim()
    .toLowerCase();
}

function languageLabel(language: string | null): string | null {
  if (!language) return null;
  return language
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^(ts|tsx|js|jsx|css|html|json|sql|yaml|xml)$/i.test(part)) {
        return part.toUpperCase();
      }
      if (/^typescript$/i.test(part)) return "TypeScript";
      if (/^javascript$/i.test(part)) return "JavaScript";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function transformCodeBlocks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".code-block-wrapper").forEach((wrapper) => {
    const codeHost = wrapper.querySelector<HTMLElement>(".code-block-content");
    if (!codeHost) return;

    const language = languageFromCodeBlock(wrapper, codeHost);
    const label = languageLabel(language);
    const codeText = codeHost.textContent ?? "";

    const block = document.createElement("div");
    block.className = "pdf-code-block";
    if (language) {
      block.setAttribute("data-language", language);
    }

    if (label) {
      const caption = document.createElement("div");
      caption.className = "pdf-code-block-language";
      caption.textContent = label;
      block.appendChild(caption);
    }

    const pre = document.createElement("pre");
    pre.className = "pdf-code-block-pre";
    const code = document.createElement("code");
    if (language) {
      code.className = `language-${language}`;
    }
    code.textContent = codeText;
    pre.appendChild(code);
    block.appendChild(pre);

    wrapper.replaceWith(block);
  });
}

function consumeStashedPng(wrapper: HTMLElement | null): string | null {
  if (!wrapper) return null;
  const png = wrapper.getAttribute("data-pdf-png");
  if (!png) return null;
  wrapper.removeAttribute("data-pdf-png");
  return png;
}

/**
 * Read the captured CSS-pixel size of a math block off the wrapper. The
 * orchestrator stashes these alongside the PNG so we can sized the emitted
 * `<img>` to its on-screen size — without explicit width/height attributes,
 * PyMuPDF Story falls back to the PNG's native pixel dimensions (≈ 2× the
 * CSS size due to `pixelRatio: 2`) and the math renders 3-4× too large.
 */
function consumeStashedDims(wrapper: HTMLElement | null): { width: string; height: string } | null {
  if (!wrapper) return null;
  const width = wrapper.getAttribute("data-pdf-png-w");
  const height = wrapper.getAttribute("data-pdf-png-h");
  wrapper.removeAttribute("data-pdf-png-w");
  wrapper.removeAttribute("data-pdf-png-h");
  if (!width || !height) return null;
  return { width, height };
}

/**
 * Read the per-image baseline-descender (in pt) the rasteriser stashed for
 * inline math. We need this here, not in CSS, because the descender is
 * specific to each equation — math with bare letters has near-zero
 * descender, while math containing `\beta`/`\rho` or large operators has
 * several pt. Emitting a per-image `vertical-align` lets PyMuPDF Story's
 * baseline-aligned `<img>` placement land math baseline on text baseline.
 */
function consumeStashedDescender(wrapper: HTMLElement | null): string | null {
  if (!wrapper) return null;
  const descender = wrapper.getAttribute("data-pdf-png-descender-pt");
  if (!descender) return null;
  wrapper.removeAttribute("data-pdf-png-descender-pt");
  return descender;
}

function findMathWrapper(host: HTMLElement): HTMLElement | null {
  // Prefer the outer React-renderer wrapper (.block-math-wrapper /
  // .inline-math-wrapper) since that's where the orchestrator stashes the
  // rasterised PNG. Fall back to the inner NodeViewWrapper for legacy nodes.
  return (
    host.closest<HTMLElement>(".block-math-wrapper, .inline-math-wrapper") ||
    host.closest<HTMLElement>(".math-node-wrapper")
  );
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function localName(el: Element): string {
  // KaTeX's MathML lives in the http://www.w3.org/1998/Math/MathML namespace;
  // tagName casing varies between browsers (`math` vs `MATH`). Normalise.
  return (el.localName || el.tagName).toLowerCase();
}

/**
 * Convert a KaTeX-emitted MathML subtree into PDF-renderable inline HTML.
 *
 * KaTeX always emits a parallel MathML tree (`<math>...</math>`) inside
 * `.katex-mathml` alongside the visual `.katex-html` tree. The MathML form
 * is structured (msup/msub/mi/mo/mn/...), Unicode-rich, and ideal for
 * lightweight rendering — and crucially, it doesn't depend on KaTeX's
 * `position: relative; top: -<n>em` superscript hack that html-to-image
 * fails to capture inside a foreignObject.
 *
 * Strategy: walk the MathML and emit tags PyMuPDF Story understands —
 * `<i>` for identifiers, `<sup>`/`<sub>` for scripts, plain text for
 * numbers and operators. Returns `null` for any element we don't have a
 * faithful mapping for (mfrac, msqrt, mover/munder, mtable, …); the
 * caller falls back to LaTeX-as-code so the math at least round-trips.
 *
 * `\beta`/`\alpha`/etc. survive verbatim — KaTeX puts the actual greek
 * Unicode codepoint in the `<mi>` text content.
 */
function mathmlToInlineHtml(node: Element): string | null {
  const tag = localName(node);

  // Leaf / atom nodes: text comes from the element's own text, not children.
  if (tag === "mi" || tag === "mn" || tag === "mo" || tag === "mtext") {
    const raw = (node.textContent ?? "").trim();
    if (!raw) return "";
    const escaped = escapeHtmlText(raw);
    // Math italic for identifiers (variables / function names). Single-letter
    // identifiers are conventionally italic in math typography; multi-letter
    // identifiers (sin, log, lim) come through as upright `<mi>` per the
    // MathML spec, but KaTeX also marks them with `mathvariant="normal"`.
    if (tag === "mi") {
      const variant = node.getAttribute("mathvariant");
      if (variant === "normal") return escaped;
      return `<i>${escaped}</i>`;
    }
    // Numbers and operators stay upright. Add hair-of-space around binary
    // operators so output reads naturally (`a + b` not `a+b`).
    return escaped;
  }

  if (tag === "mspace") {
    return " ";
  }

  // Annotation holds the LaTeX source that KaTeX kept for round-tripping;
  // it's not visible math, skip it.
  if (tag === "annotation" || tag === "annotation-xml") {
    return "";
  }

  const children = Array.from(node.children);

  // Layout containers: walk children in order. If any child is unsupported,
  // bail so the caller falls back to LaTeX-as-code.
  if (
    tag === "math" ||
    tag === "semantics" ||
    tag === "mrow" ||
    tag === "mstyle" ||
    tag === "mpadded"
  ) {
    const parts: string[] = [];
    for (const child of children) {
      const part = mathmlToInlineHtml(child);
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join("");
  }

  // Scripts: msup (base, sup), msub (base, sub), msubsup (base, sub, sup).
  if (tag === "msup" && children.length === 2) {
    const base = mathmlToInlineHtml(children[0]);
    const sup = mathmlToInlineHtml(children[1]);
    if (base !== null && sup !== null) return `${base}<sup>${sup}</sup>`;
    return null;
  }
  if (tag === "msub" && children.length === 2) {
    const base = mathmlToInlineHtml(children[0]);
    const sub = mathmlToInlineHtml(children[1]);
    if (base !== null && sub !== null) return `${base}<sub>${sub}</sub>`;
    return null;
  }
  if (tag === "msubsup" && children.length === 3) {
    const base = mathmlToInlineHtml(children[0]);
    const sub = mathmlToInlineHtml(children[1]);
    const sup = mathmlToInlineHtml(children[2]);
    if (base !== null && sub !== null && sup !== null) {
      return `${base}<sub>${sub}</sub><sup>${sup}</sup>`;
    }
    return null;
  }

  // mfrac / msqrt / mover / munder / mtable / etc.: no faithful inline
  // mapping in PyMuPDF Story's HTML subset. Bail.
  return null;
}

function findMathmlRoot(host: HTMLElement): Element | null {
  // KaTeX places the MathML tree inside `.katex-mathml`. The `<math>` element
  // there is the canonical structured form we want to walk. Some legacy
  // captures might not have this wrapper, so accept either parent.
  return host.querySelector(".katex-mathml math") || host.querySelector("math");
}

function transformMathBlocks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".math-rendered").forEach((host) => {
    const wrapper = findMathWrapper(host);
    const isBlock = !!host.closest(".block-math-wrapper, .math-node-wrapper.my-4");

    // Preferred path: the live-DOM rasteriser stashed a PNG of the rendered
    // KaTeX tree on the wrapper. Used by block math, where image-based
    // fidelity matters and inline-line geometry doesn't apply. Inline math
    // never gets a stashed PNG (the rasteriser skips it — see
    // markdown-pdf-export.ts) because html-to-image's foreignObject pipeline
    // fails to reproduce KaTeX's `position: relative; top: -<n>em`
    // superscript layout, dropping operators and superscript glyphs.
    const png = consumeStashedPng(wrapper);
    if (png) {
      const dims = consumeStashedDims(wrapper);
      const descenderPt = consumeStashedDescender(wrapper);
      const img = document.createElement("img");
      img.src = png;
      img.alt = "math";
      if (dims) {
        img.setAttribute("width", dims.width);
        img.setAttribute("height", dims.height);
      }
      if (isBlock) {
        const block = document.createElement("div");
        block.className = "pdf-math-image";
        img.className = "pdf-math-image-img";
        block.appendChild(img);
        (wrapper ?? host).replaceWith(block);
      } else {
        img.className = "pdf-math-inline-img";
        if (descenderPt) {
          img.setAttribute("style", `vertical-align: -${descenderPt}pt`);
        }
        (wrapper ?? host).replaceWith(img);
      }
      return;
    }

    // Inline math (and any block math that didn't get rasterised): convert
    // KaTeX's MathML output to PDF-renderable inline HTML using <i>/<sup>/
    // <sub>. PyMuPDF Story handles those natively, so the PDF gets real
    // typeset math without depending on the bitmap pipeline.
    if (!isBlock) {
      const mathmlRoot = findMathmlRoot(host);
      if (mathmlRoot) {
        const html = mathmlToInlineHtml(mathmlRoot);
        if (html !== null && html.trim() !== "") {
          const span = document.createElement("span");
          span.className = "pdf-math-inline-typeset";
          span.innerHTML = html;
          (wrapper ?? host).replaceWith(span);
          return;
        }
      }
    }

    // Final fallback: recover the LaTeX source from KaTeX's annotation tag
    // and render it as inline code. Used when the MathML tree contained
    // constructs we can't faithfully express in PyMuPDF Story's HTML
    // subset (mfrac/msqrt/etc.) — better to show readable LaTeX than
    // half-rendered math.
    const annotation = host.querySelector<HTMLElement>('annotation[encoding="application/x-tex"]');
    let latex = annotation?.textContent?.trim() || "";
    if (!latex) {
      if (host.querySelector(".math-empty-placeholder")) {
        wrapper?.remove();
        return;
      }
      const errorNode = host.querySelector<HTMLElement>(".text-destructive");
      latex = errorNode?.textContent?.trim() || host.textContent?.trim() || "";
    }
    if (!latex) {
      wrapper?.remove();
      return;
    }

    if (isBlock) {
      const block = document.createElement("div");
      block.className = "pdf-math-block";
      const code = document.createElement("code");
      code.textContent = latex;
      block.appendChild(code);
      (wrapper ?? host).replaceWith(block);
    } else {
      const code = document.createElement("code");
      code.className = "pdf-math-inline";
      code.textContent = latex;
      (wrapper ?? host).replaceWith(code);
    }
  });
}

function transformToggleBlocks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".notion-toggle").forEach((toggle) => {
    const summary = toggle.querySelector<HTMLElement>("[data-toggle-summary]");
    const body = toggle.querySelector<HTMLElement>("[data-toggle-body]");
    const out = document.createElement("div");
    out.className = "pdf-toggle";

    if (summary) {
      const sum = document.createElement("div");
      sum.className = "pdf-toggle-summary";
      sum.innerHTML = summary.innerHTML;
      out.appendChild(sum);
    }
    if (body) {
      const cloned = body.cloneNode(true) as HTMLElement;
      // Empty-state hint (".notion-toggle-empty") is editor-only chrome.
      cloned.querySelectorAll(".notion-toggle-empty").forEach((node) => node.remove());
      const bodyOut = document.createElement("div");
      bodyOut.className = "pdf-toggle-body";
      bodyOut.innerHTML = cloned.innerHTML;
      if (bodyOut.innerHTML.trim()) {
        out.appendChild(bodyOut);
      }
    }

    const outer = toggle.closest<HTMLElement>(".notion-toggle-wrapper") || toggle;
    outer.replaceWith(out);
  });
}

function transformColumnBlocks(root: ParentNode): void {
  // PyMuPDF Story (the backend renderer) doesn't honour flex/grid layout, so
  // the editor's `.columns-wrapper { display: flex }` ends up stacking every
  // column vertically in the PDF. Rewrite the wrapper into a single-row
  // table — Story does lay tables out side-by-side — and let each column's
  // content live inside a `<td>`. Children are *moved*, not cloned, so any
  // earlier transform results (code/math/mermaid/etc.) are preserved.
  root.querySelectorAll<HTMLElement>(".columns-wrapper").forEach((wrapper) => {
    const columns = Array.from(wrapper.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        (child.classList.contains("column") || child.hasAttribute("data-column"))
    );
    if (columns.length === 0) {
      wrapper.remove();
      return;
    }

    const table = document.createElement("table");
    table.className = "pdf-columns";

    const widthPct = (100 / columns.length).toFixed(4);
    const colgroup = document.createElement("colgroup");
    columns.forEach(() => {
      const col = document.createElement("col");
      col.setAttribute("style", `width: ${widthPct}%`);
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);

    const tbody = document.createElement("tbody");
    const tr = document.createElement("tr");
    columns.forEach((column) => {
      const td = document.createElement("td");
      td.className = "pdf-column";
      while (column.firstChild) {
        td.appendChild(column.firstChild);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
    table.appendChild(tbody);

    wrapper.replaceWith(table);
  });
}

function transformCalloutBlocks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".doxmind-callout-card").forEach((card) => {
    const emojiSpan = card.querySelector<HTMLElement>(".doxmind-callout-icon-button span");
    const emoji = emojiSpan?.textContent?.trim() || "";
    const content = card.querySelector<HTMLElement>(".doxmind-callout-content");

    const out = document.createElement("div");
    out.className = "pdf-callout";
    if (emoji) {
      const icon = document.createElement("span");
      icon.className = "pdf-callout-emoji";
      icon.textContent = emoji;
      out.appendChild(icon);
    }
    if (content) {
      const body = document.createElement("div");
      body.className = "pdf-callout-content";
      body.innerHTML = content.innerHTML;
      out.appendChild(body);
    }

    const outer = card.closest<HTMLElement>(".doxmind-callout-wrapper") || card;
    outer.replaceWith(out);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (DATA_URL_RE.test(url)) return url;
  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

function transformMermaidBlocks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".mermaid-chart-wrapper").forEach((wrapper) => {
    // Preferred path: live-DOM rasteriser already produced a PNG for this
    // diagram. Use it as the figure body — matches what the editor shows.
    const png = consumeStashedPng(wrapper);
    if (png) {
      const dims = consumeStashedDims(wrapper);
      const fig = document.createElement("figure");
      fig.className = "pdf-mermaid";
      const img = document.createElement("img");
      img.src = png;
      img.alt = "mermaid diagram";
      // Explicit pt-sized <img> so PyMuPDF Story doesn't downscale the PNG
      // to fit the page width — downscaling washes out the thin SVG strokes
      // and antialiases small arrow labels into illegibility.
      if (dims) {
        img.setAttribute("width", dims.width);
        img.setAttribute("height", dims.height);
      }
      fig.appendChild(img);
      wrapper.replaceWith(fig);
      return;
    }

    // Fallback: rasterisation failed (or the diagram never rendered, e.g.
    // empty/loading/error state). Pull the source code out of `data-code`
    // (avoiding `svg.textContent`, which on mermaid SVGs is the inline
    // <style> block, not the diagram source) and surface it as a code block
    // so the user can still see what was meant to be drawn.
    const code =
      wrapper.getAttribute("data-code") ||
      wrapper.querySelector<HTMLElement>("[data-code]")?.getAttribute("data-code") ||
      "";
    if (code.trim()) {
      const pre = document.createElement("pre");
      pre.className = "pdf-mermaid-fallback";
      pre.textContent = code.trim();
      wrapper.replaceWith(pre);
      return;
    }

    const placeholder = document.createElement("p");
    placeholder.className = "pdf-mermaid-placeholder";
    placeholder.textContent = "[mermaid diagram]";
    wrapper.replaceWith(placeholder);
  });
}

/**
 * Flatten every `<ul>`, `<ol>`, and TipTap task list (`<ul
 * data-type="taskList">`) into a sequence of `<p class="pdf-list-item">`
 * blocks with a manual marker glyph and an inline hanging-indent style.
 *
 * Why we can't just style native lists: PyMuPDF Story bakes a ~23pt left
 * indent into `<ul>` / `<ol>` and ignores `padding-left` / `margin-left` on
 * those tags. It also drops `<input type="checkbox">` silently, so task list
 * items collapse to plain bullets. Story DOES honour inline-style
 * `padding-left` + `text-indent` on `<p>`, so we synthesise the hanging
 * indent from those primitives.
 *
 * Layout per item (depth = nesting level, 0 = top):
 *
 *   <p style="padding-left: (depth+1)*INDENT pt; text-indent: -INDENT pt; margin:0 0 4pt">
 *     <span class="pdf-list-marker">•|1.|☐|☑</span>&nbsp;<... item content ...>
 *   </p>
 *
 * Critical: the marker `<span>` must NOT have `display: inline-block`. Story
 * treats inline-block as a hard line-break boundary, so the marker would land
 * on its own line above the text. Use a plain inline `<span>` and let Story
 * flow it next to the content like a regular text run.
 *
 * Hanging-indent means the marker sits flush left at the depth-appropriate x,
 * and any wrapped line aligns under the content (not under the marker).
 * Bullet, ordered, and task content x-positions will differ by a couple of pt
 * because marker glyph widths differ — that's an accepted trade-off versus
 * the line-break bug we'd hit with fixed-width markers.
 */
const LIST_INDENT_PT = 18;

function listMarker(list: HTMLElement, li: HTMLElement, index: number): string {
  if (list.matches('ul[data-type="taskList"]') || list.classList.contains("pdf-task-list")) {
    return li.getAttribute("data-checked") === "true" ? "☑" : "☐";
  }
  if (list.tagName === "OL") {
    return `${index + 1}.`;
  }
  return "•";
}

function partitionListItem(li: HTMLElement): {
  inlineContent: Node[];
  sublists: HTMLElement[];
} {
  // TipTap task items wrap content in `<div>`; bullet/ordered items hold
  // children directly. Treat them uniformly by selecting the right host.
  const taskContent = Array.from(li.children).find(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName === "DIV"
  );
  const host = taskContent ?? li;

  const sublists: HTMLElement[] = [];
  const inlineContent: Node[] = [];
  let consumedFirstParagraph = false;

  Array.from(host.childNodes).forEach((node) => {
    if (node instanceof HTMLElement) {
      if (node.tagName === "UL" || node.tagName === "OL") {
        sublists.push(node);
        return;
      }
      // <label><input/></label> is task-item editor chrome — drop it.
      if (node.tagName === "LABEL") return;
      // First <p> contributes its inline children directly. Subsequent
      // paragraphs (rare) get folded in as-is via a soft break.
      if (node.tagName === "P") {
        if (!consumedFirstParagraph) {
          consumedFirstParagraph = true;
          inlineContent.push(...Array.from(node.childNodes));
        } else {
          // Multiple <p> children: separate with a line break so the second
          // paragraph doesn't run together with the first. Story renders <br>.
          inlineContent.push(document.createElement("br"));
          inlineContent.push(...Array.from(node.childNodes));
        }
        return;
      }
    }
    inlineContent.push(node);
  });

  return { inlineContent, sublists };
}

function flattenList(list: HTMLElement, depth: number, out: Node[]): void {
  let index = 0;
  Array.from(list.children).forEach((child) => {
    if (!(child instanceof HTMLElement) || child.tagName !== "LI") return;
    const li = child;
    const marker = listMarker(list, li, index);
    index++;

    const { inlineContent, sublists } = partitionListItem(li);

    const p = document.createElement("p");
    p.className = "pdf-list-item";
    // Inline styles because Story ignores class-based padding/text-indent
    // overrides on <p> and applies its own list/paragraph defaults.
    const padLeft = (depth + 1) * LIST_INDENT_PT;
    p.setAttribute(
      "style",
      `padding-left:${padLeft}pt; text-indent:-${LIST_INDENT_PT}pt; margin:0 0 4pt`
    );
    const markerSpan = document.createElement("span");
    markerSpan.className = "pdf-list-marker";
    markerSpan.textContent = marker;
    p.appendChild(markerSpan);
    // Non-breaking space between marker and content keeps Story from
    // collapsing the gap when the line wraps, and reads as a single text run.
    p.appendChild(document.createTextNode(" "));
    inlineContent.forEach((node) => p.appendChild(node));
    out.push(p);

    sublists.forEach((sublist) => flattenList(sublist, depth + 1, out));
  });
}

function transformLists(root: ParentNode): void {
  // Only target *outermost* lists: nested lists are pulled in via flattenList
  // recursion. `:scope` selectors here would be cleaner, but `closest()` is
  // simpler and works on any ParentNode shape (DocumentFragment included).
  const topLevel = Array.from(root.querySelectorAll<HTMLElement>("ul, ol")).filter(
    (list) => !list.parentElement?.closest("ul, ol")
  );

  for (const list of topLevel) {
    const blocks: Node[] = [];
    flattenList(list, 0, blocks);
    const fragment = document.createDocumentFragment();
    blocks.forEach((node) => fragment.appendChild(node));
    list.replaceWith(fragment);
  }
}

/**
 * Rebuild web-bookmark blocks into a PDF-friendly card.
 *
 * Preferred path: the export orchestrator rasterises the live editor card
 * (rounded corners, OG thumbnail, exact typography) into a PNG and stashes
 * it on the wrapper. We swap the wrapper for an `<a>`-wrapped `<img>` so
 * the PDF gets a pixel-perfect match for the editor design AND the URL is
 * still clickable. PyMuPDF Story has no `border-radius` support, so this
 * is the only way to reproduce the editor's rounded card.
 *
 * Fallback path (capture failed — e.g. CORS-tainted OG image): rebuild the
 * subtree as a 2-col `<table>`. The editor's React node view wraps the
 * whole card in an `<a>`, which Story turns into three stacked blue
 * underlined text runs (Story applies hyperlink styling to every text run
 * inside `<a>`). The fallback drops that wrapper so only the URL line is a
 * hyperlink, and uses a table because Story doesn't lay out flex.
 *
 * Empty bookmarks (no url) are dropped: the editor shows a "Add a URL"
 * empty-state card that has no business in the export.
 */
function transformWebBookmarks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-type="web-bookmark"]').forEach((el) => {
    const url = el.getAttribute("data-url") || "";
    if (!url.trim()) {
      el.remove();
      return;
    }
    const title = (el.getAttribute("data-title") || "").trim() || url;
    const description = (el.getAttribute("data-description") || "").trim();
    const faviconUrl = el.getAttribute("data-favicon-url") || "";
    const imageUrl = el.getAttribute("data-image-url") || "";

    // Preferred path: live-DOM rasteriser produced a PNG of the rendered
    // card. Emit `<a><img></a>` so the URL stays clickable.
    const png = consumeStashedPng(el);
    if (png) {
      const dims = consumeStashedDims(el);
      const fig = document.createElement("figure");
      fig.className = "pdf-bookmark-figure";
      const link = document.createElement("a");
      link.setAttribute("href", url);
      const img = document.createElement("img");
      img.src = png;
      img.alt = title;
      if (dims) {
        img.setAttribute("width", dims.width);
        img.setAttribute("height", dims.height);
      }
      link.appendChild(img);
      fig.appendChild(link);
      el.replaceWith(fig);
      return;
    }

    const table = document.createElement("table");
    table.className = "pdf-bookmark";

    // Reserve a fixed-width right column only when there's a thumbnail.
    // Without it the text column expands to the full content width.
    if (imageUrl) {
      const colgroup = document.createElement("colgroup");
      const colText = document.createElement("col");
      colText.className = "pdf-bookmark-col-text";
      const colThumb = document.createElement("col");
      colThumb.className = "pdf-bookmark-col-thumb";
      colgroup.appendChild(colText);
      colgroup.appendChild(colThumb);
      table.appendChild(colgroup);
    }

    const tbody = document.createElement("tbody");
    const tr = document.createElement("tr");

    const tdContent = document.createElement("td");
    tdContent.className = "pdf-bookmark-content";

    const titleEl = document.createElement("div");
    titleEl.className = "pdf-bookmark-title";
    titleEl.textContent = title;
    tdContent.appendChild(titleEl);

    if (description) {
      const descEl = document.createElement("div");
      descEl.className = "pdf-bookmark-desc";
      descEl.textContent = description;
      tdContent.appendChild(descEl);
    }

    const urlRow = document.createElement("div");
    urlRow.className = "pdf-bookmark-url";
    if (faviconUrl) {
      const fav = document.createElement("img");
      fav.className = "pdf-bookmark-favicon";
      fav.src = faviconUrl;
      fav.alt = "";
      urlRow.appendChild(fav);
      urlRow.appendChild(document.createTextNode(" "));
    }
    const urlLink = document.createElement("a");
    urlLink.className = "pdf-bookmark-url-text";
    urlLink.setAttribute("href", url);
    urlLink.textContent = url;
    urlRow.appendChild(urlLink);
    tdContent.appendChild(urlRow);

    tr.appendChild(tdContent);

    if (imageUrl) {
      const tdThumb = document.createElement("td");
      tdThumb.className = "pdf-bookmark-thumb";
      const img = document.createElement("img");
      img.src = imageUrl;
      img.className = "pdf-bookmark-thumb-img";
      img.alt = "";
      tdThumb.appendChild(img);
      tr.appendChild(tdThumb);
    }

    tbody.appendChild(tr);
    table.appendChild(tbody);

    el.replaceWith(table);
  });
}

async function transformImages(root: ParentNode): Promise<void> {
  // Drop the empty-state placeholder UI for image blocks that never got a src.
  root.querySelectorAll<HTMLElement>(".image-node-wrapper").forEach((wrapper) => {
    if (!wrapper.querySelector("img")) {
      wrapper.remove();
    }
  });

  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src") || "";
      if (!src) {
        img.remove();
        return;
      }
      if (DATA_URL_RE.test(src)) return;

      const dataUrl = await fetchAsDataUrl(src);
      if (dataUrl) {
        img.setAttribute("src", dataUrl);
      } else {
        // Drop unloadable images so PyMuPDF doesn't render the "[image]"
        // placeholder text for unreachable URLs.
        img.remove();
      }
      // Inline styles like `width: …px; max-width:100%` confuse PyMuPDF Story's
      // size resolver; let the static width/height attributes drive layout.
      img.removeAttribute("style");
    })
  );
}

export async function prepareHtmlForPdf(rawHtml: string): Promise<string> {
  if (typeof document === "undefined" || !rawHtml.trim()) return rawHtml;

  const template = document.createElement("template");
  template.innerHTML = rawHtml;
  const root = template.content;

  // Math/mermaid/toggle/callout/code transforms are now pure DOM rewrites —
  // the live-DOM rasteriser already produced PNGs and stashed them on the
  // wrappers. Image inlining stays async because we still need to fetch
  // arbitrary `<img src>` URLs (Tauri asset, /api/images, external).
  transformCodeBlocks(root);
  transformMathBlocks(root);
  transformToggleBlocks(root);
  transformCalloutBlocks(root);
  transformMermaidBlocks(root);
  transformLists(root);
  // Web bookmarks rewrite the editor's `<a>`-wrapped flex card into a 2-col
  // table with `<img>` children — must run before transformImages so those
  // freshly-emitted images get their external URLs inlined as data URLs.
  transformWebBookmarks(root);
  // Columns last among DOM rewrites so each column's child blocks are already
  // in their PDF-ready form before we move them into <td> cells.
  transformColumnBlocks(root);
  await transformImages(root);

  return template.innerHTML;
}
