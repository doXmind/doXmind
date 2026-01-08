"use client";

import { Plus, Search, Sparkles, Loader2, X } from "lucide-react";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileItem } from "./file-item";
import { SearchResultItemComponent } from "./search-result-item";
import { useFileStore, type FileItem as FileItemType } from "@/stores/file-store";
import { api, type SearchResultItem } from "@/lib/api";
import { debounce } from "@/lib/utils";

// Local search result with match context
interface LocalSearchMatch {
  file: FileItemType;
  matchType: "name" | "content";
  matchContext?: string;
  matchPosition?: number;
}

export function Sidebar() {
  const { files, createFile } = useFileStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [smartResults, setSmartResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      <div className="p-2 space-y-3">
        {/* Local matches section */}
        {hasLocalMatches && (
          <div>
            <p className="text-xs text-muted-foreground px-2 mb-2 flex items-center gap-1">
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
          <p className="text-xs text-muted-foreground px-2 mb-2 flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-yellow-500" />
            AI semantic search
            {isSearching && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
          </p>

          {searchError ? (
            <p className="text-xs text-muted-foreground px-2 italic">{searchError}</p>
          ) : isSearching && !hasSmartResults ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-xs">Searching...</span>
            </div>
          ) : hasSmartResults ? (
            <div className="space-y-1">
              {smartResults.map((result, index) => (
                <SearchResultItemComponent
                  key={`${result.id}-${index}`}
                  result={result}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground px-2 italic">
              No semantic matches
            </p>
          )}
        </div>

        {/* No results at all */}
        {noResults && !hasLocalMatches && (
          <div className="text-center py-4 text-muted-foreground text-sm">
            No results found for &quot;{searchQuery}&quot;
          </div>
        )}
      </div>
    );
  };

  // Render file list (no search)
  const renderFileList = () => {
    if (files.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No files yet
        </div>
      );
    }

    return (
      <div className="p-2 space-y-1">
        {files.map((file) => (
          <FileItem key={file.id} file={file} />
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Files</h2>
          <Button variant="ghost" size="icon" onClick={handleCreateFile}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder="Search files and content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-8 h-9"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-0.5 h-8 w-8"
              onClick={clearSearch}
            >
              <X className="h-3.5 w-3.5" />
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
        <mark className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
          {text.slice(index, index + query.length)}
        </mark>
        {text.slice(index + query.length)}
      </>
    );
  };

  return (
    <div
      onClick={handleClick}
      className={`
        group flex flex-col gap-1 px-2 py-2 rounded-md cursor-pointer transition-colors
        ${isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-foreground"
        }
      `}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium truncate flex-1">
          {match.matchType === "name"
            ? highlightMatch(match.file.name)
            : match.file.name
          }
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          match.matchType === "name"
            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
            : "bg-green-500/10 text-green-600 dark:text-green-400"
        }`}>
          {match.matchType === "name" ? "name" : "content"}
        </span>
      </div>

      {match.matchType === "content" && match.matchContext && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {highlightMatch(match.matchContext)}
        </p>
      )}
    </div>
  );
}
