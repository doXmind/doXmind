/**
 * Search and Replace Extension for TipTap
 *
 * Provides hybrid search:
 * - Keyword search: immediate highlighting (yellow)
 * - Semantic search: AI-matched sections highlighting (purple)
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// Search result range
interface SearchRange {
  from: number;
  to: number;
}

// Semantic match with score
interface SemanticRange extends SearchRange {
  score: number; // 0-1, higher is better match
}

// Plugin state interface
export interface SearchPluginState {
  searchTerm: string;
  replaceTerm: string;
  results: SearchRange[]; // Keyword matches
  semanticResults: SemanticRange[]; // Semantic matches
  currentIndex: number;
  currentSemanticIndex: number;
  caseSensitive: boolean;
}

// Plugin key for accessing state
export const SearchPluginKey = new PluginKey<SearchPluginState>("search");

// Escape special regex characters
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build regex from search term
function getRegex(searchTerm: string, caseSensitive: boolean): RegExp | null {
  if (!searchTerm.trim()) return null;
  try {
    const escaped = escapeRegExp(searchTerm);
    return new RegExp(escaped, caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

// Find all keyword matches in document
function processSearches(
  doc: PMNode,
  searchTerm: string,
  caseSensitive: boolean
): SearchRange[] {
  const results: SearchRange[] = [];
  const regex = getRegex(searchTerm, caseSensitive);

  if (!regex) return results;

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    const matches = [...node.text.matchAll(regex)];
    matches.forEach((match) => {
      if (match.index !== undefined) {
        results.push({
          from: pos + match.index,
          to: pos + match.index + match[0].length,
        });
      }
    });
  });

  return results;
}

// Find semantic match positions in document
// Returns ranges where the chunk content appears
// Optimized for sentence-level chunks from the API
function findSemanticRanges(
  doc: PMNode,
  chunks: Array<{ content: string; score: number }>
): SemanticRange[] {
  const results: SemanticRange[] = [];

  console.log("[SearchExt] findSemanticRanges called with", chunks.length, "chunks");

  // Get full document text with position mapping
  let fullText = "";
  const posMap: number[] = []; // posMap[textIndex] = documentPos

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        posMap.push(pos + i);
      }
      fullText += node.text;
    } else if (node.isBlock && fullText.length > 0) {
      // Add newline for block boundaries
      posMap.push(pos);
      fullText += "\n";
    }
  });

  console.log("[SearchExt] Document text length:", fullText.length);

  // For each chunk (now sentence-level), find its position in the document
  for (const chunk of chunks) {
    // Clean and normalize the chunk content for matching
    // Sentence chunks from API are already clean text without HTML
    const cleanChunk = chunk.content
      .replace(/<[^>]+>/g, "") // Remove any HTML tags (just in case)
      .trim();

    console.log("[SearchExt] Processing sentence chunk:", cleanChunk.slice(0, 60) + (cleanChunk.length > 60 ? "..." : ""));

    if (cleanChunk.length < 5) {
      console.log("[SearchExt] Chunk too short, skipping");
      continue;
    }

    // For sentence-level search, use the entire chunk as search text
    // Since chunks are now sentences, they should be short enough to match exactly
    const searchText = cleanChunk;

    // Normalize for fuzzy comparison - lowercase and collapse whitespace
    const normalizedSearch = searchText.toLowerCase().replace(/\s+/g, " ").trim();
    const normalizedDoc = fullText.toLowerCase().replace(/\s+/g, " ");

    // Try exact match first
    let idx = normalizedDoc.indexOf(normalizedSearch);

    // If no exact match, try with more aggressive normalization
    if (idx === -1) {
      // Remove punctuation for matching
      const searchNoPunct = normalizedSearch.replace(/[.,!?;:，。！？；：、]/g, "");
      const docNoPunct = normalizedDoc.replace(/[.,!?;:，。！？；：、]/g, "");
      idx = docNoPunct.indexOf(searchNoPunct);
      console.log("[SearchExt] Tried without punctuation, idx:", idx);
    }

    // If still no match, try finding a key phrase (first 30 chars)
    if (idx === -1 && normalizedSearch.length > 30) {
      const keyPhrase = normalizedSearch.slice(0, 30);
      idx = normalizedDoc.indexOf(keyPhrase);
      console.log("[SearchExt] Tried key phrase match, idx:", idx);
    }

    console.log("[SearchExt] Index found:", idx);

    if (idx !== -1) {
      // Map text index back to document position
      const from = posMap[idx] ?? 0;
      // Use the actual chunk length for the end position
      const endIdx = Math.min(idx + searchText.length, posMap.length - 1);
      const to = posMap[endIdx] ?? from;

      console.log("[SearchExt] Position range:", { from, to, searchLen: searchText.length });

      if (from < to) {
        results.push({
          from,
          to,
          score: chunk.score,
        });
      }
    }
  }

  console.log("[SearchExt] Total results:", results.length);

  // Remove duplicates and overlapping ranges
  return dedupeRanges(results);
}

// Remove overlapping ranges, keeping higher scores
function dedupeRanges(ranges: SemanticRange[]): SemanticRange[] {
  if (ranges.length === 0) return [];

  // Sort by score (highest first)
  const sorted = [...ranges].sort((a, b) => b.score - a.score);
  const result: SemanticRange[] = [];

  for (const range of sorted) {
    // Check if this range overlaps with any existing range
    const overlaps = result.some(
      (r) => !(range.to <= r.from || range.from >= r.to)
    );
    if (!overlaps) {
      result.push(range);
    }
  }

  // Sort by position for consistent ordering
  return result.sort((a, b) => a.from - b.from);
}

// Declare custom commands for TypeScript
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    search: {
      setSearchTerm: (term: string) => ReturnType;
      setReplaceTerm: (term: string) => ReturnType;
      setCaseSensitive: (value: boolean) => ReturnType;
      setSemanticResults: (
        chunks: Array<{ content: string; score: number }>
      ) => ReturnType;
      clearSemanticResults: () => ReturnType;
      nextSearchResult: () => ReturnType;
      previousSearchResult: () => ReturnType;
      nextSemanticResult: () => ReturnType;
      previousSemanticResult: () => ReturnType;
      replace: () => ReturnType;
      replaceAll: () => ReturnType;
      closeSearch: () => ReturnType;
    };
  }
}

export interface SearchExtensionOptions {
  searchResultClass: string;
  currentResultClass: string;
  semanticResultClass: string;
  currentSemanticResultClass: string;
}

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
                meta.searchTerm !== undefined
                  ? meta.searchTerm
                  : value.searchTerm;
              const updatedCaseSensitive =
                meta.caseSensitive !== undefined
                  ? meta.caseSensitive
                  : value.caseSensitive;

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
                  meta.semanticChunks
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
                  meta.replaceTerm !== undefined
                    ? meta.replaceTerm
                    : value.replaceTerm,
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

            // Semantic matches (purple) - as block decorations
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
        (chunks: Array<{ content: string; score: number }>) =>
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

          const newIndex =
            (pluginState.currentIndex + 1) % pluginState.results.length;
          tr.setMeta(SearchPluginKey, { currentIndex: newIndex });
          dispatch(tr);

          const result = pluginState.results[newIndex];
          this.editor.commands.setTextSelection(result.from);

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

          return true;
        },

      nextSemanticResult:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = SearchPluginKey.getState(state);
          if (!pluginState?.semanticResults.length || !dispatch) return false;

          const newIndex =
            (pluginState.currentSemanticIndex + 1) %
            pluginState.semanticResults.length;
          tr.setMeta(SearchPluginKey, { currentSemanticIndex: newIndex });
          dispatch(tr);

          const result = pluginState.semanticResults[newIndex];
          this.editor.commands.setTextSelection(result.from);

          return true;
        },

      previousSemanticResult:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = SearchPluginKey.getState(state);
          if (!pluginState?.semanticResults.length || !dispatch) return false;

          const newIndex =
            (pluginState.currentSemanticIndex -
              1 +
              pluginState.semanticResults.length) %
            pluginState.semanticResults.length;
          tr.setMeta(SearchPluginKey, { currentSemanticIndex: newIndex });
          dispatch(tr);

          const result = pluginState.semanticResults[newIndex];
          this.editor.commands.setTextSelection(result.from);

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
            tr.insertText(
              pluginState.replaceTerm,
              from + offset,
              to + offset
            );
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
