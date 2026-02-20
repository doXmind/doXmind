"use client";

import { useState, useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommunityHeaderProps {
  sortBy: string;
  searchQuery: string;
  onSortChange: (sort: "newest" | "popular" | "most_viewed") => void;
  onSearchChange: (query: string) => void;
}

const SORT_OPTIONS = [
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
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      {/* Search with glow */}
      <div className="relative flex-1 sm:max-w-xs">
        {/* Animated glow */}
        <div
          className={cn(
            "absolute -inset-0.5 rounded-xl opacity-0 blur-md transition-opacity duration-500",
            isFocused && "opacity-100"
          )}
          style={{
            background: "linear-gradient(135deg, #00f2ea20, #ff005020, #00f2ea20)",
          }}
        />

        <div
          className={cn(
            "relative flex h-10 items-center gap-2 rounded-xl border px-3 transition-all duration-300",
            isFocused
              ? "border-foreground/15 bg-card shadow-lg"
              : "border-border/60 bg-card/80 shadow-sm hover:border-foreground/10 hover:bg-card hover:shadow-md"
          )}
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Search..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => {
                onSearchChange("");
                inputRef.current?.focus();
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Sort pills */}
      <div className="flex gap-1 rounded-lg border border-border/50 bg-muted/30 p-1">
        {SORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => onSortChange(option.value)}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ${
              sortBy === option.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
