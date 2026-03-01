"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  ChevronRight,
  FileText,
  Users,
  Link2,
  GitFork,
  Bookmark,
  Plus,
  FilePlus,
  FolderPlus,
  LayoutTemplate,
  Upload,
  Loader2,
} from "lucide-react";
import { useFileStore } from "@/stores/file-store";
import { useAuthStore } from "@/stores/auth-store";
import { useLayoutStore } from "@/stores/layout-store";
import {
  api,
  type SearchResultItem,
  type Share,
  type ForkInfo,
  type CommunityItem,
  type SharedWithMeItem,
} from "@/lib/api";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { telemetry } from "@/lib/telemetry";
import { useIsMobile } from "@/hooks/use-device-type";
import { cn } from "@/lib/utils";
import { HomeSearch } from "./home-search";
import { FileGrid } from "./file-grid";
import { RecentFiles } from "./recent-files";
import { FavoritesSection } from "./favorites-section";
import { SwipeCoordinatorProvider } from "./swipe-coordinator";
import { HomeTabs } from "./home-tabs";
import { SharesSection } from "./shares-section";
import { SharedWithMeSection } from "./shared-with-me-section";
import { ForksSection } from "./forks-section";
import { BookmarksSection } from "./bookmarks-section";
import { HomeSortDropdown } from "./home-sort-dropdown";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { TemplatePicker, type FileTemplate } from "@/components/sidebar/template-picker";
import { markdownToHtml } from "@/lib/markdown";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";

function getGreeting(): { title: string; subtitle: string } {
  const hour = new Date().getHours();
  if (hour < 5)
    return {
      title: "Burning the midnight oil",
      subtitle: "Don't forget to rest. Your words will still be here tomorrow.",
    };
  if (hour < 9)
    return { title: "Good morning", subtitle: "A fresh start. What will you write today?" };
  if (hour < 12)
    return {
      title: "Good morning",
      subtitle: "Pick up where you left off, or search across your writing.",
    };
  if (hour < 18)
    return {
      title: "Good afternoon",
      subtitle: "Pick up where you left off, or search across your writing.",
    };
  if (hour < 21)
    return {
      title: "Good evening",
      subtitle: "Wind down with some writing, or revisit an old draft.",
    };
  if (hour < 23)
    return { title: "Winding down", subtitle: "A quiet moment to write. Take it easy." };
  return {
    title: "Still up late",
    subtitle: "The best ideas come at night. But don't stay up too late.",
  };
}

function TypewriterText({
  text,
  speed = 80,
  delay = 0,
}: {
  text: string;
  speed?: number;
  delay?: number;
}) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    let interval: ReturnType<typeof setInterval> | null = null;

    const timeout = setTimeout(() => {
      let i = 0;
      interval = setInterval(() => {
        i++;
        setDisplayed(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(interval!);
          setDone(true);
        }
      }, speed);
    }, delay);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [text, speed, delay]);

  return (
    <>
      {displayed}
      {!done && (
        <span className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-foreground/60 align-middle" />
      )}
    </>
  );
}

function CollapsibleSection({
  icon: Icon,
  title,
  count,
  defaultExpanded = false,
  children,
}: {
  icon: typeof FileText;
  title: string;
  count: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="mt-4">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 py-2 active:opacity-70"
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 text-muted-foreground/50 transition-transform duration-200",
            expanded && "rotate-90"
          )}
        />
        <Icon className="h-4 w-4 text-muted-foreground/70" />
        <span className="text-[14px] font-medium text-foreground/80">{title}</span>
        <span className="text-[12px] tabular-nums text-muted-foreground/50">{count}</span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function HomeDashboard() {
  const router = useRouter();
  const {
    files,
    loadFiles,
    isLoading,
    getRecentFiles,
    getFavorites,
    sortBy,
    setSortBy,
    createFile,
    createFolder,
    importFile,
    currentFolderId,
    getFolders,
  } = useFileStore();
  const { user } = useAuthStore();
  const homeActiveTab = useLayoutStore((s) => s.homeActiveTab);
  const isMobile = useIsMobile();
  const [mobileSearchExpanded, setMobileSearchExpanded] = useState(false);

  // Mobile file creation state
  const [isImporting, setIsImporting] = useState(false);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Management data (shares, forks, bookmarks)
  const [shares, setShares] = useState<Share[]>([]);
  const [forks, setForks] = useState<ForkInfo[]>([]);
  const [bookmarks, setBookmarks] = useState<CommunityItem[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMeItem[]>([]);
  const managementLoadedRef = useRef(false);

  // Search state — lifted here so FileGrid can filter
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Telemetry refs
  const searchResultClickedRef = useRef(false);
  const searchResultsShownAtRef = useRef<number | null>(null);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Load management data (shares, forks, bookmarks) once when user is logged in
  useEffect(() => {
    if (!user || managementLoadedRef.current) return;
    managementLoadedRef.current = true;

    Promise.allSettled([
      api.getMyShares(),
      api.getMyForks(),
      api.getBookmarks(),
      api.getSharedWithMe(),
    ]).then(([sharesResult, forksResult, bookmarksResult, sharedWithMeResult]) => {
      if (sharesResult.status === "fulfilled") setShares(sharesResult.value.shares);
      if (forksResult.status === "fulfilled") setForks(forksResult.value.forks);
      if (bookmarksResult.status === "fulfilled") setBookmarks(bookmarksResult.value.items);
      if (sharedWithMeResult.status === "fulfilled")
        setSharedWithMe(sharedWithMeResult.value.shares);
    });
  }, [user]);

  const performSearch = useDebouncedCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    // Track results_no_click: previous search results existed but none were clicked
    if (
      searchResultsShownAtRef.current &&
      !searchResultClickedRef.current &&
      searchResults.length > 0
    ) {
      telemetry.trackFeature("file_search", "completed", undefined, {
        event: "results_no_click",
        results_count: searchResults.length,
        dwell_time_ms: Date.now() - searchResultsShownAtRef.current,
      });
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSearching(true);
    const startTime = Date.now();
    try {
      const res = await api.searchFiles(q, undefined, 10, controller.signal);
      if (res) setSearchResults(res.results);
      searchResultClickedRef.current = false;
      searchResultsShownAtRef.current = Date.now();
      telemetry.trackFeature("file_search", "completed", Date.now() - startTime, {
        results_count: res?.results.length ?? 0,
        query_length: q.trim().length,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSearchResults([]);
      telemetry.trackFeature("file_search", "error", Date.now() - startTime);
    } finally {
      setIsSearching(false);
    }
  }, 300);

  useEffect(() => {
    performSearch(query);
  }, [query, performSearch]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleSearchResultClick = useCallback(
    (fileId: string, position: number, score: number) => {
      searchResultClickedRef.current = true;
      telemetry.trackFeature("file_search", "completed", undefined, {
        event: "result_clicked",
        file_id: fileId,
        position,
        result_score: score,
        total_results: searchResults.length,
      });
    },
    [searchResults.length]
  );

  const handleQueryChange = (q: string) => {
    setQuery(q);
  };

  // Mobile file creation handlers
  const handleMobileCreateFile = async () => {
    haptics.light();
    try {
      const newId = await createFile(`Untitled-${files.length + 1}.md`, "", currentFolderId);
      router.push(`/editor/${newId}`);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleMobileCreateFolder = async () => {
    haptics.light();
    const folders = getFolders();
    const name = `New Folder ${folders.length + 1}`;
    try {
      await createFolder(name);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleMobileImportClick = () => {
    haptics.light();
    fileInputRef.current?.click();
  };

  const handleMobileFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setIsImporting(true);
    const toastId = toast.loading(`Importing "${file.name}"...`);
    try {
      await importFile(file, currentFolderId);
      toast.success(`Imported "${file.name}" successfully`, { id: toastId });
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { id: toastId, description });
    } finally {
      setIsImporting(false);
    }
  };

  const handleMobileTemplateSelect = async (template: FileTemplate) => {
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

  const { title: greeting, subtitle: greetingSubtitle } = getGreeting();
  const firstName = user?.username?.split(" ")[0];

  // Derived data for new sections
  const recentFiles = getRecentFiles(isMobile ? 5 : 3);
  const favorites = getFavorites();
  const totalDocs = files.filter((f) => !f.isFolder).length;
  const isSearchActive = query.trim().length > 0;
  const isDocumentsTab = homeActiveTab === "documents";
  const showRecent = totalDocs >= 4 && !isSearchActive;
  const showFavorites = favorites.length > 0 && !isSearchActive;

  const tabCounts = {
    documents: totalDocs,
    shared: sharedWithMe.length,
    shares: shares.length,
    forks: forks.length,
    bookmarks: bookmarks.length,
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      {/* Subtle dot grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Mobile compact header — fixed greeting row + expandable search */}
      <div className="relative z-10 flex-shrink-0 md:hidden">
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <h1 className="text-[17px] font-semibold tracking-tight text-foreground/90">
            {firstName ? `${greeting}, ${firstName}` : greeting}
          </h1>
          <div className="flex items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-accent/50"
                  aria-label="Create new"
                >
                  <Plus className="h-[18px] w-[18px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={handleMobileCreateFile}>
                  <FilePlus className="mr-2 h-4 w-4" />
                  New Document
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleMobileCreateFolder} disabled={!!currentFolderId}>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  New Folder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setIsTemplatePickerOpen(true)}>
                  <LayoutTemplate className="mr-2 h-4 w-4" />
                  From Template
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleMobileImportClick} disabled={isImporting}>
                  {isImporting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Import File
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <HomeSortDropdown sortBy={sortBy} setSortBy={setSortBy} />
            <button
              onClick={() => setMobileSearchExpanded((prev) => !prev)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-accent/50"
              aria-label="Search"
            >
              <Search className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        {/* Expandable search bar */}
        <AnimatePresence>
          {mobileSearchExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden px-4 pb-2"
            >
              <HomeSearch
                query={query}
                onQueryChange={handleQueryChange}
                isSearching={isSearching}
                onClose={() => setMobileSearchExpanded(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <SwipeCoordinatorProvider>
        <main className="relative flex-1 px-4 pb-16 md:px-10">
          {/* Desktop hero section (hidden on mobile) */}
          <div className="mx-auto hidden max-w-xl pt-8 md:block md:pt-20">
            {/* Greeting */}
            <motion.div
              className="mb-6 text-center md:mb-10"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            >
              <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">
                <TypewriterText text={firstName ? `${greeting}, ${firstName}` : greeting} />
              </h1>
              <p className="mt-2.5 text-[13px] text-muted-foreground/60 dark:text-muted-foreground/70">
                <TypewriterText
                  text={files.length > 0 ? greetingSubtitle : "Start writing something brilliant."}
                  speed={30}
                  delay={300}
                />
              </p>
            </motion.div>

            {/* Desktop Search */}
            <HomeSearch query={query} onQueryChange={handleQueryChange} isSearching={isSearching} />
          </div>

          {/* Continue writing — recent files (with favorites merged on mobile) */}
          {showRecent && (
            <div className="mx-auto mt-3 max-w-5xl md:mt-10">
              <RecentFiles files={recentFiles} favorites={favorites} />
            </div>
          )}

          {/* Favorites (desktop only — merged into carousel on mobile) */}
          {showFavorites && (
            <div className="mx-auto mt-6 hidden max-w-5xl md:mt-8 md:block">
              <FavoritesSection favorites={favorites} />
            </div>
          )}

          {/* Desktop: Tab navigation */}
          {!isSearchActive && (
            <div className="mx-auto mt-3 hidden max-w-5xl md:mt-10 md:block">
              <HomeTabs counts={tabCounts} />
            </div>
          )}

          {/* Content area */}
          <>
            {/* Desktop: tab-based content switching */}
            <div className="hidden md:block">
              {isSearchActive || isDocumentsTab ? (
                <FileGrid
                  files={files}
                  isLoading={isLoading}
                  searchQuery={query}
                  searchResults={searchResults}
                  isSearching={isSearching}
                  onResultClick={handleSearchResultClick}
                />
              ) : homeActiveTab === "shared" ? (
                <div className="mx-auto mt-6 max-w-5xl">
                  <SharedWithMeSection items={sharedWithMe} />
                </div>
              ) : homeActiveTab === "shares" ? (
                <div className="mx-auto mt-6 max-w-5xl">
                  <SharesSection shares={shares} onSharesChange={setShares} />
                </div>
              ) : homeActiveTab === "forks" ? (
                <div className="mx-auto mt-6 max-w-5xl">
                  <ForksSection forks={forks} onForksChange={setForks} />
                </div>
              ) : homeActiveTab === "bookmarks" ? (
                <div className="mx-auto mt-6 max-w-5xl">
                  <BookmarksSection bookmarks={bookmarks} />
                </div>
              ) : null}
            </div>

            {/* Mobile: Notion-style collapsible sections (all visible) */}
            <div className="md:hidden">
              {isSearchActive ? (
                <FileGrid
                  files={files}
                  isLoading={isLoading}
                  searchQuery={query}
                  searchResults={searchResults}
                  isSearching={isSearching}
                  onResultClick={handleSearchResultClick}
                />
              ) : (
                <>
                  {/* Documents section — expanded by default */}
                  <CollapsibleSection
                    icon={FileText}
                    title="Documents"
                    count={totalDocs}
                    defaultExpanded
                  >
                    <FileGrid
                      files={files}
                      isLoading={isLoading}
                      searchQuery=""
                      searchResults={[]}
                      isSearching={false}
                    />
                  </CollapsibleSection>

                  {/* Shared with me section — always visible for discoverability */}
                  <CollapsibleSection
                    icon={Users}
                    title="Shared with me"
                    count={sharedWithMe.length}
                  >
                    <div className="mt-2">
                      <SharedWithMeSection items={sharedWithMe} />
                    </div>
                  </CollapsibleSection>

                  {/* My Links section */}
                  {shares.length > 0 && (
                    <CollapsibleSection icon={Link2} title="My Links" count={shares.length}>
                      <div className="mt-2">
                        <SharesSection shares={shares} onSharesChange={setShares} />
                      </div>
                    </CollapsibleSection>
                  )}

                  {/* Forks section */}
                  {forks.length > 0 && (
                    <CollapsibleSection icon={GitFork} title="Forks" count={forks.length}>
                      <div className="mt-2">
                        <ForksSection forks={forks} onForksChange={setForks} />
                      </div>
                    </CollapsibleSection>
                  )}

                  {/* Bookmarks section */}
                  {bookmarks.length > 0 && (
                    <CollapsibleSection icon={Bookmark} title="Saved" count={bookmarks.length}>
                      <div className="mt-2">
                        <BookmarksSection bookmarks={bookmarks} />
                      </div>
                    </CollapsibleSection>
                  )}
                </>
              )}
            </div>
          </>
        </main>
      </SwipeCoordinatorProvider>

      {/* Hidden file input for mobile import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown"
        onChange={handleMobileFileSelect}
        className="hidden"
      />

      {/* Template Picker Modal (mobile) */}
      <TemplatePicker
        open={isTemplatePickerOpen}
        onClose={() => setIsTemplatePickerOpen(false)}
        onSelect={handleMobileTemplateSelect}
      />
    </div>
  );
}
