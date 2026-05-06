/**
 * Markdown→HTML conversion (via marked) for imported markdown → TipTap editor.
 * HTML→Markdown is handled by TipTap's @tiptap/markdown extension.
 */

import { marked } from "marked";

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
        return src.match(/\$\$/)?.index;
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

export function markdownToHtml(markdown: string): string {
  if (!markdown || markdown.trim() === "") return "<p></p>";

  try {
    const html = marked.parse(markdown, { async: false }) as string;
    return unwrapMathInTableCells(html);
  } catch (e) {
    console.error("Markdown to HTML conversion error:", e);
    return `<p>${markdown}</p>`;
  }
}
