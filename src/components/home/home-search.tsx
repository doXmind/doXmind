"use client";

import { useRef, useState } from "react";
import { Search, X, Loader2, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface HomeSearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  isSearching: boolean;
}

export function HomeSearch({ query, onQueryChange, isSearching }: HomeSearchProps) {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onQueryChange("");
      inputRef.current?.blur();
    }
  };

  const handleClear = () => {
    onQueryChange("");
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
        <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground/60 md:h-[18px] md:w-[18px]" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder="Search your documents..."
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none md:text-base"
          aria-label="Search documents"
        />
        {isSearching && (
          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground/60" />
        )}
        {query && !isSearching && (
          <button
            onClick={handleClear}
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {!query && (
          <div className="hidden items-center gap-1 md:flex">
            <Sparkles className="h-3 w-3 text-muted-foreground/30" />
            <span className="text-[11px] text-muted-foreground/30">AI</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
