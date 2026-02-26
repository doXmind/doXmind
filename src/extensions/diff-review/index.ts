/**
 * Diff Review Extension for TipTap
 *
 * Displays inline diff hunks with accept/reject buttons.
 * Similar to Cursor's code review experience.
 */

import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMParser as ProseMirrorDOMParser, Slice } from "@tiptap/pm/model";
import type { DiffHunk } from "@/types/diff";
import { markdownToHtml, isHtml } from "@/lib/markdown";

import { DiffReviewPluginKey, type DiffReviewPluginState } from "./diff-types";
import {
  findTextInDocument,
  findTextNormalized,
  findTextViaMarkdown,
  clearMarkdownCache,
} from "./position-mapping";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { createInsertWidget, createActionWidget, createInlineDiffWidget } from "./diff-widgets";
import { normalizeTableHtml, normalizeMermaidHtml } from "./replacement-utils";

// Re-export types for external use
export * from "./diff-types";
export {
  findTextInDocument,
  findAllTextInDocument,
  findTextNormalized,
  findTextViaMarkdown,
  clearMarkdownCache,
} from "./position-mapping";
export { createInsertWidget, createActionWidget, createInlineDiffWidget } from "./diff-widgets";

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

/**
 * Detect structured content that would lose meaning if flattened to plain text.
 * These types fall back to block-level rendering (strikethrough + insert widget).
 */
function isStructuredContent(content: string): boolean {
  if (!content) return false;
  // Tables (markdown: |...|---| or HTML: <table>)
  if (/\|.+\|/.test(content) && /\|[-: ]+\|/.test(content)) return true;
  if (/<table[\s>]/i.test(content)) return true;
  // Mermaid diagrams
  if (/```mermaid/i.test(content)) return true;
  if (/data-type="mermaid-chart"/i.test(content)) return true;
  // Code blocks (fenced)
  if (/```[\s\S]*?```/.test(content)) return true;
  // HTML block elements (tables, divs, etc. — not just inline formatting)
  if (isHtml(content)) return true;
  return false;
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
            // Get the document's markdown for markdown-first matching strategy
            const originalMarkdown =
              useDiffReviewStore.getState().diffSession?.originalMarkdown || "";

            // Track cumulative markdown state for sequential edits.
            // Backend applies edits cumulatively: each edit N's old_str is validated
            // against the content AFTER edits 1..N-1 were applied.
            // We replicate this on the frontend so we can find old_str in the correct state.
            let cumulativeMarkdown = originalMarkdown;

            for (const hunk of pluginState.hunks) {
              // Skip non-pending hunks but still advance cumulative markdown
              if (hunk.status !== "pending") {
                if (hunk.oldContent && cumulativeMarkdown) {
                  const idx = cumulativeMarkdown.indexOf(hunk.oldContent);
                  if (idx !== -1) {
                    cumulativeMarkdown =
                      cumulativeMarkdown.slice(0, idx) +
                      (hunk.newContent || "") +
                      cumulativeMarkdown.slice(idx + hunk.oldContent.length);
                  }
                }
                continue;
              }

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
                // Primary strategy: "Apply and Diff" — replicate backend's markdown matching
                // Parses full documents (not fragments), so tables, code blocks, etc. always work
                let found = originalMarkdown
                  ? findTextViaMarkdown(
                      state.doc,
                      hunk.oldContent,
                      originalMarkdown,
                      usedPositions,
                      null,
                      state.schema
                    )
                  : null;

                // Try cumulative markdown for sequential edits
                // (backend applies edits sequentially, so edit N's old_str may only exist
                // in the content after edits 1..N-1 were applied)
                if (!found && cumulativeMarkdown && cumulativeMarkdown !== originalMarkdown) {
                  found = findTextViaMarkdown(
                    state.doc,
                    hunk.oldContent,
                    cumulativeMarkdown,
                    usedPositions,
                    null,
                    state.schema
                  );
                }

                // Fallback: fragment-based matching (when markdown strategies fail)
                if (!found) {
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

                  // Fallback strategy 1: Exact textContent match
                  found = findTextInDocument(
                    state.doc,
                    cached.textContent,
                    usedPositions,
                    cached.blockType
                  );

                  // Fallback strategy 2: searchText from hunk
                  if (!found && hunk.searchText && hunk.searchText !== cached.textContent) {
                    found = findTextInDocument(
                      state.doc,
                      hunk.searchText,
                      usedPositions,
                      cached.blockType
                    );
                  }

                  // Fallback strategy 3: Normalized whitespace
                  if (!found) {
                    found = findTextNormalized(
                      state.doc,
                      cached.textContent,
                      usedPositions,
                      cached.blockType
                    );
                  }
                }

                if (found) {
                  from = found.from;
                  to = found.to;
                  buttonPos = found.blockStart + 1;
                  usedPositions.add(from);
                  hunk.resolvedFrom = from;
                  hunk.resolvedTo = to;
                } else {
                  console.error(`[DiffReview] All matching strategies failed for hunk ${hunk.id}`, {
                    oldContent: hunk.oldContent?.slice(0, 200),
                    docTextLength: state.doc.textContent.length,
                    hasMarkdown: !!originalMarkdown,
                    hasCumulativeMarkdown: cumulativeMarkdown !== originalMarkdown,
                  });
                  // Advance cumulative markdown even for failed hunks
                  if (hunk.oldContent && cumulativeMarkdown) {
                    const idx = cumulativeMarkdown.indexOf(hunk.oldContent);
                    if (idx !== -1) {
                      cumulativeMarkdown =
                        cumulativeMarkdown.slice(0, idx) +
                        (hunk.newContent || "") +
                        cumulativeMarkdown.slice(idx + hunk.oldContent.length);
                    }
                  }
                  continue;
                }
              } else {
                // Insert mode (oldContent is empty): use stored position
                const docSize = state.doc.content.size;
                from = Math.max(0, Math.min(hunk.from, docSize));
                to = from;
                buttonPos = from;
              }

              const isFocused = pluginState.focusedHunkId === hunk.id;

              // Determine rendering mode based on hunk content
              const hasOldContent = !!hunk.oldContent && from < to;
              const hasNewContent = !!hunk.newContent;
              const isReplace = hasOldContent && hasNewContent;
              // Structured content (tables, mermaid, code blocks, HTML) falls back to
              // block-level rendering to preserve formatting
              const useBlockFallback =
                isStructuredContent(hunk.oldContent || "") ||
                isStructuredContent(hunk.newContent || "");

              if (isReplace && !hunk.isFullDocumentReplace && !useBlockFallback) {
                // --- Notion-style inline word-level diff (plain text only) ---
                // 1. Hide original text via inline decoration
                decorations.push(
                  Decoration.inline(from, to, {
                    class: isFocused
                      ? "diff-source-hidden diff-hunk-focused"
                      : "diff-source-hidden",
                    "data-hunk-id": hunk.id,
                  })
                );

                // 2. Show word-level diff widget at the start position
                decorations.push(
                  Decoration.widget(
                    from,
                    () => {
                      const widget = createInlineDiffWidget(hunk);
                      if (isFocused) widget.classList.add("diff-hunk-focused");
                      return widget;
                    },
                    {
                      side: -1,
                      key: `inline-diff-${hunk.id}`,
                    }
                  )
                );
              } else if (isReplace && !hunk.isFullDocumentReplace && useBlockFallback) {
                // --- Block fallback for structured content (tables, mermaid, code) ---
                // Strikethrough old content + insert widget with full markdown rendering
                // (createInsertWidget already has integrated hover accept/reject buttons)
                decorations.push(
                  Decoration.inline(from, to, {
                    class: isFocused ? "diff-deleted diff-hunk-focused" : "diff-deleted",
                    "data-hunk-id": hunk.id,
                  })
                );

                // Compute position AFTER the containing structural block (table, codeBlock, etc.)
                // so the insert widget renders below the block, not inside a cell
                let insertAfterPos = to;
                try {
                  const $to = state.doc.resolve(to);
                  for (let d = $to.depth; d >= 1; d--) {
                    const nodeName = $to.node(d).type.name;
                    if (nodeName === "table" || nodeName === "codeBlock") {
                      insertAfterPos = $to.after(d);
                      break;
                    }
                  }
                } catch {
                  /* keep default */
                }

                decorations.push(
                  Decoration.widget(
                    insertAfterPos,
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
              } else if (hasOldContent && !hasNewContent) {
                // --- Delete only: strikethrough with hover action buttons ---
                decorations.push(
                  Decoration.widget(
                    buttonPos,
                    () => {
                      const widget = createActionWidget(hunk);
                      if (isFocused) widget.classList.add("diff-hunk-focused");
                      return widget;
                    },
                    {
                      side: -1,
                      key: `actions-${hunk.id}`,
                    }
                  )
                );

                decorations.push(
                  Decoration.inline(from, to, {
                    class: isFocused ? "diff-deleted diff-hunk-focused" : "diff-deleted",
                    "data-hunk-id": hunk.id,
                  })
                );
              } else if (!hasOldContent && hasNewContent) {
                // --- Insert only: show insert widget with hover buttons ---
                decorations.push(
                  Decoration.widget(
                    from,
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
              } else if (hunk.isFullDocumentReplace) {
                // --- Full document replace: use insert widget for preview ---
                decorations.push(
                  Decoration.widget(
                    buttonPos,
                    () => {
                      const widget = createActionWidget(hunk);
                      if (isFocused) widget.classList.add("diff-hunk-focused");
                      return widget;
                    },
                    {
                      side: -1,
                      key: `actions-${hunk.id}`,
                    }
                  )
                );

                if (hasNewContent) {
                  decorations.push(
                    Decoration.widget(
                      buttonPos,
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

              // Advance cumulative markdown for subsequent hunks
              if (hunk.oldContent && cumulativeMarkdown) {
                const idx = cumulativeMarkdown.indexOf(hunk.oldContent);
                if (idx !== -1) {
                  cumulativeMarkdown =
                    cumulativeMarkdown.slice(0, idx) +
                    (hunk.newContent || "") +
                    cumulativeMarkdown.slice(idx + hunk.oldContent.length);
                }
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
            // Clear caches when diff session ends
            pmTextCache.clear();
            clearMarkdownCache();
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
              // Fallback: re-search (should rarely happen — resolvedFrom/To are usually set by decorations)
              // Primary: markdown-first "Apply and Diff"
              const diffSession = useDiffReviewStore.getState().diffSession;
              const acceptOriginalMarkdown = diffSession?.originalMarkdown || "";
              let found = acceptOriginalMarkdown
                ? findTextViaMarkdown(
                    state.doc,
                    hunk.oldContent,
                    acceptOriginalMarkdown,
                    undefined,
                    null,
                    state.schema
                  )
                : null;

              // Try cumulative markdown for sequential edits
              if (!found && acceptOriginalMarkdown && diffSession) {
                let cumMd = acceptOriginalMarkdown;
                for (const h of pluginState.hunks) {
                  if (h.id === hunk.id) break;
                  if (h.oldContent && cumMd) {
                    const idx = cumMd.indexOf(h.oldContent);
                    if (idx !== -1) {
                      cumMd =
                        cumMd.slice(0, idx) +
                        (h.newContent || "") +
                        cumMd.slice(idx + h.oldContent.length);
                    }
                  }
                }
                if (cumMd !== acceptOriginalMarkdown) {
                  found = findTextViaMarkdown(
                    state.doc,
                    hunk.oldContent,
                    cumMd,
                    undefined,
                    null,
                    state.schema
                  );
                }
              }

              // Fallback: fragment-based matching
              if (!found) {
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
                found = findTextInDocument(
                  state.doc,
                  cached.textContent,
                  undefined,
                  cached.blockType
                );
                if (!found) {
                  found = findTextNormalized(
                    state.doc,
                    cached.textContent,
                    undefined,
                    cached.blockType
                  );
                }
              }
              if (found) {
                from = found.from;
                to = found.to;
              } else {
                console.error(
                  `[DiffReview] Accept: all matching strategies failed for hunk ${hunk.id}`
                );
                return false;
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

          // Collapse cursor to avoid selecting the next block
          try {
            const cursorPos = Math.min(tr.mapping.map(from), tr.doc.content.size);
            tr.setSelection(TextSelection.create(tr.doc, cursorPos));
          } catch {
            // Position may be invalid after complex replacements — leave default
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
