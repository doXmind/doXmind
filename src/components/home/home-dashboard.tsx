"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useFileStore } from "@/stores/file-store";
import { useAuthStore } from "@/stores/auth-store";
import { api, type SearchResultItem } from "@/lib/api";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { HomeHeader } from "./home-header";
import { HomeSearch } from "./home-search";
import { FileGrid } from "./file-grid";

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

export function HomeDashboard() {
  const { files, loadFiles, isLoading } = useFileStore();
  const { user } = useAuthStore();

  // Search state — lifted here so FileGrid can filter
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const performSearch = useDebouncedCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSearching(true);
    try {
      const res = await api.searchFiles(q, undefined, 10, controller.signal);
      if (res) setSearchResults(res.results);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, 300);

  useEffect(() => {
    performSearch(query);
  }, [query, performSearch]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const { title: greeting, subtitle: greetingSubtitle } = getGreeting();
  const firstName = user?.username?.split(" ")[0];

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Subtle dot grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <HomeHeader />

      <main className="relative flex-1 px-5 pb-12 md:px-8">
        {/* Hero section */}
        <div className="mx-auto max-w-xl pt-12 md:pt-16">
          {/* Greeting */}
          <motion.div
            className="mb-8 text-center"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              <span className="animate-text-wave">{greeting}</span>
              {firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground/50">
              {files.length > 0 ? greetingSubtitle : "Start writing something brilliant."}
            </p>
          </motion.div>

          {/* Search */}
          <HomeSearch query={query} onQueryChange={setQuery} isSearching={isSearching} />
        </div>

        {/* Documents */}
        <FileGrid
          files={files}
          isLoading={isLoading}
          searchQuery={query}
          searchResults={searchResults}
          isSearching={isSearching}
        />
      </main>
    </div>
  );
}
