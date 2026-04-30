import type {
  MarkdownSearchOptions,
  MarkdownSearchResult,
  MarkdownSearchResults,
  StorageAdapter,
  WorkspaceEntry,
  WorkspaceIndexEntry,
  WorkspaceIndexQuery,
} from "./types";

const DEFAULT_INDEX_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 5;
const EXCERPT_RADIUS = 80;

export async function queryWorkspaceIndex(
  adapter: StorageAdapter,
  query: WorkspaceIndexQuery = {}
): Promise<WorkspaceIndexEntry[]> {
  if (adapter.queryWorkspaceIndex) {
    return adapter.queryWorkspaceIndex(query);
  }

  return entriesToWorkspaceIndex(await adapter.list(), query);
}

export async function searchMarkdown(
  adapter: StorageAdapter,
  query: string,
  options: MarkdownSearchOptions = {}
): Promise<MarkdownSearchResults> {
  if (adapter.searchMarkdown) {
    return adapter.searchMarkdown(query, options);
  }

  const normalizedQuery = query.trim();
  if (!normalizedQuery) return { results: [] };

  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const entries = (await adapter.list()).filter((entry) => entry.kind === "document");
  const fileIdSet = options.fileIds ? new Set(options.fileIds) : null;
  const results: MarkdownSearchResult[] = [];

  for (const entry of entries) {
    if (options.signal?.aborted) break;
    if (fileIdSet && !fileIdSet.has(entry.handle.id)) continue;

    const content = await adapter.read(entry.handle);
    const text = content.markdown ?? content.html;
    const match = findTextMatch(text, normalizedQuery);
    if (!match) continue;

    results.push({
      id: `${entry.handle.id}:${match.start}`,
      content: excerpt(text, match.start, match.end),
      metadata: {
        fileId: entry.handle.id,
        name: entry.name,
        path: entry.handle.relPath ?? entry.handle.path ?? null,
        start: match.start,
        end: match.end,
        chunkIndex: 0,
      },
      score: scoreMatch(match.start),
    });

    if (results.length >= limit) break;
  }

  return { results };
}

export function entriesToWorkspaceIndex(
  entries: WorkspaceEntry[],
  query: WorkspaceIndexQuery = {}
): WorkspaceIndexEntry[] {
  const includeFolders = query.includeFolders ?? false;
  const normalizedQuery = query.query?.trim().toLowerCase() ?? "";
  const limit = query.limit ?? DEFAULT_INDEX_LIMIT;

  return entries
    .filter((entry) => includeFolders || entry.kind === "document")
    .map(toWorkspaceIndexEntry)
    .filter((entry) => {
      if (!normalizedQuery) return true;
      return [entry.title, entry.name, entry.path, entry.preview]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery));
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.title.localeCompare(b.title);
    })
    .slice(0, limit);
}

export function findMarkdownMatches(
  entries: WorkspaceEntry[],
  read: StorageAdapter["read"],
  query: string,
  options: MarkdownSearchOptions = {}
): Promise<MarkdownSearchResults> {
  return searchEntries(entries, read, query, options);
}

async function searchEntries(
  entries: WorkspaceEntry[],
  read: StorageAdapter["read"],
  query: string,
  options: MarkdownSearchOptions
): Promise<MarkdownSearchResults> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return { results: [] };

  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const fileIdSet = options.fileIds ? new Set(options.fileIds) : null;
  const results: MarkdownSearchResult[] = [];

  for (const entry of entries) {
    if (options.signal?.aborted) break;
    if (entry.kind !== "document") continue;
    if (fileIdSet && !fileIdSet.has(entry.handle.id)) continue;

    const document = await read(entry.handle);
    const text = document.markdown ?? document.html;
    const match = findTextMatch(text, normalizedQuery);
    if (!match) continue;

    results.push({
      id: `${entry.handle.id}:${match.start}`,
      content: excerpt(text, match.start, match.end),
      metadata: {
        fileId: entry.handle.id,
        name: entry.name,
        path: entry.handle.relPath ?? entry.handle.path ?? null,
        start: match.start,
        end: match.end,
        chunkIndex: 0,
      },
      score: scoreMatch(match.start),
    });

    if (results.length >= limit) break;
  }

  return { results };
}

function toWorkspaceIndexEntry(entry: WorkspaceEntry): WorkspaceIndexEntry {
  return {
    handle: entry.handle,
    id: entry.handle.id,
    kind: entry.kind,
    name: entry.name,
    title: entry.name.replace(/\.(md|markdown)$/i, "") || "Untitled",
    path: entry.handle.relPath ?? entry.handle.path ?? null,
    parent: entry.parent,
    preview: entry.preview,
    icon: entry.icon,
    updatedAt: entry.updatedAt,
  };
}

function findTextMatch(text: string, query: string): { start: number; end: number } | null {
  const start = text.toLowerCase().indexOf(query.toLowerCase());
  if (start < 0) return null;
  return { start, end: start + query.length };
}

function excerpt(text: string, start: number, end: number): string {
  const excerptStart = Math.max(0, start - EXCERPT_RADIUS);
  const excerptEnd = Math.min(text.length, end + EXCERPT_RADIUS);
  return text.slice(excerptStart, excerptEnd).replace(/\s+/g, " ").trim();
}

function scoreMatch(start: number): number {
  return 1 / (1 + start);
}
