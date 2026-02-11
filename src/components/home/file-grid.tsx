"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LayoutTemplate,
  List,
  Upload,
  Loader2,
  SearchX,
  Home,
  FolderOpen,
  FolderPlus,
  FilePlus,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { cn, getErrorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useFileStore,
  sortFilesByOption,
  type FileItem,
  type SortOption,
} from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { type SearchResultItem } from "@/lib/api";
import { markdownToHtml } from "@/lib/markdown";
import { useDragPageTransition } from "@/hooks/use-drag-page-transition";
import { TemplatePicker, type FileTemplate } from "@/components/sidebar/template-picker";
import { FileCard } from "./file-card";
import { FileRow } from "./file-row";
import { EmptyState } from "./empty-state";

interface FileGridProps {
  files: FileItem[];
  isLoading: boolean;
  searchQuery: string;
  searchResults: SearchResultItem[];
  isSearching: boolean;
  hideActions?: boolean;
  maxColumns?: number;
  onResultClick?: (fileId: string, position: number, score: number) => void;
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
  hideActions,
  maxColumns,
  onResultClick,
}: FileGridProps) {
  const {
    createFile,
    createFolder,
    importFile,
    currentFolderId,
    setCurrentFolder,
    getFile,
    getFolders,
    moveFileToFolder,
    sortBy,
    setSortBy,
  } = useFileStore();
  const router = useRouter();
  const { homeViewMode, setHomeViewMode } = useLayoutStore();
  const [isImporting, setIsImporting] = useState(false);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [isDraggingOverRoot, setIsDraggingOverRoot] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSearchActive = searchQuery.trim().length > 0;
  const isGrid = homeViewMode === "grid" || isSearchActive;
  const pageSize = usePageSize(isGrid);

  // Pagination — declared early so the drag hook can reference it
  // (totalPages is computed further down after displayFiles)

  // Get current folder info for breadcrumb
  const currentFolder = currentFolderId ? getFile(currentFolderId) : null;

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
    // When searching, show all matching files regardless of folder
    if (isSearchActive) {
      const sorted = [...files].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      return sorted
        .filter((f) => searchMatchMap.has(f.id))
        .sort((a, b) => {
          const scoreA = searchMatchMap.get(a.id)?.score ?? 0;
          const scoreB = searchMatchMap.get(b.id)?.score ?? 0;
          return scoreB - scoreA;
        });
    }

    // When not searching, filter by current folder
    const inCurrentFolder = files.filter((f) => {
      // If in root, show root files and folders
      if (currentFolderId === null) {
        return f.parentId === null;
      }
      // If in a folder, show files in that folder (folders are always at root)
      return !f.isFolder && f.parentId === currentFolderId;
    });

    // Sort: folders first (when at root), then by selected sort option
    const folders = inCurrentFolder.filter((f) => f.isFolder);
    const nonFolders = inCurrentFolder.filter((f) => !f.isFolder);
    return [...sortFilesByOption(folders, sortBy), ...sortFilesByOption(nonFolders, sortBy)];
  }, [files, isSearchActive, searchMatchMap, currentFolderId, sortBy]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(displayFiles.length / pageSize));
  const pagedFiles = useMemo(
    () => displayFiles.slice(page * pageSize, (page + 1) * pageSize),
    [displayFiles, page, pageSize]
  );

  // Cross-page drag-and-drop (iOS-style edge navigation)
  const {
    isDragActive,
    activeEdge,
    dwellProgress,
    dragHoveredPage,
    gridRef,
    onDragOver: handleGridDragOver,
    onDragLeave: handleGridDragLeave,
    onDrop: handleGridDrop,
    getPageButtonDragProps,
  } = useDragPageTransition({
    page,
    totalPages,
    setPage,
    enabled: totalPages > 1,
  });

  // Frozen key: keep the same key during drag so React doesn't unmount the grid
  // (unmounting kills the HTML5 drag operation). When not dragging, use page-based
  // key for smooth page-flip animations.
  const gridKeyBase = isSearchActive ? "search-grid" : "grid";
  const gridKey = isDragActive ? `${gridKeyBase}-drag` : `${gridKeyBase}-${page}`;
  const listKey = isDragActive ? "list-drag" : `list-${page}`;

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
      const newId = await createFile(`Untitled-${files.length + 1}.md`, "", currentFolderId);
      router.push(`/editor/${newId}`);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleTemplateSelect = async (template: FileTemplate) => {
    const currentFiles = files.filter((f) => !f.isFolder && f.parentId === currentFolderId);
    let counter = 0;
    let name: string;
    do {
      counter++;
      name =
        counter === 1
          ? `${template.defaultFileName}.md`
          : `${template.defaultFileName} ${counter}.md`;
    } while (currentFiles.some((f) => f.name === name));

    try {
      const markdown = template.getContent();
      const htmlContent = markdown ? markdownToHtml(markdown) : "";
      const newId = await createFile(name, htmlContent, currentFolderId);
      router.push(`/editor/${newId}`);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
      throw error;
    }
  };

  const handleCreateFolder = async () => {
    const folders = getFolders();
    const name = `New Folder ${folders.length + 1}`;
    try {
      await createFolder(name);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
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
      const newId = await importFile(file);
      router.push(`/editor/${newId}`);
      toast.success(`Imported "${file.name}" successfully`);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setIsImporting(false);
    }
  };

  // Drag and drop handlers for moving files to root
  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDraggingOverRoot(true);
  };

  const handleRootDragLeave = () => {
    setIsDraggingOverRoot(false);
  };

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOverRoot(false);

    const draggedFileId = e.dataTransfer.getData("text/plain");
    if (draggedFileId) {
      try {
        await moveFileToFolder(draggedFileId, null);
        toast.success("File moved to root");
      } catch {
        toast.error("Failed to move file");
      }
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
        <div
          className={cn(
            "grid grid-cols-1 gap-6 sm:grid-cols-2",
            maxColumns !== 2 && "lg:grid-cols-3"
          )}
        >
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
      {/* Breadcrumb navigation - only show when in a folder or searching */}
      {(currentFolderId || isSearchActive) && (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <button
            onClick={() => setCurrentFolder(null)}
            onDragOver={handleRootDragOver}
            onDragLeave={handleRootDragLeave}
            onDrop={handleRootDrop}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 transition-all",
              isDraggingOverRoot
                ? "scale-105 bg-blue-100 text-blue-700 ring-2 ring-blue-400/50 dark:bg-blue-900/30 dark:text-blue-300"
                : "hover:bg-accent hover:text-foreground"
            )}
          >
            <Home className="h-4 w-4" />
            <span>All Files</span>
          </button>
          {currentFolder && !isSearchActive && (
            <>
              <ChevronRight className="h-4 w-4 text-muted-foreground/30" />
              <div className="flex items-center gap-1.5 rounded-md bg-accent/50 px-2 py-1">
                <FolderOpen className="h-4 w-4 text-amber-500" />
                <span className="font-medium text-foreground">{currentFolder.name}</span>
              </div>
            </>
          )}
          {isSearchActive && (
            <>
              <ChevronRight className="h-4 w-4 text-muted-foreground/30" />
              <span className="text-muted-foreground/60">Search Results</span>
            </>
          )}
        </div>
      )}

      {/* Section header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground/60">
            {isSearchActive ? "Results" : currentFolder ? currentFolder.name : "Documents"}
          </h2>
          <span className="text-xs text-muted-foreground/30">{displayFiles.length}</span>
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

              {/* Sort dropdown */}
              <HomeSortDropdown sortBy={sortBy} setSortBy={setSortBy} />

              <div className="hidden h-4 w-px bg-border/50 md:block" />
            </>
          )}

          {/* Actions */}
          {!hideActions && (
            <>
              {/* New Folder button - disabled when inside folder (single-level hierarchy) */}
              <Tooltip
                content={currentFolderId ? "Only one folder level allowed" : "Create New Folder"}
                side="bottom"
              >
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 text-xs font-medium"
                  onClick={handleCreateFolder}
                  disabled={!!currentFolderId}
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  Folder
                </Button>
              </Tooltip>
              <Tooltip content="Create New Document" side="bottom">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 text-xs font-medium"
                  onClick={handleCreate}
                >
                  <FilePlus className="h-3.5 w-3.5" />
                  New
                </Button>
              </Tooltip>
              <Tooltip content="New from Template" side="bottom">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 text-xs font-medium"
                  onClick={() => setIsTemplatePickerOpen(true)}
                >
                  <LayoutTemplate className="h-3.5 w-3.5" />
                  Template
                </Button>
              </Tooltip>
              <Tooltip content="Import File" side="bottom">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 text-xs font-medium"
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
              </Tooltip>
            </>
          )}
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
              {/* Desktop: paginated grid with cross-page drag zones */}
              <div
                ref={gridRef}
                className="relative hidden sm:block"
                onDragOver={handleGridDragOver}
                onDragLeave={handleGridDragLeave}
                onDrop={handleGridDrop}
              >
                {/* Left edge indicator */}
                {activeEdge === "left" && page > 0 && (
                  <DragEdgeIndicator side="left" progress={dwellProgress} />
                )}

                <motion.div
                  className={cn(
                    "grid gap-8 py-2 sm:grid-cols-2",
                    maxColumns !== 2 && "lg:grid-cols-3"
                  )}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  key={gridKey}
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
                            duration: isDragActive ? 0.15 : 0.4,
                            delay: isDragActive ? 0 : i * 0.06,
                            ease: [0.16, 1, 0.3, 1] as const,
                          },
                        }}
                        layout
                        exit={
                          isDragActive
                            ? { opacity: 0, transition: { duration: 0.1 } }
                            : { opacity: 0, scale: 0.95, transition: { duration: 0.2 } }
                        }
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
                          onResultClick={onResultClick}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </motion.div>

                {/* Right edge indicator */}
                {activeEdge === "right" && page < totalPages - 1 && (
                  <DragEdgeIndicator side="right" progress={dwellProgress} />
                )}
              </div>

              {/* Mobile: horizontal scroll carousel */}
              <MobileCarousel
                files={displayFiles}
                isSearchActive={isSearchActive}
                searchMatchMap={searchMatchMap}
                searchQuery={searchQuery}
                onResultClick={onResultClick}
              />
            </>
          ) : (
            <div
              ref={gridRef}
              className="relative"
              onDragOver={handleGridDragOver}
              onDragLeave={handleGridDragLeave}
              onDrop={handleGridDrop}
            >
              {/* Left edge indicator */}
              {activeEdge === "left" && page > 0 && (
                <DragEdgeIndicator side="left" progress={dwellProgress} />
              )}

              <motion.div
                className={cn(
                  "rounded-[3px]",
                  "border border-stone-200/40 dark:border-neutral-700/25",
                  "bg-[#fdfcfa]/40 dark:bg-[#1e1e20]/30"
                )}
                style={{ boxShadow: LIST_SHADOW }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                key={listKey}
              >
                {pagedFiles.map((file, i) => (
                  <motion.div
                    key={file.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      transition: {
                        duration: isDragActive ? 0.15 : 0.4,
                        delay: isDragActive ? 0 : i * 0.06,
                        ease: [0.16, 1, 0.3, 1] as const,
                      },
                    }}
                    className={cn(
                      i > 0 && "border-t border-stone-200/25 dark:border-neutral-700/15"
                    )}
                  >
                    <FileRow file={file} index={i} />
                  </motion.div>
                ))}
              </motion.div>

              {/* Right edge indicator */}
              {activeEdge === "right" && page < totalPages - 1 && (
                <DragEdgeIndicator side="right" progress={dwellProgress} />
              )}
            </div>
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

              {Array.from({ length: totalPages }).map((_, i) => {
                const pageDragProps = getPageButtonDragProps(i);
                return (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    {...pageDragProps}
                    className={cn(
                      "h-7 min-w-[28px] rounded-md px-1.5 text-xs transition-all",
                      i === page
                        ? "bg-foreground/[0.07] font-medium text-foreground"
                        : "text-muted-foreground/40 hover:text-foreground",
                      dragHoveredPage === i &&
                        "scale-110 bg-foreground/[0.07] ring-2 ring-foreground/20"
                    )}
                  >
                    {i + 1}
                  </button>
                );
              })}

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

      {/* Template Picker Modal */}
      <TemplatePicker
        open={isTemplatePickerOpen}
        onClose={() => setIsTemplatePickerOpen(false)}
        onSelect={handleTemplateSelect}
      />
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Sort dropdown for the home page (mirrors sidebar sort-dropdown design)
// ---------------------------------------------------------------------------

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "modified-newest", label: "Modified (Newest)" },
  { value: "modified-oldest", label: "Modified (Oldest)" },
  { value: "created-newest", label: "Created (Newest)" },
  { value: "created-oldest", label: "Created (Oldest)" },
];

function HomeSortDropdown({
  sortBy,
  setSortBy,
}: {
  sortBy: SortOption;
  setSortBy: (v: SortOption) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip content="Sort files" side="bottom">
        <DropdownMenuTrigger asChild>
          <button
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Sort files"
          >
            <ArrowUpDown className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        {SORT_OPTIONS.slice(0, 2).map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => setSortBy(opt.value)}
            className="flex items-center justify-between"
          >
            <span>{opt.label}</span>
            {sortBy === opt.value && <Check className="h-3.5 w-3.5 text-foreground/50" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {SORT_OPTIONS.slice(2, 4).map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => setSortBy(opt.value)}
            className="flex items-center justify-between"
          >
            <span>{opt.label}</span>
            {sortBy === opt.value && <Check className="h-3.5 w-3.5 text-foreground/50" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {SORT_OPTIONS.slice(4).map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => setSortBy(opt.value)}
            className="flex items-center justify-between"
          >
            <span>{opt.label}</span>
            {sortBy === opt.value && <Check className="h-3.5 w-3.5 text-foreground/50" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Edge indicator shown during cross-page drag (iOS-style page transition hint)
// ---------------------------------------------------------------------------

function DragEdgeIndicator({ side, progress }: { side: "left" | "right"; progress: number }) {
  const circumference = 2 * Math.PI * 14; // r=14
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-0 top-0 z-10 flex items-center",
        side === "left" ? "-left-8" : "-right-8"
      )}
    >
      <motion.div
        className="flex h-12 w-12 items-center justify-center"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ duration: 0.15 }}
      >
        {/* Progress ring */}
        <svg className="absolute h-10 w-10 -rotate-90" viewBox="0 0 36 36">
          <circle
            cx="18"
            cy="18"
            r="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-foreground/5"
          />
          <circle
            cx="18"
            cy="18"
            r="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-foreground/30"
            strokeDasharray={`${progress * circumference} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
        {/* Arrow */}
        {side === "left" ? (
          <ChevronLeft className="h-5 w-5 text-foreground/40" />
        ) : (
          <ChevronRight className="h-5 w-5 text-foreground/40" />
        )}
      </motion.div>
    </div>
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
  onResultClick,
}: {
  files: FileItem[];
  isSearchActive: boolean;
  searchMatchMap: Map<string, { snippet: string; score: number }>;
  searchQuery: string;
  onResultClick?: (fileId: string, position: number, score: number) => void;
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
              onResultClick={onResultClick}
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
