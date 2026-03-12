/**
 * Diff Review Extension for TipTap
 *
 * Displays inline diff hunks with accept/reject buttons.
 * Similar to Cursor's code review experience.
 */

import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Slice } from "@tiptap/pm/model";
import type { DiffHunk } from "@/types/diff";
import { isHtml } from "@/lib/markdown";
import { findInMarkdown } from "@/lib/diff-utils";

import { DiffReviewPluginKey, type DiffReviewPluginState } from "./diff-types";
import {
  findTextInDocument,
  findTextViaMarkdown,
  findAtomNode,
  findTextFuzzy,
  clearMarkdownCache,
} from "./position-mapping";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { createInsertWidget, createActionWidget, createInlineDiffWidget } from "./diff-widgets";

// Re-export types for external use
export * from "./diff-types";
export {
  findTextInDocument,
  findAllTextInDocument,
  findTextViaMarkdown,
  clearMarkdownCache,
} from "./position-mapping";
export { createInsertWidget, createActionWidget, createInlineDiffWidget } from "./diff-widgets";

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
  // Block math ($$...$$) — atom nodes that would be garbled by inline word diff
  if (/\$\$[\s\S]*?\$\$/.test(content)) return true;
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

            // Advance cumulative base past accepted hunks.
            // After accepting hunks (which modifies the document), the plugin state
            // only contains pending hunks. But cumulativeMarkdown must reflect accepted
            // changes so remaining pending hunks can be correctly matched.
            const allSessionHunks = useDiffReviewStore.getState().diffSession?.hunks || [];
            for (const sh of allSessionHunks) {
              if (sh.status === "accepted" && sh.oldContent && cumulativeMarkdown) {
                const idx = findInMarkdown(cumulativeMarkdown, sh.oldContent, sh.markdownOffset);
                if (idx !== -1) {
                  cumulativeMarkdown =
                    cumulativeMarkdown.slice(0, idx) +
                    (sh.newContent || "") +
                    cumulativeMarkdown.slice(idx + sh.oldContent.length);
                }
              }
            }

            for (const hunk of pluginState.hunks) {
              // Skip non-pending hunks but still advance cumulative markdown
              if (hunk.status !== "pending") {
                if (hunk.oldContent && cumulativeMarkdown) {
                  const idx = findInMarkdown(
                    cumulativeMarkdown,
                    hunk.oldContent,
                    hunk.markdownOffset
                  );
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
                buttonPos = 0; // Place before first block node (not inside it)
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
                      state.schema,
                      hunk.markdownOffset
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
                    state.schema,
                    hunk.markdownOffset
                  );
                }

                // Fallback: parse via @tiptap/markdown and search by textContent or atom attrs
                if (!found) {
                  const editor = useEditorRefStore.getState().editor;
                  if (editor?.markdown) {
                    const json = editor.markdown.parse(hunk.oldContent);
                    const fragmentDoc = state.schema.nodeFromJSON(json);
                    const searchText = fragmentDoc.textContent;
                    if (searchText) {
                      found = findTextInDocument(state.doc, searchText, usedPositions);
                    } else {
                      // Atom node (mermaid, blockMath, inlineMath) — no textContent.
                      // Search the actual editor doc for a matching node by type + attributes.
                      found = findAtomNode(state.doc, fragmentDoc, usedPositions);
                    }
                  }
                }

                // Tier 4: Fuzzy whitespace-normalised matching
                if (!found) {
                  found = findTextFuzzy(state.doc, hunk.oldContent, usedPositions);
                }

                if (found) {
                  from = found.from;
                  to = found.to;
                  buttonPos = found.blockStart + 1;
                  usedPositions.add(from);
                  hunk.resolvedFrom = from;
                  hunk.resolvedTo = to;
                } else {
                  console.warn(`[DiffReview] All matching strategies failed for hunk ${hunk.id}`, {
                    oldContent: hunk.oldContent?.slice(0, 200),
                    docTextLength: state.doc.textContent.length,
                    hasMarkdown: !!originalMarkdown,
                    hasCumulativeMarkdown: cumulativeMarkdown !== originalMarkdown,
                  });
                  hunk.matchFailed = true;

                  // Show user-visible warning widget at document start
                  const warningPos = Math.min(1, state.doc.content.size);
                  const preview = (hunk.oldContent || "").slice(0, 80).replace(/\n/g, " ");
                  const truncated = hunk.oldContent && hunk.oldContent.length > 80;

                  decorations.push(
                    Decoration.widget(
                      warningPos,
                      () => {
                        const widget = document.createElement("div");
                        widget.className = "diff-match-failed-notice";
                        widget.innerHTML =
                          '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin:4px 0;' +
                          "border-radius:6px;border:1px solid var(--amber-200, #fde68a);" +
                          'background:var(--amber-50, #fffbeb);font-size:13px;">' +
                          '<span style="color:var(--amber-600, #d97706);flex-shrink:0;">&#9888;</span>' +
                          '<span style="flex:1;color:var(--amber-800, #92400e);overflow:hidden;' +
                          'text-overflow:ellipsis;white-space:nowrap;">Could not locate: &quot;' +
                          preview.replace(/</g, "&lt;").replace(/>/g, "&gt;") +
                          (truncated ? "\u2026" : "") +
                          "&quot;</span>" +
                          '<button type="button" class="diff-match-skip-btn" data-hunk-id="' +
                          hunk.id +
                          '" style="padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500;' +
                          "cursor:pointer;border:none;background:var(--amber-200, #fde68a);" +
                          'color:var(--amber-900, #78350f);">Skip</button>' +
                          "</div>";

                        const skipBtn = widget.querySelector(".diff-match-skip-btn");
                        if (skipBtn) {
                          skipBtn.addEventListener("click", (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            document.dispatchEvent(
                              new CustomEvent("diff-reject", { detail: { hunkId: hunk.id } })
                            );
                          });
                        }
                        return widget;
                      },
                      { side: -1, key: `match-failed-${hunk.id}` }
                    )
                  );

                  // Advance cumulative markdown even for failed hunks
                  if (hunk.oldContent && cumulativeMarkdown) {
                    const idx = findInMarkdown(
                      cumulativeMarkdown,
                      hunk.oldContent,
                      hunk.markdownOffset
                    );
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
              // Atom block nodes (database, mermaid, math, bookmark, etc.) need
              // Decoration.node() — Decoration.inline() doesn't work on ReactNodeViewRenderer atoms
              const nodeAtHunkStart = hasOldContent ? state.doc.nodeAt(from) : null;
              const coversAtomBlock = !!(nodeAtHunkStart?.isAtom && nodeAtHunkStart?.isBlock);
              // Structured content (tables, mermaid, code blocks, HTML) falls back to
              // block-level rendering to preserve formatting
              const useBlockFallback =
                coversAtomBlock ||
                isStructuredContent(hunk.oldContent || "") ||
                isStructuredContent(hunk.newContent || "");

              if (isReplace && !hunk.isFullDocumentReplace && !useBlockFallback) {
                // --- Notion-style inline word-level diff ---
                // 1. Hide original text via inline decoration
                //    ProseMirror auto-clips at block boundaries, applying to each block separately
                decorations.push(
                  Decoration.inline(from, to, {
                    class: isFocused
                      ? "diff-source-hidden diff-hunk-focused"
                      : "diff-source-hidden",
                    "data-hunk-id": hunk.id,
                  })
                );

                // 2. Show word-level diff widget
                //    For multi-block hunks: place BEFORE the first block so all blocks
                //    collapse (no widget inside → CSS :has() rule hides them)
                //    For single-block hunks: place inside the block at `from`
                const $fromR = state.doc.resolve(from);
                const $toR = state.doc.resolve(to);
                const isMultiBlock = $fromR.parent !== $toR.parent;
                const widgetPos = isMultiBlock ? buttonPos - 1 : from;

                decorations.push(
                  Decoration.widget(
                    widgetPos,
                    () => {
                      const widget = createInlineDiffWidget(hunk);
                      if (isFocused) widget.classList.add("diff-hunk-focused");
                      if (isMultiBlock) widget.classList.add("diff-structured");
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

                // Check if range covers an atom block node (mermaid chart, block math, etc.)
                // Inline decorations don't visually affect NodeViews rendered by ReactNodeViewRenderer,
                // so we use Decoration.node() which applies class to the outermost wrapper DOM element.
                const nodeAtFrom = state.doc.nodeAt(from);
                const isAtomBlock = nodeAtFrom?.isAtom && nodeAtFrom?.isBlock;

                if (isAtomBlock) {
                  decorations.push(
                    Decoration.node(from, from + nodeAtFrom.nodeSize, {
                      class: isFocused ? "diff-deleted diff-hunk-focused" : "diff-deleted",
                      "data-hunk-id": hunk.id,
                    })
                  );
                } else {
                  decorations.push(
                    Decoration.inline(from, to, {
                      class: isFocused ? "diff-deleted diff-hunk-focused" : "diff-deleted",
                      "data-hunk-id": hunk.id,
                    })
                  );
                }

                // Compute position AFTER the containing structural block (table, codeBlock, etc.)
                // so the insert widget renders below the block, not inside a cell
                let insertAfterPos = to;
                try {
                  const $to = state.doc.resolve(to);
                  for (let d = $to.depth; d >= 1; d--) {
                    const ancestorNode = $to.node(d);
                    if (
                      ancestorNode.type.name === "table" ||
                      ancestorNode.type.name === "codeBlock" ||
                      ancestorNode.isAtom // all atom blocks (mermaid, math, database, bookmark, etc.)
                    ) {
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

                // Check if range covers an atom block node (mermaid chart, block math, etc.)
                const delNodeAtFrom = state.doc.nodeAt(from);
                const isDelAtomBlock = delNodeAtFrom?.isAtom && delNodeAtFrom?.isBlock;

                if (isDelAtomBlock) {
                  decorations.push(
                    Decoration.node(from, from + delNodeAtFrom.nodeSize, {
                      class: isFocused ? "diff-deleted diff-hunk-focused" : "diff-deleted",
                      "data-hunk-id": hunk.id,
                    })
                  );
                } else {
                  decorations.push(
                    Decoration.inline(from, to, {
                      class: isFocused ? "diff-deleted diff-hunk-focused" : "diff-deleted",
                      "data-hunk-id": hunk.id,
                    })
                  );
                }
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
                // --- Full document replace: inline word-level diff ---
                // Show the same Notion-style word diff used for partial edits
                decorations.push(
                  Decoration.widget(
                    buttonPos,
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

                // Hide all existing document content (the widget shows the diff)
                state.doc.forEach((node, offset) => {
                  decorations.push(
                    Decoration.node(offset, offset + node.nodeSize, {
                      class: "diff-block-collapsed",
                      "data-hunk-id": hunk.id,
                    })
                  );
                });
              }

              // Advance cumulative markdown for subsequent hunks
              if (hunk.oldContent && cumulativeMarkdown) {
                const idx = findInMarkdown(
                  cumulativeMarkdown,
                  hunk.oldContent,
                  hunk.markdownOffset
                );
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
                    state.schema,
                    hunk.markdownOffset
                  )
                : null;

              // Try cumulative markdown for sequential edits.
              // Read full hunk list from Zustand store (includes accepted/rejected hunks
              // that were removed from plugin state by the useEffect sync).
              if (!found && acceptOriginalMarkdown && diffSession) {
                let cumMd = acceptOriginalMarkdown;
                const allHunks = diffSession.hunks;
                for (const h of allHunks) {
                  if (h.id === hunk.id) break;
                  if (h.status === "rejected") continue; // rejected = no change applied
                  if (h.oldContent && cumMd) {
                    const idx = findInMarkdown(cumMd, h.oldContent, h.markdownOffset);
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
                    state.schema,
                    hunk.markdownOffset
                  );
                }
              }

              // Fallback: parse via @tiptap/markdown and search by textContent or atom attrs
              if (!found) {
                const editor = useEditorRefStore.getState().editor;
                if (editor?.markdown) {
                  const json = editor.markdown.parse(hunk.oldContent);
                  const fragmentDoc = state.schema.nodeFromJSON(json);
                  const searchText = fragmentDoc.textContent;
                  if (searchText) {
                    found = findTextInDocument(state.doc, searchText);
                  } else {
                    // Atom node (mermaid, blockMath, inlineMath) — search by type + attrs
                    found = findAtomNode(state.doc, fragmentDoc);
                  }
                }
              }
              // Tier 4: Fuzzy whitespace-normalised matching
              if (!found) {
                found = findTextFuzzy(state.doc, hunk.oldContent);
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
            const editor = useEditorRefStore.getState().editor;

            if (hunk.isFullDocumentReplace) {
              // Full document replacement via @tiptap/markdown parser
              if (editor?.markdown) {
                const json = editor.markdown.parse(newContent);
                const parsed = state.schema.nodeFromJSON(json);
                if (parsed.content.size > 0) {
                  tr.replaceWith(0, state.doc.content.size, parsed.content);
                }
              }
            } else {
              const $from = state.doc.resolve(from);
              const isInCodeBlock = $from.parent.type.name === "codeBlock";

              // Expand range to structural block boundaries (table, codeBlock, etc.)
              // so replacing a table doesn't nest the new table inside the old one
              let blockFrom = from;
              let blockTo = to;
              let isStructuralBlock = false;
              try {
                for (let d = $from.depth; d >= 1; d--) {
                  const nodeName = $from.node(d).type.name;
                  if (nodeName === "table" || nodeName === "codeBlock") {
                    blockFrom = $from.before(d);
                    blockTo = $from.after(d);
                    isStructuralBlock = true;
                    break;
                  }
                }
              } catch {
                /* keep defaults */
              }

              if (isInCodeBlock) {
                // Code block: plain text replacement (strip markdown fences)
                const code = newContent.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
                tr.replaceWith(from, to, state.schema.text(code));
              } else if (editor?.markdown) {
                // Parse new content via @tiptap/markdown — schema-aware, no HTML roundtrip
                const json = editor.markdown.parse(newContent);
                const parsed = state.schema.nodeFromJSON(json);

                if (parsed.content.size > 0) {
                  // For multi-block replacements, expand to block boundaries
                  // to avoid leaving empty block shells after replaceRange splits
                  if (!isStructuralBlock && parsed.content.childCount > 1) {
                    try {
                      const $f = state.doc.resolve(from);
                      const $t = state.doc.resolve(to);
                      blockFrom = $f.before($f.depth);
                      blockTo = $t.after($t.depth);
                      isStructuralBlock = true;
                    } catch {
                      /* keep defaults */
                    }
                  }

                  if (isStructuralBlock) {
                    // Replace the entire structural block to avoid nesting/empty lines
                    tr.replaceWith(blockFrom, blockTo, parsed.content);
                  } else {
                    // Use replaceRange — ProseMirror's built-in smart replacement
                    tr.replaceRange(from, to, new Slice(parsed.content, 0, 0));
                  }
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
