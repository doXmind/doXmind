/**
 * Diff Review Extension - Widget Creation
 *
 * Functions for creating DOM elements for diff visualization.
 */

import { marked } from "marked";
import type { DiffHunk } from "@/types/diff";
import { isHtml } from "@/lib/markdown";

/**
 * Convert markdown to HTML for diff display
 * If content is already HTML, return it as-is
 */
function renderMarkdownToHtml(markdown: string): string {
  if (!markdown || markdown.trim() === "") return "";

  // If content is already HTML (e.g., tables from TipTap), return as-is
  if (isHtml(markdown)) {
    return markdown;
  }

  try {
    // Configure marked for inline rendering when content is simple
    const html = marked.parse(markdown, {
      async: false,
      gfm: true,
      breaks: true, // Convert \n to <br>
    }) as string;
    return html;
  } catch (e) {
    console.error("Diff markdown rendering error:", e);
    // Fallback: escape HTML and convert newlines to <br>
    return markdown
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }
}

/**
 * Create a widget for displaying inserted content (green ghost text)
 * Renders markdown content as HTML for proper display
 */
export function createInsertWidget(hunk: DiffHunk): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "diff-inserted-wrapper";
  wrapper.setAttribute("data-hunk-id", hunk.id);
  wrapper.setAttribute("contenteditable", "false");

  const content = document.createElement("div");
  content.className = "diff-inserted diff-markdown-content";

  // Trim trailing newlines to avoid extra empty lines
  const newContent = (hunk.newContent || "").replace(/\n+$/, "");

  // Render markdown to HTML
  const renderedHtml = renderMarkdownToHtml(newContent);
  content.innerHTML = renderedHtml;

  wrapper.appendChild(content);
  return wrapper;
}

/**
 * Create action buttons widget (accept/reject)
 * Displayed as a toolbar row above the diff content
 */
export function createActionWidget(hunk: DiffHunk): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "diff-actions-row";
  wrapper.setAttribute("contenteditable", "false");
  wrapper.setAttribute("data-hunk-id", hunk.id);

  const buttonsContainer = document.createElement("span");
  buttonsContainer.className = "diff-actions";

  const acceptBtn = document.createElement("button");
  acceptBtn.className = "diff-action-btn diff-accept";
  acceptBtn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5L5 9L9.5 3.5"/></svg>';
  acceptBtn.title = "Accept change (apply)";
  acceptBtn.type = "button";
  acceptBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent("diff-accept", { detail: { hunkId: hunk.id } }));
  };

  const rejectBtn = document.createElement("button");
  rejectBtn.className = "diff-action-btn diff-reject";
  rejectBtn.innerHTML =
    '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2L8 8M8 2L2 8"/></svg>';
  rejectBtn.title = "Reject change (discard)";
  rejectBtn.type = "button";
  rejectBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent("diff-reject", { detail: { hunkId: hunk.id } }));
  };

  // Add label
  const label = document.createElement("span");
  label.className = "diff-label";
  label.textContent =
    hunk.type === "delete" ? "Delete" : hunk.oldContent === "" ? "Insert" : "Replace";

  buttonsContainer.appendChild(acceptBtn);
  buttonsContainer.appendChild(rejectBtn);
  wrapper.appendChild(buttonsContainer);
  wrapper.appendChild(label);

  return wrapper;
}
