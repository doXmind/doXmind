/**
 * Diff Review Extension - Widget Creation
 *
 * Functions for creating DOM elements for diff visualization.
 */

import type { DiffHunk } from "@/types/diff";

/**
 * Create a widget for displaying inserted content (green ghost text)
 */
export function createInsertWidget(hunk: DiffHunk): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "diff-inserted-wrapper";
  wrapper.setAttribute("data-hunk-id", hunk.id);
  wrapper.setAttribute("contenteditable", "false");

  const content = document.createElement("div");
  content.className = "diff-inserted";

  // Handle newlines by converting them to <br> for display
  // Split by \n\n (paragraph breaks) and \n (line breaks)
  // Trim trailing newlines to avoid extra empty lines
  const newContent = (hunk.newContent || "").replace(/\n+$/, "");

  if (newContent.includes("\n")) {
    // Create elements for each line/paragraph
    const parts = newContent.split(/\n\n+/);
    parts.forEach((part, index) => {
      if (index > 0) {
        // Add paragraph separator (visual break)
        const br1 = document.createElement("br");
        const br2 = document.createElement("br");
        content.appendChild(br1);
        content.appendChild(br2);
      }
      // Handle single newlines within the part
      const lines = part.split("\n");
      lines.forEach((line, lineIndex) => {
        if (lineIndex > 0) {
          content.appendChild(document.createElement("br"));
        }
        content.appendChild(document.createTextNode(line));
      });
    });
  } else {
    content.textContent = newContent;
  }

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
  acceptBtn.innerHTML = "&#10003;"; // checkmark
  acceptBtn.title = "Accept change (apply)";
  acceptBtn.type = "button";
  acceptBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.dispatchEvent(
      new CustomEvent("diff-accept", { detail: { hunkId: hunk.id } })
    );
  };

  const rejectBtn = document.createElement("button");
  rejectBtn.className = "diff-action-btn diff-reject";
  rejectBtn.innerHTML = "&#10005;"; // X mark
  rejectBtn.title = "Reject change (discard)";
  rejectBtn.type = "button";
  rejectBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.dispatchEvent(
      new CustomEvent("diff-reject", { detail: { hunkId: hunk.id } })
    );
  };

  // Add label
  const label = document.createElement("span");
  label.className = "diff-label";
  label.textContent =
    hunk.type === "delete" ? "Delete" : hunk.type === "insert" ? "Insert" : "Replace";

  buttonsContainer.appendChild(acceptBtn);
  buttonsContainer.appendChild(rejectBtn);
  wrapper.appendChild(buttonsContainer);
  wrapper.appendChild(label);

  return wrapper;
}
