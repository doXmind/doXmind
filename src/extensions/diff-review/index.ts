/**
 * Diff Review Extension for TipTap
 *
 * Displays inline diff hunks with accept/reject buttons.
 * Similar to Cursor's code review experience.
 */

import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMParser as ProseMirrorDOMParser, Slice } from "@tiptap/pm/model";
import type { DiffHunk } from "@/types/diff";
import { markdownToHtml, isHtml } from "@/lib/markdown";

import { DiffReviewPluginKey, type DiffReviewPluginState } from "./diff-types";
import { findTextInDocument } from "./position-mapping";
import { createInsertWidget, createActionWidget } from "./diff-widgets";
import { normalizeTableHtml, normalizeMermaidHtml } from "./replacement-utils";

// Re-export types for external use
export * from "./diff-types";
export { findTextInDocument, findAllTextInDocument } from "./position-mapping";
export { createInsertWidget, createActionWidget } from "./diff-widgets";

/**
 * Cache for ProseMirror-parsed textContent and block type.
 * Key = markdown oldContent, Value = { textContent, blockType } from ProseMirror parser.
 * Using the SAME parser/schema as the document guarantees textContent matches doc.textContent.
 * blockType is the first text-containing block's type name (e.g., "heading", "paragraph"),
 * used to disambiguate when the same text appears in multiple locations (e.g., TOC vs heading).
 */
interface ParsedContentCache {
  textContent: string;
  blockType: string | null;
}
const pmTextCache = new Map<string, ParsedContentCache>();

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
            focusedHunkId: null,
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
              } else if (hunk.oldContent) {
                // Convert oldContent to plain text using ProseMirror's own parser
                // This guarantees textContent matches doc.textContent (same parser, same schema)
                let cached = pmTextCache.get(hunk.oldContent);
                if (!cached) {
                  const html = isHtml(hunk.oldContent)
                    ? hunk.oldContent
                    : markdownToHtml(hunk.oldContent);
                  const el = document.createElement("div");
                  el.innerHTML = html;
                  normalizeTableHtml(el);
                  normalizeMermaidHtml(el);
                  const parsed = ProseMirrorDOMParser.fromSchema(state.schema).parse(el);

                  // Extract expected block type for disambiguation (e.g., "heading" vs "listItem")
                  let blockType: string | null = null;
                  for (let i = 0; i < parsed.content.childCount; i++) {
                    const child = parsed.content.child(i);
                    if (child.isBlock && child.textContent.trim()) {
                      blockType = child.type.name;
                      break;
                    }
                  }

                  cached = { textContent: parsed.textContent, blockType };
                  pmTextCache.set(hunk.oldContent, cached);
                }

                // Use block type hint to disambiguate when same text appears in TOC and heading
                const found = findTextInDocument(
                  state.doc,
                  cached.textContent,
                  usedPositions,
                  cached.blockType
                );

                if (found) {
                  from = found.from;
                  to = found.to;
                  // Place buttons at the start of the containing block (paragraph)
                  // +1 to get inside the block node
                  buttonPos = found.blockStart + 1;
                  // Mark this position as used
                  usedPositions.add(from);
                  // Store resolved position directly on the hunk for use by accept command
                  hunk.resolvedFrom = from;
                  hunk.resolvedTo = to;
                } else {
                  // Fallback to stored positions (may be inaccurate)
                  const docSize = state.doc.content.size;
                  from = Math.max(0, Math.min(hunk.from, docSize));
                  to = Math.max(from, Math.min(hunk.to, docSize));
                  buttonPos = from;
                  console.warn(`[DiffReview] Position resolution failed for hunk ${hunk.id}`, {
                    searchText: cached.textContent?.slice(0, 80),
                  });
                }
              } else {
                // Insert mode (oldContent is empty): use stored position
                const docSize = state.doc.content.size;
                from = Math.max(0, Math.min(hunk.from, docSize));
                to = from;
                buttonPos = from;
              }

              const isFocused = pluginState.focusedHunkId === hunk.id;

              // Add action buttons at the start of the block (before any text)
              decorations.push(
                Decoration.widget(
                  buttonPos,
                  () => {
                    const widget = createActionWidget(hunk);
                    if (isFocused) widget.classList.add("diff-hunk-focused");
                    return widget;
                  },
                  {
                    side: -1, // Place before any content at this position
                    key: `actions-${hunk.id}`,
                  }
                )
              );

              // Mark old content with strikethrough (when there's old content to show)
              if (hunk.oldContent && from < to) {
                decorations.push(
                  Decoration.inline(from, to, {
                    class: isFocused ? "diff-deleted diff-hunk-focused" : "diff-deleted",
                    "data-hunk-id": hunk.id,
                  })
                );
              }

              // Show new content as ghost text (when there's new content to add)
              if (hunk.newContent) {
                const insertPos = hunk.oldContent === "" ? from : to;
                decorations.push(
                  Decoration.widget(
                    insertPos,
                    () => {
                      const widget = createInsertWidget(hunk);
                      if (isFocused) widget.classList.add("diff-hunk-focused");
                      return widget;
                    },
                    {
                      side: 1,
                      key: `insert-${hunk.id}`,
                    }
                  )
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
          } else if (hunk.oldContent) {
            // Has old content: use resolved positions from decoration computation
            if (hunk.resolvedFrom !== undefined && hunk.resolvedTo !== undefined) {
              from = hunk.resolvedFrom;
              to = hunk.resolvedTo;
            } else {
              // Fallback: re-search via ProseMirror parser (should rarely happen)
              let cached = pmTextCache.get(hunk.oldContent);
              if (!cached) {
                const html = isHtml(hunk.oldContent)
                  ? hunk.oldContent
                  : markdownToHtml(hunk.oldContent);
                const el = document.createElement("div");
                el.innerHTML = html;
                normalizeTableHtml(el);
                normalizeMermaidHtml(el);
                const parsed = ProseMirrorDOMParser.fromSchema(state.schema).parse(el);

                let blockType: string | null = null;
                for (let i = 0; i < parsed.content.childCount; i++) {
                  const child = parsed.content.child(i);
                  if (child.isBlock && child.textContent.trim()) {
                    blockType = child.type.name;
                    break;
                  }
                }

                cached = { textContent: parsed.textContent, blockType };
                pmTextCache.set(hunk.oldContent, cached);
              }
              const found = findTextInDocument(
                state.doc,
                cached.textContent,
                undefined,
                cached.blockType
              );
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
            // Insert mode (oldContent is empty): use stored position
            const docSize = state.doc.content.size;
            from = Math.max(0, Math.min(hunk.from, docSize));
            to = from;
          }

          // Apply the change
          const newContent = (hunk.newContent || "").replace(/\n+$/, "");

          if (newContent) {
            if (hunk.isFullDocumentReplace) {
              // Full document replacement
              const html = isHtml(newContent) ? newContent : markdownToHtml(newContent);
              const el = document.createElement("div");
              el.innerHTML = html;
              normalizeTableHtml(el);
              normalizeMermaidHtml(el);
              const parsed = ProseMirrorDOMParser.fromSchema(state.schema).parse(el);
              if (parsed.content.size > 0) {
                tr.replaceWith(0, state.doc.content.size, parsed.content);
              }
            } else {
              const $from = state.doc.resolve(from);
              const isInCodeBlock = $from.parent.type.name === "codeBlock";

              if (isInCodeBlock) {
                // Code block: plain text replacement (strip markdown fences)
                const code = newContent.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
                tr.replaceWith(from, to, state.schema.text(code));
              } else {
                // Parse new content as HTML
                const html = isHtml(newContent) ? newContent : markdownToHtml(newContent);
                const el = document.createElement("div");
                el.innerHTML = html;
                normalizeTableHtml(el);
                normalizeMermaidHtml(el);
                const parsed = ProseMirrorDOMParser.fromSchema(state.schema).parse(el);

                if (parsed.content.size > 0) {
                  // Use replaceRange — ProseMirror's built-in smart replacement
                  // Automatically handles cross-block boundaries, tables, lists, etc.
                  tr.replaceRange(from, to, new Slice(parsed.content, 0, 0));
                }
              }
            }
          } else {
            // Delete (empty new content or no new content)
            if (from < to) {
              tr.delete(from, to);
            }
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

      setFocusedHunk:
        (hunkId: string | null) =>
        ({ tr, state, dispatch }) => {
          if (dispatch) {
            const pluginState = DiffReviewPluginKey.getState(state);
            if (pluginState) {
              tr.setMeta(DiffReviewPluginKey, {
                ...pluginState,
                focusedHunkId: hunkId,
              });
              dispatch(tr);
            }
          }
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
