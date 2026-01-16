/**
 * Autocomplete Extension for TipTap
 *
 * Displays ghost text (inline suggestions) at the cursor position
 * using ProseMirror's Decoration system.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Plugin state interface
export interface AutocompletePluginState {
  suggestion: string | null;
  position: number | null;
}

// Plugin key for accessing state
export const AutocompletePluginKey = new PluginKey<AutocompletePluginState>("autocomplete");

// Declare custom commands for TypeScript
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    autocomplete: {
      /**
       * Set the autocomplete suggestion
       */
      setSuggestion: (suggestion: string | null) => ReturnType;
      /**
       * Accept the full suggestion
       */
      acceptSuggestion: () => ReturnType;
      /**
       * Accept one word from the suggestion
       */
      acceptWordSuggestion: () => ReturnType;
      /**
       * Clear the suggestion
       */
      clearSuggestion: () => ReturnType;
    };
  }
}

export const AutocompleteExtension = Extension.create({
  name: "autocomplete",

  addProseMirrorPlugins() {
    const _editor = this.editor;

    return [
      new Plugin<AutocompletePluginState>({
        key: AutocompletePluginKey,

        state: {
          init: () => ({
            suggestion: null,
            position: null,
          }),

          apply(tr, value) {
            // Check for meta updates
            const meta = tr.getMeta(AutocompletePluginKey);
            if (meta !== undefined) {
              return meta;
            }

            // Clear suggestion if document changed (user is typing)
            if (tr.docChanged) {
              return { suggestion: null, position: null };
            }

            // Clear suggestion if selection changed significantly
            if (tr.selectionSet && value.position !== null) {
              const newPos = tr.selection.from;
              // If cursor moved away from suggestion position, clear it
              if (newPos !== value.position) {
                return { suggestion: null, position: null };
              }
            }

            return value;
          },
        },

        props: {
          decorations(state) {
            const pluginState = this.getState(state);
            const decorations: Decoration[] = [];

            // Show ghost text if there's a suggestion
            if (pluginState?.suggestion && pluginState.position !== null) {
              const ghostWidget = Decoration.widget(
                pluginState.position,
                () => {
                  const span = document.createElement("span");
                  span.className = "autocomplete-ghost-text";
                  span.textContent = pluginState.suggestion;
                  // Prevent the ghost text from being selected
                  span.setAttribute("contenteditable", "false");
                  return span;
                },
                {
                  side: 1, // Show after the cursor
                  key: "autocomplete-ghost",
                }
              );
              decorations.push(ghostWidget);
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
      setSuggestion:
        (suggestion: string | null) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            const pos = tr.selection.from;
            tr.setMeta(AutocompletePluginKey, {
              suggestion,
              position: suggestion ? pos : null,
            });
            dispatch(tr);
          }
          return true;
        },

      acceptSuggestion:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = AutocompletePluginKey.getState(state);

          if (!pluginState?.suggestion || !dispatch) {
            return false;
          }

          // Insert the suggestion text at cursor position
          tr.insertText(pluginState.suggestion, tr.selection.from);

          // Clear the suggestion
          tr.setMeta(AutocompletePluginKey, {
            suggestion: null,
            position: null,
          });

          dispatch(tr);
          return true;
        },

      acceptWordSuggestion:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = AutocompletePluginKey.getState(state);

          if (!pluginState?.suggestion || !dispatch) {
            return false;
          }

          // Extract first word (including trailing space if present)
          const match = pluginState.suggestion.match(/^\S+\s*/);
          if (!match) {
            return false;
          }

          const word = match[0];
          const remaining = pluginState.suggestion.slice(word.length);

          // Insert the word
          const insertPos = tr.selection.from;
          tr.insertText(word, insertPos);

          // Update suggestion with remaining text
          tr.setMeta(AutocompletePluginKey, {
            suggestion: remaining || null,
            position: remaining ? insertPos + word.length : null,
          });

          dispatch(tr);
          return true;
        },

      clearSuggestion:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(AutocompletePluginKey, {
              suggestion: null,
              position: null,
            });
            dispatch(tr);
          }
          return true;
        },
    };
  },
});

/**
 * Helper function to get current suggestion from editor state
 */
export function getSuggestion(editor: { state: { doc: unknown } } | null): string | null {
  if (!editor) return null;
  const pluginState = AutocompletePluginKey.getState(
    editor.state as Parameters<typeof AutocompletePluginKey.getState>[0]
  );
  return pluginState?.suggestion ?? null;
}

/**
 * Helper function to check if there's an active suggestion
 */
export function hasSuggestion(editor: { state: { doc: unknown } } | null): boolean {
  return getSuggestion(editor) !== null;
}
