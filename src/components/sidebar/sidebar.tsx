"use client";

import { Plus, Search, Sparkles, Loader2, X, Upload } from "lucide-react";
import { toast } from "sonner";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { FileItem } from "./file-item";
import { SearchResultItemComponent } from "./search-result-item";
import { useFileStore, type FileItem as FileItemType } from "@/stores/file-store";
import { api, type SearchResultItem } from "@/lib/api";
import { debounce, getErrorMessage } from "@/lib/utils";

// Local search result with match context
interface LocalSearchMatch {
  file: FileItemType;
  matchType: "name" | "content";
  matchContext?: string;
  matchPosition?: number;
}

export function Sidebar() {
  const { files, createFile, importFile } = useFileStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [smartResults, setSmartResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Local search - search both name and content
  const localMatches = useMemo((): LocalSearchMatch[] => {
    if (!searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase();
    const matches: LocalSearchMatch[] = [];

    for (const file of files) {
      // Check filename
      if (file.name.toLowerCase().includes(query)) {
        matches.push({ file, matchType: "name" });
        continue; // Don't duplicate if name matches
      }

      // Check content
      const contentLower = file.content.toLowerCase();
      const matchIndex = contentLower.indexOf(query);
      if (matchIndex !== -1) {
        // Extract context around match
        const contextStart = Math.max(0, matchIndex - 30);
        const contextEnd = Math.min(file.content.length, matchIndex + query.length + 50);
        let matchContext = file.content.slice(contextStart, contextEnd).trim();

        // Add ellipsis if truncated
        if (contextStart > 0) matchContext = "..." + matchContext;
        if (contextEnd < file.content.length) matchContext = matchContext + "...";

        matches.push({
          file,
          matchType: "content",
          matchContext,
          matchPosition: matchIndex,
        });
      }
    }

    return matches;
  }, [files, searchQuery]);

  // Smart search with debounce (RAG semantic search)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce returns a new function, empty deps is intentional
  const performSmartSearch = useCallback(
    debounce(async (query: string) => {
      if (!query.trim()) {
        setSmartResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      setSearchError(null);

      try {
        const response = await api.searchFiles(query, undefined, 10);
        setSmartResults(response.results);
      } catch (error) {
        console.error("Smart search failed:", error);
        setSearchError("AI search unavailable");
        setSmartResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 500),
    []
  );

  // Trigger smart search when query changes
  useEffect(() => {
    if (searchQuery.trim()) {
      setIsSearching(true);
      performSmartSearch(searchQuery);
    } else {
      setSmartResults([]);
      setSearchError(null);
    }
  }, [searchQuery, performSmartSearch]);

  const handleCreateFile = async () => {
    const name = `Untitled-${files.length + 1}.md`;
    try {
      await createFile(name);
    } catch (error) {
      console.error("Failed to create file:", error);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be selected again
    e.target.value = "";

    setIsImporting(true);
    try {
      await importFile(file);
      toast.success(`Imported "${file.name}" successfully`);
    } catch (error) {
      console.error("Failed to import file:", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setIsImporting(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSmartResults([]);
    setSearchError(null);
    inputRef.current?.focus();
  };

  // Render search results
  const renderSearchResults = () => {
    const hasLocalMatches = localMatches.length > 0;
    const hasSmartResults = smartResults.length > 0;
    const noResults = !hasLocalMatches && !hasSmartResults && !isSearching;

    return (
      <div className="space-y-3 p-2">
        {/* Local matches section */}
        {hasLocalMatches && (
          <div>
            <p className="mb-2 flex items-center gap-1 px-2 text-xs text-muted-foreground">
              <Search className="h-3 w-3" />
              Local matches ({localMatches.length})
            </p>
            <div className="space-y-1">
              {localMatches.map((match) => (
                <LocalMatchItem key={match.file.id} match={match} query={searchQuery} />
              ))}
            </div>
          </div>
        )}

        {/* AI semantic search section */}
        <div>
          <p className="mb-2 flex items-center gap-1 px-2 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3 text-yellow-500" />
            AI semantic search
            {isSearching && <Loader2 className="ml-1 h-3 w-3 animate-spin" />}
          </p>

          {searchError ? (
            <p className="px-2 text-xs italic text-muted-foreground">{searchError}</p>
          ) : isSearching && !hasSmartResults ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <span className="text-xs">Searching...</span>
            </div>
          ) : hasSmartResults ? (
            <div className="space-y-1">
              {smartResults.map((result, index) => (
                <SearchResultItemComponent key={`${result.id}-${index}`} result={result} />
              ))}
            </div>
          ) : (
            <p className="px-2 text-xs italic text-muted-foreground">No semantic matches</p>
          )}
        </div>

        {/* No results at all */}
        {noResults && !hasLocalMatches && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            No results found for &quot;{searchQuery}&quot;
          </div>
        )}
      </div>
    );
  };

  // Render file list (no search)
  const renderFileList = () => {
    if (files.length === 0) {
      return <div className="py-8 text-center text-sm text-muted-foreground">No files yet</div>;
    }

    return (
      <div className="space-y-1 p-2">
        {files.map((file) => (
          <FileItem key={file.id} file={file} />
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header - Hidden on mobile (title is in mobile header) */}
      <div className="border-b border-border p-3 md:p-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="hidden text-sm font-semibold md:block md:text-sm">Files</h2>
          <div className="flex w-full items-center justify-end gap-1 md:w-auto md:gap-1">
            <Tooltip content="Import File (PDF, DOCX, MD)" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleImportClick}
                disabled={isImporting}
                aria-label="Import File"
                className="h-10 w-10 md:h-9 md:w-9"
              >
                {isImporting ? (
                  <Loader2 className="h-5 w-5 animate-spin md:h-4 md:w-4" />
                ) : (
                  <Upload className="h-5 w-5 md:h-4 md:w-4" />
                )}
              </Button>
            </Tooltip>
            <Tooltip content="Create New File" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCreateFile}
                aria-label="Create New File"
                className="h-10 w-10 md:h-9 md:w-9"
              >
                <Plus className="h-5 w-5 md:h-4 md:w-4" />
              </Button>
            </Tooltip>
          </div>
          {/* Hidden file input for import */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.md,.markdown"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Search - Larger on mobile for touch */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground md:left-2.5 md:h-4 md:w-4" />
          <Input
            ref={inputRef}
            placeholder="Search files and content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-12 rounded-xl pl-10 pr-10 text-base md:h-9 md:rounded-md md:pl-9 md:pr-9 md:text-sm"
            aria-label="Search files"
            type="search"
            enterKeyHint="search"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 h-10 w-10 -translate-y-1/2 md:right-0.5 md:h-8 md:w-8"
              onClick={clearSearch}
              aria-label="Clear search"
            >
              <X className="h-5 w-5 md:h-3.5 md:w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {searchQuery.trim() ? renderSearchResults() : renderFileList()}
      </ScrollArea>
    </div>
  );
}

// Local match item component
function LocalMatchItem({ match, query }: { match: LocalSearchMatch; query: string }) {
  const { setCurrentFile, currentFileId } = useFileStore();
  const isActive = currentFileId === match.file.id;

  const handleClick = () => {
    setCurrentFile(match.file.id);
  };

  // Highlight matching text
  const highlightMatch = (text: string) => {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);

    if (index === -1) return text;

    return (
      <>
        {text.slice(0, index)}
        <mark className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-800">
          {text.slice(index, index + query.length)}
        </mark>
        {text.slice(index + query.length)}
      </>
    );
  };

  return (
    <div
      onClick={handleClick}
      className={`group flex cursor-pointer flex-col gap-1 rounded-md px-2 py-2 transition-colors ${
        isActive ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"
      } `}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm font-medium">
          {match.matchType === "name" ? highlightMatch(match.file.name) : match.file.name}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] ${
            match.matchType === "name"
              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
              : "bg-green-500/10 text-green-600 dark:text-green-400"
          }`}
        >
          {match.matchType === "name" ? "name" : "content"}
        </span>
      </div>

      {match.matchType === "content" && match.matchContext && (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {highlightMatch(match.matchContext)}
        </p>
      )}
    </div>
  );
}
