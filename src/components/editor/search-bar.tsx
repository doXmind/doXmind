"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ChevronUp,
  ChevronDown,
  X,
  CaseSensitive,
  WholeWord,
  Replace,
  Regex,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useLayoutStore } from "@/stores/layout-store";
import { SearchPluginKey } from "@/extensions/search";

export function SearchBar() {
  const t = useTranslations("editor");
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { editor } = useEditorRefStore();
  const { isSearchBarOpen, setSearchBarOpen } = useLayoutStore();

  // Track search results via editor transactions (plugin state isn't reactive in React)
  const [resultsCount, setResultsCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);

  const syncSearchState = useCallback(() => {
    if (!editor) return;
    const state = SearchPluginKey.getState(editor.state);
    if (state) {
      setResultsCount(state.results.length);
      setCurrentIndex(state.currentIndex);
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", syncSearchState);
    return () => {
      editor.off("transaction", syncSearchState);
    };
  }, [editor, syncSearchState]);

  // Focus input when opened (only on desktop to avoid keyboard popup on mobile)
  useEffect(() => {
    if (isSearchBarOpen) {
      if (window.innerWidth >= 768) {
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    }
  }, [isSearchBarOpen]);

  // Sync search term with editor
  useEffect(() => {
    if (!editor) return;
    setTimeout(() => {
      editor.commands.setSearchTerm(searchTerm);
    });
  }, [editor, searchTerm]);

  // Sync case sensitivity with editor
  useEffect(() => {
    if (!editor) return;
    setTimeout(() => {
      editor.commands.setCaseSensitive(caseSensitive);
    }, 0);
  }, [editor, caseSensitive]);

  // Sync whole word with editor
  useEffect(() => {
    if (!editor) return;
    setTimeout(() => {
      editor.commands.setWholeWord(wholeWord);
    }, 0);
  }, [editor, wholeWord]);

  // Sync regex mode with editor
  useEffect(() => {
    if (!editor) return;
    setTimeout(() => {
      editor.commands.setUseRegex(useRegex);
    }, 0);
  }, [editor, useRegex]);

  // Clear search when closed
  useEffect(() => {
    if (!isSearchBarOpen && editor) {
      setTimeout(() => {
        editor.commands.closeSearch();
      }, 0);
      setSearchTerm("");
      setReplaceTerm("");
      setShowReplace(false);
      setCaseSensitive(false);
      setWholeWord(false);
      setUseRegex(false);
      setResultsCount(0);
      setCurrentIndex(0);
    }
  }, [isSearchBarOpen, editor]);

  const handleNext = () => editor?.commands.nextSearchResult();
  const handlePrevious = () => editor?.commands.previousSearchResult();

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

  // Keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleNext();
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      handlePrevious();
    }
  };

  return (
    <AnimatePresence>
      {isSearchBarOpen && (
        <motion.div
          role="search"
          aria-label={t("searchBar.findPlaceholder")}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className={cn(
            "absolute top-2 z-[45]",
            // Mobile: full width with padding, Desktop: fixed width on right
            "left-2 right-2 md:left-auto md:right-4 md:w-[540px]",
            "rounded-lg border border-border bg-popover",
            "shadow-lg shadow-black/10 dark:shadow-black/30"
          )}
          onKeyDown={handleKeyDown}
        >
          {/* Search row */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />

            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t("searchBar.findPlaceholder")}
              className="min-w-[80px] flex-1 bg-transparent text-base placeholder:text-muted-foreground focus:outline-none md:text-sm"
              aria-label="Search text"
            />

            {/* Match counter */}
            <span className="min-w-[60px] whitespace-nowrap text-center text-xs text-muted-foreground">
              {searchTerm ? (
                resultsCount > 0 ? (
                  `${currentIndex + 1} of ${resultsCount}`
                ) : (
                  <span className="text-amber-500">{t("searchBar.noMatches")}</span>
                )
              ) : null}
            </span>

            {/* Search option toggles */}
            <button
              onClick={() => setCaseSensitive(!caseSensitive)}
              className={cn(
                "rounded-md p-1.5 transition-colors hover:bg-accent",
                caseSensitive && "bg-accent text-accent-foreground"
              )}
              aria-label="Toggle case sensitivity"
              aria-pressed={caseSensitive}
              title={t("searchBar.matchCase")}
            >
              <CaseSensitive className="h-4 w-4" />
            </button>
            <button
              onClick={() => setWholeWord(!wholeWord)}
              className={cn(
                "rounded-md p-1.5 transition-colors hover:bg-accent",
                wholeWord && "bg-accent text-accent-foreground"
              )}
              aria-label="Toggle whole word matching"
              aria-pressed={wholeWord}
              title={t("searchBar.matchWholeWord")}
            >
              <WholeWord className="h-4 w-4" />
            </button>
            <button
              onClick={() => setUseRegex(!useRegex)}
              className={cn(
                "rounded-md p-1.5 transition-colors hover:bg-accent",
                useRegex && "bg-accent text-accent-foreground"
              )}
              aria-label="Toggle regex mode"
              aria-pressed={useRegex}
              title={t("searchBar.useRegex")}
            >
              <Regex className="h-4 w-4" />
            </button>

            {/* Navigation */}
            <button
              onClick={handlePrevious}
              disabled={resultsCount === 0}
              className="rounded-md p-1.5 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous result"
              title={t("searchBar.previousMatch")}
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              onClick={handleNext}
              disabled={resultsCount === 0}
              className="rounded-md p-1.5 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next result"
              title={t("searchBar.nextMatch")}
            >
              <ChevronDown className="h-4 w-4" />
            </button>

            {/* Toggle replace */}
            <button
              onClick={() => setShowReplace(!showReplace)}
              className={cn(
                "rounded-md p-1.5 transition-colors hover:bg-accent",
                showReplace && "bg-accent text-accent-foreground"
              )}
              aria-label="Toggle replace"
              aria-expanded={showReplace}
              title={t("searchBar.toggleReplace")}
            >
              <Replace className="h-4 w-4" />
            </button>

            {/* Close */}
            <button
              onClick={handleClose}
              className="rounded-md p-1.5 transition-colors hover:bg-accent"
              aria-label="Close search"
              title={t("searchBar.closeSearch")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Replace row (collapsible) */}
          <AnimatePresence>
            {showReplace && (
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
                    placeholder={t("searchBar.replacePlaceholder")}
                    className="min-w-0 flex-1 bg-transparent text-base placeholder:text-muted-foreground focus:outline-none md:text-sm"
                    aria-label="Replace text"
                  />
                  <button
                    onClick={handleReplace}
                    disabled={resultsCount === 0}
                    className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("searchBar.replace")}
                  </button>
                  <button
                    onClick={handleReplaceAll}
                    disabled={resultsCount === 0}
                    className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("searchBar.replaceAll")}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
