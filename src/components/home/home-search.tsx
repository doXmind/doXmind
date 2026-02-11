"use client";

import { useRef, useState } from "react";
import { Search, X, Loader2, Sparkles, Send } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { telemetry } from "@/lib/telemetry";

type SearchMode = "search" | "ask";

interface HomeSearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  isSearching: boolean;
  isAnswering?: boolean;
  onAskAgent?: (question: string) => void;
  onModeChange?: (mode: SearchMode) => void;
}

export type { SearchMode };

export function HomeSearch({
  query,
  onQueryChange,
  isSearching,
  isAnswering,
  onAskAgent,
  onModeChange,
}: HomeSearchProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [mode, setMode] = useState<SearchMode>("ask");
  const inputRef = useRef<HTMLInputElement>(null);
  const querySubmittedRef = useRef(false);

  const isAskMode = mode === "ask";

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onQueryChange("");
      inputRef.current?.blur();
    }
    if (e.key === "Enter" && isAskMode && query.trim() && onAskAgent) {
      e.preventDefault();
      onAskAgent(query.trim());
    }
  };

  const handleSubmit = () => {
    if (isAskMode && query.trim() && onAskAgent) {
      querySubmittedRef.current = true;
      telemetry.trackFeature("kb_search", "completed", undefined, {
        event: "query_submitted",
        query_length: query.trim().length,
        mode: "ask",
      });
      onAskAgent(query.trim());
    }
  };

  const handleClear = () => {
    if (query.trim() && !querySubmittedRef.current) {
      const feature = isAskMode ? "kb_search" : "file_search";
      telemetry.trackFeature(feature, "abandoned", undefined, {
        event: "query_abandoned",
        query_length: query.length,
        mode,
      });
    }
    querySubmittedRef.current = false;
    onQueryChange("");
    inputRef.current?.focus();
  };

  const toggleMode = () => {
    const next = mode === "search" ? "ask" : "search";
    telemetry.trackFeature("kb_search", "completed", undefined, {
      event: "mode_switch",
      from_mode: mode,
      to_mode: next,
      had_query: !!query.trim(),
    });
    setMode(next);
    onModeChange?.(next);
    inputRef.current?.focus();
  };

  return (
    <motion.div
      className="relative mx-auto w-full max-w-xl"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Animated glow behind search bar */}
      <div
        className={cn(
          "absolute -inset-0.5 rounded-2xl opacity-0 blur-md transition-opacity duration-500",
          isFocused && "opacity-100"
        )}
        style={{
          background: "linear-gradient(135deg, #00f2ea20, #ff005020, #00f2ea20)",
        }}
      />

      {/* Search input */}
      <div
        className={cn(
          "relative flex h-12 items-center gap-3 rounded-2xl border px-4 backdrop-blur-sm transition-all duration-300 md:h-14 md:px-5",
          isFocused
            ? "border-foreground/15 bg-card shadow-lg"
            : "border-border/60 bg-card/80 shadow-sm hover:border-foreground/10 hover:bg-card hover:shadow-md"
        )}
      >
        {/* Mode toggle */}
        <button
          onClick={toggleMode}
          className={cn(
            "flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-all duration-200",
            "bg-accent/50 text-muted-foreground hover:bg-accent"
          )}
          aria-label={`Switch to ${isAskMode ? "search" : "ask AI"} mode`}
        >
          {isAskMode ? (
            <>
              <Sparkles className="h-3 w-3" />
              <span className="hidden sm:inline">Ask AI</span>
            </>
          ) : (
            <>
              <Search className="h-3 w-3" />
              <span className="hidden sm:inline">Search</span>
            </>
          )}
        </button>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => {
            setIsFocused(true);
            querySubmittedRef.current = false;
          }}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={
            isAskMode ? "Ask a question about your documents..." : "Search your documents..."
          }
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none md:text-base"
          aria-label={isAskMode ? "Ask a question" : "Search documents"}
        />

        {(isSearching || isAnswering) && (
          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground/60" />
        )}

        {query && !isSearching && !isAnswering && (
          <>
            {isAskMode && onAskAgent && (
              <button
                onClick={handleSubmit}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/90"
                aria-label="Ask AI"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={handleClear}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Clear"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {!query && !isAskMode && (
          <div className="hidden items-center gap-1 md:flex">
            <Sparkles className="h-3 w-3 text-muted-foreground/30" />
            <span className="text-[11px] text-muted-foreground/30">AI</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
