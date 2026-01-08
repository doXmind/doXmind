/**
 * Markdown/HTML conversion utilities
 */

import TurndownService from "turndown";
import { marked } from "marked";

// Configure turndown for HTML to Markdown
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Add custom rules
turndownService.addRule("strikethrough", {
  filter: ["del", "s"] as const,
  replacement: function (content) {
    return "~~" + content + "~~";
  },
});

/**
 * Convert HTML to Markdown
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html.trim() === "") return "";

  // Handle empty paragraph placeholder
  if (html === "<p></p>") return "";

  try {
    return turndownService.turndown(html);
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
 * Check if content looks like HTML
 */
export function isHtml(content: string): boolean {
  return /<[^>]+>/.test(content);
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
