/**
 * Markdown/HTML conversion utilities
 *
 * HTML→Markdown conversion is handled by TipTap's @tiptap/markdown extension
 * via editor.getMarkdown() (schema-aware serialization). This module provides:
 * - Markdown→HTML conversion (via marked) for AI output → editor
 * - HTML detection, plain text extraction, and normalization helpers
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
// This ensures parseFullMarkdown() in the diff review system produces proper atom nodes
// that match the actual editor document structure.
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
 * Convert Markdown to HTML
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown || markdown.trim() === "") return "<p></p>";

  try {
    const html = marked.parse(markdown, { async: false }) as string;
    return html;
  } catch (e) {
    console.error("Markdown to HTML conversion error:", e);
    return `<p>${markdown}</p>`;
  }
}

/**
 * Check if content looks like HTML (not just Markdown with angle brackets)
 *
 * This is more strict than just checking for angle brackets, since Markdown
 * can contain angle brackets in code blocks or as literal characters.
 * We look for actual HTML tags that would indicate the content is HTML.
 */
export function isHtml(content: string): boolean {
  // Quick check: if it doesn't have any angle brackets, it's not HTML
  if (!/</.test(content)) {
    return false;
  }

  // Check for common HTML tags that wouldn't appear in Markdown
  // We're looking for opening tags like <p>, <div>, <table>, <h1>, etc.
  const htmlTagPattern =
    /<(p|div|span|table|tr|td|th|thead|tbody|ul|ol|li|h[1-6]|br|hr|img|a|strong|em|code|pre|blockquote)(\s[^>]*)?\/?>/i;

  return htmlTagPattern.test(content);
}

/**
 * Normalize content from AI to HTML for editor
 */
export function normalizeForEditor(content: string): string {
  if (!isHtml(content)) {
    return markdownToHtml(content);
  }
  return content;
}

/**
 * Convert markdown to plain text for searching in doc.textContent.
 * ProseMirror's doc.textContent concatenates all text nodes without separators
 * between block elements, but PRESERVES whitespace (including newlines) within
 * preformatted elements like <pre> and <code>.
 *
 * Example: "<p>hello</p><p>world</p>" -> "helloworld"
 * Example: "<pre>line1\nline2</pre>" -> "line1\nline2"
 */
export function markdownToPlainText(markdown: string): string {
  if (!markdown) return "";

  try {
    // Check if input is already HTML - if so, extract text directly without markdown parsing
    // This is important for HTML content like tables from TipTap
    const inputIsHtml = isHtml(markdown);
    const html = inputIsHtml ? markdown : (marked.parse(markdown, { async: false }) as string);

    // Extract text content - simulating ProseMirror's textContent behavior
    if (typeof document !== "undefined") {
      const temp = document.createElement("div");
      temp.innerHTML = html;

      // Extract content from data attributes (mermaid charts, math expressions)
      // These render as empty elements with content in data-code/data-latex attributes
      temp.querySelectorAll("[data-code], [data-latex]").forEach((el) => {
        const attr = el.getAttribute("data-code") || el.getAttribute("data-latex") || "";
        if (attr) {
          const decoded = attr
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"');
          el.textContent = decoded;
        }
      });

      // Walk through all nodes and build text content
      // ProseMirror preserves newlines in <pre>/<code> but not between blocks
      let result = "";
      const walker = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT, null);

      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent || "";
        // Check if this text node is inside a <pre> or <code> element
        let parent = node.parentElement;
        let isPreformatted = false;
        while (parent && parent !== temp) {
          if (parent.tagName === "PRE" || parent.tagName === "CODE") {
            isPreformatted = true;
            break;
          }
          parent = parent.parentElement;
        }

        if (isPreformatted) {
          // Preserve all whitespace including newlines
          result += text;
        } else {
          // Remove newlines (block separators) but keep spaces
          result += text.replace(/\n/g, "");
        }
      }

      return result.replace(/^\s+|\s+$/g, ""); // Trim start/end only
    }

    // Fallback for SSR: more complex handling needed
    // Extract code blocks first, preserve their newlines
    const codeBlocks: string[] = [];
    let processed = html.replace(
      /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
      (_, content) => {
        const decoded = content
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"');
        const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
        codeBlocks.push(decoded);
        return placeholder;
      }
    );

    // Extract content from data-code/data-latex attributes before stripping tags
    // Mermaid: <div data-code="..."></div>, Math: <div/span data-latex="...">
    processed = processed
      .replace(/<(?:div|span)[^>]*\sdata-code="([^"]*)"[^>]*>(?:<\/(?:div|span)>)?/gi, (_, c) =>
        c
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
      )
      .replace(/<(?:div|span)[^>]*\sdata-latex="([^"]*)"[^>]*>(?:<\/(?:div|span)>)?/gi, (_, c) =>
        c
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
      );

    // Process rest of HTML
    processed = processed
      .replace(/<[^>]+>/g, "") // Remove HTML tags
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\n/g, ""); // Remove newlines from non-code content

    // Restore code blocks with preserved newlines
    codeBlocks.forEach((block, i) => {
      processed = processed.replace(`__CODE_BLOCK_${i}__`, block);
    });

    return processed.replace(/^\s+|\s+$/g, ""); // Trim start/end
  } catch {
    // Fallback: basic markdown stripping, preserve code block newlines
    let result = markdown;

    // Extract and preserve code blocks
    const codeBlocks: string[] = [];
    result = result.replace(/```[\s\S]*?```/g, (m) => {
      const content = m.split("\n").slice(1, -1).join("\n");
      const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(content);
      return placeholder;
    });

    // Strip markdown formatting
    result = result
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^[-*+]\s+/gm, "")
      .replace(/^#+\s+/gm, "")
      .replace(/\n/g, ""); // Remove newlines from non-code content

    // Restore code blocks
    codeBlocks.forEach((block, i) => {
      result = result.replace(`__CODE_BLOCK_${i}__`, block);
    });

    return result.replace(/^\s+|\s+$/g, ""); // Trim start/end
  }
}

/**
 * Strip code fences and image references from markdown preview text.
 * For mermaid blocks, extracts chart titles as meaningful preview text.
 * Used for card previews where raw code blocks and images aren't useful.
 */
export function stripPreviewBlocks(markdown: string): string {
  if (!markdown) return "";
  return markdown
    .replace(/```mermaid\n([\s\S]*?)```\n*/g, (_, content: string) => {
      // Extract title from mermaid chart for meaningful preview
      const titleMatch = content.match(/title\s+"([^"]+)"/);
      return titleMatch ? titleMatch[1] + "\n" : "";
    })
    .replace(/```[\w-]*\n[\s\S]*?```\n*/g, "") // Remove other code fences
    .replace(/```[\w-]*[\s\S]*$/g, "") // Remove trailing unclosed code fence
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1") // Replace images with alt text
    .trim();
}
