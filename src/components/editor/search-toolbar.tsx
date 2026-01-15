"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Editor } from "@tiptap/react";
import {
  Search,
  X,
  ChevronUp,
  ChevronDown,
  Replace,
  CaseSensitive,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

interface SearchToolbarProps {
  editor: Editor | null;
  fileId?: string;
  isOpen: boolean;
  onClose: () => void;
}

export function SearchToolbar({
  editor,
  fileId,
  isOpen,
  onClose,
}: SearchToolbarProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [semanticEnabled, setSemanticEnabled] = useState(true);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Get results info from storage
  const keywordCount = editor?.storage.search?.resultsCount ?? 0;
  const keywordIndex = editor?.storage.search?.currentIndex ?? 0;
  const semanticCount = editor?.storage.search?.semanticResultsCount ?? 0;
  const semanticIndex = editor?.storage.search?.currentSemanticIndex ?? 0;

  // Focus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }, [isOpen]);

  // Clear search when closed
  useEffect(() => {
    if (!isOpen && editor) {
      editor.commands.closeSearch();
      setSearchTerm("");
      setReplaceTerm("");
      setShowReplace(false);
    }
  }, [isOpen, editor]);

  // Semantic search with debounce
  const performSemanticSearch = useCallback(
    async (query: string) => {
      if (!query.trim() || !fileId || !semanticEnabled) {
        editor?.commands.clearSemanticResults();
        return;
      }

      setSemanticLoading(true);
      try {
        const response = await api.searchInDocument(query, fileId, 10);
        const chunks = response.results.map((r) => ({
          content: r.content,
          score: r.distance !== undefined ? 1 - r.distance : 0.5,
        }));
        editor?.commands.setSemanticResults(chunks);
      } catch (error) {
        console.error("[Search] Semantic search error:", error);
        editor?.commands.clearSemanticResults();
      } finally {
        setSemanticLoading(false);
      }
    },
    [fileId, editor, semanticEnabled]
  );

  // Update search
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchTerm(value);
      editor?.commands.setSearchTerm(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (semanticEnabled && value.trim()) {
        debounceRef.current = setTimeout(() => {
          performSemanticSearch(value);
        }, 500);
      } else {
        editor?.commands.clearSemanticResults();
      }
    },
    [editor, semanticEnabled, performSemanticSearch]
  );

  // Toggle semantic search
  const handleSemanticToggle = useCallback(() => {
    const newValue = !semanticEnabled;
    setSemanticEnabled(newValue);
    if (!newValue) {
      editor?.commands.clearSemanticResults();
    } else if (searchTerm.trim()) {
      performSemanticSearch(searchTerm);
    }
  }, [semanticEnabled, editor, searchTerm, performSemanticSearch]);

  // Update replace term
  const handleReplaceChange = useCallback(
    (value: string) => {
      setReplaceTerm(value);
      editor?.commands.setReplaceTerm(value);
    },
    [editor]
  );

  // Toggle case sensitivity
  const handleCaseSensitiveToggle = useCallback(() => {
    const newValue = !caseSensitive;
    setCaseSensitive(newValue);
    editor?.commands.setCaseSensitive(newValue);
  }, [caseSensitive, editor]);

  // Navigation
  const handleNextKeyword = useCallback(() => {
    editor?.commands.nextSearchResult();
  }, [editor]);

  const handlePreviousKeyword = useCallback(() => {
    editor?.commands.previousSearchResult();
  }, [editor]);

  const handleNextSemantic = useCallback(() => {
    editor?.commands.nextSemanticResult();
  }, [editor]);

  const handlePreviousSemantic = useCallback(() => {
    editor?.commands.previousSemanticResult();
  }, [editor]);

  // Replace operations
  const handleReplace = useCallback(() => {
    editor?.commands.replace();
  }, [editor]);

  const handleReplaceAll = useCallback(() => {
    editor?.commands.replaceAll();
  }, [editor]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && !e.altKey) {
        if (e.shiftKey) {
          handlePreviousKeyword();
        } else {
          handleNextKeyword();
        }
        e.preventDefault();
      } else if (e.key === "Enter" && e.altKey) {
        if (e.shiftKey) {
          handlePreviousSemantic();
        } else {
          handleNextSemantic();
        }
        e.preventDefault();
      } else if (e.key === "h" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setShowReplace((prev) => !prev);
      }
    },
    [
      onClose,
      handleNextKeyword,
      handlePreviousKeyword,
      handleNextSemantic,
      handlePreviousSemantic,
    ]
  );

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "absolute top-3 right-3 z-50",
        "bg-background border border-border rounded-lg shadow-lg",
        "w-80"
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Search row */}
      <div className="flex items-center gap-2 p-2">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input
          ref={searchInputRef}
          placeholder="Search..."
          value={searchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="h-7 flex-1 text-sm"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Options & Navigation */}
      <div className="flex items-center gap-1 px-2 pb-2">
        {/* AI toggle */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7",
            semanticEnabled && "bg-violet-500/20 text-violet-500"
          )}
          onClick={handleSemanticToggle}
          title={semanticEnabled ? "AI search ON" : "AI search OFF"}
        >
          {semanticLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
        </Button>

        {/* Case sensitive */}
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7", caseSensitive && "bg-accent")}
          onClick={handleCaseSensitiveToggle}
          title="Case sensitive"
        >
          <CaseSensitive className="h-3.5 w-3.5" />
        </Button>

        {/* Replace toggle */}
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7", showReplace && "bg-accent")}
          onClick={() => setShowReplace((prev) => !prev)}
          title="Replace (Ctrl+H)"
        >
          <Replace className="h-3.5 w-3.5" />
        </Button>

        <div className="flex-1" />

        {/* Keyword navigation */}
        <span
          className={cn(
            "px-1.5 py-0.5 rounded text-xs",
            "text-yellow-600 dark:text-yellow-400 bg-yellow-500/10"
          )}
          title="Keyword matches"
        >
          {keywordCount > 0 ? `${keywordIndex + 1}/${keywordCount}` : "0"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handlePreviousKeyword}
          disabled={keywordCount === 0}
          title="Previous (Shift+Enter)"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleNextKeyword}
          disabled={keywordCount === 0}
          title="Next (Enter)"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Semantic results row */}
      {semanticEnabled && (
        <div className="flex items-center gap-1 px-2 pb-2 border-t border-border/50 pt-2">
          <Sparkles className="h-3.5 w-3.5 text-violet-500 shrink-0" />
          <span className="text-xs text-muted-foreground">AI matches</span>
          <div className="flex-1" />
          <span
            className={cn(
              "px-1.5 py-0.5 rounded text-xs",
              "text-violet-600 dark:text-violet-400 bg-violet-500/10"
            )}
            title="AI semantic matches"
          >
            {semanticCount > 0 ? `${semanticIndex + 1}/${semanticCount}` : "0"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handlePreviousSemantic}
            disabled={semanticCount === 0}
            title="Previous AI (Alt+Shift+Enter)"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleNextSemantic}
            disabled={semanticCount === 0}
            title="Next AI (Alt+Enter)"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Replace row */}
      {showReplace && (
        <div className="flex items-center gap-2 p-2 border-t border-border/50">
          <Replace className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            placeholder="Replace..."
            value={replaceTerm}
            onChange={(e) => handleReplaceChange(e.target.value)}
            className="h-7 flex-1 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={handleReplace}
            disabled={keywordCount === 0}
          >
            Replace
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={handleReplaceAll}
            disabled={keywordCount === 0}
          >
            All
          </Button>
        </div>
      )}
    </div>
  );
}
