/**
 * Search Extension Type Definitions
 */

import { PluginKey } from "@tiptap/pm/state";

// Search result range
export interface SearchRange {
  from: number;
  to: number;
}

// Semantic match with score
export interface SemanticRange extends SearchRange {
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
  wholeWord: boolean;
  useRegex: boolean;
}

// Plugin key for accessing state
export const SearchPluginKey = new PluginKey<SearchPluginState>("search");

// Extension options
export interface SearchExtensionOptions {
  searchResultClass: string;
  currentResultClass: string;
  semanticResultClass: string;
  currentSemanticResultClass: string;
}

// Semantic chunk from API
export interface SemanticChunk {
  content: string;
  score: number;
  // Position in original document (from backend)
  start?: number;
  end?: number;
}

// Declare custom commands for TypeScript
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    search: {
      setSearchTerm: (term: string) => ReturnType;
      setReplaceTerm: (term: string) => ReturnType;
      setCaseSensitive: (value: boolean) => ReturnType;
      setWholeWord: (value: boolean) => ReturnType;
      setUseRegex: (value: boolean) => ReturnType;
      setSemanticResults: (chunks: SemanticChunk[]) => ReturnType;
      clearSemanticResults: () => ReturnType;
      nextSearchResult: () => ReturnType;
      previousSearchResult: () => ReturnType;
      goToSemanticResult: (index: number) => ReturnType;
      nextSemanticResult: () => ReturnType;
      previousSemanticResult: () => ReturnType;
      replace: () => ReturnType;
      replaceAll: () => ReturnType;
      closeSearch: () => ReturnType;
    };
  }
}
