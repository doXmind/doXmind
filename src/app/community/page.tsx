"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { CommunityHeader } from "@/components/community/community-header";
import { CommunityGrid } from "@/components/community/community-grid";
import { TagFilterBar } from "@/components/community/tag-filter-bar";
import { useCommunityStore } from "@/stores/community-store";
import { AlertCircle, Loader2 } from "lucide-react";

function CommunityContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    items,
    isLoading,
    hasMore,
    sortBy,
    searchQuery,
    tagFilter,
    error,
    loadItems,
    loadMore,
    setSortBy,
    setSearchQuery,
    setTagFilter,
  } = useCommunityStore();

  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  // Initialize store from URL params on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const urlSort = searchParams.get("sort");
    const urlSearch = searchParams.get("q");
    const urlTag = searchParams.get("tag");

    if (urlSort && ["newest", "popular", "most_viewed"].includes(urlSort)) {
      useCommunityStore.setState({ sortBy: urlSort as "newest" | "popular" | "most_viewed" });
    }
    if (urlSearch) {
      useCommunityStore.setState({ searchQuery: urlSearch });
    }
    if (urlTag) {
      useCommunityStore.setState({ tagFilter: urlTag });
    }

    loadItems();
  }, [searchParams, loadItems]);

  // Sync state to URL (shallow)
  const updateUrl = useCallback(
    (params: { sort?: string; q?: string; tag?: string }) => {
      const current = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(params)) {
        if (value) {
          current.set(key, value);
        } else {
          current.delete(key);
        }
      }

      // Remove defaults
      if (current.get("sort") === "newest") current.delete("sort");

      const qs = current.toString();
      router.replace(qs ? `/community?${qs}` : "/community", { scroll: false });
    },
    [searchParams, router]
  );

  const handleSearchChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        loadItems();
        updateUrl({ q: query || undefined });
      }, 400);
    },
    [setSearchQuery, loadItems, updateUrl]
  );

  const handleSortChange = useCallback(
    (sort: "newest" | "popular" | "most_viewed") => {
      setSortBy(sort);
      updateUrl({ sort });
    },
    [setSortBy, updateUrl]
  );

  const handleTagSelect = useCallback(
    (tag: string) => {
      setTagFilter(tag);
      updateUrl({ tag: tag || undefined });
    },
    [setTagFilter, updateUrl]
  );

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setTagFilter("");
    loadItems();
    router.replace("/community", { scroll: false });
  }, [setSearchQuery, setTagFilter, loadItems, router]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          loadMore();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, loadMore]);

  const hasActiveFilters = !!(searchQuery || tagFilter);

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        {/* Hero */}
        <div className="border-b border-border/40">
          <div className="mx-auto max-w-6xl px-6 py-14 sm:px-8 lg:px-10">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Community
            </h1>
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
              Discover and fork documents shared by the community.
            </p>
          </div>
        </div>

        {/* Controls + Grid */}
        <div className="mx-auto max-w-6xl px-6 py-10 sm:px-8 lg:px-10">
          <CommunityHeader
            sortBy={sortBy}
            searchQuery={searchQuery}
            onSortChange={handleSortChange}
            onSearchChange={handleSearchChange}
          />

          <TagFilterBar activeTag={tagFilter} onTagSelect={handleTagSelect} />

          {error && (
            <div className="mb-8 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
              <button
                onClick={() => loadItems()}
                className="ml-auto shrink-0 text-xs font-medium underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          )}

          <CommunityGrid
            items={items}
            isLoading={isLoading}
            hasActiveFilters={hasActiveFilters}
            searchQuery={searchQuery}
            onClearFilters={handleClearFilters}
            onTagClick={handleTagSelect}
          />

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-1" />

          {isLoading && items.length > 0 && (
            <div className="mt-12 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

export default function CommunityPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="flex h-screen items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </AppShell>
      }
    >
      <CommunityContent />
    </Suspense>
  );
}
