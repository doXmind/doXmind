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
import { markdownToHtml, isHtml } from "@/lib/markdown";

import { DiffReviewPluginKey, type DiffReviewPluginState } from "./diff-types";
import { findTextInDocument } from "./position-mapping";
import { createInsertWidget, createActionWidget } from "./diff-widgets";
import {
  calculateReplacementRange,
  normalizeTableHtml,
  handleTableReplacement,
} from "./replacement-utils";

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

                // Map all position fields including resolvedFrom/resolvedTo
                // CRITICAL: resolvedFrom/resolvedTo are computed by decorations() and stored on the hunk
                // They MUST be updated when the document changes, otherwise accept() will use stale positions
                const mappedHunk = {
                  ...hunk,
                  from: tr.mapping.map(hunk.from),
                  to: tr.mapping.map(hunk.to),
                };

                // Also map resolved positions if they exist
                if (hunk.resolvedFrom !== undefined) {
                  mappedHunk.resolvedFrom = tr.mapping.map(hunk.resolvedFrom);
                }
                if (hunk.resolvedTo !== undefined) {
                  mappedHunk.resolvedTo = tr.mapping.map(hunk.resolvedTo);
                }

                return mappedHunk;
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

              if (hunk.isFullDocumentReplace) {
                // Full document replacement: use entire document range
                from = 0;
                to = state.doc.content.size;
                buttonPos = 1; // Place button at start of document
                hunk.resolvedFrom = from;
                hunk.resolvedTo = to;
              } else if (hunk.type === "replace" || hunk.type === "delete") {
                // Use searchText (plain text) for finding position in doc.textContent
                // Fall back to oldContent for backward compatibility
                const searchText = hunk.searchText || hunk.oldContent;

                // Pass usedPositions to exclude already-claimed positions
                const found = findTextInDocument(state.doc, searchText, usedPositions);

                if (found) {
                  from = found.from;
                  to = found.to;
                  // Place buttons at the start of the containing block (paragraph)
                  // +1 to get inside the block node
                  buttonPos = found.blockStart + 1;
                  // Mark this position as used
                  usedPositions.add(from);
                  // Store resolved position directly on the hunk for use by accept command
                  // This ensures accept uses the exact same position that decorations display
                  hunk.resolvedFrom = from;
                  hunk.resolvedTo = to;
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
              if ((hunk.type === "replace" || hunk.type === "delete") && from < to) {
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

          // Use the resolved positions that were computed by the decorations function
          // This ensures accept operates on the EXACT same position that was visually marked
          let from: number;
          let to: number;

          if (hunk.isFullDocumentReplace) {
            // Full document replacement: replace entire document content
            from = 0;
            to = state.doc.content.size;
          } else if (hunk.type === "replace" || hunk.type === "delete") {
            // Use resolved positions from decoration computation
            if (hunk.resolvedFrom !== undefined && hunk.resolvedTo !== undefined) {
              from = hunk.resolvedFrom;
              to = hunk.resolvedTo;
            } else {
              // Fallback: re-search (should rarely happen)
              const searchText = hunk.searchText || hunk.oldContent;
              const found = findTextInDocument(state.doc, searchText);
              if (found) {
                from = found.from;
                to = found.to;
              } else {
                const docSize = state.doc.content.size;
                from = Math.max(0, Math.min(hunk.from, docSize));
                to = Math.max(from, Math.min(hunk.to, docSize));
              }
            }
          } else {
            const docSize = state.doc.content.size;
            from = Math.max(0, Math.min(hunk.from, docSize));
            to = from;
          }

          // Apply the change based on hunk type
          if (hunk.type === "replace" || hunk.type === "insert") {
            // Trim trailing newlines to avoid extra empty lines
            const newContent = (hunk.newContent || "").replace(/\n+$/, "");

            if (hunk.type === "replace") {
              if (newContent) {
                // Special handling for full document replacement
                if (hunk.isFullDocumentReplace) {
                  // For full document replacement, replace the entire document content
                  const contentIsHtml = isHtml(newContent);
                  const html = contentIsHtml ? newContent : markdownToHtml(newContent);
                  const element = document.createElement("div");
                  element.innerHTML = html;

                  normalizeTableHtml(element);

                  const parser = ProseMirrorDOMParser.fromSchema(state.schema);
                  const parsedDoc = parser.parse(element);

                  if (parsedDoc.content.size > 0) {
                    // Replace entire document content (from position 0 to end)
                    tr.replaceWith(0, state.doc.content.size, parsedDoc.content);
                  }
                }
                // Regular replace (not full document)
                else {
                  const $from = state.doc.resolve(from);
                  const $to = state.doc.resolve(to);
                  const isInCodeBlock = $from.parent.type.name === "codeBlock";

                  if (isInCodeBlock) {
                    // For code blocks, just replace with plain text
                    // Don't parse as markdown - keep the raw text
                    // Strip markdown code fences if present (``` at start/end)
                    let codeContent = newContent;
                    // Remove opening fence: ```language or just ```
                    codeContent = codeContent.replace(/^```[^\n]*\n?/, "");
                    // Remove closing fence
                    codeContent = codeContent.replace(/\n?```\s*$/, "");

                    const textNode = state.schema.text(codeContent);
                    tr.replaceWith(from, to, textNode);
                  } else {
                    // ============================================
                    // UNIFIED CROSS-BLOCK REPLACEMENT LOGIC
                    // ============================================
                    // Key insight: when old_str spans multiple blocks (e.g., heading + list),
                    // we must replace from the START of the first block to the END of the last block.
                    // This ensures all old content is deleted before inserting new content.

                    // Step 1: Calculate the actual replacement range
                    // This expands from/to to block boundaries when content spans multiple blocks
                    const replacementRange = calculateReplacementRange(
                      state.doc,
                      from,
                      to,
                      $from,
                      $to
                    );

                    // Step 2: Parse the new content
                    const parentType = $from.parent.type.name;

                    // Check if we're inside a list item or table (at any depth)
                    let isInListItem = false;
                    let isInTable = false;
                    let tableDepth = -1;
                    for (let d = $from.depth; d >= 0; d--) {
                      const node = $from.node(d);
                      if (node.type.name === "listItem") {
                        isInListItem = true;
                      }
                      if (node.type.name === "table") {
                        isInTable = true;
                        tableDepth = d;
                      }
                    }

                    const isInParagraph = parentType === "paragraph";
                    const isInHeading = parentType === "heading";

                    // Strip list markers from newContent if we're inside a list item
                    let contentToRender = newContent;
                    if (isInListItem && !isHtml(newContent)) {
                      contentToRender = newContent.replace(/^[-*+]\s+|\d+\.\s+/gm, "");
                    }

                    // Check if content is already HTML
                    const contentIsHtml = isHtml(contentToRender);
                    const html = contentIsHtml ? contentToRender : markdownToHtml(contentToRender);
                    const element = document.createElement("div");
                    element.innerHTML = html;

                    // Normalize table HTML for TipTap compatibility
                    normalizeTableHtml(element);

                    const parser = ProseMirrorDOMParser.fromSchema(state.schema);
                    const parsedDoc = parser.parse(element);

                    if (parsedDoc.content.size > 0) {
                      const firstChild = parsedDoc.content.firstChild;
                      const childCount = parsedDoc.content.childCount;
                      const hasMultipleBlocks = childCount > 1;

                      // Step 3: Determine replacement strategy based on content analysis
                      // Priority order (from most specific to most general):

                      // 3a. Cross-block replacement: when from/to span different blocks
                      // BUT NOT if we're replacing a table with a table (let 3a2 handle that)
                      if (
                        replacementRange.isCrossBlock &&
                        !(isInTable && firstChild?.type.name === "table")
                      ) {
                        tr.replaceWith(
                          replacementRange.actualStart,
                          replacementRange.actualEnd,
                          parsedDoc.content
                        );
                      }
                      // 3a2. Table-to-table replacement: when we're inside a table and new content is a table
                      // This MUST be before paragraph checks because table cells contain paragraphs
                      else if (isInTable && firstChild?.type.name === "table" && tableDepth > 0) {
                        // Replace the entire containing table with the new table
                        const tableStart = $from.before(tableDepth);
                        const tableEnd = $from.after(tableDepth);
                        tr.replaceWith(tableStart, tableEnd, parsedDoc.content);
                      }
                      // 3b. List item inline replacement
                      else if (
                        isInListItem &&
                        firstChild?.type.name === "bulletList" &&
                        !hasMultipleBlocks
                      ) {
                        const listItem = firstChild.content.firstChild;
                        if (listItem) {
                          const paragraph = listItem.content.firstChild;
                          if (paragraph && paragraph.content.size > 0) {
                            tr.replaceWith(from, to, paragraph.content);
                          }
                        }
                      }
                      // 3c. Single paragraph inline replacement
                      else if (
                        isInParagraph &&
                        firstChild?.type.name === "paragraph" &&
                        !hasMultipleBlocks &&
                        !replacementRange.shouldExpandToBlock
                      ) {
                        if (firstChild.content.size > 0) {
                          tr.replaceWith(from, to, firstChild.content);
                        }
                      }
                      // 3d. Multiple blocks replacing a paragraph
                      else if (isInParagraph && hasMultipleBlocks) {
                        const paragraphStart = $from.start($from.depth);
                        // Use Math.max to ensure we delete all content up to 'to'
                        const paragraphEnd = Math.max($from.end($from.depth), to);
                        tr.replaceWith(paragraphStart, paragraphEnd, parsedDoc.content);
                      }
                      // 3e. Table replacement
                      else if (firstChild?.type.name === "table") {
                        handleTableReplacement(
                          tr,
                          state,
                          from,
                          to,
                          $from,
                          $to,
                          firstChild,
                          parsedDoc
                        );
                      }
                      // 3f. Block-level content replacing paragraph
                      else if (
                        isInParagraph &&
                        firstChild &&
                        ["codeBlock", "blockquote", "bulletList", "orderedList"].includes(
                          firstChild.type.name
                        )
                      ) {
                        let blockStart = from;
                        let blockEnd = to;

                        for (let d = $from.depth; d > 0; d--) {
                          const node = $from.node(d);
                          if (
                            node.type.name === "paragraph" ||
                            node.type.name === "tableCell" ||
                            node.type.name === "tableHeader"
                          ) {
                            blockStart = $from.start(d);
                            // Use Math.max to ensure we delete all old content
                            blockEnd = Math.max($from.end(d), to);
                            break;
                          }
                        }

                        tr.replaceWith(blockStart, blockEnd, parsedDoc.content);
                      }
                      // 3g. Heading replacement (uses actualEnd which includes content beyond heading)
                      else if (isInHeading) {
                        const headingStart = $from.before($from.depth);
                        const headingEnd = $from.after($from.depth);
                        // Use Math.max to ensure we delete all content up to 'to'
                        // This handles cases where old_str spans heading + subsequent content
                        const actualEnd = Math.max(headingEnd, to);
                        tr.replaceWith(headingStart, actualEnd, parsedDoc.content);
                      }
                      // 3h. Default: use from/to directly
                      else {
                        tr.replaceWith(from, to, parsedDoc.content);
                      }
                    }
                  }
                }
              } else {
                // Empty new content = delete
                tr.delete(from, to);
              }
            } else {
              // Insert type - parse markdown/HTML and insert
              if (newContent) {
                const contentIsHtml = isHtml(newContent);
                const html = contentIsHtml ? newContent : markdownToHtml(newContent);
                const element = document.createElement("div");
                element.innerHTML = html;

                normalizeTableHtml(element);

                const parser = ProseMirrorDOMParser.fromSchema(state.schema);
                const parsedDoc = parser.parse(element);

                if (parsedDoc.content.size > 0) {
                  tr.insert(from, parsedDoc.content);
                }
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
export function getDiffHunks(editor: { state: { doc: unknown } } | null): DiffHunk[] {
  if (!editor) return [];
  const pluginState = DiffReviewPluginKey.getState(
    editor.state as Parameters<typeof DiffReviewPluginKey.getState>[0]
  );
  return pluginState?.hunks ?? [];
}

/**
 * Helper function to check if diff review is active
 */
export function isDiffReviewActive(editor: { state: { doc: unknown } } | null): boolean {
  if (!editor) return false;
  const pluginState = DiffReviewPluginKey.getState(
    editor.state as Parameters<typeof DiffReviewPluginKey.getState>[0]
  );
  return pluginState?.isActive ?? false;
}
