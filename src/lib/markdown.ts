/**
 * Markdown→HTML conversion (via marked) for imported markdown → TipTap editor.
 * HTML→Markdown is handled by TipTap's @tiptap/markdown extension, except for
 * text escaping (`escapeMarkdownText`), which lives here so the escape rules sit
 * next to the parse rules they have to survive.
 */

import { marked } from "marked";

import { containsCjk } from "@/extensions/math/cjk";
import { isCustomBlockPlaceholderComment, isHtmlCommentBlock } from "@/extensions/html-comment";

// Raw-HTML blocks that other extensions already own — must NOT be wrapped as a
// rawHtml passthrough or those features break: HTML comments (htmlComment, and
// the pdf-block / excel-block placeholders that share their syntax),
// `<details>` (toggle), and `<div data-column(s)>` (columns). Genuine user raw
// HTML (badge rows, etc.) carries none of these markers.
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

function escapeForAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Configure marked to wrap raw-HTML blocks in a sentinel so they import as a
// single rawHtml atom node (preserved byte-identical by source preservation)
// rather than being flattened into images/links with the layout dropped.
marked.use({
  renderer: {
    html(token: string | { raw?: string; text?: string; block?: boolean }): string {
      const original = typeof token === "string" ? token : (token.raw ?? token.text ?? "");
      const raw = original.replace(/\n+$/, "");
      // marked routes inline HTML through this same callback. Only a
      // block-level comment may become a node: turning an inline
      // `<!-- omit in toc -->` into a div splits its heading or paragraph in
      // two and detaches the marker from what it annotates.
      const isBlock = typeof token !== "string" && token.block === true;
      if (isBlock && isHtmlCommentBlock(raw) && !isCustomBlockPlaceholderComment(raw)) {
        return `<div data-html-comment="${escapeForAttr(raw)}" data-type="html-comment"></div>`;
      }
      if (isClaimedRawHtml(raw)) return original; // pass through untouched
      if (!raw.trim()) return "";
      return `<div data-raw-html="${escapeForAttr(raw)}" data-type="raw-html"></div>`;
    },
  },
});

// Map a `[!MARKER]` alert label onto one of the editor's four callout types.
// Accepts doXmind's own names (what the serializer writes) plus the GFM alert
// set, so alerts authored on GitHub import as callouts too. Must stay in sync
// with `callout_type_for_alert` (Rust) and `_CALLOUT_TYPE_BY_ALERT` (Python) —
// see docs/adr/0009 and conformance/.
const CALLOUT_TYPE_BY_ALERT: Record<string, string> = {
  INFO: "info",
  NOTE: "info",
  IMPORTANT: "info",
  TIP: "tip",
  WARNING: "warning",
  ERROR: "error",
  CAUTION: "error",
};

const ALERT_MARKER_RE = /^[ \t]*\[!([A-Za-z]+)\][ \t]*(?:\r?\n|$)/;

// Parse the GFM alert blockquote the callout serializer emits. Without this the
// syntax is write-only: a saved callout reopens as a plain blockquote and its
// type is lost.
marked.use({
  renderer: {
    blockquote(token: { text?: string }): string | false {
      const source = token.text ?? "";
      const match = ALERT_MARKER_RE.exec(source);
      const type = match ? CALLOUT_TYPE_BY_ALERT[match[1].toUpperCase()] : undefined;
      if (!match || !type) return false; // plain quote — default renderer
      const inner = marked.parse(source.slice(match[0].length), { async: false }) as string;
      // The callout schema is `block+`, so an alert with no body still needs one.
      return `<div data-callout-type="${type}">${inner || "<p></p>"}</div>`;
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

// A paragraph whose whole line is `---` / `***` / `___` is a thematic break —
// and a leading `---` also collides with the frontmatter delimiter.
const THEMATIC_BREAK_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
// Block constructs that only bite at the start of a line. A leading backslash
// is escaped too, so text that literally reads `\# x` survives a round-trip.
const LEADING_MARKER_RE = /^([ \t]*)(\\|#{1,6}(?=[ \t]|$)|[-+*](?=[ \t]|$)|>)/;
// Ordered lists escape their delimiter, not the digits — only ASCII punctuation
// is escapable, so `\1.` would stay a literal backslash.
const ORDERED_MARKER_RE = /^([ \t]*\d{1,9})([.)])(?=[ \t]|$)/;
// `[label](dest)`, `[label][ref]` and `[label]: dest`. A genuine link arrives as
// a link mark, so a bracket pair still sitting in plain text is literal.
const LINK_LIKE_RE = /\[[^[\]]*\](?=[([:])/g;

/**
 * Escape literal text so the `.md` reads back as text rather than structure.
 *
 * @tiptap/markdown only HTML-entity-encodes text, so typed or pasted `# foo`,
 * `- foo`, `1. foo`, `---` and `[x](y)` come back as a heading, list, thematic
 * break or link when the file is reopened without its sidecar.
 *
 * Deliberately minimal: only constructs that would change the parse are
 * escaped. Over-escaping rewrites bytes inside untouched blocks, which makes
 * the source-preservation baseline fail self-validation and disables byte
 * fidelity for the whole document. `&` and `<` therefore stay HTML entities —
 * `\<` is not a recognised escape in python-markdown, the importer the shipping
 * app uses — while `>` becomes `\>`, which all three importers understand.
 */
export function escapeMarkdownText(text: string, atLineStart: boolean): string {
  const entities = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  // The leading-marker pass runs BEFORE the link pass, and therefore only ever
  // sees backslashes the user typed. Its first alternative matches a literal
  // backslash so that one survives the round-trip — run it second and it would
  // escape the backslash the link pass just inserted at index 0, doubling it.
  const marked = !atLineStart
    ? entities
    : THEMATIC_BREAK_RE.test(entities)
      ? entities.replace(/[-*_]/, (c) => `\\${c}`)
      : ORDERED_MARKER_RE.test(entities)
        ? entities.replace(ORDERED_MARKER_RE, (_match, prefix, delim) => `${prefix}\\${delim}`)
        : entities.replace(LEADING_MARKER_RE, (_match, indent, marker) => `${indent}\\${marker}`);
  return marked.replace(LINK_LIKE_RE, (match) => `\\${match}`);
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
