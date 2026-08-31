"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { createStorageAdapter, searchMarkdown, type MarkdownSearchResult } from "@/lib/storage";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { useFileStore } from "@/stores/file-store";
import { usePageSessionStore } from "@/stores/page-session-store";
import { cn } from "@/lib/utils";

/** One character matches most of a workspace; the scan is a full read of every Page. */
const MIN_QUERY_CHARS = 2;
const FILE_LIMIT = 50;

export function SearchSidebar() {
  const t = useTranslations("sidebar");
  const tCommon = useTranslations("common");
  const rootPath = useFileStore((s) => s.rootPath);
  const requestReveal = usePageSessionStore((s) => s.requestReveal);

  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<MarkdownSearchResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const abortRef = React.useRef<AbortController | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const performSearch = useDebouncedCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < MIN_QUERY_CHARS || !rootPath) {
      abortRef.current?.abort();
      setResults([]);
      setIsSearching(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsSearching(true);
    try {
      const adapter = createStorageAdapter({ disk: { root: rootPath } });
      const found = await searchMarkdown(adapter, trimmed, {
        limit: FILE_LIMIT,
        signal: controller.signal,
      }).catch(() => null);
      // A slower earlier request must not overwrite a faster later one.
      if (!controller.signal.aborted) setResults(found?.results ?? []);
    } finally {
      if (!controller.signal.aborted) setIsSearching(false);
    }
  }, 250);

  React.useEffect(() => {
    performSearch(query);
  }, [query, performSearch]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const totalHits = results.reduce(
    (sum, result) => sum + (result.matchCount ?? result.matches?.length ?? 1),
    0
  );
  const trimmed = query.trim();
  const showEmpty = trimmed.length >= MIN_QUERY_CHARS && !isSearching && results.length === 0;

  const openHit = (result: MarkdownSearchResult, line: number) => {
    const fileId = result.metadata.fileId;
    // The reveal is requested first: navigation may need to save a dirty Page, and the editor
    // consumes the request on whichever commit the new Page's document is live.
    requestReveal(fileId, line);
    void navigateToEditorFile(fileId);
  };

  const toggleGroup = (fileId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <div className="flex h-8 items-center gap-2 rounded-lg bg-[var(--sidebar-hover)] px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--sidebar-icon)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            className="text-ui-base min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--sidebar-icon)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={tCommon("clear")}
              className="shrink-0 text-[var(--sidebar-icon)] hover:text-[var(--sidebar-text)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {results.length > 0 && (
          <p className="text-ui-xs px-1 pt-2 text-[var(--sidebar-icon)]">
            {t("searchSummary", { hits: totalHits, pages: results.length })}
          </p>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full flex-col px-1.5 pb-3">
          {isSearching && results.length === 0 && (
            <p className="text-ui-xs px-2 py-6 text-center text-[var(--sidebar-icon)]">
              {tCommon("loading")}
            </p>
          )}
          {showEmpty && (
            <p className="text-ui-xs px-2 py-6 text-center text-[var(--sidebar-icon)]">
              {tCommon("noResults")}
            </p>
          )}
          {results.map((result) => {
            const fileId = result.metadata.fileId;
            const isCollapsed = collapsed.has(fileId);
            const hits = result.matches ?? [
              { line: result.metadata.chunkIndex ?? 1, preview: result.content },
            ];
            const count = result.matchCount ?? hits.length;
            return (
              <div key={fileId} className="pb-0.5">
                <button
                  type="button"
                  onClick={() => toggleGroup(fileId)}
                  aria-expanded={!isCollapsed}
                  className="text-ui-base flex h-7 w-full items-center gap-1 rounded-md px-1.5 text-left font-medium hover:bg-[var(--sidebar-hover)]"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--sidebar-icon)]" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--sidebar-icon)]" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{result.metadata.name}</span>
                  <span className="text-ui-xs shrink-0 text-[var(--sidebar-icon)]">{count}</span>
                </button>
                {!isCollapsed &&
                  hits.map((hit) => (
                    <button
                      key={`${fileId}:${hit.line}`}
                      type="button"
                      onClick={() => openHit(result, hit.line)}
                      className={cn(
                        "text-ui-xs flex w-full items-start gap-1.5 rounded-md py-1 pl-6 pr-1.5 text-left",
                        "text-[var(--sidebar-icon)] hover:bg-[var(--sidebar-hover)]"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <HighlightedPreview preview={hit.preview} query={trimmed} />
                      </span>
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * The matched run, marked inside its line.
 *
 * `<mark>` is repainted rather than used as-is: the UA default is a fixed yellow that fails
 * contrast against the dark themes' surfaces. `--primary` is defined by every theme, so the
 * highlight follows the theme without adding a token to all eighteen of them.
 */
function HighlightedPreview({ preview, query }: { preview: string; query: string }) {
  const at = query ? preview.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
  if (at < 0) return <>{preview}</>;
  return (
    <>
      {preview.slice(0, at)}
      <mark className="rounded-[2px] bg-primary/25 px-[1px] text-[var(--sidebar-text)]">
        {preview.slice(at, at + query.length)}
      </mark>
      {preview.slice(at + query.length)}
    </>
  );
}
