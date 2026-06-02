/**
 * Markdown→HTML conversion (via marked) for imported markdown → TipTap editor.
 * HTML→Markdown is handled by TipTap's @tiptap/markdown extension.
 */

import { marked } from "marked";

import { containsCjk } from "@/extensions/math/cjk";

// Raw-HTML blocks that other extensions already own — must NOT be wrapped as a
// rawHtml passthrough or those features break: HTML-comment placeholders
// (pdf-block / excel-block / database), `<details>` (toggle), and
// `<div data-column(s)>` (columns). Genuine user raw HTML (badge rows, etc.)
// carries none of these markers.
export function isClaimedRawHtml(raw: string): boolean {
  const head = raw.trimStart();
  return (
    head.startsWith("<!--") ||
    head.startsWith("</") || // structural closing tag (columns/toggle close)
    /^<details[\s>]/i.test(head) ||
    /^<pre[\s>]/i.test(head) || // fenced code block — a CodeBlock node, not raw HTML
    /data-column/.test(raw) ||
    // Any editor-owned node marker (task lists, etc.) is claimed by its own
    // parseHTML and must not be swallowed as a rawHtml passthrough.
    /data-type=/.test(raw)
  );
}

// Configure marked to wrap raw-HTML blocks in a sentinel so they import as a
// single rawHtml atom node (preserved byte-identical by source preservation)
// rather than being flattened into images/links with the layout dropped.
marked.use({
  renderer: {
    html(token: string | { raw?: string; text?: string }): string {
      const original = typeof token === "string" ? token : (token.raw ?? token.text ?? "");
      const raw = original.replace(/\n+$/, "");
      if (isClaimedRawHtml(raw)) return original; // pass through untouched
      if (!raw.trim()) return "";
      const escaped = raw
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<div data-raw-html="${escaped}" data-type="raw-html"></div>`;
    },
  },
});

// Configure marked to handle mermaid code fences
marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string | false {
      if (lang === "mermaid") {
        // Decode any existing HTML entities first (idempotent encoding)
        // marked may pass pre-escaped text depending on version/config
        const raw = text
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"');
        // Then encode once for safe HTML attribute embedding
        const escaped = raw
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return `<div data-type="mermaid-chart" data-code="${escaped}" class="mermaid-chart"></div>`;
      }
      return false; // Use default renderer for other languages
    },
  },
});

// Configure marked to handle math expressions ($$...$$ and $...$).
// Converts to the same HTML format that ProseMirror's block-math/inline-math parseHTML expects.
// This produces atom nodes that match the actual editor document structure.
function escapeLatexForAttr(latex: string): string {
  return latex
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

marked.use({
  extensions: [
    {
      name: "blockMath",
      level: "block" as const,
      start(src: string) {
        // Only treat `$$` that begins its own line as block math. Returning the
        // index of any `$$` (e.g. one inside an inline `` `$$x$$` `` code span)
        // makes marked truncate the paragraph there and re-lex it as block math,
        // destroying the code span. `$$` mid-line is left to inline handling.
        const m = src.match(/(?:^|\n)[ \t]*\$\$/);
        return m && m.index !== undefined ? m.index + m[0].length - 2 : undefined;
      },
      tokenizer(src: string) {
        const match = src.match(/^\$\$([\s\S]*?)\$\$/);
        if (match) {
          return {
            type: "blockMath",
            raw: match[0],
            latex: match[1].trim(),
          };
        }
        return undefined;
      },
      renderer(token) {
        const latex = (token as Record<string, string>).latex || "";
        return `<div data-type="block-math" data-latex="${escapeLatexForAttr(latex)}" class="block-math"></div>\n`;
      },
    },
    {
      name: "inlineMath",
      level: "inline" as const,
      start(src: string) {
        return src.match(/(?<!\$)\$(?!\$)/)?.index;
      },
      tokenizer(src: string) {
        const match = src.match(/^(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/);
        if (match) {
          return {
            type: "inlineMath",
            raw: match[0],
            latex: match[1].trim(),
          };
        }
        return undefined;
      },
      renderer(token) {
        const latex = (token as Record<string, string>).latex || "";
        return `<span data-type="inline-math" data-latex="${escapeLatexForAttr(latex)}" class="inline-math"></span>`;
      },
    },
  ],
});

/**
 * Reverts any `$...$` / `$$...$$` math spans that landed inside a table cell
 * back to their literal markdown form. Math auto-recognition is product-scoped
 * out of table cells (see docs/adr/0006-feature-scope-typora-notion.md). The
 * markdown tokenizer (both client `marked` and server `markdown_to_html`)
 * doesn't know about cell context, so we strip after parse — and storage
 * paths that read previously-cached sidecar HTML also pipe through this.
 */
export function unwrapMathInTableCells(html: string): string {
  if (typeof document === "undefined") return html; // SSR fallback
  if (!html.includes("data-type=")) return html; // fast path: no custom blocks at all

  const template = document.createElement("template");
  template.innerHTML = html;

  const mathInCells = template.content.querySelectorAll(
    ':is(td, th) [data-type="inline-math"], :is(td, th) [data-type="block-math"]'
  );
  if (mathInCells.length === 0) return html;

  for (const node of Array.from(mathInCells)) {
    const latex = node.getAttribute("data-latex") || "";
    const isBlock = node.getAttribute("data-type") === "block-math";
    const literal = isBlock ? `$$${latex}$$` : `$${latex}$`;
    node.replaceWith(document.createTextNode(literal));
  }

  return template.innerHTML;
}

/**
 * Reverts `$...$` / `$$...$$` math spans whose `data-latex` contains CJK
 * back to their literal markdown form. Math auto-recognition is gated on
 * content (see docs/adr/0006-feature-scope-typora-notion.md): CJK paragraphs
 * use `$X$` as quoting/emphasis, not LaTeX, and converting them produces
 * broken KaTeX output and a flood of strict-mode warnings. The marked tokenizer
 * has no language gate, so we strip after parse — the editor-side InputRule /
 * PasteRule / migration plugin gate independently.
 */
export function unwrapCjkMath(html: string): string {
  if (typeof document === "undefined") return html; // SSR fallback
  if (!html.includes("data-type=")) return html;

  const template = document.createElement("template");
  template.innerHTML = html;

  const mathNodes = template.content.querySelectorAll(
    '[data-type="inline-math"], [data-type="block-math"]'
  );
  if (mathNodes.length === 0) return html;

  let touched = false;
  for (const node of Array.from(mathNodes)) {
    const latex = node.getAttribute("data-latex") || "";
    if (!containsCjk(latex)) continue;
    const isBlock = node.getAttribute("data-type") === "block-math";
    const literal = isBlock ? `$$${latex}$$` : `$${latex}$`;
    node.replaceWith(document.createTextNode(literal));
    touched = true;
  }

  return touched ? template.innerHTML : html;
}

export function markdownToHtml(markdown: string): string {
  if (!markdown || markdown.trim() === "") return "<p></p>";

  try {
    const html = marked.parse(markdown, { async: false }) as string;
    return unwrapCjkMath(unwrapMathInTableCells(html));
  } catch (e) {
    console.error("Markdown to HTML conversion error:", e);
    return `<p>${markdown}</p>`;
  }
}
