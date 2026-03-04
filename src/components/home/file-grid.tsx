"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  SearchX,
  Home,
  FolderOpen,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { cn, getErrorMessage } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { useFileStore, sortFilesByOption, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { type SearchResultItem } from "@/lib/api";
import { markdownToHtml } from "@/lib/markdown";
import { useDragPageTransition } from "@/hooks/use-drag-page-transition";
import { useLocale, useTranslations } from "next-intl";
import {
  TemplatePicker,
  getLocalizedFileName,
  type FileTemplate,
} from "@/components/sidebar/template-picker";
import { TrashPanel } from "@/components/sidebar/trash-panel";
import { FileCard } from "./file-card";
import { FileRow } from "./file-row";
import { EmptyState } from "./empty-state";
import { NewButton } from "./new-button";
import { HomeSortDropdown } from "./home-sort-dropdown";
import { MobileDocumentList } from "./mobile-document-list";
import { WritingTip } from "./writing-tip";

interface FileGridProps {
  files: FileItem[];
  isLoading: boolean;
  searchQuery: string;
  searchResults: SearchResultItem[];
  isSearching: boolean;
  hideActions?: boolean;
  maxColumns?: number;
  totalDocs?: number;
  onResultClick?: (fileId: string, position: number, score: number) => void;
}

// Layout constants for page size calculation
// Overhead: header(48) + hero(pt-12 + greeting + mb-8 + search ≈ 220) + section-header(mt-10 + mb-6 + row ≈ 96) + pagination(mt-8 + controls ≈ 60) + bottom-pad(48)
const LAYOUT_OVERHEAD = 472;
const GRID_CARD_HEIGHT = 252; // min-h-[240px] + pb-1.5 + stacked pages offset
const GRID_GAP = 24; // gap-6
const LIST_ROW_HEIGHT = 57; // py-4 + content + border

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

export function FileGrid({
  files,
  isLoading,
  searchQuery,
  searchResults,
  isSearching,
  hideActions,
  maxColumns,
  totalDocs,
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
  const locale = useLocale();
  const t = useTranslations("home");
  const router = useRouter();
  const { homeViewMode, setHomeViewMode } = useLayoutStore();
  const [isImporting, setIsImporting] = useState(false);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
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
      await createFile(`${t("untitled")}-${files.length + 1}.md`, "", currentFolderId);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleTemplateSelect = async (template: FileTemplate) => {
    const currentFiles = files.filter((f) => !f.isFolder && f.parentId === currentFolderId);
    const localName = getLocalizedFileName(template.id, template.defaultFileName, locale);
    let counter = 0;
    let name: string;
    do {
      counter++;
      name = counter === 1 ? `${localName}.md` : `${localName} ${counter}.md`;
    } while (currentFiles.some((f) => f.name === name));

    try {
      const markdown = template.getContent(locale);
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
    const name = t("newFolderN", { n: folders.length + 1 });
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
    const toastId = toast.loading(t("importing", { name: file.name }));
    try {
      await importFile(file, currentFolderId);
      toast.success(t("imported", { name: file.name }), { id: toastId });
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { id: toastId, description });
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
        toast.success(t("fileMovedToRoot"));
      } catch {
        toast.error(t("failedToMoveFile"));
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
              className="h-[200px] rounded-2xl bg-muted/60 dark:bg-neutral-800/30"
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
      className="mx-auto mt-2 w-full max-w-5xl md:mt-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.4 }}
    >
      {/* Breadcrumb navigation - only show when in a folder or searching */}
      {(currentFolderId || isSearchActive) && (
        <>
          {/* Mobile: back arrow + Home / FolderName breadcrumb */}
          <div className="mb-3 flex items-center gap-1 md:hidden">
            <button
              onClick={() => setCurrentFolder(null)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground active:opacity-70"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            {currentFolder && !isSearchActive && (
              <>
                <button
                  onClick={() => setCurrentFolder(null)}
                  className="text-[13px] text-muted-foreground/60 active:opacity-70"
                >
                  {t("allFiles")}
                </button>
                <span className="text-[13px] text-muted-foreground/30">/</span>
                <span className="flex-1 truncate text-[13px] font-medium text-foreground/80">
                  {currentFolder.name}
                </span>
                <button
                  onClick={handleCreate}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 active:bg-accent/50"
                  aria-label={t("newDoc")}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </>
            )}
            {isSearchActive && (
              <span className="text-[13px] text-muted-foreground/70">{t("searchResults")}</span>
            )}
          </div>

          {/* Desktop: full breadcrumb */}
          <div className="mb-4 hidden items-center gap-2 text-sm text-muted-foreground md:flex">
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
              <span>{t("allFiles")}</span>
            </button>
            {currentFolder && !isSearchActive && (
              <>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50 dark:text-muted-foreground/60" />
                <div className="flex items-center gap-1.5 rounded-md bg-accent/50 px-2 py-1">
                  <FolderOpen className="h-4 w-4 text-amber-500" />
                  <span className="font-medium text-foreground">{currentFolder.name}</span>
                </div>
              </>
            )}
            {isSearchActive && (
              <>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50 dark:text-muted-foreground/60" />
                <span className="text-muted-foreground/70 dark:text-muted-foreground/80">
                  {t("searchResults")}
                </span>
              </>
            )}
          </div>
        </>
      )}

      {/* Unified toolbar row (hidden on mobile — tabs + compact header provide this) */}
      <div className="mb-4 hidden items-center justify-between gap-4 md:flex">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-medium text-foreground/70">
            {isSearchActive ? t("results") : currentFolder ? currentFolder.name : t("documents")}
          </h2>
          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground/60">
            {isSearchActive || currentFolder
              ? displayFiles.length
              : (totalDocs ?? displayFiles.length)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* View toggle — segmented control style */}
          {!isSearchActive && (
            <>
              <div className="hidden items-center gap-0 rounded-lg bg-muted/40 p-0.5 md:flex">
                <Tooltip content={t("gridView")} side="bottom">
                  <button
                    onClick={() => setHomeViewMode("grid")}
                    className={cn(
                      "rounded-md p-1.5 transition-all",
                      homeViewMode === "grid"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground/50 hover:text-muted-foreground"
                    )}
                    aria-label={t("gridView")}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
                <Tooltip content={t("listView")} side="bottom">
                  <button
                    onClick={() => setHomeViewMode("list")}
                    className={cn(
                      "rounded-md p-1.5 transition-all",
                      homeViewMode === "list"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground/50 hover:text-muted-foreground"
                    )}
                    aria-label={t("listView")}
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>

              {/* Sort dropdown */}
              <HomeSortDropdown sortBy={sortBy} setSortBy={setSortBy} />
            </>
          )}

          {/* Trash */}
          {!hideActions && (
            <Tooltip content={t("trash")} side="bottom">
              <button
                onClick={() => setIsTrashOpen(true)}
                className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:text-foreground"
                aria-label={t("trash")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}

          {/* Actions — single New button with dropdown (hidden on mobile, FAB replaces it) */}
          {!hideActions && (
            <div className="hidden md:block">
              <NewButton
                onCreateFile={handleCreate}
                onCreateFolder={handleCreateFolder}
                onOpenTemplatePicker={() => setIsTemplatePickerOpen(true)}
                onImportFile={handleImportClick}
                isImporting={isImporting}
                disableFolder={!!currentFolderId}
              />
            </div>
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
          <SearchX className="mb-4 h-10 w-10 text-muted-foreground/40 dark:text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground/60 dark:text-muted-foreground/70">
            {t("noMatchQuery", { query: searchQuery })}
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
                    "grid gap-6 py-2 sm:grid-cols-2",
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

              {/* Mobile: vertical document list */}
              <MobileDocumentList
                files={displayFiles}
                isSearchActive={isSearchActive}
                searchMatchMap={searchMatchMap}
                searchQuery={searchQuery}
                onResultClick={onResultClick}
              />
            </>
          ) : (
            <>
              {/* Desktop: list view with FileRow */}
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
                  className={cn("rounded-xl", "border border-border/50", "bg-card/40")}
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
                      className={cn(i > 0 && "border-t border-border/30")}
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

              {/* Mobile: swipeable document list */}
              <MobileDocumentList
                files={displayFiles}
                isSearchActive={isSearchActive}
                searchMatchMap={searchMatchMap}
                searchQuery={searchQuery}
                onResultClick={onResultClick}
              />
            </>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-10 flex items-center justify-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md p-2 text-muted-foreground/40 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
                aria-label={t("previousPage")}
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
                      "h-8 min-w-[32px] rounded-md px-1.5 text-xs transition-all",
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
                className="rounded-md p-2 text-muted-foreground/40 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
                aria-label={t("nextPage")}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}

      {/* Writing tip for sparse pages — random on each mount */}
      {!isSearchActive && displayFiles.length > 0 && displayFiles.length < 4 && <WritingTip />}

      {/* Template Picker Modal */}
      <TemplatePicker
        open={isTemplatePickerOpen}
        onClose={() => setIsTemplatePickerOpen(false)}
        onSelect={handleTemplateSelect}
      />

      {/* Trash Panel Modal */}
      <TrashPanel open={isTrashOpen} onClose={() => setIsTrashOpen(false)} />
    </motion.div>
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
