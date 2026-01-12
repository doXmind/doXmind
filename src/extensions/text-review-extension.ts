/**
 * Text Review Extension for TipTap
 *
 * Displays AI-generated writing suggestions with color-coded underlines
 * based on category (correctness, clarity, tone, engagement).
 * Similar to Grammarly's suggestion system.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Category color mapping (Grammarly-inspired)
export const REVIEW_CATEGORIES = {
  correctness: {
    color: "#EF4444", // red
    label: "Correctness",
    description: "Grammar, spelling, punctuation",
  },
  clarity: {
    color: "#3B82F6", // blue
    label: "Clarity",
    description: "Conciseness, readability",
  },
  tone: {
    color: "#8B5CF6", // purple
    label: "Tone",
    description: "Formality, politeness",
  },
  engagement: {
    color: "#22C55E", // green
    label: "Engagement",
    description: "Word choice, variety",
  },
} as const;

export type ReviewCategory = keyof typeof REVIEW_CATEGORIES;

export interface ReviewSuggestion {
  id: string;
  category: ReviewCategory;
  type: string;
  from: number; // ProseMirror position
  to: number;
  originalText: string;
  replacement: string;
  explanation: string;
  status: "pending" | "accepted" | "dismissed";
}

export interface TextReviewPluginState {
  suggestions: ReviewSuggestion[];
  isActive: boolean;
  isLoading: boolean;
  activeSuggestionId: string | null; // For highlighting in panel
  summary: string | null;
}

export const TextReviewPluginKey = new PluginKey<TextReviewPluginState>(
  "textReview"
);

// Declare custom commands for TypeScript
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textReview: {
      setReviewSuggestions: (
        suggestions: ReviewSuggestion[],
        summary?: string
      ) => ReturnType;
      clearReview: () => ReturnType;
      acceptSuggestion: (id: string) => ReturnType;
      dismissSuggestion: (id: string) => ReturnType;
      acceptAllSuggestions: () => ReturnType;
      dismissAllSuggestions: () => ReturnType;
      setActiveSuggestion: (id: string | null) => ReturnType;
      setReviewLoading: (loading: boolean) => ReturnType;
    };
  }
}

export interface TextReviewExtensionOptions {
  // Options can be added here in the future
}

export const TextReviewExtension =
  Extension.create<TextReviewExtensionOptions>({
    name: "textReview",

    addStorage() {
      return {
        suggestions: [] as ReviewSuggestion[],
        isActive: false,
        isLoading: false,
        summary: null as string | null,
      };
    },

    addProseMirrorPlugins() {
      const { storage } = this;

      return [
        new Plugin<TextReviewPluginState>({
          key: TextReviewPluginKey,

          state: {
            init: () => ({
              suggestions: [],
              isActive: false,
              isLoading: false,
              activeSuggestionId: null,
              summary: null,
            }),

            apply(tr, value) {
              const meta = tr.getMeta(TextReviewPluginKey);
              if (meta) {
                const newState = { ...value, ...meta };
                // Update storage for external access
                storage.suggestions = newState.suggestions;
                storage.isActive = newState.isActive;
                storage.isLoading = newState.isLoading;
                storage.summary = newState.summary;
                return newState;
              }

              // Map positions when document changes
              if (tr.docChanged && value.suggestions.length > 0) {
                const mappedSuggestions = value.suggestions
                  .map((s) => ({
                    ...s,
                    from: tr.mapping.map(s.from),
                    to: tr.mapping.map(s.to),
                  }))
                  .filter((s) => s.from < s.to && s.status === "pending");

                const newState = { ...value, suggestions: mappedSuggestions };
                storage.suggestions = mappedSuggestions;
                return newState;
              }

              return value;
            },
          },

          props: {
            decorations(state) {
              const pluginState = this.getState(state);
              if (
                !pluginState?.isActive ||
                pluginState.suggestions.length === 0
              ) {
                return DecorationSet.empty;
              }

              const decorations: Decoration[] = [];

              for (const suggestion of pluginState.suggestions) {
                if (suggestion.status !== "pending") continue;
                if (suggestion.from >= suggestion.to) continue;
                if (suggestion.to > state.doc.content.size) continue;

                const category = REVIEW_CATEGORIES[suggestion.category];
                const isActive =
                  suggestion.id === pluginState.activeSuggestionId;

                decorations.push(
                  Decoration.inline(suggestion.from, suggestion.to, {
                    class: `review-suggestion review-${suggestion.category}${isActive ? " review-active" : ""}`,
                    "data-review-id": suggestion.id,
                    "data-review-category": suggestion.category,
                    style: `text-decoration: underline wavy ${category.color}; text-underline-offset: 3px; cursor: pointer;`,
                  })
                );
              }

              return DecorationSet.create(state.doc, decorations);
            },
          },
        }),
      ];
    },

    // @ts-expect-error TipTap command types are overly strict about parameter unions
    addCommands() {
      return {
        setReviewSuggestions:
          (suggestions: ReviewSuggestion[], summary?: string) =>
          ({ tr, dispatch }) => {
            if (dispatch) {
              tr.setMeta(TextReviewPluginKey, {
                suggestions,
                isActive: suggestions.length > 0,
                isLoading: false,
                activeSuggestionId: null,
                summary: summary || null,
              });
              dispatch(tr);
            }
            return true;
          },

        clearReview:
          () =>
          ({ tr, dispatch }) => {
            if (dispatch) {
              tr.setMeta(TextReviewPluginKey, {
                suggestions: [],
                isActive: false,
                isLoading: false,
                activeSuggestionId: null,
                summary: null,
              });
              dispatch(tr);
            }
            return true;
          },

        acceptSuggestion:
          (id: string) =>
          ({ tr, state, dispatch }) => {
            if (!dispatch) return true;

            const pluginState = TextReviewPluginKey.getState(state);
            if (!pluginState) return true;

            const suggestion = pluginState.suggestions.find((s) => s.id === id);
            if (!suggestion || suggestion.status !== "pending") return true;

            // Validate positions
            if (
              suggestion.from < 0 ||
              suggestion.to > state.doc.content.size ||
              suggestion.from >= suggestion.to
            ) {
              return true;
            }

            // Apply the replacement
            tr.insertText(suggestion.replacement, suggestion.from, suggestion.to);

            // Map positions for all OTHER suggestions using tr.mapping
            // This is critical because insertText changes document positions
            const updated = pluginState.suggestions
              .map((s) => {
                if (s.id === id) {
                  // Mark the accepted suggestion
                  return { ...s, status: "accepted" as const };
                }
                // Map positions for other suggestions
                const newFrom = tr.mapping.map(s.from);
                const newTo = tr.mapping.map(s.to);
                return { ...s, from: newFrom, to: newTo };
              })
              .filter((s) => s.status !== "pending" || s.from < s.to);

            tr.setMeta(TextReviewPluginKey, {
              ...pluginState,
              suggestions: updated,
              isActive: updated.some((s) => s.status === "pending"),
            });

            dispatch(tr);
            return true;
          },

        dismissSuggestion:
          (id: string) =>
          ({ tr, state, dispatch }) => {
            if (!dispatch) return true;

            const pluginState = TextReviewPluginKey.getState(state);
            if (!pluginState) return true;

            const updated = pluginState.suggestions.map((s) =>
              s.id === id ? { ...s, status: "dismissed" as const } : s
            );

            tr.setMeta(TextReviewPluginKey, {
              ...pluginState,
              suggestions: updated,
              isActive: updated.some((s) => s.status === "pending"),
            });

            dispatch(tr);
            return true;
          },

        acceptAllSuggestions:
          () =>
          ({ tr, state, dispatch }) => {
            if (!dispatch) return true;

            const pluginState = TextReviewPluginKey.getState(state);
            if (!pluginState) return true;

            // Get pending suggestions sorted by position (reverse order to handle shifts)
            const pending = pluginState.suggestions
              .filter((s) => s.status === "pending")
              .sort((a, b) => b.from - a.from);

            // Apply all replacements
            for (const suggestion of pending) {
              if (
                suggestion.from >= 0 &&
                suggestion.to <= tr.doc.content.size &&
                suggestion.from < suggestion.to
              ) {
                tr.insertText(
                  suggestion.replacement,
                  suggestion.from,
                  suggestion.to
                );
              }
            }

            // Mark all as accepted
            const updated = pluginState.suggestions.map((s) =>
              s.status === "pending" ? { ...s, status: "accepted" as const } : s
            );

            tr.setMeta(TextReviewPluginKey, {
              ...pluginState,
              suggestions: updated,
              isActive: false,
            });

            dispatch(tr);
            return true;
          },

        dismissAllSuggestions:
          () =>
          ({ tr, state, dispatch }) => {
            if (!dispatch) return true;

            const pluginState = TextReviewPluginKey.getState(state);
            if (!pluginState) return true;

            const updated = pluginState.suggestions.map((s) =>
              s.status === "pending"
                ? { ...s, status: "dismissed" as const }
                : s
            );

            tr.setMeta(TextReviewPluginKey, {
              ...pluginState,
              suggestions: updated,
              isActive: false,
            });

            dispatch(tr);
            return true;
          },

        setActiveSuggestion:
          (id: string | null) =>
          ({ tr, state, dispatch }) => {
            if (!dispatch) return true;

            const pluginState = TextReviewPluginKey.getState(state);
            if (!pluginState) return true;

            tr.setMeta(TextReviewPluginKey, {
              ...pluginState,
              activeSuggestionId: id,
            });

            dispatch(tr);
            return true;
          },

        setReviewLoading:
          (loading: boolean) =>
          ({ tr, state, dispatch }) => {
            if (!dispatch) return true;

            const pluginState = TextReviewPluginKey.getState(state);

            tr.setMeta(TextReviewPluginKey, {
              ...(pluginState || {
                suggestions: [],
                isActive: false,
                activeSuggestionId: null,
                summary: null,
              }),
              isLoading: loading,
            });

            dispatch(tr);
            return true;
          },
      };
    },
  });

/**
 * Helper function to get review state from editor
 */
export function getReviewState(
  editor: { state: Parameters<typeof TextReviewPluginKey.getState>[0] } | null
): TextReviewPluginState | null {
  if (!editor) return null;
  return TextReviewPluginKey.getState(editor.state) ?? null;
}

/**
 * Helper function to get pending suggestion count
 */
export function getPendingSuggestionCount(
  editor: { state: Parameters<typeof TextReviewPluginKey.getState>[0] } | null
): number {
  const state = getReviewState(editor);
  if (!state) return 0;
  return state.suggestions.filter((s) => s.status === "pending").length;
}
