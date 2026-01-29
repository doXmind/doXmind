/**
 * Search and Replace Extension for TipTap
 *
 * Provides hybrid search:
 * - Keyword search: immediate highlighting (yellow)
 * - Semantic search: AI-matched sections highlighting (purple)
 */

import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/core";

/**
 * Scroll the editor view to make a position visible
 * Works with custom scroll containers (like ScrollArea)
 */
function scrollToPosition(editor: Editor, pos: number): void {
  const view = editor.view;
  if (!view) return;

  // Use requestAnimationFrame to ensure DOM is updated after state change
  requestAnimationFrame(() => {
    try {
      const coords = view.coordsAtPos(pos);
      const editorElement = view.dom;

      // Find the scrollable container (parent with overflow-y: auto)
      let scrollContainer: HTMLElement | null = editorElement.parentElement;
      while (scrollContainer) {
        const style = window.getComputedStyle(scrollContainer);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          break;
        }
        scrollContainer = scrollContainer.parentElement;
      }

      if (!scrollContainer) {
        // Fallback to window scroll
        window.scrollTo({
          top: coords.top - window.innerHeight / 2,
          behavior: "smooth",
        });
        return;
      }

      // Calculate position relative to scroll container
      const containerRect = scrollContainer.getBoundingClientRect();
      const relativeTop = coords.top - containerRect.top;
      const containerHeight = scrollContainer.clientHeight;

      // Only scroll if the position is outside the visible area
      if (relativeTop < 50 || relativeTop > containerHeight - 50) {
        // Scroll to center the match in the viewport
        const targetScrollTop =
          scrollContainer.scrollTop + relativeTop - containerHeight / 2;
        scrollContainer.scrollTo({
          top: targetScrollTop,
          behavior: "smooth",
        });
      }
    } catch (error) {
      // Silently fail if coordinates can't be determined
      console.warn("[Search] Could not scroll to position:", error);
    }
  });
}

import {
  SearchPluginKey,
  type SearchPluginState,
  type SearchExtensionOptions,
  type SemanticChunk,
} from "./search-types";

import { processSearches, findSemanticRanges } from "./search-algorithms";

// Re-export types for external use
export * from "./search-types";
export { processSearches, findSemanticRanges, dedupeRanges } from "./search-algorithms";

export const SearchExtension = Extension.create<SearchExtensionOptions>({
  name: "search",

  addOptions() {
    return {
      searchResultClass: "search-result",
      currentResultClass: "search-result-current",
      semanticResultClass: "search-result-semantic",
      currentSemanticResultClass: "search-result-semantic-current",
    };
  },

  addStorage() {
    return {
      searchTerm: "",
      replaceTerm: "",
      currentIndex: 0,
      caseSensitive: false,
      resultsCount: 0,
      semanticResultsCount: 0,
      currentSemanticIndex: 0,
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
            semanticResults: [],
            currentIndex: 0,
            currentSemanticIndex: 0,
            caseSensitive: false,
          }),

          apply(tr, value, _oldState, editorState) {
            const meta = tr.getMeta(SearchPluginKey);

            if (meta) {
              const updatedSearchTerm =
                meta.searchTerm !== undefined ? meta.searchTerm : value.searchTerm;
              const updatedCaseSensitive =
                meta.caseSensitive !== undefined ? meta.caseSensitive : value.caseSensitive;

              let updatedResults = value.results;
              let updatedIndex = value.currentIndex;
              let updatedSemanticResults = value.semanticResults;
              let updatedSemanticIndex = value.currentSemanticIndex;

              // Recalculate keyword results
              if (
                meta.searchTerm !== undefined ||
                meta.caseSensitive !== undefined ||
                tr.docChanged
              ) {
                updatedResults = processSearches(
                  editorState.doc,
                  updatedSearchTerm,
                  updatedCaseSensitive
                );
                if (meta.searchTerm !== undefined) {
                  updatedIndex = 0;
                } else if (updatedIndex >= updatedResults.length) {
                  updatedIndex = Math.max(0, updatedResults.length - 1);
                }
              }

              // Handle semantic results update
              if (meta.semanticChunks !== undefined) {
                updatedSemanticResults = findSemanticRanges(
                  editorState.doc,
                  meta.semanticChunks as SemanticChunk[]
                );
                updatedSemanticIndex = 0;
              }

              if (meta.clearSemantic) {
                updatedSemanticResults = [];
                updatedSemanticIndex = 0;
              }

              // Update indices if explicitly set
              if (meta.currentIndex !== undefined) {
                updatedIndex = meta.currentIndex;
              }
              if (meta.currentSemanticIndex !== undefined) {
                updatedSemanticIndex = meta.currentSemanticIndex;
              }

              const pluginState: SearchPluginState = {
                searchTerm: updatedSearchTerm,
                replaceTerm:
                  meta.replaceTerm !== undefined ? meta.replaceTerm : value.replaceTerm,
                results: updatedResults,
                semanticResults: updatedSemanticResults,
                currentIndex: updatedIndex,
                currentSemanticIndex: updatedSemanticIndex,
                caseSensitive: updatedCaseSensitive,
              };

              // Update storage
              storage.searchTerm = pluginState.searchTerm;
              storage.replaceTerm = pluginState.replaceTerm;
              storage.currentIndex = pluginState.currentIndex;
              storage.caseSensitive = pluginState.caseSensitive;
              storage.resultsCount = pluginState.results.length;
              storage.semanticResultsCount = pluginState.semanticResults.length;
              storage.currentSemanticIndex = pluginState.currentSemanticIndex;

              return pluginState;
            }

            // Recalculate on document change
            if (tr.docChanged && value.searchTerm) {
              const updatedResults = processSearches(
                editorState.doc,
                value.searchTerm,
                value.caseSensitive
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

            // Semantic matches (purple)
            pluginState.semanticResults.forEach((result, index) => {
              const isCurrent = index === pluginState.currentSemanticIndex;
              decorations.push(
                Decoration.inline(result.from, result.to, {
                  class: isCurrent
                    ? `${options.semanticResultClass} ${options.currentSemanticResultClass}`
                    : options.semanticResultClass,
                  "data-score": Math.round(result.score * 100).toString(),
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
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SearchPluginKey, { searchTerm: term });
            dispatch(tr);
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

      setSemanticResults:
        (chunks: SemanticChunk[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SearchPluginKey, { semanticChunks: chunks });
            dispatch(tr);
          }
          return true;
        },

      clearSemanticResults:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SearchPluginKey, { clearSemantic: true });
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

      goToSemanticResult:
        (index: number) =>
        ({ tr, state, dispatch }) => {
          const pluginState = SearchPluginKey.getState(state);
          if (!pluginState?.semanticResults[index] || !dispatch) return false;

          tr.setMeta(SearchPluginKey, { currentSemanticIndex: index });
          dispatch(tr);

          const result = pluginState.semanticResults[index];
          this.editor.commands.setTextSelection(result.from);
          scrollToPosition(this.editor, result.from);

          return true;
        },

      nextSemanticResult:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = SearchPluginKey.getState(state);
          if (!pluginState?.semanticResults.length || !dispatch) return false;

          const newIndex =
            (pluginState.currentSemanticIndex + 1) % pluginState.semanticResults.length;
          tr.setMeta(SearchPluginKey, { currentSemanticIndex: newIndex });
          dispatch(tr);

          const result = pluginState.semanticResults[newIndex];
          this.editor.commands.setTextSelection(result.from);
          scrollToPosition(this.editor, result.from);

          return true;
        },

      previousSemanticResult:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = SearchPluginKey.getState(state);
          if (!pluginState?.semanticResults.length || !dispatch) return false;

          const newIndex =
            (pluginState.currentSemanticIndex - 1 + pluginState.semanticResults.length) %
            pluginState.semanticResults.length;
          tr.setMeta(SearchPluginKey, { currentSemanticIndex: newIndex });
          dispatch(tr);

          const result = pluginState.semanticResults[newIndex];
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
          tr.insertText(pluginState.replaceTerm, result.from, result.to);
          dispatch(tr);

          return true;
        },

      replaceAll:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = SearchPluginKey.getState(state);
          if (!pluginState?.results.length || !dispatch) return false;

          let offset = 0;
          pluginState.results.forEach(({ from, to }) => {
            tr.insertText(pluginState.replaceTerm, from + offset, to + offset);
            offset += pluginState.replaceTerm.length - (to - from);
          });
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
              clearSemantic: true,
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
