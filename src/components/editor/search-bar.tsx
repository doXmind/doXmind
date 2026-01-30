"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ChevronUp,
  ChevronDown,
  X,
  CaseSensitive,
  Replace,
  Sparkles,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { SearchPluginKey, type SemanticChunk } from "@/extensions/search";
import { api, type SearchResultItem } from "@/lib/api";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";

export function SearchBar() {
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // AI Search state
  const [isAIMode, setIsAIMode] = useState(false);
  const [isAISearching, setIsAISearching] = useState(false);
  const [aiResults, setAIResults] = useState<SearchResultItem[]>([]);
  const [showAIResults, setShowAIResults] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { editor } = useEditorRefStore();
  const { isSearchBarOpen, setSearchBarOpen, shouldOpenSearchWithAI } = useLayoutStore();
  const { currentFileId } = useFileStore();

  // Get search state from plugin
  const pluginState = editor ? SearchPluginKey.getState(editor.state) : null;
  const resultsCount = pluginState?.results.length ?? 0;
  const currentIndex = pluginState?.currentIndex ?? 0;
  const semanticResultsCount = pluginState?.semanticResults.length ?? 0;
  const currentSemanticIndex = pluginState?.currentSemanticIndex ?? 0;

  // AI Search function with debounce
  const performAISearch = useDebouncedCallback(async (query: string) => {
    if (!query.trim() || !currentFileId) {
      setAIResults([]);
      editor?.commands.clearSemanticResults();
      return;
    }

    // Cancel previous request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsAISearching(true);

    try {
      const response = await api.searchInDocument(
        query,
        currentFileId,
        10,
        0.3,
        controller.signal
      );

      if (response.results.length > 0) {
        setAIResults(response.results);
        setShowAIResults(true);

        // Convert to SemanticChunk format for editor highlighting
        // Include start/end positions from backend for accurate highlighting
        const semanticChunks: SemanticChunk[] = response.results.map((r) => ({
          content: r.content,
          score: r.distance !== undefined ? 1 - r.distance : 0.5,
          start: r.metadata?.start as number | undefined,
          end: r.metadata?.end as number | undefined,
        }));
        editor?.commands.setSemanticResults(semanticChunks);
      } else {
        setAIResults([]);
        editor?.commands.clearSemanticResults();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("[SearchBar] AI search failed:", error);
      setAIResults([]);
    } finally {
      setIsAISearching(false);
    }
  }, 500);

  // Trigger AI search when search term changes (only in AI mode)
  useEffect(() => {
    if (isAIMode && searchTerm.trim()) {
      performAISearch(searchTerm);
    }
  }, [searchTerm, performAISearch, isAIMode]);

  // Focus input when opened (only on desktop to avoid keyboard popup on mobile)
  // Also handle shouldOpenSearchWithAI flag
  useEffect(() => {
    if (isSearchBarOpen) {
      // Check if we should open in AI mode
      if (shouldOpenSearchWithAI) {
        setIsAIMode(true);
      }
      // Focus input on desktop
      if (window.innerWidth >= 768) {
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    }
  }, [isSearchBarOpen, shouldOpenSearchWithAI]);

  // Sync search term with editor (only for keyword search)
  useEffect(() => {
    if (!editor) return;
    // Defer the editor command to avoid flushSync warning during React render
    queueMicrotask(() => {
      // Only do keyword search when not in AI mode
      if (!isAIMode) {
        editor.commands.setSearchTerm(searchTerm);
      } else {
        editor.commands.setSearchTerm(""); // Clear keyword highlights in AI mode
      }
    });
  }, [editor, searchTerm, isAIMode]);

  // Sync case sensitivity with editor
  useEffect(() => {
    if (!editor) return;
    queueMicrotask(() => {
      editor.commands.setCaseSensitive(caseSensitive);
    });
  }, [editor, caseSensitive]);

  // Clear search when closed
  useEffect(() => {
    if (!isSearchBarOpen && editor) {
      queueMicrotask(() => {
        editor.commands.closeSearch();
      });
      setSearchTerm("");
      setReplaceTerm("");
      setShowReplace(false);
      setIsAIMode(false);
      setAIResults([]);
      setShowAIResults(false);
      abortControllerRef.current?.abort();
    }
  }, [isSearchBarOpen, editor]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Keyword search navigation
  const handleNext = () => editor?.commands.nextSearchResult();
  const handlePrevious = () => editor?.commands.previousSearchResult();

  // AI search navigation
  const handleNextSemantic = () => editor?.commands.nextSemanticResult();
  const handlePreviousSemantic = () => editor?.commands.previousSemanticResult();

  const handleReplace = () => {
    if (!editor || resultsCount === 0) return;
    editor.commands.setReplaceTerm(replaceTerm);
    editor.commands.replace();
  };

  const handleReplaceAll = () => {
    if (!editor || resultsCount === 0) return;
    editor.commands.setReplaceTerm(replaceTerm);
    editor.commands.replaceAll();
  };

  const handleClose = () => {
    setSearchBarOpen(false);
  };

  // Toggle AI mode - only update state, effects handle editor commands
  const toggleAIMode = useCallback(() => {
    setIsAIMode((prev) => !prev);
  }, []);

  // Handle AI mode changes - clear/restore highlights
  useEffect(() => {
    if (!editor) return;

    queueMicrotask(() => {
      if (isAIMode) {
        // Switching to AI mode - clear keyword highlights, trigger AI search
        editor.commands.setSearchTerm("");
        if (searchTerm.trim()) {
          performAISearch(searchTerm);
        }
      } else {
        // Switching to keyword mode - clear AI results, restore keyword search
        setAIResults([]);
        setShowAIResults(false);
        editor.commands.clearSemanticResults();
        if (searchTerm) {
          editor.commands.setSearchTerm(searchTerm);
        }
      }
    });
    // Only run when isAIMode changes, not on every searchTerm change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAIMode, editor]);

  // Jump to semantic result by clicking - uses same command pattern as arrow navigation
  const handleSemanticResultClick = useCallback(
    (index: number) => {
      editor?.commands.goToSemanticResult(index);
    },
    [editor]
  );

  // Keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isAIMode) {
        handleNextSemantic();
      } else {
        handleNext();
      }
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      if (isAIMode) {
        handlePreviousSemantic();
      } else {
        handlePrevious();
      }
    }
  };

  return (
    <AnimatePresence>
      {isSearchBarOpen && (
        <motion.div
          role="search"
          aria-label="Find in document"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className={cn(
            "absolute top-2 z-[45]",
            // Mobile: full width with padding, Desktop: fixed width on right
            "left-2 right-2 md:left-auto md:right-4 md:w-[400px]",
            "rounded-lg border border-border bg-popover",
            "shadow-lg shadow-black/10 dark:shadow-black/30"
          )}
          onKeyDown={handleKeyDown}
        >
          {/* Search row */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            {/* Search icon / AI loading indicator */}
            {isAISearching ? (
              <Loader2 className="h-4 w-4 flex-shrink-0 text-purple-500 animate-spin" />
            ) : isAIMode ? (
              <Sparkles className="h-4 w-4 flex-shrink-0 text-purple-500" />
            ) : (
              <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            )}

            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={isAIMode ? "AI semantic search..." : "Find in document..."}
              className={cn(
                "flex-1 min-w-0 bg-transparent text-base md:text-sm focus:outline-none placeholder:text-muted-foreground",
                isAIMode && "placeholder:text-purple-400"
              )}
              aria-label="Search text"
            />

            {/* Match counter - different display for AI vs keyword mode */}
            <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[60px] text-center">
              {searchTerm ? (
                isAIMode ? (
                  isAISearching ? (
                    <span className="text-purple-500">Searching...</span>
                  ) : semanticResultsCount > 0 ? (
                    <span className="text-purple-600 dark:text-purple-400">
                      {currentSemanticIndex + 1} of {semanticResultsCount}
                    </span>
                  ) : (
                    <span className="text-amber-500">No matches</span>
                  )
                ) : resultsCount > 0 ? (
                  `${currentIndex + 1} of ${resultsCount}`
                ) : (
                  <span className="text-amber-500">No matches</span>
                )
              ) : null}
            </span>

            {/* AI Search toggle */}
            <button
              onClick={toggleAIMode}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                isAIMode
                  ? "bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400"
                  : "hover:bg-accent text-muted-foreground"
              )}
              aria-label="Toggle AI search"
              aria-pressed={isAIMode}
              title={isAIMode ? "Switch to keyword search" : "Switch to AI search"}
            >
              <Sparkles className="h-4 w-4" />
            </button>

            {/* Case sensitivity toggle - only show in keyword mode */}
            {!isAIMode && (
              <button
                onClick={() => setCaseSensitive(!caseSensitive)}
                className={cn(
                  "p-1.5 rounded-md hover:bg-accent transition-colors",
                  caseSensitive && "bg-accent text-accent-foreground"
                )}
                aria-label="Toggle case sensitivity"
                aria-pressed={caseSensitive}
                title="Match case"
              >
                <CaseSensitive className="h-4 w-4" />
              </button>
            )}

            {/* Navigation */}
            <button
              onClick={isAIMode ? handlePreviousSemantic : handlePrevious}
              disabled={isAIMode ? semanticResultsCount === 0 : resultsCount === 0}
              className="p-1.5 rounded-md hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Previous result"
              title="Previous (Shift+Enter)"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              onClick={isAIMode ? handleNextSemantic : handleNext}
              disabled={isAIMode ? semanticResultsCount === 0 : resultsCount === 0}
              className="p-1.5 rounded-md hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Next result"
              title="Next (Enter)"
            >
              <ChevronDown className="h-4 w-4" />
            </button>

            {/* Toggle replace - only show in keyword mode */}
            {!isAIMode && (
              <button
                onClick={() => setShowReplace(!showReplace)}
                className={cn(
                  "p-1.5 rounded-md hover:bg-accent transition-colors",
                  showReplace && "bg-accent text-accent-foreground"
                )}
                aria-label="Toggle replace"
                aria-expanded={showReplace}
                title="Toggle replace"
              >
                <Replace className="h-4 w-4" />
              </button>
            )}

            {/* Close */}
            <button
              onClick={handleClose}
              className="p-1.5 rounded-md hover:bg-accent transition-colors"
              aria-label="Close search"
              title="Close (Escape)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Replace row (collapsible) - only in keyword mode */}
          <AnimatePresence>
            {showReplace && !isAIMode && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden border-t border-border"
              >
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <Replace className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <input
                    type="text"
                    value={replaceTerm}
                    onChange={(e) => setReplaceTerm(e.target.value)}
                    placeholder="Replace with..."
                    className="flex-1 min-w-0 bg-transparent text-base md:text-sm focus:outline-none placeholder:text-muted-foreground"
                    aria-label="Replace text"
                  />
                  <button
                    onClick={handleReplace}
                    disabled={resultsCount === 0}
                    className="px-2.5 py-1 text-xs font-medium rounded-md bg-secondary hover:bg-secondary/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Replace
                  </button>
                  <button
                    onClick={handleReplaceAll}
                    disabled={resultsCount === 0}
                    className="px-2.5 py-1 text-xs font-medium rounded-md bg-secondary hover:bg-secondary/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Replace All
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* AI Search Results Panel - renders from semanticResults for correct index mapping */}
          <AnimatePresence>
            {isAIMode && semanticResultsCount > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden border-t border-purple-200 dark:border-purple-800"
              >
                <div className="max-h-[200px] overflow-y-auto">
                  <div className="px-3 py-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 sticky top-0">
                    AI Results ({semanticResultsCount})
                  </div>
                  {pluginState?.semanticResults.map((result, index) => {
                    const score = Math.round(result.score * 100);
                    const content = editor?.state.doc.textBetween(result.from, result.to) ?? "";
                    const isCurrentResult = index === currentSemanticIndex;

                    return (
                      <button
                        key={`semantic-result-${index}`}
                        onClick={() => handleSemanticResultClick(index)}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm transition-colors",
                          "hover:bg-purple-50 dark:hover:bg-purple-900/30",
                          "border-b border-border/50 last:border-b-0",
                          isCurrentResult && "bg-purple-100 dark:bg-purple-900/40"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <div
                            className={cn(
                              "flex-1 min-w-0 line-clamp-2 text-foreground/80",
                              isCurrentResult && "text-purple-700 dark:text-purple-300"
                            )}
                          >
                            {content}
                          </div>
                          <span
                            className={cn(
                              "flex-shrink-0 text-xs px-1.5 py-0.5 rounded",
                              score >= 70
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : score >= 50
                                  ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                            )}
                          >
                            {score}%
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
