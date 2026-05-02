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

export function markdownToHtml(markdown: string): string {
  if (!markdown || markdown.trim() === "") return "<p></p>";

  try {
    return marked.parse(markdown, { async: false }) as string;
  } catch (e) {
    console.error("Markdown to HTML conversion error:", e);
    return `<p>${markdown}</p>`;
  }
}
