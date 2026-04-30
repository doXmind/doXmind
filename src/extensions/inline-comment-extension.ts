/**
 * Inline Comment Extension for TipTap
 *
 * Renders text-anchored note highlights as ProseMirror Decorations.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// ---- Types ----

export interface InlineCommentData {
  id: string;
  from: number;
  to: number;
  text: string;
  isResolved: boolean;
}

interface InlineCommentPluginState {
  comments: InlineCommentData[];
  activeCommentId: string | null;
  decorations: DecorationSet;
}

interface InlineCommentMeta {
  type: "setComments" | "setActive";
  comments?: InlineCommentData[];
  activeId?: string | null;
}

// ---- Plugin Key ----

export const InlineCommentPluginKey = new PluginKey<InlineCommentPluginState>("inlineComment");

// ---- Command type augmentation ----

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineComment: {
      setInlineComments: (comments: InlineCommentData[]) => ReturnType;
      setActiveInlineComment: (commentId: string | null) => ReturnType;
    };
  }
}

// ---- Extension ----

export interface InlineCommentOptions {
  onCommentClick?: (commentId: string) => void;
}

export const InlineCommentExtension = Extension.create<InlineCommentOptions>({
  name: "inlineComment",

  addOptions() {
    return {
      onCommentClick: undefined,
    };
  },

  addCommands() {
    return {
      setInlineComments:
        (comments: InlineCommentData[]) =>
        ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
          if (dispatch) {
            tr.setMeta(InlineCommentPluginKey, {
              type: "setComments",
              comments,
            } satisfies InlineCommentMeta);
            dispatch(tr);
          }
          return true;
        },
      setActiveInlineComment:
        (commentId: string | null) =>
        ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
          if (dispatch) {
            tr.setMeta(InlineCommentPluginKey, {
              type: "setActive",
              activeId: commentId,
            } satisfies InlineCommentMeta);
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const extensionOptions = this.options;

    return [
      new Plugin<InlineCommentPluginState>({
        key: InlineCommentPluginKey,

        state: {
          init: () => ({
            comments: [],
            activeCommentId: null,
            decorations: DecorationSet.empty,
          }),

          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(InlineCommentPluginKey) as InlineCommentMeta | undefined;

            let comments = value.comments;
            let activeId = value.activeCommentId;
            let needsRebuild = false;

            if (meta) {
              if (meta.type === "setComments" && meta.comments) {
                comments = meta.comments;
                needsRebuild = true;
              }
              if (meta.type === "setActive") {
                activeId = meta.activeId ?? null;
                needsRebuild = true;
              }
            }

            // If document changed, map decorations
            if (!needsRebuild && tr.docChanged) {
              return {
                comments,
                activeCommentId: activeId,
                decorations: value.decorations.map(tr.mapping, tr.doc),
              };
            }

            if (needsRebuild) {
              const docSize = newState.doc.content.size;
              const decorations: Decoration[] = [];

              for (const comment of comments) {
                if (comment.from < 0 || comment.to > docSize || comment.from >= comment.to) {
                  continue;
                }

                const isActive = comment.id === activeId;
                const cssClass = [
                  "inline-comment-highlight",
                  isActive ? "inline-comment-active" : "",
                  comment.isResolved ? "inline-comment-resolved" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                decorations.push(
                  Decoration.inline(comment.from, comment.to, {
                    class: cssClass,
                    "data-comment-id": comment.id,
                  })
                );
              }

              return {
                comments,
                activeCommentId: activeId,
                decorations: DecorationSet.create(newState.doc, decorations),
              };
            }

            return value;
          },
        },

        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },

          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement;
            const commentEl = target.closest("[data-comment-id]");
            if (commentEl) {
              const commentId = commentEl.getAttribute("data-comment-id");
              if (commentId && extensionOptions.onCommentClick) {
                extensionOptions.onCommentClick(commentId);
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});
