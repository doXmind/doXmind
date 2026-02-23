/**
 * Diff Review Extension - Widget Creation
 *
 * Functions for creating DOM elements for diff visualization.
 */

import { marked } from "marked";
import katex from "katex";
import type { DiffHunk } from "@/types/diff";
import { isHtml } from "@/lib/markdown";
import { renderMermaidSvg } from "@/lib/mermaid-renderer";

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

  // Render any mermaid chart placeholders into actual SVG diagrams
  const mermaidDivs = content.querySelectorAll<HTMLElement>('[data-type="mermaid-chart"]');
  mermaidDivs.forEach((div) => {
    const decoded = div.getAttribute("data-code");
    if (!decoded) return;
    div.classList.add("mermaid-rendered");
    div.textContent = "Rendering diagram…";
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
      .catch(() => {
        div.textContent = "[Diagram]";
      });
  });

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
