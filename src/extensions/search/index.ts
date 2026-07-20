/**
 * Search and Replace Extension for TipTap
 *
 * Provides keyword search with highlighting and replace.
 */

import { Extension } from "@tiptap/core";
import { Plugin, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { scrollToPosition } from "@/lib/editor-utils";

import {
  SearchPluginKey,
  type SearchPluginState,
  type SearchExtensionOptions,
  type SearchRange,
} from "./search-types";

import { processSearches } from "./search-algorithms";

// Re-export types for external use
export * from "./search-types";
export { processSearches } from "./search-algorithms";

/**
 * Swap a matched range for the replacement text.
 *
 * A match may span several text nodes with different marks. The replacement is
 * a single text node, so it cannot reproduce that split; it inherits the marks
 * of the first character of the match. Replacing "needle" in `**nee**dle` gives
 * a fully bold "pin" — the alternative (dropping marks entirely) loses more.
 */
function replaceRange(
  tr: Transaction,
  state: EditorState,
  range: SearchRange,
  replaceTerm: string
): void {
  if (!replaceTerm) {
    tr.delete(range.from, range.to);
    return;
  }
  const marks = state.doc.nodeAt(range.from)?.marks ?? [];
  tr.replaceWith(range.from, range.to, state.schema.text(replaceTerm, marks));
}

export const SearchExtension = Extension.create<SearchExtensionOptions>({
  name: "search",

  addOptions() {
    return {
      searchResultClass: "search-result",
      currentResultClass: "search-result-current",
    };
  },

  addStorage() {
    return {
      searchTerm: "",
      replaceTerm: "",
      currentIndex: 0,
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      resultsCount: 0,
    };
  },

  addProseMirrorPlugins() {
    const { options, storage } = this;

    return [
      new Plugin<SearchPluginState>({
        key: SearchPluginKey,

        state: {
          init: () => ({
            searchTerm: "",
            replaceTerm: "",
            results: [],
            currentIndex: 0,
            caseSensitive: false,
            wholeWord: false,
            useRegex: false,
          }),

          apply(tr, value, _oldState, editorState) {
            const meta = tr.getMeta(SearchPluginKey);

            if (meta) {
              const updatedSearchTerm =
                meta.searchTerm !== undefined ? meta.searchTerm : value.searchTerm;
              const updatedCaseSensitive =
                meta.caseSensitive !== undefined ? meta.caseSensitive : value.caseSensitive;
              const updatedWholeWord =
                meta.wholeWord !== undefined ? meta.wholeWord : value.wholeWord;
              const updatedUseRegex = meta.useRegex !== undefined ? meta.useRegex : value.useRegex;

              let updatedResults = value.results;
              let updatedIndex = value.currentIndex;

              // Recalculate keyword results
              if (
                meta.searchTerm !== undefined ||
                meta.caseSensitive !== undefined ||
                meta.wholeWord !== undefined ||
                meta.useRegex !== undefined ||
                tr.docChanged
              ) {
                updatedResults = processSearches(
                  editorState.doc,
                  updatedSearchTerm,
                  updatedCaseSensitive,
                  updatedWholeWord,
                  updatedUseRegex
                );
                if (meta.searchTerm !== undefined) {
                  updatedIndex = 0;
                } else if (updatedIndex >= updatedResults.length) {
                  updatedIndex = Math.max(0, updatedResults.length - 1);
                }
              }

              // Update index if explicitly set
              if (meta.currentIndex !== undefined) {
                updatedIndex = meta.currentIndex;
              }

              const pluginState: SearchPluginState = {
                searchTerm: updatedSearchTerm,
                replaceTerm: meta.replaceTerm !== undefined ? meta.replaceTerm : value.replaceTerm,
                results: updatedResults,
                currentIndex: updatedIndex,
                caseSensitive: updatedCaseSensitive,
                wholeWord: updatedWholeWord,
                useRegex: updatedUseRegex,
              };

              // Update storage
              storage.searchTerm = pluginState.searchTerm;
              storage.replaceTerm = pluginState.replaceTerm;
              storage.currentIndex = pluginState.currentIndex;
              storage.caseSensitive = pluginState.caseSensitive;
              storage.wholeWord = pluginState.wholeWord;
              storage.useRegex = pluginState.useRegex;
              storage.resultsCount = pluginState.results.length;

              return pluginState;
            }

            // Recalculate on document change
            if (tr.docChanged && value.searchTerm) {
              const updatedResults = processSearches(
                editorState.doc,
                value.searchTerm,
                value.caseSensitive,
                value.wholeWord,
                value.useRegex
              );
              const updatedIndex =
                value.currentIndex >= updatedResults.length
                  ? Math.max(0, updatedResults.length - 1)
                  : value.currentIndex;

              storage.resultsCount = updatedResults.length;
              storage.currentIndex = updatedIndex;

              return {
                ...value,
                results: updatedResults,
                currentIndex: updatedIndex,
              };
            }

            return value;
          },
        },

        props: {
          decorations(state) {
            const pluginState = this.getState(state);
            if (!pluginState) return DecorationSet.empty;

            const decorations: Decoration[] = [];

            // Keyword matches (yellow)
            pluginState.results.forEach((result, index) => {
              const isCurrent = index === pluginState.currentIndex;
              decorations.push(
                Decoration.inline(result.from, result.to, {
                  class: isCurrent
                    ? `${options.searchResultClass} ${options.currentResultClass}`
                    : options.searchResultClass,
                })
              );
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setSearchTerm:
        (term: string) =>
        ({ tr, state, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SearchPluginKey, { searchTerm: term });
            dispatch(tr);

            // The counter reports the first match as current, so bring it into
            // view as the term is typed. Without this the user stares at "1 of
            // N" with the match off screen, and the first Enter looks like it
            // skipped a hit. The dispatch above is queued by the command
            // manager, so the new results are recomputed here rather than read
            // back off the (still stale) editor state.
            const pluginState = SearchPluginKey.getState(state);
            const [first] = processSearches(
              state.doc,
              term,
              pluginState?.caseSensitive ?? false,
              pluginState?.wholeWord ?? false,
              pluginState?.useRegex ?? false
            );
            if (first) scrollToPosition(this.editor, first.from);
          }
          return true;
        },

      setReplaceTerm:
        (term: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SearchPluginKey, { replaceTerm: term });
            dispatch(tr);
          }
          return true;
        },

      setCaseSensitive:
        (value: boolean) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SearchPluginKey, { caseSensitive: value });
            dispatch(tr);
          }
          return true;
        },

      setWholeWord:
        (value: boolean) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SearchPluginKey, { wholeWord: value });
            dispatch(tr);
          }
          return true;
        },

      setUseRegex:
        (value: boolean) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SearchPluginKey, { useRegex: value });
            dispatch(tr);
          }
          return true;
        },

      nextSearchResult:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = SearchPluginKey.getState(state);
          if (!pluginState?.results.length || !dispatch) return false;

          const newIndex = (pluginState.currentIndex + 1) % pluginState.results.length;
          tr.setMeta(SearchPluginKey, { currentIndex: newIndex });
          dispatch(tr);

          const result = pluginState.results[newIndex];
          this.editor.commands.setTextSelection(result.from);
          scrollToPosition(this.editor, result.from);

          return true;
        },

      previousSearchResult:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = SearchPluginKey.getState(state);
          if (!pluginState?.results.length || !dispatch) return false;

          const newIndex =
            (pluginState.currentIndex - 1 + pluginState.results.length) %
            pluginState.results.length;
          tr.setMeta(SearchPluginKey, { currentIndex: newIndex });
          dispatch(tr);

          const result = pluginState.results[newIndex];
          this.editor.commands.setTextSelection(result.from);
          scrollToPosition(this.editor, result.from);

          return true;
        },

      replace:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = SearchPluginKey.getState(state);
          if (!pluginState?.results.length || !dispatch) return false;

          const result = pluginState.results[pluginState.currentIndex];
          replaceRange(tr, state, result, pluginState.replaceTerm);
          dispatch(tr);

          return true;
        },

      replaceAll:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = SearchPluginKey.getState(state);
          if (!pluginState?.results.length || !dispatch) return false;

          // One transaction, so one undo step. Walking backwards keeps the
          // remaining (earlier) match positions valid without remapping.
          for (let i = pluginState.results.length - 1; i >= 0; i--) {
            replaceRange(tr, state, pluginState.results[i], pluginState.replaceTerm);
          }
          dispatch(tr);

          return true;
        },

      closeSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SearchPluginKey, {
              searchTerm: "",
              replaceTerm: "",
              currentIndex: 0,
            });
            dispatch(tr);
          }
          return true;
        },
    };
  },
});

/**
 * Helper function to get search state from editor
 */
export function getSearchState(
  editor: { state: Parameters<typeof SearchPluginKey.getState>[0] } | null
): SearchPluginState | null {
  if (!editor) return null;
  return SearchPluginKey.getState(editor.state) ?? null;
}
