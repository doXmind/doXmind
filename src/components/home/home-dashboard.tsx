"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useFileStore } from "@/stores/file-store";
import { useAuthStore } from "@/stores/auth-store";
import { useLayoutStore } from "@/stores/layout-store";
import {
  api,
  type SearchResultItem,
  type Share,
  type ForkInfo,
  type CommunityItem,
} from "@/lib/api";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { useKBAgent } from "@/hooks/use-kb-agent";
import { telemetry } from "@/lib/telemetry";
import { useIsMobile } from "@/hooks/use-device-type";
import { HomeSearch, type SearchMode } from "./home-search";
import { FileGrid } from "./file-grid";
import { KBAnswerCard } from "./kb-answer-card";
import { RecentFiles } from "./recent-files";
import { FavoritesSection } from "./favorites-section";
import { HomeTabs } from "./home-tabs";
import { SharesSection } from "./shares-section";
import { ForksSection } from "./forks-section";
import { BookmarksSection } from "./bookmarks-section";
import { MobileFAB } from "./mobile-fab";

function getGreeting(): { title: string; subtitle: string } {
  const hour = new Date().getHours();
  if (hour < 5)
    return {
      title: "Burning the midnight oil",
      subtitle: "Don't forget to rest. Your words will still be here tomorrow.",
    };
  if (hour < 9)
    return { title: "Good morning", subtitle: "A fresh start. What will you write today?" };
  if (hour < 12)
    return {
      title: "Good morning",
      subtitle: "Pick up where you left off, or search across your writing.",
    };
  if (hour < 18)
    return {
      title: "Good afternoon",
      subtitle: "Pick up where you left off, or search across your writing.",
    };
  if (hour < 21)
    return {
      title: "Good evening",
      subtitle: "Wind down with some writing, or revisit an old draft.",
    };
  if (hour < 23)
    return { title: "Winding down", subtitle: "A quiet moment to write. Take it easy." };
  return {
    title: "Still up late",
    subtitle: "The best ideas come at night. But don't stay up too late.",
  };
}

function TypewriterText({
  text,
  speed = 80,
  delay = 0,
}: {
  text: string;
  speed?: number;
  delay?: number;
}) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    let interval: ReturnType<typeof setInterval> | null = null;

    const timeout = setTimeout(() => {
      let i = 0;
      interval = setInterval(() => {
        i++;
        setDisplayed(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(interval!);
          setDone(true);
        }
      }, speed);
    }, delay);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [text, speed, delay]);

  return (
    <>
      {displayed}
      {!done && (
        <span className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-foreground/60 align-middle" />
      )}
    </>
  );
}

export function HomeDashboard() {
  const { files, loadFiles, isLoading, getRecentFiles, getFavorites } = useFileStore();
  const { user } = useAuthStore();
  const homeActiveTab = useLayoutStore((s) => s.homeActiveTab);
  const isMobile = useIsMobile();

  // Management data (shares, forks, bookmarks)
  const [shares, setShares] = useState<Share[]>([]);
  const [forks, setForks] = useState<ForkInfo[]>([]);
  const [bookmarks, setBookmarks] = useState<CommunityItem[]>([]);
  const managementLoadedRef = useRef(false);

  // Search state — lifted here so FileGrid can filter
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>("ask");
  const abortControllerRef = useRef<AbortController | null>(null);

  // Telemetry refs
  const searchResultClickedRef = useRef(false);
  const searchResultsShownAtRef = useRef<number | null>(null);
  const searchQueryCountRef = useRef(0);
  const searchModeEnteredAtRef = useRef<number | null>(null);
  const recentQueriesRef = useRef<string[]>([]);

  // KB Agent state
  const kbAgent = useKBAgent();
  const showAnswerCard = kbAgent.isAnswering || kbAgent.answer || kbAgent.error;

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Load management data (shares, forks, bookmarks) once when user is logged in
  useEffect(() => {
    if (!user || managementLoadedRef.current) return;
    managementLoadedRef.current = true;

    Promise.allSettled([api.getMyShares(), api.getMyForks(), api.getBookmarks()]).then(
      ([sharesResult, forksResult, bookmarksResult]) => {
        if (sharesResult.status === "fulfilled") setShares(sharesResult.value.shares);
        if (forksResult.status === "fulfilled") setForks(forksResult.value.forks);
        if (bookmarksResult.status === "fulfilled") setBookmarks(bookmarksResult.value.items);
      }
    );
  }, [user]);

  const performSearch = useDebouncedCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    // Track results_no_click: previous search results existed but none were clicked
    if (
      searchResultsShownAtRef.current &&
      !searchResultClickedRef.current &&
      searchResults.length > 0
    ) {
      telemetry.trackFeature("file_search", "completed", undefined, {
        event: "results_no_click",
        results_count: searchResults.length,
        dwell_time_ms: Date.now() - searchResultsShownAtRef.current,
      });
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSearching(true);
    searchQueryCountRef.current++;
    const startTime = Date.now();
    try {
      const res = await api.searchFiles(q, undefined, 10, controller.signal);
      if (res) setSearchResults(res.results);
      searchResultClickedRef.current = false;
      searchResultsShownAtRef.current = Date.now();
      telemetry.trackFeature("file_search", "completed", Date.now() - startTime, {
        results_count: res?.results.length ?? 0,
        query_length: q.trim().length,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSearchResults([]);
      telemetry.trackFeature("file_search", "error", Date.now() - startTime);
    } finally {
      setIsSearching(false);
    }
  }, 300);

  useEffect(() => {
    if (searchMode === "search") {
      performSearch(query);
    } else {
      setSearchResults([]);
      setIsSearching(false);
    }
  }, [query, performSearch, searchMode]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleModeChange = (newMode: SearchMode) => {
    if (searchMode === "search" && newMode === "ask" && searchQueryCountRef.current > 0) {
      telemetry.trackFeature("kb_search", "completed", undefined, {
        event: "search_then_ask",
        search_query_count: searchQueryCountRef.current,
        time_in_search_mode_ms: searchModeEnteredAtRef.current
          ? Date.now() - searchModeEnteredAtRef.current
          : undefined,
      });
    }
    if (newMode === "search") {
      searchModeEnteredAtRef.current = Date.now();
      searchQueryCountRef.current = 0;
    }
    setSearchMode(newMode);
  };

  const checkQueryRephrase = (q: string, feature: "kb_search" | "file_search") => {
    const words = new Set(q.toLowerCase().trim().split(/\s+/).filter(Boolean));
    if (words.size < 2) {
      recentQueriesRef.current = [...recentQueriesRef.current.slice(-2), q];
      return;
    }
    for (const prev of recentQueriesRef.current) {
      const prevWords = new Set(prev.toLowerCase().trim().split(/\s+/).filter(Boolean));
      const intersection = [...words].filter((w) => prevWords.has(w)).length;
      const union = new Set([...words, ...prevWords]).size;
      const jaccard = union > 0 ? intersection / union : 0;
      if (q.toLowerCase().trim() === prev.toLowerCase().trim()) {
        telemetry.trackFeature(feature, "completed", undefined, {
          event: "query_rephrased",
          similarity: "exact_retry",
          original_length: prev.length,
          new_length: q.length,
        });
        break;
      } else if (jaccard > 0.7) {
        telemetry.trackFeature(feature, "completed", undefined, {
          event: "query_rephrased",
          similarity: "likely_rephrase",
          original_length: prev.length,
          new_length: q.length,
        });
        break;
      }
    }
    recentQueriesRef.current = [...recentQueriesRef.current.slice(-2), q];
  };

  const handleAskAgent = (question: string) => {
    checkQueryRephrase(question, "kb_search");
    kbAgent.ask(question);
  };

  const handleCloseAnswer = () => {
    kbAgent.clear();
  };

  const handleSearchResultClick = useCallback(
    (fileId: string, position: number, score: number) => {
      searchResultClickedRef.current = true;
      telemetry.trackFeature("file_search", "completed", undefined, {
        event: "result_clicked",
        file_id: fileId,
        position,
        result_score: score,
        total_results: searchResults.length,
      });
    },
    [searchResults.length]
  );

  // Clear KB agent when query is emptied
  const handleQueryChange = (q: string) => {
    setQuery(q);
    if (!q.trim() && showAnswerCard) {
      kbAgent.clear();
    }
  };

  const isAskMode = searchMode === "ask";

  const { title: greeting, subtitle: greetingSubtitle } = getGreeting();
  const firstName = user?.username?.split(" ")[0];

  // Derived data for new sections
  const recentFiles = getRecentFiles(3);
  const favorites = getFavorites();
  const totalDocs = files.filter((f) => !f.isFolder).length;
  const isSearchActive = query.trim().length > 0;
  const isDocumentsTab = homeActiveTab === "documents";
  const showRecent = totalDocs >= 4 && !showAnswerCard && !isSearchActive;
  const showFavorites = favorites.length > 0 && !showAnswerCard && !isSearchActive;

  const tabCounts = {
    documents: totalDocs,
    shares: shares.length,
    forks: forks.length,
    bookmarks: bookmarks.length,
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      {/* Subtle dot grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <main className="relative flex-1 px-6 pb-16 md:px-10">
        {/* Hero section */}
        <div className="mx-auto max-w-xl pt-8 md:pt-20">
          {/* Greeting */}
          <motion.div
            className="mb-6 text-center md:mb-10"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">
              <TypewriterText text={firstName ? `${greeting}, ${firstName}` : greeting} />
            </h1>
            <p className="mt-2.5 text-[13px] text-muted-foreground/60 dark:text-muted-foreground/70">
              <TypewriterText
                text={files.length > 0 ? greetingSubtitle : "Start writing something brilliant."}
                speed={30}
                delay={300}
              />
            </p>
          </motion.div>

          {/* Search */}
          <HomeSearch
            query={query}
            onQueryChange={handleQueryChange}
            isSearching={isSearching}
            isAnswering={kbAgent.isAnswering}
            onAskAgent={handleAskAgent}
            onModeChange={handleModeChange}
          />
        </div>

        {/* Continue writing — recent files */}
        {showRecent && (
          <div className="mx-auto mt-6 max-w-5xl md:mt-10">
            <RecentFiles files={recentFiles} />
          </div>
        )}

        {/* Favorites */}
        {showFavorites && (
          <div className="mx-auto mt-6 max-w-5xl md:mt-8">
            <FavoritesSection favorites={favorites} />
          </div>
        )}

        {/* Tab navigation */}
        {!showAnswerCard && !isSearchActive && (
          <div className="mx-auto mt-6 max-w-5xl md:mt-10">
            <HomeTabs counts={tabCounts} />
          </div>
        )}

        {/* Content area */}
        {showAnswerCard ? (
          <div className="mx-auto mt-6 max-w-2xl">
            <KBAnswerCard
              question={kbAgent.question}
              answer={kbAgent.answer}
              sources={kbAgent.sources}
              activeTool={kbAgent.activeTool}
              isAnswering={kbAgent.isAnswering}
              error={kbAgent.error}
              onClose={handleCloseAnswer}
              onStop={kbAgent.stop}
              onAsk={handleAskAgent}
              history={kbAgent.history}
              conversationId={kbAgent.conversationId}
            />
          </div>
        ) : isSearchActive || isDocumentsTab ? (
          <FileGrid
            files={files}
            isLoading={isLoading}
            searchQuery={isAskMode ? "" : query}
            searchResults={searchResults}
            isSearching={isAskMode ? false : isSearching}
            onResultClick={handleSearchResultClick}
          />
        ) : homeActiveTab === "shares" ? (
          <div className="mx-auto mt-6 max-w-5xl">
            <SharesSection shares={shares} onSharesChange={setShares} />
          </div>
        ) : homeActiveTab === "forks" ? (
          <div className="mx-auto mt-6 max-w-5xl">
            <ForksSection forks={forks} onForksChange={setForks} />
          </div>
        ) : homeActiveTab === "bookmarks" ? (
          <div className="mx-auto mt-6 max-w-5xl">
            <BookmarksSection bookmarks={bookmarks} />
          </div>
        ) : null}
      </main>

      {/* Mobile floating action button — only on Documents tab */}
      {isMobile && !showAnswerCard && isDocumentsTab && <MobileFAB />}
    </div>
  );
}
