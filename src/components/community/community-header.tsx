"use client";

import { useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

interface CommunityHeaderProps {
  sortBy: string;
  searchQuery: string;
  onSortChange: (sort: "newest" | "popular" | "most_viewed" | "for_you") => void;
  onSearchChange: (query: string) => void;
}

const BASE_SORT_OPTIONS = [
  { value: "newest", label: "Latest" },
  { value: "popular", label: "Popular" },
  { value: "most_viewed", label: "Most Viewed" },
] as const;

export function CommunityHeader({
  sortBy,
  searchQuery,
  onSortChange,
  onSearchChange,
}: CommunityHeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const user = useAuthStore((s) => s.user);

  const sortOptions = useMemo(
    () =>
      user
        ? [{ value: "for_you" as const, label: "For You" }, ...BASE_SORT_OPTIONS]
        : BASE_SORT_OPTIONS,
    [user]
  );

  return (
    <div className="sticky top-0 z-10 -mx-1 mb-4 space-y-3 bg-background/95 px-1 pb-1 pt-2 backdrop-blur-sm sm:-mx-3 sm:px-3">
      {/* Search bar */}
      <div className="flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 transition-colors focus-within:border-foreground/20">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground/40" />
        <input
          ref={inputRef}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search"
          className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
        />
        {searchQuery && (
          <button
            onClick={() => {
              onSearchChange("");
              inputRef.current?.focus();
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-foreground transition-colors hover:bg-foreground/20"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Tab bar — like X.com's "For you / Following" tabs */}
      <div className="flex border-b border-border">
        {sortOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => onSortChange(option.value)}
            className={cn(
              "relative flex-1 py-3 text-center text-[14px] font-medium transition-colors",
              sortBy === option.value
                ? "text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <span className="relative inline-block">
              {option.label}
              {sortBy === option.value && (
                <motion.div
                  className="absolute -bottom-3 left-0 right-0 h-[3px] rounded-full bg-foreground"
                  layoutId="tab-indicator"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                />
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
