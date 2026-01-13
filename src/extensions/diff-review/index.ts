/**
 * Diff Review Extension for TipTap
 *
 * Displays inline diff hunks with accept/reject buttons.
 * Similar to Cursor's code review experience.
 */

import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import type { DiffHunk } from "@/types/diff";
import { markdownToHtml } from "@/lib/markdown";

import {
  DiffReviewPluginKey,
  type DiffReviewPluginState,
} from "./diff-types";
import { findTextInDocument } from "./position-mapping";
import { createInsertWidget, createActionWidget } from "./diff-widgets";

// Re-export types for external use
export * from "./diff-types";
export { findTextInDocument, findAllTextInDocument } from "./position-mapping";
export { createInsertWidget, createActionWidget } from "./diff-widgets";

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
              if (
                earlierHunk.status === "pending" &&
                (earlierHunk.type === "replace" || earlierHunk.type === "delete") &&
                earlierHunk.oldContent === hunk.oldContent
              ) {
                // Find where this earlier hunk would match
                const found = findTextInDocument(
                  state.doc,
                  earlierHunk.oldContent,
                  usedPositions
                );
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
