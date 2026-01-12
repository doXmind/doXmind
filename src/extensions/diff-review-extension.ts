/**
 * Diff Review Extension for TipTap
 *
 * Displays inline diff hunks with accept/reject buttons.
 * Similar to Cursor's code review experience.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import type { DiffHunk } from "@/types/diff";
import { markdownToHtml } from "@/lib/markdown";

// Plugin state interface
export interface DiffReviewPluginState {
  hunks: DiffHunk[];
  isActive: boolean;
}

/**
 * Find ALL occurrences of a text string in the document.
 * Unlike simple textContent.indexOf(), this correctly accounts for node boundaries.
 * Returns array of { from, to, blockStart } positions.
 * blockStart is the position of the containing block node (paragraph, etc.)
 */
function findAllTextInDocument(
  doc: Parameters<typeof DiffReviewPluginKey.getState>[0]["doc"],
  searchText: string
): Array<{ from: number; to: number; blockStart: number }> {
  const results: Array<{ from: number; to: number; blockStart: number }> = [];

  // Walk through all text nodes and build a mapping
  let textOffset = 0;
  const textPositions: Array<{
    start: number;
    end: number;
    pos: number;
    blockPos: number;
  }> = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      // Find the containing block node position
      // Walk up to find the block-level parent
      let blockPos = pos;
      doc.nodesBetween(0, pos + 1, (n, p) => {
        if (n.isBlock && p <= pos && p + n.nodeSize > pos) {
          blockPos = p;
        }
      });

      textPositions.push({
        start: textOffset,
        end: textOffset + node.text.length,
        pos: pos,
        blockPos: blockPos,
      });
      textOffset += node.text.length;
    }
    return true;
  });

  // Now find ALL occurrences of searchText in the concatenated text
  const fullText = doc.textContent;
  let searchStart = 0;

  while (searchStart < fullText.length) {
    const textIndex = fullText.indexOf(searchText, searchStart);
    if (textIndex === -1) break;

    const textEndIndex = textIndex + searchText.length;

    // Find the starting position
    let fromPos: number | null = null;
    let toPos: number | null = null;
    let blockStart: number | null = null;

    for (const tp of textPositions) {
      // Check if search start falls within this text node
      if (fromPos === null && textIndex >= tp.start && textIndex < tp.end) {
        const offsetInNode = textIndex - tp.start;
        fromPos = tp.pos + offsetInNode;
        blockStart = tp.blockPos;
      }

      // Check if search end falls within this text node
      if (toPos === null && textEndIndex > tp.start && textEndIndex <= tp.end) {
        const offsetInNode = textEndIndex - tp.start;
        toPos = tp.pos + offsetInNode;
      }

      if (fromPos !== null && toPos !== null) break;
    }

    if (fromPos !== null && toPos !== null && blockStart !== null) {
      results.push({ from: fromPos, to: toPos, blockStart });
    }

    // Move past this occurrence
    searchStart = textIndex + 1;
  }

  return results;
}

/**
 * Find the ProseMirror position of a text string in the document.
 * Unlike simple textContent.indexOf(), this correctly accounts for node boundaries.
 * Returns { from, to, blockStart } or null if not found.
 * blockStart is the position of the containing block node (paragraph, etc.)
 *
 * @param excludePositions - Set of 'from' positions to exclude (already used by other hunks)
 */
function findTextInDocument(
  doc: Parameters<typeof DiffReviewPluginKey.getState>[0]["doc"],
  searchText: string,
  excludePositions?: Set<number>
): { from: number; to: number; blockStart: number } | null {
  const allOccurrences = findAllTextInDocument(doc, searchText);

  if (allOccurrences.length === 0) return null;

  // If no exclusions, return the first occurrence
  if (!excludePositions || excludePositions.size === 0) {
    return allOccurrences[0];
  }

  // Find the first occurrence that's not excluded
  for (const occurrence of allOccurrences) {
    if (!excludePositions.has(occurrence.from)) {
      return occurrence;
    }
  }

  // All occurrences are excluded, return null
  return null;
}

// Plugin key for accessing state
export const DiffReviewPluginKey = new PluginKey<DiffReviewPluginState>(
  "diffReview"
);

// Declare custom commands for TypeScript
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    diffReview: {
      /**
       * Set the diff hunks to display
       */
      setDiffHunks: (hunks: DiffHunk[]) => ReturnType;
      /**
       * Clear all diff review decorations
       */
      clearDiffReview: () => ReturnType;
      /**
       * Accept a specific diff hunk (applies the change)
       */
      acceptDiffHunk: (hunkId: string) => ReturnType;
      /**
       * Reject a specific diff hunk (removes the decoration)
       */
      rejectDiffHunk: (hunkId: string) => ReturnType;
    };
  }
}

/**
 * Create a widget for displaying inserted content (green ghost text)
 */
function createInsertWidget(hunk: DiffHunk): HTMLElement {
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
function createActionWidget(hunk: DiffHunk): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "diff-actions-row";
  wrapper.setAttribute("contenteditable", "false");
  wrapper.setAttribute("data-hunk-id", hunk.id);

  const buttonsContainer = document.createElement("span");
  buttonsContainer.className = "diff-actions";

  const acceptBtn = document.createElement("button");
  acceptBtn.className = "diff-action-btn diff-accept";
  acceptBtn.innerHTML = "&#10003;"; // ✓
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
  rejectBtn.innerHTML = "&#10005;"; // ✕
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
  label.textContent = hunk.type === "delete" ? "Delete" : hunk.type === "insert" ? "Insert" : "Replace";

  buttonsContainer.appendChild(acceptBtn);
  buttonsContainer.appendChild(rejectBtn);
  wrapper.appendChild(buttonsContainer);
  wrapper.appendChild(label);

  return wrapper;
}

export const DiffReviewExtension = Extension.create({
  name: "diffReview",

  addProseMirrorPlugins() {
    return [
      new Plugin<DiffReviewPluginState>({
        key: DiffReviewPluginKey,

        state: {
          init: () => ({
            hunks: [],
            isActive: false,
          }),

          apply(tr, value) {
            // Check for meta updates
            const meta = tr.getMeta(DiffReviewPluginKey);
            if (meta !== undefined) {
              return { ...value, ...meta };
            }

            // When document changes, update hunk positions using the mapping
            if (tr.docChanged && value.isActive && value.hunks.length > 0) {
              const updatedHunks = value.hunks.map((hunk) => {
                // Only map positions for pending hunks
                if (hunk.status !== "pending") return hunk;

                return {
                  ...hunk,
                  from: tr.mapping.map(hunk.from),
                  to: tr.mapping.map(hunk.to),
                };
              });
              return { ...value, hunks: updatedHunks };
            }

            return value;
          },
        },

        props: {
          decorations(state) {
            const pluginState = this.getState(state);
            if (!pluginState?.isActive || pluginState.hunks.length === 0) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];
            // Track positions that have been claimed by hunks to avoid duplicate matches
            const usedPositions = new Set<number>();

            for (const hunk of pluginState.hunks) {
              // Skip non-pending hunks
              if (hunk.status !== "pending") continue;

              // For replace/delete: find the actual position of oldContent in the document
              // This is more accurate than using stored positions from markdown
              let from: number;
              let to: number;
              let buttonPos: number; // Position for action buttons (at block start)

              if (hunk.type === "replace" || hunk.type === "delete") {
                // Search for oldContent using proper ProseMirror position mapping
                // Pass usedPositions to exclude already-claimed positions
                const found = findTextInDocument(state.doc, hunk.oldContent, usedPositions);

                if (found) {
                  from = found.from;
                  to = found.to;
                  // Place buttons at the start of the containing block (paragraph)
                  // +1 to get inside the block node
                  buttonPos = found.blockStart + 1;
                  // Mark this position as used
                  usedPositions.add(from);
                } else {
                  // Fallback to stored positions (may be inaccurate)
                  const docSize = state.doc.content.size;
                  from = Math.max(0, Math.min(hunk.from, docSize));
                  to = Math.max(from, Math.min(hunk.to, docSize));
                  buttonPos = from;
                }
              } else {
                // For insert type, use stored position
                const docSize = state.doc.content.size;
                from = Math.max(0, Math.min(hunk.from, docSize));
                to = from;
                buttonPos = from;
              }

              // Add action buttons at the start of the block (before any text)
              decorations.push(
                Decoration.widget(buttonPos, () => createActionWidget(hunk), {
                  side: -1, // Place before any content at this position
                  key: `actions-${hunk.id}`,
                })
              );

              // For replace and delete types: mark the old content with strikethrough
              if (
                (hunk.type === "replace" || hunk.type === "delete") &&
                from < to
              ) {
                decorations.push(
                  Decoration.inline(from, to, {
                    class: "diff-deleted",
                    "data-hunk-id": hunk.id,
                  })
                );
              }

              // For replace and insert types: show the new content as ghost text
              if (hunk.type === "replace" || hunk.type === "insert") {
                const insertPos = hunk.type === "insert" ? from : to;
                decorations.push(
                  Decoration.widget(insertPos, () => createInsertWidget(hunk), {
                    side: 1,
                    key: `insert-${hunk.id}`,
                  })
                );
              }
            }

            if (decorations.length === 0) {
              return DecorationSet.empty;
            }

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setDiffHunks:
        (hunks: DiffHunk[]) =>
          ({ tr, dispatch }) => {
            if (dispatch) {
              tr.setMeta(DiffReviewPluginKey, {
                hunks,
                isActive: hunks.length > 0,
              });
              dispatch(tr);
            }
            return true;
          },

      clearDiffReview:
        () =>
          ({ tr, dispatch }) => {
            if (dispatch) {
              tr.setMeta(DiffReviewPluginKey, {
                hunks: [],
                isActive: false,
              });
              dispatch(tr);
            }
            return true;
          },

      acceptDiffHunk:
        (hunkId: string) =>
          ({ tr, state, dispatch }) => {
            const pluginState = DiffReviewPluginKey.getState(state);
            if (!pluginState || !dispatch) return false;

            const hunkIndex = pluginState.hunks.findIndex((h) => h.id === hunkId);
            if (hunkIndex === -1) return false;

            const hunk = pluginState.hunks[hunkIndex];
            if (hunk.status !== "pending") return false;

            // Find the actual position of oldContent using proper ProseMirror position mapping
            // Track positions used by hunks that appear before this one in the list
            // to find the correct occurrence
            let from: number;
            let to: number;

            if (hunk.type === "replace" || hunk.type === "delete") {
              // Build the set of positions used by earlier hunks with the same oldContent
              const usedPositions = new Set<number>();
              for (let i = 0; i < hunkIndex; i++) {
                const earlierHunk = pluginState.hunks[i];
                if (earlierHunk.status === "pending" &&
                  (earlierHunk.type === "replace" || earlierHunk.type === "delete") &&
                  earlierHunk.oldContent === hunk.oldContent) {
                  // Find where this earlier hunk would match
                  const found = findTextInDocument(state.doc, earlierHunk.oldContent, usedPositions);
                  if (found) {
                    usedPositions.add(found.from);
                  }
                }
              }

              const found = findTextInDocument(state.doc, hunk.oldContent, usedPositions);

              if (found) {
                from = found.from;
                to = found.to;
              } else {
                // Fallback to stored positions
                const docSize = state.doc.content.size;
                from = Math.max(0, Math.min(hunk.from, docSize));
                to = Math.max(from, Math.min(hunk.to, docSize));
              }
            } else {
              const docSize = state.doc.content.size;
              from = Math.max(0, Math.min(hunk.from, docSize));
              to = from;
            }

            // Apply the change based on hunk type
            if (hunk.type === "replace" || hunk.type === "insert") {
              // Trim trailing newlines to avoid extra empty lines
              // This matches the visual preview logic in createInsertWidget
              const newContent = (hunk.newContent || "").replace(/\n+$/, "");

              if (hunk.type === "replace") {
                // For replace, use replaceWith to atomically replace content
                // This avoids issues with delete + insert at shifted positions
                if (newContent) {
                  const hasMultipleParagraphs = newContent.includes("\n\n");

                  if (hasMultipleParagraphs) {
                    // Multi-paragraph content: parse as full document structure
                    const html = markdownToHtml(newContent);
                    const element = document.createElement("div");
                    element.innerHTML = html;

                    const parser = ProseMirrorDOMParser.fromSchema(state.schema);
                    const parsedDoc = parser.parse(element);

                    if (parsedDoc.content.size > 0) {
                      // Use replaceWith to replace the old content with new paragraphs
                      tr.replaceWith(from, to, parsedDoc.content);
                    }
                  } else {
                    // Single paragraph/inline content: replace with text node
                    // Using replaceWith ensures atomic replacement without position issues
                    const textNode = state.schema.text(newContent);
                    tr.replaceWith(from, to, textNode);
                  }
                } else {
                  // Empty new content = delete
                  tr.delete(from, to);
                }
              } else {
                // Insert type - just insert at position
                if (newContent) {
                  const textNode = state.schema.text(newContent);
                  tr.insert(from, textNode);
                }
              }
            } else if (hunk.type === "delete") {
              // Just delete old content
              tr.delete(from, to);
            }

            // Update hunk status
            const updatedHunks = pluginState.hunks.map((h) =>
              h.id === hunkId ? { ...h, status: "accepted" as const } : h
            );

            // Check if all hunks are processed
            const hasPending = updatedHunks.some((h) => h.status === "pending");

            tr.setMeta(DiffReviewPluginKey, {
              hunks: updatedHunks,
              isActive: hasPending,
            });

            dispatch(tr);
            return true;
          },

      rejectDiffHunk:
        (hunkId: string) =>
          ({ tr, state, dispatch }) => {
            const pluginState = DiffReviewPluginKey.getState(state);
            if (!pluginState || !dispatch) return false;

            // Just update the status, don't modify the document
            const updatedHunks = pluginState.hunks.map((h) =>
              h.id === hunkId ? { ...h, status: "rejected" as const } : h
            );

            // Check if all hunks are processed
            const hasPending = updatedHunks.some((h) => h.status === "pending");

            tr.setMeta(DiffReviewPluginKey, {
              hunks: updatedHunks,
              isActive: hasPending,
            });

            dispatch(tr);
            return true;
          },
    };
  },
});

/**
 * Helper function to get current diff hunks from editor state
 */
export function getDiffHunks(
  editor: { state: { doc: unknown } } | null
): DiffHunk[] {
  if (!editor) return [];
  const pluginState = DiffReviewPluginKey.getState(
    editor.state as Parameters<typeof DiffReviewPluginKey.getState>[0]
  );
  return pluginState?.hunks ?? [];
}

/**
 * Helper function to check if diff review is active
 */
export function isDiffReviewActive(
  editor: { state: { doc: unknown } } | null
): boolean {
  if (!editor) return false;
  const pluginState = DiffReviewPluginKey.getState(
    editor.state as Parameters<typeof DiffReviewPluginKey.getState>[0]
  );
  return pluginState?.isActive ?? false;
}
