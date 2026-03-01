/**
 * Diff Review Extension - Widget Creation
 *
 * Functions for creating DOM elements for diff visualization.
 * Supports Notion-style word-level inline diffs.
 */

import { marked } from "marked";
import katex from "katex";
import type { DiffHunk } from "@/types/diff";
import { isHtml } from "@/lib/markdown";
import { renderMermaidSvg } from "@/lib/mermaid-renderer";
import { computeWordDiff, type WordDiffSegment } from "@/lib/word-diff";

/**
 * Render LaTeX math expressions within text using KaTeX.
 * Extracts $$...$$ (block) and $...$ (inline), replaces with placeholders,
 * then restores with KaTeX-rendered HTML after markdown processing.
 */
function renderMathInText(html: string): string {
  const placeholders: { key: string; rendered: string }[] = [];
  let idx = 0;

  // Replace block math $$...$$ first (greedy within single match, non-greedy across)
  let result = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
    try {
      const rendered = katex.renderToString(latex.trim(), {
        displayMode: true,
        throwOnError: false,
      });
      const key = `__MATH_BLOCK_${idx++}__`;
      placeholders.push({ key, rendered });
      return key;
    } catch {
      return `$$${latex}$$`;
    }
  });

  // Replace inline math $...$ (not preceded/followed by $, not spanning newlines)
  result = result.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_, latex) => {
    try {
      const rendered = katex.renderToString(latex.trim(), {
        displayMode: false,
        throwOnError: false,
      });
      const key = `__MATH_INLINE_${idx++}__`;
      placeholders.push({ key, rendered });
      return key;
    } catch {
      return `$${latex}$`;
    }
  });

  // Restore placeholders with rendered KaTeX HTML
  for (const { key, rendered } of placeholders) {
    result = result.replace(key, rendered);
  }

  return result;
}

/**
 * Convert markdown to HTML for diff display
 * If content is already HTML, return it as-is
 * Supports LaTeX math rendering via KaTeX
 */
function renderMarkdownToHtml(markdown: string): string {
  if (!markdown || markdown.trim() === "") return "";

  // If content is already HTML (e.g., tables from TipTap), return as-is
  if (isHtml(markdown)) {
    return renderMathInText(markdown);
  }

  try {
    // Extract math expressions before marked processing to protect them
    const mathPlaceholders: { key: string; original: string }[] = [];
    let mathIdx = 0;
    let processed = markdown;

    // Protect block math $$...$$
    processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (match) => {
      const key = `MATHPLACEHOLDER${mathIdx++}ENDMATH`;
      mathPlaceholders.push({ key, original: match });
      return key;
    });

    // Protect inline math $...$
    processed = processed.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (match) => {
      const key = `MATHPLACEHOLDER${mathIdx++}ENDMATH`;
      mathPlaceholders.push({ key, original: match });
      return key;
    });

    // Run marked on the protected text
    let html = marked.parse(processed, {
      async: false,
      gfm: true,
      breaks: true,
    }) as string;

    // Restore math expressions and render with KaTeX
    for (const { key, original } of mathPlaceholders) {
      // Extract latex from delimiters
      const blockMatch = original.match(/^\$\$([\s\S]*?)\$\$$/);
      const inlineMatch = original.match(/^\$([^$\n]+?)\$$/);
      const latex = blockMatch ? blockMatch[1] : inlineMatch ? inlineMatch[1] : original;
      const isBlock = !!blockMatch;

      try {
        const rendered = katex.renderToString(latex.trim(), {
          displayMode: isBlock,
          throwOnError: false,
        });
        html = html.replace(key, rendered);
      } catch {
        html = html.replace(key, original);
      }
    }

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
 * Strip markdown formatting to get plain text for word-level diffing.
 * Preserves paragraph breaks (\n) so multi-paragraph diffs render with line breaks.
 */
function toPlainText(content: string): string {
  if (!content) return "";
  return content
    .replace(/<[^>]+>/g, "") // strip HTML tags (safety net)
    .replace(/^#{1,6}\s+/gm, "") // strip heading markers
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/__(.+?)__/g, "$1") // bold alt
    .replace(/\*(.+?)\*/g, "$1") // italic
    .replace(/_(.+?)_/g, "$1") // italic alt
    .replace(/~~(.+?)~~/g, "$1") // strikethrough
    .replace(/`(.+?)`/g, "$1") // inline code
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links
    .replace(/^>\s?/gm, "") // blockquote markers
    .replace(/^[-*+]\s/gm, "• ") // unordered list markers → bullet
    .replace(/^\d+\.\s/gm, "• ") // ordered list markers → bullet
    .replace(/\n{3,}/g, "\n\n") // collapse 3+ newlines to 2
    .replace(/\n+$/, "") // trim trailing newlines
    .trim();
}

/**
 * Create a styled span for a word-diff segment.
 */
function createDiffSpan(text: string, type: "equal" | "added" | "removed"): HTMLSpanElement {
  const span = document.createElement("span");
  span.textContent = text;
  switch (type) {
    case "removed":
      span.className = "diff-word-removed";
      break;
    case "added":
      span.className = "diff-word-added";
      break;
    case "equal":
      span.className = "diff-word-equal";
      break;
  }
  return span;
}

/**
 * Render word-diff segments as flat inline spans with <br> for line breaks.
 * Used for simple paragraph-only hunks where no block structure is needed.
 */
function renderInlineDiff(container: HTMLElement, segments: WordDiffSegment[]) {
  for (const segment of segments) {
    const lines = segment.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) container.appendChild(document.createElement("br"));
      if (lines[i]) container.appendChild(createDiffSpan(lines[i], segment.type));
    }
  }
}

/**
 * Render word-diff segments into proper block structure (headings, lists, paragraphs).
 * Produces <div> for text lines and <ul>/<li> for list items so they match editor styling.
 */
function renderStructuredDiff(
  container: HTMLElement,
  segments: WordDiffSegment[],
  headingLevel: number,
  headingSizes: Record<number, string>
) {
  // Phase 1: Process segments into lines of spans
  interface LineInfo {
    spans: HTMLSpanElement[];
    isList: boolean;
  }

  const lines: LineInfo[] = [{ spans: [], isList: false }];

  for (const segment of segments) {
    const parts = segment.text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push({ spans: [], isList: false });

      if (parts[i]) {
        const currentLine = lines[lines.length - 1];
        let text = parts[i];

        // Detect list item marker at start of line
        if (currentLine.spans.length === 0 && text.startsWith("• ")) {
          currentLine.isList = true;
          text = text.slice(2); // Strip "• " — the <li> bullet comes from CSS
        }

        if (text) currentLine.spans.push(createDiffSpan(text, segment.type));
      }
    }
  }

  // Apply heading styles to lines before the first empty line (block boundary)
  if (headingLevel > 0) {
    for (const line of lines) {
      if (line.spans.length === 0) break; // first empty line = heading boundary
      for (const span of line.spans) {
        span.style.fontWeight = "600";
        span.style.fontSize = headingSizes[headingLevel] || "1rem";
        span.style.lineHeight = "1.3";
      }
    }
  }

  // Phase 2: Render lines into structural DOM
  let currentList: HTMLUListElement | null = null;

  for (const line of lines) {
    if (line.spans.length === 0) {
      // Empty line (paragraph break) — flush any open list
      if (currentList) {
        container.appendChild(currentList);
        currentList = null;
      }
      continue;
    }

    if (line.isList) {
      if (!currentList) {
        currentList = document.createElement("ul");
        currentList.className = "diff-list";
      }
      const li = document.createElement("li");
      li.className = "diff-list-item";
      for (const span of line.spans) li.appendChild(span);
      currentList.appendChild(li);
    } else {
      if (currentList) {
        container.appendChild(currentList);
        currentList = null;
      }
      const div = document.createElement("div");
      div.className = "diff-text-line";
      for (const span of line.spans) div.appendChild(span);
      container.appendChild(div);
    }
  }

  if (currentList) container.appendChild(currentList);
}

/**
 * Create a Notion-style inline diff widget showing word-level changes.
 * Deleted words shown with strikethrough, added words highlighted.
 * Accept/reject buttons appear on hover.
 */
export function createInlineDiffWidget(hunk: DiffHunk): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "diff-inline-wrapper";
  wrapper.setAttribute("data-hunk-id", hunk.id);
  wrapper.setAttribute("contenteditable", "false");

  // Detect structure from original markdown (before toPlainText stripping)
  const rawOld = hunk.oldContent || "";
  const rawNew = (hunk.newContent || "").replace(/\n+$/, "");
  const headingMatch = rawOld.match(/^(#{1,6})\s+/) || rawNew.match(/^(#{1,6})\s+/);
  const headingLevel = headingMatch ? headingMatch[1].length : 0;
  const headingSizes: Record<number, string> = {
    1: "1.875rem",
    2: "1.5rem",
    3: "1.25rem",
    4: "1.125rem",
    5: "1rem",
    6: "0.875rem",
  };
  const hasListItems =
    /^[-*+]\s/m.test(rawOld) ||
    /^[-*+]\s/m.test(rawNew) ||
    /^\d+\.\s/m.test(rawOld) ||
    /^\d+\.\s/m.test(rawNew);
  const isStructured = headingLevel > 0 || hasListItems;

  // Use block layout for structured hunks (headings/lists) so DOM blocks work
  if (isStructured) {
    wrapper.classList.add("diff-structured");
  }

  // Compute word-level diff
  const oldPlain = toPlainText(rawOld);
  const newPlain = toPlainText(rawNew);
  const segments = computeWordDiff(oldPlain, newPlain);

  // Build diff content container
  const diffContent = document.createElement("div");
  diffContent.className = "diff-inline-content";

  if (isStructured) {
    renderStructuredDiff(diffContent, segments, headingLevel, headingSizes);
  } else {
    renderInlineDiff(diffContent, segments);
  }

  // Build hover action buttons
  const actions = document.createElement("div");
  actions.className = "diff-hover-actions";

  const actionsInner = document.createElement("div");
  actionsInner.className = "diff-actions";

  const acceptBtn = document.createElement("button");
  acceptBtn.className = "diff-action-btn diff-accept";
  acceptBtn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5L5 9L9.5 3.5"/></svg>';
  acceptBtn.title = "Accept change";
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
  rejectBtn.title = "Reject change";
  rejectBtn.type = "button";
  rejectBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent("diff-reject", { detail: { hunkId: hunk.id } }));
  };

  actionsInner.appendChild(acceptBtn);
  actionsInner.appendChild(rejectBtn);
  actions.appendChild(actionsInner);

  wrapper.appendChild(actions);
  wrapper.appendChild(diffContent);

  return wrapper;
}

/**
 * Create a widget for displaying inserted content (blue ghost text)
 * Renders markdown content as HTML for proper display
 */
export function createInsertWidget(hunk: DiffHunk): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "diff-inserted-wrapper";
  wrapper.setAttribute("data-hunk-id", hunk.id);
  wrapper.setAttribute("contenteditable", "false");

  // Build hover action buttons
  const actions = document.createElement("div");
  actions.className = "diff-hover-actions";

  const actionsInner = document.createElement("div");
  actionsInner.className = "diff-actions";

  const acceptBtn = document.createElement("button");
  acceptBtn.className = "diff-action-btn diff-accept";
  acceptBtn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5L5 9L9.5 3.5"/></svg>';
  acceptBtn.title = "Accept change";
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
  rejectBtn.title = "Reject change";
  rejectBtn.type = "button";
  rejectBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent("diff-reject", { detail: { hunkId: hunk.id } }));
  };

  actionsInner.appendChild(acceptBtn);
  actionsInner.appendChild(rejectBtn);
  actions.appendChild(actionsInner);

  const content = document.createElement("div");
  content.className = "diff-inserted diff-markdown-content";

  // Trim trailing newlines to avoid extra empty lines
  const newContent = (hunk.newContent || "").replace(/\n+$/, "");

  // Render markdown to HTML
  const renderedHtml = renderMarkdownToHtml(newContent);
  content.innerHTML = renderedHtml;

  // Render any mermaid chart placeholders into actual SVG diagrams
  const mermaidDivs = content.querySelectorAll<HTMLElement>('[data-type="mermaid-chart"]');
  mermaidDivs.forEach((div) => {
    const decoded = div.getAttribute("data-code");
    if (!decoded) return;
    div.classList.add("mermaid-rendered");
    div.textContent = "Rendering diagram...";
    renderMermaidSvg(decoded)
      .then((svg) => {
        div.innerHTML = svg;
        const svgEl = div.querySelector("svg");
        if (svgEl) {
          svgEl.style.maxWidth = "100%";
          svgEl.style.maxHeight = "460px";
          svgEl.style.height = "auto";
          svgEl.style.width = "auto";
        }
      })
      .catch((err) => {
        console.error("[DiffWidget] Mermaid render failed:", err, "\nCode:", decoded);
        // Show error details instead of generic [Diagram]
        const errMsg =
          err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
        // Extract the useful part of mermaid's error (strip verbose preamble)
        const short = errMsg.replace(/^.*?Syntax error/i, "Syntax error").slice(0, 120);
        div.innerHTML = "";
        const label = document.createElement("span");
        label.style.cssText = "color:#ef4444;font-size:12px;opacity:0.85;";
        label.textContent = `[Diagram error: ${short || "render failed"}]`;
        div.appendChild(label);
      });
  });

  wrapper.appendChild(actions);
  wrapper.appendChild(content);
  return wrapper;
}

/**
 * Create action buttons widget (accept/reject) — hover-only version
 * Used for delete-only hunks where we keep inline strikethrough
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

  buttonsContainer.appendChild(acceptBtn);
  buttonsContainer.appendChild(rejectBtn);
  wrapper.appendChild(buttonsContainer);

  return wrapper;
}
