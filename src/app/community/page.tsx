"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { AppShell } from "@/components/layout/app-shell";
import { CommunityHeader } from "@/components/community/community-header";
import { CommunityFeed } from "@/components/community/community-feed";
import { TagFilterBar } from "@/components/community/tag-filter-bar";
import { useCommunityStore } from "@/stores/community-store";
import { useAuthStore } from "@/stores/auth-store";
import { AlertCircle, Loader2 } from "lucide-react";

function CommunityContent() {
  const t = useTranslations("community");
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    items,
    isLoading,
    hasMore,
    total,
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
  const loadItemsRef = useRef(loadItems);
  loadItemsRef.current = loadItems;

  useEffect(() => {
    document.title = "Community";
  }, []);

  // Initialize store from URL params on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const urlSort = searchParams.get("sort");
    const urlSearch = searchParams.get("q");
    const urlTag = searchParams.get("tag");

    if (urlSort && ["newest", "popular", "most_viewed", "for_you", "following"].includes(urlSort)) {
      useCommunityStore.setState({
        sortBy: urlSort as "newest" | "popular" | "most_viewed" | "for_you" | "following",
      });
    } else if (useAuthStore.getState().user) {
      useCommunityStore.setState({ sortBy: "for_you" });
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

  const updateUrlRef = useRef(updateUrl);
  updateUrlRef.current = updateUrl;

  const handleSearchChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        loadItemsRef.current();
        updateUrlRef.current({ q: query || undefined });
      }, 500);
    },
    [setSearchQuery]
  );

  const handleSortChange = useCallback(
    (sort: "newest" | "popular" | "most_viewed" | "for_you" | "following") => {
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
  const hasMoreRef = useRef(hasMore);
  const isLoadingRef = useRef(isLoading);
  const sentinelVisibleRef = useRef(false);
  hasMoreRef.current = hasMore;
  isLoadingRef.current = isLoading;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        sentinelVisibleRef.current = entries[0].isIntersecting;
        if (entries[0].isIntersecting && hasMoreRef.current && !isLoadingRef.current) {
          loadMore();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => {
      sentinelVisibleRef.current = false;
      observer.disconnect();
    };
  }, [loadMore]);

  useEffect(() => {
    if (!isLoading && hasMore && sentinelVisibleRef.current) {
      loadMore();
    }
  }, [isLoading, hasMore, loadMore]);

  const hasActiveFilters = !!(searchQuery || tagFilter);

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          {/* Feed + Sidebar layout */}
          <div className="flex gap-8 py-6">
            {/* ── Main feed column ────────────────────────── */}
            <div className="min-w-0 flex-1">
              {/* Header: sort tabs + search */}
              <CommunityHeader
                sortBy={sortBy}
                searchQuery={searchQuery}
                onSortChange={handleSortChange}
                onSearchChange={handleSearchChange}
              />

              {/* Active tag filter indicator */}
              {tagFilter && (
                <div className="mb-4 flex items-center gap-2 text-[13px]">
                  <span className="text-muted-foreground">Filtered by</span>
                  <span className="rounded-full bg-foreground/10 px-2.5 py-0.5 text-[12px] font-medium text-foreground">
                    {tagFilter}
                  </span>
                  <button
                    onClick={() => handleTagSelect("")}
                    className="text-muted-foreground/60 transition-colors hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
              )}

              {error && (
                <div className="mb-4 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
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

              {/* Feed */}
              <CommunityFeed
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
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
                </div>
              )}
            </div>

            {/* ── Right sidebar (lg+) ─────────────────────── */}
            <motion.aside
              className="hidden w-72 shrink-0 lg:block"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              <div className="sticky top-6 space-y-6">
                {/* About */}
                <div className="rounded-xl border border-border bg-card p-4">
                  <h2 className="text-[13px] font-semibold text-foreground">{t("community")}</h2>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                    {t("sidebarDesc")}
                  </p>
                  {total > 0 && (
                    <div className="mt-3 border-t border-border pt-3 text-[12px] text-muted-foreground">
                      {t("documentsPublished", { count: total })}
                    </div>
                  )}
                </div>

                {/* Tags */}
                <TagFilterBar activeTag={tagFilter} onTagSelect={handleTagSelect} />
              </div>
            </motion.aside>
          </div>

          {/* Mobile tags (below lg) */}
          <div className="lg:hidden">
            <TagFilterBar activeTag={tagFilter} onTagSelect={handleTagSelect} />
          </div>
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
