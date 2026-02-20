"use client";

import Link from "next/link";
import { CommunityItem } from "@/lib/api";
import { CommunityCard } from "./community-card";
import { FileText, Search } from "lucide-react";

interface CommunityGridProps {
  items: CommunityItem[];
  isLoading: boolean;
  hasActiveFilters?: boolean;
  searchQuery?: string;
  onClearFilters?: () => void;
  onTagClick?: (tag: string) => void;
}

export function CommunityGrid({
  items,
  isLoading,
  hasActiveFilters,
  searchQuery,
  onClearFilters,
  onTagClick,
}: CommunityGridProps) {
  if (isLoading && items.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col rounded-2xl border border-border/30 bg-card p-6">
            <div className="h-5 w-3/4 animate-pulse rounded-md bg-muted/60" />
            <div className="mt-3 h-4 w-full animate-pulse rounded-md bg-muted/40" />
            <div className="mt-1.5 h-4 w-2/3 animate-pulse rounded-md bg-muted/40" />
            <div className="mt-4 flex gap-1.5">
              <div className="h-5 w-14 animate-pulse rounded-full bg-muted/40" />
              <div className="h-5 w-12 animate-pulse rounded-full bg-muted/40" />
            </div>
            <div className="mt-auto border-t border-border/20 pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 animate-pulse rounded-full bg-muted/50" />
                  <div className="h-3 w-16 animate-pulse rounded-md bg-muted/40" />
                </div>
                <div className="h-3 w-20 animate-pulse rounded-md bg-muted/30" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0 && hasActiveFilters) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50">
          <Search className="h-8 w-8 text-muted-foreground/40" />
        </div>
        <h3 className="mt-5 text-lg font-semibold tracking-tight text-foreground">
          No results{searchQuery ? ` for "${searchQuery}"` : ""}
        </h3>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Try different keywords or clear your filters.
        </p>
        {onClearFilters && (
          <button
            onClick={onClearFilters}
            className="mt-4 rounded-lg border border-border/60 px-4 py-2 text-sm font-medium text-foreground transition-all hover:border-foreground/20"
          >
            Clear filters
          </button>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50">
          <FileText className="h-8 w-8 text-muted-foreground/40" />
        </div>
        <h3 className="mt-5 text-lg font-semibold tracking-tight text-foreground">
          No published documents yet
        </h3>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Be the first to share your work with the community.
        </p>
        <Link
          href="/editor"
          className="mt-4 rounded-lg border border-border/60 px-4 py-2 text-sm font-medium text-foreground transition-all hover:border-foreground/20"
        >
          Start writing
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <CommunityCard key={item.share_id} item={item} onTagClick={onTagClick} />
      ))}
    </div>
  );
}
