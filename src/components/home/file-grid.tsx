"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  Plus,
  Upload,
  Loader2,
  SearchX,
} from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { cn, getErrorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { type SearchResultItem } from "@/lib/api";
import { FileCard } from "./file-card";
import { FileRow } from "./file-row";
import { EmptyState } from "./empty-state";

interface FileGridProps {
  files: FileItem[];
  isLoading: boolean;
  searchQuery: string;
  searchResults: SearchResultItem[];
  isSearching: boolean;
}

// Layout constants for page size calculation
// Overhead: header(48) + hero(pt-12 + greeting + mb-8 + search ≈ 220) + section-header(mt-10 + mb-6 + row ≈ 96) + pagination(mt-8 + controls ≈ 60) + bottom-pad(48)
const LAYOUT_OVERHEAD = 472;
const GRID_CARD_HEIGHT = 242; // min-h-[230px] + pb-1.5 + stacked pages offset
const GRID_GAP = 32; // gap-8
const LIST_ROW_HEIGHT = 53; // py-3.5 + content + border

function usePageSize(isGrid: boolean) {
  const calc = useCallback(() => {
    if (typeof window === "undefined") return 6;
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // Mobile: show all files with natural scroll (no pagination)
    if (vw < 640) return Infinity;

    const available = Math.max(vh - LAYOUT_OVERHEAD, GRID_CARD_HEIGHT);

    if (isGrid) {
      const cols = vw >= 1024 ? 3 : vw >= 640 ? 2 : 1;
      const rows = Math.max(1, Math.floor((available + GRID_GAP) / (GRID_CARD_HEIGHT + GRID_GAP)));
      return rows * cols;
    }
    return Math.max(3, Math.floor(available / LIST_ROW_HEIGHT));
  }, [isGrid]);

  const [pageSize, setPageSize] = useState(calc);

  useEffect(() => {
    const onResize = () => setPageSize(calc());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [calc]);

  return pageSize;
}

// Paper shadow for list container
const LIST_SHADOW = [
  "0 1px 1px rgba(0,0,0,0.03)",
  "0 2px 4px rgba(0,0,0,0.025)",
  "0 4px 8px rgba(0,0,0,0.02)",
].join(",");

export function FileGrid({
  files,
  isLoading,
  searchQuery,
  searchResults,
  isSearching,
}: FileGridProps) {
  const { createFile, importFile } = useFileStore();
  const { homeViewMode, setHomeViewMode } = useLayoutStore();
  const [isImporting, setIsImporting] = useState(false);
  const [page, setPage] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSearchActive = searchQuery.trim().length > 0;
  const isGrid = homeViewMode === "grid" || isSearchActive;
  const pageSize = usePageSize(isGrid);

  // Build search match lookup: file_id → { snippet, score }
  const searchMatchMap = useMemo(() => {
    if (!isSearchActive) return new Map<string, { snippet: string; score: number }>();
    const map = new Map<string, { snippet: string; score: number }>();
    for (const result of searchResults) {
      const fileId = result.metadata.file_id;
      // Keep the best match per file (first occurrence = best relevance)
      if (!map.has(fileId)) {
        map.set(fileId, {
          snippet: result.content.replace(/\n/g, " ").slice(0, 150),
          score: Math.round((1 - (result.distance ?? 0)) * 100),
        });
      }
    }
    return map;
  }, [isSearchActive, searchResults]);

  // Determine which files to show
  const displayFiles = useMemo(() => {
    const sorted = [...files].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    if (!isSearchActive) return sorted;

    // Filter to matched files, sorted by relevance (highest score first)
    return sorted
      .filter((f) => searchMatchMap.has(f.id))
      .sort((a, b) => {
        const scoreA = searchMatchMap.get(a.id)?.score ?? 0;
        const scoreB = searchMatchMap.get(b.id)?.score ?? 0;
        return scoreB - scoreA;
      });
  }, [files, isSearchActive, searchMatchMap]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(displayFiles.length / pageSize));
  const pagedFiles = useMemo(
    () => displayFiles.slice(page * pageSize, (page + 1) * pageSize),
    [displayFiles, page, pageSize]
  );

  // Reset page when search query, view mode, or file count changes
  useEffect(() => {
    setPage(0);
  }, [searchQuery, homeViewMode, files.length]);

  // Clamp page if it goes out of bounds (e.g. after deletion)
  useEffect(() => {
    if (page >= totalPages) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  const handleCreate = async () => {
    try {
      await createFile(`Untitled-${files.length + 1}.md`);
    } catch {
      // handled by store
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setIsImporting(true);
    try {
      await importFile(file);
      toast.success(`Imported "${file.name}" successfully`);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setIsImporting(false);
    }
  };

  // Loading skeleton
  if (isLoading && files.length === 0) {
    return (
      <div className="mx-auto mt-10 w-full max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-36" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-[230px] rounded-[3px] bg-stone-100/50 dark:bg-neutral-800/30"
            />
          ))}
        </div>
      </div>
    );
  }

  // Empty state (no files at all)
  if (!isLoading && files.length === 0) {
    return <EmptyState />;
  }

  return (
    <motion.div
      className="mx-auto mt-10 w-full max-w-5xl md:mt-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.4 }}
    >
      {/* Section header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground/60">
            {isSearchActive ? "Results" : "Documents"}
          </h2>
          <span className="text-xs text-muted-foreground/30">
            {isSearchActive ? displayFiles.length : files.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle — hide during search */}
          {!isSearchActive && (
            <>
              <div className="hidden items-center gap-0.5 rounded-lg p-0.5 md:flex">
                <Tooltip content="Grid view" side="bottom">
                  <button
                    onClick={() => setHomeViewMode("grid")}
                    className={cn(
                      "rounded-md p-1.5 transition-colors",
                      homeViewMode === "grid"
                        ? "text-foreground"
                        : "text-muted-foreground/30 hover:text-muted-foreground"
                    )}
                    aria-label="Grid view"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                </Tooltip>
                <Tooltip content="List view" side="bottom">
                  <button
                    onClick={() => setHomeViewMode("list")}
                    className={cn(
                      "rounded-md p-1.5 transition-colors",
                      homeViewMode === "list"
                        ? "text-foreground"
                        : "text-muted-foreground/30 hover:text-muted-foreground"
                    )}
                    aria-label="List view"
                  >
                    <List className="h-4 w-4" />
                  </button>
                </Tooltip>
              </div>

              <div className="hidden h-4 w-px bg-border/50 md:block" />
            </>
          )}

          {/* Actions */}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs font-medium"
            onClick={handleCreate}
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs font-medium text-muted-foreground"
            onClick={handleImportClick}
            disabled={isImporting}
          >
            {isImporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Import
          </Button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* No search results */}
      {isSearchActive && !isSearching && displayFiles.length === 0 && (
        <motion.div
          className="flex flex-col items-center justify-center py-20 text-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <SearchX className="mb-4 h-10 w-10 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground/50">
            No documents match &quot;{searchQuery}&quot;
          </p>
        </motion.div>
      )}

      {/* File grid/list */}
      {displayFiles.length > 0 && (
        <>
          {isGrid ? (
            <>
              {/* Desktop: paginated grid */}
              <motion.div
                className="hidden gap-8 py-2 sm:grid sm:grid-cols-2 lg:grid-cols-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                key={`${isSearchActive ? "search-grid" : "grid"}-${page}`}
              >
                <AnimatePresence mode="popLayout">
                  {pagedFiles.map((file, i) => (
                    <motion.div
                      key={file.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        transition: {
                          duration: 0.4,
                          delay: i * 0.06,
                          ease: [0.16, 1, 0.3, 1] as const,
                        },
                      }}
                      layout
                      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                    >
                      <FileCard
                        file={file}
                        index={i}
                        searchMatch={
                          isSearchActive
                            ? {
                                ...searchMatchMap.get(file.id)!,
                                query: searchQuery,
                              }
                            : undefined
                        }
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>

              {/* Mobile: horizontal scroll carousel */}
              <MobileCarousel
                files={displayFiles}
                isSearchActive={isSearchActive}
                searchMatchMap={searchMatchMap}
                searchQuery={searchQuery}
              />
            </>
          ) : (
            <motion.div
              className={cn(
                "rounded-[3px]",
                "border border-stone-200/40 dark:border-neutral-700/25",
                "bg-[#fdfcfa]/40 dark:bg-[#1e1e20]/30"
              )}
              style={{ boxShadow: LIST_SHADOW }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              key={`list-${page}`}
            >
              {pagedFiles.map((file, i) => (
                <motion.div
                  key={file.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: {
                      duration: 0.4,
                      delay: i * 0.06,
                      ease: [0.16, 1, 0.3, 1] as const,
                    },
                  }}
                  className={cn(i > 0 && "border-t border-stone-200/25 dark:border-neutral-700/15")}
                >
                  <FileRow file={file} index={i} />
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i)}
                  className={cn(
                    "h-7 min-w-[28px] rounded-md px-1.5 text-xs transition-colors",
                    i === page
                      ? "bg-foreground/[0.07] font-medium text-foreground"
                      : "text-muted-foreground/40 hover:text-foreground"
                  )}
                >
                  {i + 1}
                </button>
              ))}

              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Mobile horizontal carousel with snap-scroll + dot indicators
// ---------------------------------------------------------------------------

function MobileCarousel({
  files,
  isSearchActive,
  searchMatchMap,
  searchQuery,
}: {
  files: FileItem[];
  isSearchActive: boolean;
  searchMatchMap: Map<string, { snippet: string; score: number }>;
  searchQuery: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Track scroll position to update dot indicator
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      const scrollLeft = el.scrollLeft;
      const cardWidth = el.firstElementChild
        ? (el.firstElementChild as HTMLElement).offsetWidth
        : 1;
      // gap-4 = 16px
      setActiveIndex(Math.round(scrollLeft / (cardWidth + 16)));
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [files.length]);

  const totalDots = files.length;
  // Show max 7 dots, centered around active
  const maxDots = 7;
  let dotStart = 0;
  let dotEnd = totalDots;
  if (totalDots > maxDots) {
    dotStart = Math.max(0, activeIndex - Math.floor(maxDots / 2));
    dotEnd = dotStart + maxDots;
    if (dotEnd > totalDots) {
      dotEnd = totalDots;
      dotStart = dotEnd - maxDots;
    }
  }

  return (
    <motion.div className="sm:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Scrollable row — extend to viewport edges with negative margin + padding */}
      <div
        ref={scrollRef}
        className="hide-scrollbar -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 py-2"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {files.map((file, i) => (
          <motion.div
            key={file.id}
            className="w-[80vw] max-w-[320px] flex-shrink-0 snap-center"
            initial={{ opacity: 0, x: 30 }}
            animate={{
              opacity: 1,
              x: 0,
              transition: {
                duration: 0.4,
                delay: Math.min(i * 0.06, 0.3),
                ease: [0.16, 1, 0.3, 1] as const,
              },
            }}
          >
            <FileCard
              file={file}
              index={i}
              searchMatch={
                isSearchActive
                  ? {
                      ...searchMatchMap.get(file.id)!,
                      query: searchQuery,
                    }
                  : undefined
              }
            />
          </motion.div>
        ))}
      </div>

      {/* Dot indicators */}
      {totalDots > 1 && (
        <div className="mt-4 flex items-center justify-center gap-1.5">
          {dotStart > 0 && <span className="h-1 w-1 rounded-full bg-muted-foreground/15" />}
          {Array.from({ length: dotEnd - dotStart }).map((_, i) => {
            const idx = dotStart + i;
            return (
              <span
                key={idx}
                className={cn(
                  "rounded-full transition-all duration-200",
                  idx === activeIndex
                    ? "h-1.5 w-1.5 bg-foreground/40"
                    : "h-1 w-1 bg-muted-foreground/15"
                )}
              />
            );
          })}
          {dotEnd < totalDots && <span className="h-1 w-1 rounded-full bg-muted-foreground/15" />}
        </div>
      )}
    </motion.div>
  );
}
