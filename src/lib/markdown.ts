/**
 * Markdown/HTML conversion utilities
 */

import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { marked } from "marked";

// Configure turndown for HTML to Markdown
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Add GFM plugin for tables, strikethrough, task lists, etc.
turndownService.use(gfm);

// Add custom rules
turndownService.addRule("strikethrough", {
  filter: ["del", "s"] as const,
  replacement: function (content) {
    return "~~" + content + "~~";
  },
});

/**
 * Normalize TipTap table HTML to standard format for turndown.
 *
 * TipTap generates tables with:
 * 1. ALL cells as <th> (tableHeader nodes)
 * 2. Cell content wrapped in <p> tags
 *
 * turndown-plugin-gfm expects:
 * - <thead> with <th> cells for header row
 * - <tbody> with <td> cells for body rows
 * - No <p> tags inside cells (causes extra newlines in markdown)
 *
 * This function converts TipTap's format to standard HTML table format.
 */
function normalizeTipTapTableForTurndown(html: string): string {
  // Only process if there are tables
  if (!/<table/i.test(html)) {
    return html;
  }

  // Use browser DOM if available
  if (typeof document !== "undefined") {
    const temp = document.createElement("div");
    temp.innerHTML = html;

    const tables = temp.querySelectorAll("table");
    tables.forEach((table) => {
      // Remove colgroup (not needed for markdown)
      table.querySelectorAll("colgroup").forEach((cg) => cg.remove());

      // Get all rows
      const allRows = Array.from(table.querySelectorAll("tr"));
      if (allRows.length === 0) return;

      // First row becomes header, rest become body
      const headerRow = allRows[0];
      const bodyRows = allRows.slice(1);

      // Unwrap <p> tags inside all cells (TipTap wraps cell content in <p>)
      // This prevents turndown from adding extra newlines
      table.querySelectorAll("th, td").forEach((cell) => {
        const p = cell.querySelector("p");
        if (p && cell.childNodes.length === 1) {
          // Replace <p> with its inner content
          cell.innerHTML = p.innerHTML;
        }
      });

      // Ensure header row cells are <th>
      headerRow.querySelectorAll("td").forEach((td) => {
        const th = document.createElement("th");
        th.innerHTML = td.innerHTML;
        Array.from(td.attributes).forEach((attr) => {
          if (attr.name !== "data-colwidth") {
            th.setAttribute(attr.name, attr.value);
          }
        });
        td.parentNode?.replaceChild(th, td);
      });

      // Ensure body row cells are <td>
      bodyRows.forEach((row) => {
        row.querySelectorAll("th").forEach((th) => {
          const td = document.createElement("td");
          td.innerHTML = th.innerHTML;
          Array.from(th.attributes).forEach((attr) => {
            if (attr.name !== "data-colwidth") {
              td.setAttribute(attr.name, attr.value);
            }
          });
          th.parentNode?.replaceChild(td, th);
        });
      });

      // Remove existing thead/tbody
      table.querySelectorAll("thead, tbody").forEach((el) => {
        // Move children to table before removing
        while (el.firstChild) {
          table.insertBefore(el.firstChild, el);
        }
        el.remove();
      });

      // Create proper thead and tbody
      const thead = document.createElement("thead");
      const tbody = document.createElement("tbody");

      // Move header row to thead
      thead.appendChild(headerRow);

      // Move body rows to tbody
      bodyRows.forEach((row) => tbody.appendChild(row));

      // Clear table and add thead + tbody
      while (table.firstChild) {
        table.removeChild(table.firstChild);
      }
      table.appendChild(thead);
      if (bodyRows.length > 0) {
        table.appendChild(tbody);
      }

      // Remove style attribute (TipTap adds min-width which isn't needed)
      table.removeAttribute("style");
    });

    return temp.innerHTML;
  }

  // Fallback: return as-is (SSR case - tables will remain as HTML)
  return html;
}

/**
 * Convert HTML to Markdown
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html.trim() === "") return "";

  // Handle empty paragraph placeholder
  if (html === "<p></p>") return "";

  try {
    // Normalize TipTap tables to standard format before conversion
    const normalizedHtml = normalizeTipTapTableForTurndown(html);
    return turndownService.turndown(normalizedHtml);
  } catch (e) {
    console.error("HTML to Markdown conversion error:", e);
    return html;
  }
}

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
 * Normalize content to markdown for AI processing
 */
export function normalizeForAI(content: string): string {
  if (isHtml(content)) {
    return htmlToMarkdown(content);
  }
  return content;
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
