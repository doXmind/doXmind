/**
 * Search Extension Type Definitions
 */

import { PluginKey } from "@tiptap/pm/state";

// Search result range
export interface SearchRange {
  from: number;
  to: number;
}

// Plugin state interface
export interface SearchPluginState {
  searchTerm: string;
  replaceTerm: string;
  results: SearchRange[]; // Keyword matches
  currentIndex: number;
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
      nextSearchResult: () => ReturnType;
      previousSearchResult: () => ReturnType;
      replace: () => ReturnType;
      replaceAll: () => ReturnType;
      closeSearch: () => ReturnType;
    };
  }
}
