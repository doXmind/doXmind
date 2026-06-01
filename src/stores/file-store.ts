import { create } from "zustand";
import { persist } from "zustand/middleware";
import { storeLogger } from "@/lib/logger";
import { eventBus } from "@/lib/events";
import { syncDatabasesForDocument } from "@/stores/database-store";
import { useEditorStore } from "@/stores/editor-store";
import type { FileItem } from "@/types";
import { documentTypeFromName } from "@/lib/document-types";
import {
  createStorageAdapter,
  type DocumentHandle,
  type DocumentContent,
  type StorageAdapter,
  type WorkspaceEntry,
} from "@/lib/storage";
import { registerWindowTarget, syncRecentsToDock, unregisterWindowTarget } from "@/lib/window";
import { perfAsync, perfSync } from "@/lib/perf";

const log = storeLogger.child("File");

// Track in-progress content fetches to deduplicate concurrent loadFileContent calls
const pendingContentLoads = new Set<string>();

// Re-export for convenience
export type { FileItem } from "@/types";

export type SortOption =
  | "name-asc"
  | "name-desc"
  | "modified-newest"
  | "modified-oldest"
  | "created-newest"
  | "created-oldest";

// Sort the sidebar tree. Every option produces the same three-tier comparator:
//   1. Folders before files. VS Code / Notion / Finder convention; users
//      expect containers to cluster.
//   2. The user-chosen criterion (name / modified / created).
//   3. id ascending as an absolute tiebreaker. Without this, two entries
//      with equal sort keys (e.g. files whose updatedAt got the same
//      timestamp during a batched autosave) fall back to whatever order
//      Array.sort happens to keep, which lets the sidebar shuffle on
//      otherwise-irrelevant mutations.
export function sortFilesByOption(files: FileItem[], sortBy: SortOption): FileItem[] {
  const criterion = criterionFor(sortBy);
  return [...files].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    const primary = criterion(a, b);
    if (primary !== 0) return primary;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function criterionFor(sortBy: SortOption): (a: FileItem, b: FileItem) => number {
  switch (sortBy) {
    case "name-asc":
      return (a, b) => a.name.localeCompare(b.name);
    case "name-desc":
      return (a, b) => b.name.localeCompare(a.name);
    case "modified-newest":
      return (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    case "modified-oldest":
      return (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    case "created-newest":
      return (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    case "created-oldest":
      return (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    default:
      return () => 0;
  }
}

// VSCode-style: at any moment the editor is in one of three states.
// `none` shows the welcome screen with no sidebar. `folder` mounts the
// directory tree. `file` opens exactly one loose file with no sibling
// scan — its parent directory is still used as the storage root for I/O
// (sidecar writes, PDF state, image lookups), but the sidebar shows just
// the open file rather than leaking its neighbours.
export type OpenTarget = "none" | "file" | "folder";

// VSCode-style untitled buffer: an in-memory document that has never
// been written to disk. The editor sees it as a normal FileItem (added
// to `files`) so routing/lookup work unchanged, but the editor's save
// path detects the matching `transientFile` slot and triggers a Save-As
// dialog before the first persist. Only one transient at a time for now.
// Hyphen rather than colon to keep the id URL-segment safe (colons get
// percent-encoded by some routers, breaking lookups via /editor/<id>).
export const TRANSIENT_ID_PREFIX = "transient-";

export interface TransientFile {
  id: string;
  name: string;
  content: string;
  contentMarkdown: string;
  createdAt: string;
}

export interface RecentEntry {
  kind: "file" | "folder";
  path: string;
}

interface FileState {
  files: FileItem[];
  currentFileId: string | null;
  currentFolderId: string | null; // null = root view
  openTarget: OpenTarget;
  // Active storage root: in `folder` mode this is the mounted folder, in
  // `file` mode the parent directory of the open file, in `none` mode null.
  rootPath: string | null;
  // Absolute path of the open file when openTarget === "file". Persisted so
  // cold boots can re-open it.
  openFilePath: string | null;
  // In-memory untitled buffer. When set, `files` contains a synthetic
  // FileItem with the same id; the editor reads/writes through this slot
  // until the user picks a save location and `materializeTransient` runs.
  transientFile: TransientFile | null;
  recents: RecentEntry[];
  isLoading: boolean;
  isSynced: boolean;
  sortBy: SortOption;
  justCreatedFileId: string | null;
  expandedFolderIds: Set<string>;
  selectedFileIds: Set<string>;
  loadedContentIds: Set<string>;

  // File actions
  loadFiles: (options?: { silent?: boolean }) => Promise<void>;
  loadFileContent: (fileId: string, options?: { force?: boolean }) => Promise<void>;
  openFolder: (root: string) => Promise<void>;
  openFile: (absolutePath: string) => Promise<void>;
  closeOpened: () => void;
  createFile: (
    name: string,
    content?: string,
    parentId?: string | null,
    options?: { documentType?: "markdown" | "pdf" | "excel" }
  ) => Promise<string>;
  updateFile: (
    id: string,
    updates: Partial<Pick<FileItem, "name" | "content" | "contentMarkdown">>
  ) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  setCurrentFile: (id: string | null) => void;
  renameFile: (id: string, name: string) => Promise<void>;
  getFile: (id: string) => FileItem | undefined;

  // Transient (untitled) buffer actions. See TransientFile.
  nextUntitledName: () => string;
  createTransientFile: (name: string) => string;
  setTransientContent: (content: string, contentMarkdown: string) => void;
  materializeTransient: (absolutePath: string) => Promise<string>;
  discardTransient: () => void;

  // Favorites & Icons
  toggleFavorite: (fileId: string) => Promise<void>;
  setFileIcon: (fileId: string, icon: string | null) => Promise<void>;
  setCoverImage: (fileId: string, url: string | null) => Promise<void>;
  setCoverPosition: (fileId: string, position: number) => Promise<void>;
  getFavorites: () => FileItem[];
  getRecentFiles: (limit?: number) => FileItem[];

  // Folder actions
  createFolder: (
    name: string,
    parentId?: string | null,
    options?: { silent?: boolean }
  ) => Promise<string>;
  moveFileToFolder: (fileId: string, folderId: string | null) => Promise<void>;
  /**
   * External-import entry point used by sidebar DnD (#67). Always copies; the
   * source file (e.g. from Downloads) is left untouched.
   *
   * `mode` defaults to `"create"`. `"replace"` (added in #69) overwrites the
   * user file at the destination but leaves the hidden `.doxmind` sidecar
   * untouched — the next open trips the Stale-sidecar / Salvage path
   * (ADR 0002), which is the right behavior because at the FS level a
   * Replace is indistinguishable from an external edit.
   *
   * Throws `ImportError` with `code: "destination-exists"` if `mode === "create"`
   * and a name clash is detected on the backend (race window between the D2
   * plan-phase resolver and the actual copy).
   */
  importExternalFile: (input: {
    name: string;
    parentId: string | null;
    srcPath?: string;
    bytes?: Uint8Array;
    mode?: "create" | "replace";
  }) => Promise<string>;
  setCurrentFolder: (folderId: string | null) => void;
  getFilesInFolder: (folderId: string | null) => FileItem[];
  getFolders: (parentId?: string | null) => FileItem[];
  getFolderAncestors: (folderId: string) => FileItem[];

  // Sorting
  setSortBy: (sortBy: SortOption) => void;

  // Auto-rename helper
  clearJustCreatedFileId: () => void;

  // Folder expansion
  toggleFolderExpanded: (folderId: string) => void;
  setFolderExpanded: (folderId: string, expanded: boolean) => void;

  // Multi-select
  toggleFileSelection: (fileId: string) => void;
  selectFileRange: (fromId: string, toId: string) => void;
  clearSelection: () => void;
  selectAll: () => void;
  bulkMoveFiles: (fileIds: string[], folderId: string | null) => Promise<void>;
  bulkDeleteFiles: (fileIds: string[]) => Promise<void>;
}

function getAdapter(state: Pick<FileState, "rootPath">): StorageAdapter {
  return createStorageAdapter({ disk: { root: state.rootPath } });
}

// Cap files and folders independently so frequently-opened documents don't
// evict workspace history from the shared recents list (and vice versa).
const RECENTS_FILE_LIMIT = 16;
const RECENTS_FOLDER_LIMIT = 12;

function rememberRecent(entry: RecentEntry, state: Pick<FileState, "recents">): RecentEntry[] {
  const deduped = [
    entry,
    ...state.recents.filter((r) => !(r.kind === entry.kind && r.path === entry.path)),
  ];
  let files = 0;
  let folders = 0;
  // Preserves overall recency order (newest first) while bounding each kind.
  return deduped.filter((r) =>
    r.kind === "file" ? ++files <= RECENTS_FILE_LIMIT : ++folders <= RECENTS_FOLDER_LIMIT
  );
}

function forgetRecent(entry: RecentEntry, state: Pick<FileState, "recents">): RecentEntry[] {
  return state.recents.filter((r) => !(r.kind === entry.kind && r.path === entry.path));
}

function isMissingWorkspaceRootError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /workspace root is not a directory/i.test(message) ||
    /failed to resolve workspace root/i.test(message) ||
    /no such file or directory/i.test(message)
  );
}

function replaceWorkspaceLocation(target: RecentEntry | null): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  url.pathname = "/editor";
  url.searchParams.delete("folder");
  url.searchParams.delete("file");

  if (target?.kind === "folder") {
    url.searchParams.set("folder", target.path);
  } else if (target?.kind === "file") {
    url.searchParams.set("file", target.path);
  }

  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.replaceState(window.history.state, "", next);
  }
}

function handleForFile(file: FileItem): DocumentHandle {
  return (
    file.storageHandle ?? { mode: "disk", id: file.id, kind: file.isFolder ? "folder" : "document" }
  );
}

type LoadedReadModel = Pick<
  FileItem,
  | "content"
  | "editorHtml"
  | "browsingHtml"
  | "contentMarkdown"
  | "sourceState"
  | "outline"
  | "browsingRendererVersion"
>;

function readModelFromContent(content: DocumentContent): LoadedReadModel {
  const editorHtml = content.editorHtml ?? content.html ?? "";
  const browsingHtml = content.browsingHtml ?? editorHtml;
  return {
    content: editorHtml,
    editorHtml,
    browsingHtml,
    contentMarkdown: content.markdown ?? null,
    sourceState: content.sourceState,
    outline: content.outline ?? [],
    browsingRendererVersion: content.browsingRendererVersion,
  };
}

function readModelFromFile(file: FileItem): LoadedReadModel {
  const editorHtml = file.editorHtml ?? file.content ?? "";
  return {
    content: file.content ?? editorHtml,
    editorHtml,
    browsingHtml: file.browsingHtml ?? editorHtml,
    contentMarkdown: file.contentMarkdown ?? null,
    sourceState: file.sourceState,
    outline: file.outline,
    browsingRendererVersion: file.browsingRendererVersion,
  };
}

function shouldSyncDatabases(content: DocumentContent): boolean {
  if (content.html.includes("data-database-id")) return true;
  if (content.markdown?.includes("database:")) return true;
  const extras = content.extras;
  if (!extras || typeof extras !== "object") return false;
  const databases = (extras as { databases?: unknown }).databases;
  return Boolean(databases && typeof databases === "object" && Object.keys(databases).length > 0);
}

function syncDatabasesForContent(content: DocumentContent): void {
  if (!shouldSyncDatabases(content)) return;
  perfSync(
    "doxmind.loadFileContent.syncDatabases",
    () => syncDatabasesForDocument(content.extras, content.html, content.markdown),
    { htmlBytes: content.html?.length ?? 0 }
  );
}

function outlinesEqual(
  left: LoadedReadModel["outline"] = [],
  right: LoadedReadModel["outline"] = []
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.id !== b.id || a.depth !== b.depth || a.text !== b.text) return false;
  }
  return true;
}

function fileFromEntry(entry: WorkspaceEntry, existingReadModel?: LoadedReadModel): FileItem {
  return {
    id: entry.handle.id,
    name: entry.name,
    content: existingReadModel?.content ?? "",
    editorHtml: existingReadModel?.editorHtml,
    browsingHtml: existingReadModel?.browsingHtml,
    contentMarkdown: existingReadModel?.contentMarkdown,
    sourceState: existingReadModel?.sourceState,
    outline: existingReadModel?.outline,
    browsingRendererVersion: existingReadModel?.browsingRendererVersion,
    isFolder: entry.kind === "folder",
    parentId: entry.parent?.id ?? null,
    position: entry.position || 0,
    isFavorite: entry.isFavorite || false,
    icon: entry.icon || null,
    coverImageUrl: entry.coverImageUrl || null,
    coverPosition: entry.coverPosition ?? 0.5,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    wordCount: entry.wordCount || 0,
    preview: entry.preview || "",
    documentType: entry.documentType ?? documentTypeFromName(entry.name),
    storageHandle: entry.handle,
  };
}

// Whether two FileItems are identical in every field the sidebar/editor
// renders. Deliberately excludes content (loaded lazily) and createdAt/
// updatedAt (the scan stamps those with `new Date()` every call, so they
// always differ and are not displayed meaningfully). Used by loadFiles to
// reuse object identity for unchanged files across a re-scan.
function sameScanFields(a: FileItem, b: FileItem): boolean {
  return (
    a.name === b.name &&
    a.isFolder === b.isFolder &&
    a.parentId === b.parentId &&
    a.position === b.position &&
    a.isFavorite === b.isFavorite &&
    a.icon === b.icon &&
    a.coverImageUrl === b.coverImageUrl &&
    a.coverPosition === b.coverPosition &&
    a.documentType === b.documentType &&
    a.storageHandle?.path === b.storageHandle?.path
  );
}

// Move an id-keyed set entry from oldId to newId. A rename changes a file's
// path, and path-derived ids (PDF/Excel, and markdown without a frontmatter id)
// change with it; markdown with a frontmatter id keeps its id, so this no-ops.
function migrateIdInSet(ids: Set<string>, oldId: string, newId: string): Set<string> {
  if (oldId === newId || !ids.has(oldId)) return ids;
  const next = new Set(ids);
  next.delete(oldId);
  next.add(newId);
  return next;
}

function parentHandleForId(
  files: FileItem[],
  parentId: string | null | undefined
): DocumentHandle | null {
  if (!parentId) return null;
  const parent = files.find((f) => f.id === parentId);
  return parent ? handleForFile(parent) : null;
}

export const useFileStore = create<FileState>()(
  persist(
    (set, get) => ({
      files: [],
      currentFileId: null,
      currentFolderId: null,
      openTarget: "none",
      rootPath: null,
      openFilePath: null,
      transientFile: null,
      recents: [],
      isLoading: false,
      isSynced: false,
      // Default to name-asc so the sidebar order is stable. modified-newest
      // is intrinsically jittery: every autosave bumps updatedAt and shuffles
      // the tree, which (combined with the post-mutation re-sort) made the
      // sidebar appear to reshuffle on every keystroke.
      sortBy: "name-asc" as SortOption,
      justCreatedFileId: null,
      expandedFolderIds: new Set<string>(),
      selectedFileIds: new Set<string>(),
      loadedContentIds: new Set<string>(),

      loadFiles: async (options) => {
        const silent = options?.silent ?? false;
        const target = get().openTarget;
        // Welcome screen — no I/O, but mark synced so consumers stop waiting.
        if (target === "none") {
          set({ files: [], isSynced: true, isLoading: false });
          return;
        }
        // File mode owns `files` directly. If a cold boot rehydrated the
        // persisted file path but content hasn't been loaded yet, re-open
        // it to repopulate the single-file entry.
        if (target === "file") {
          if (get().files.length === 0 && get().openFilePath) {
            try {
              await get().openFile(get().openFilePath as string);
            } catch (error) {
              log.error("Failed to restore previously opened file", error);
              set({ openTarget: "none", rootPath: null, openFilePath: null, isSynced: true });
            }
          } else {
            set({ isSynced: true, isLoading: false });
          }
          return;
        }
        const rootBeforeLoad = get().rootPath;
        // Silent refreshes (the filesystem watcher) skip the loading flag so a
        // background re-scan never flickers the sidebar's loading state.
        if (!silent) set({ isLoading: true });
        try {
          const adapter = getAdapter(get());
          const entries = await adapter.list();
          const newFileIds = new Set(entries.map((f) => f.handle.id));

          // Use set callback to read the latest state atomically, preventing
          // race conditions where a concurrent loadFileContent updates
          // loadedContentIds between our read and write.
          set((state) => {
            // Preserve loadedContentIds for files that still exist on server
            const preservedContentIds = new Set(
              Array.from(state.loadedContentIds).filter((id) => newFileIds.has(id))
            );

            // Build a map of previously loaded content to merge into new file list
            const prevReadModelMap = new Map<string, LoadedReadModel>();
            if (preservedContentIds.size > 0) {
              for (const f of state.files) {
                if (preservedContentIds.has(f.id) && f.content) {
                  prevReadModelMap.set(f.id, readModelFromFile(f));
                }
              }
            }

            const previousById = new Map(state.files.map((f) => [f.id, f] as const));
            const files: FileItem[] = entries.map((entry) => {
              const built = fileFromEntry(entry, prevReadModelMap.get(entry.handle.id));
              const prev = previousById.get(built.id);
              // Reuse the previous object when nothing the UI renders has
              // changed, so selectors like `files.find(id === current)` keep a
              // stable reference. Without this, every background re-scan —
              // including our own autosave rewriting the .md — hands the editor
              // a brand-new object and forces a full re-render (the jank).
              return prev && sameScanFields(prev, built) ? prev : built;
            });

            // Nothing structural changed (a self-save, or an external edit to a
            // file's contents that the scan doesn't surface): leave state
            // untouched so no component re-renders. The identity reuse above
            // makes this a cheap reference check.
            const filesUnchanged =
              files.length === state.files.length &&
              files.every((file, index) => file === state.files[index]);
            if (filesUnchanged) {
              return { isSynced: true, isLoading: false };
            }

            // Clear currentFileId / currentFolderId if they no longer exist
            const validCurrentFileId =
              state.currentFileId && newFileIds.has(state.currentFileId)
                ? state.currentFileId
                : null;
            const validCurrentFolderId =
              state.currentFolderId &&
              files.some((f) => f.id === state.currentFolderId && f.isFolder)
                ? state.currentFolderId
                : null;

            // Clear selection of files that no longer exist
            const validSelectedFileIds = new Set(
              Array.from(state.selectedFileIds).filter((id) => newFileIds.has(id))
            );

            return {
              files,
              currentFileId: validCurrentFileId,
              currentFolderId: validCurrentFolderId,
              selectedFileIds: validSelectedFileIds,
              loadedContentIds: preservedContentIds,
              isSynced: true,
              isLoading: false,
            };
          });
        } catch (error) {
          log.error("Failed to load files from server", error);
          if (rootBeforeLoad && isMissingWorkspaceRootError(error)) {
            set((state) => ({
              openTarget: "none",
              rootPath: null,
              openFilePath: null,
              transientFile: null,
              files: [],
              currentFileId: null,
              currentFolderId: null,
              loadedContentIds: new Set(),
              selectedFileIds: new Set(),
              recents: forgetRecent({ kind: "folder", path: rootBeforeLoad }, state),
              isSynced: true,
              isLoading: false,
            }));
            replaceWorkspaceLocation(null);
            void unregisterWindowTarget();
            void syncRecentsToDock(get().recents);
            return;
          }
          // Keep local files if server is unavailable
          set({ isSynced: false, isLoading: false });
        }
      },

      loadFileContent: async (fileId: string, options?: { force?: boolean }) => {
        const cacheHit = !options?.force && get().loadedContentIds.has(fileId);
        if (cacheHit) {
          // Surface cache hits in the perf log so the dev overlay can show
          // hit/miss ratios; near-zero duration since we bail immediately.
          perfSync("doxmind.loadFileContent.cacheHit", () => undefined, {
            fileId,
            forced: !!options?.force,
          });
          return;
        }
        // Prevent duplicate concurrent fetches for the same file
        if (pendingContentLoads.has(fileId)) return;
        pendingContentLoads.add(fileId);
        try {
          await perfAsync(
            "doxmind.loadFileContent.total",
            async () => {
              const file = get().files.find((f) => f.id === fileId);
              if (!file) return;
              if (file.documentType === "pdf" || file.documentType === "excel") {
                set((state) => ({
                  loadedContentIds: new Set([...state.loadedContentIds, fileId]),
                }));
                return;
              }
              const fullFile = await perfAsync(
                "doxmind.loadFileContent.adapterRead",
                () => getAdapter(get()).read(handleForFile(file)),
                { fileId, documentType: file.documentType }
              );
              syncDatabasesForContent(fullFile);
              perfSync("doxmind.loadFileContent.storeCommit", () =>
                set((state) => {
                  // Only update if the file exists in the files array.
                  // If loadFiles() hasn't completed yet, files may be empty — in that case
                  // skip the update and don't mark as loaded so it retries after loadFiles.
                  const existing = state.files.find((f) => f.id === fileId);
                  if (!existing) return {};

                  // Force-reload on window refocus must be a no-op when nothing
                  // changed on disk. If we rewrite `content` with an equal-but-new
                  // string, the editor's [file.content] effect re-runs setContent
                  // and resets scroll/selection. Compare HTML byte-for-byte and
                  // skip the slice update when unchanged.
                  const nextReadModel = readModelFromContent(fullFile);
                  const htmlUnchanged = existing.content === nextReadModel.content;
                  const browsingHtmlUnchanged =
                    (existing.browsingHtml ?? existing.content) === nextReadModel.browsingHtml;
                  const outlineUnchanged = outlinesEqual(existing.outline, nextReadModel.outline);
                  const handleIdUnchanged = existing.id === fullFile.handle.id;
                  if (
                    htmlUnchanged &&
                    browsingHtmlUnchanged &&
                    outlineUnchanged &&
                    handleIdUnchanged
                  ) {
                    return {
                      loadedContentIds: new Set([...state.loadedContentIds, fullFile.handle.id]),
                    };
                  }

                  return {
                    files: state.files.map((f) =>
                      f.id === fileId
                        ? {
                            ...f,
                            id: fullFile.handle.id,
                            ...nextReadModel,
                            storageHandle: fullFile.handle,
                          }
                        : f
                    ),
                    currentFileId:
                      state.currentFileId === fileId ? fullFile.handle.id : state.currentFileId,
                    loadedContentIds: new Set([...state.loadedContentIds, fullFile.handle.id]),
                  };
                })
              );
            },
            { fileId, forced: !!options?.force }
          );
        } catch (error) {
          log.error("Failed to load file content", error);
        } finally {
          pendingContentLoads.delete(fileId);
        }
      },

      openFolder: async (root: string) => {
        const trimmedRoot = root.trim();
        if (!trimmedRoot) return;
        set((state) => ({
          openTarget: "folder",
          rootPath: trimmedRoot,
          openFilePath: null,
          recents: rememberRecent({ kind: "folder", path: trimmedRoot }, state),
          files: [],
          currentFileId: null,
          currentFolderId: null,
          loadedContentIds: new Set(),
          isSynced: false,
        }));
        replaceWorkspaceLocation({ kind: "folder", path: trimmedRoot });
        void registerWindowTarget({ kind: "folder", path: trimmedRoot });
        void syncRecentsToDock(get().recents);
        await get().loadFiles();
      },

      openFile: async (absolutePath: string) => {
        const trimmed = absolutePath.trim();
        if (!trimmed) return;

        const normalized = trimmed.replaceAll("\\", "/");
        const lastSlash = normalized.lastIndexOf("/");
        if (lastSlash <= 0) {
          throw new Error("openFile requires an absolute path");
        }
        const parentDir = trimmed.slice(0, lastSlash);
        const fileBase = normalized.slice(lastSlash + 1);

        // Adapter is scoped to the picked file's parent directory so sidecar
        // I/O lands next to the file.
        const adapter = createStorageAdapter({ disk: { root: parentDir } });

        const documentType = documentTypeFromName(fileBase);
        const handle: DocumentHandle = {
          mode: "disk",
          id: `path:${fileBase}`,
          kind: "document",
          documentType,
          path: fileBase,
          relPath: fileBase,
        };

        const now = new Date().toISOString();
        let looseFile: FileItem;

        if (documentType === "pdf" || documentType === "excel") {
          // Binary documents are loaded on demand by their workspaces; we just
          // need a stable FileItem so the editor can resolve the current file.
          looseFile = {
            id: handle.id,
            name: fileBase,
            content: "",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: now,
            updatedAt: now,
            wordCount: 0,
            preview: "",
            documentType,
            storageHandle: handle,
          };
        } else {
          const content = await adapter.read(handle);
          syncDatabasesForContent(content);
          const readModel = readModelFromContent(content);
          looseFile = {
            id: content.handle.id || handle.id,
            name: fileBase,
            ...readModel,
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: content.meta?.favorite ?? false,
            icon: content.meta?.icon ?? null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: content.meta?.created || now,
            updatedAt: content.meta?.updated || now,
            wordCount: 0,
            preview: "",
            documentType: "markdown",
            storageHandle: content.handle,
          };
        }

        set((state) => ({
          openTarget: "file",
          rootPath: parentDir,
          openFilePath: trimmed,
          recents: rememberRecent({ kind: "file", path: trimmed }, state),
          files: [looseFile],
          currentFileId: looseFile.id,
          currentFolderId: null,
          loadedContentIds: new Set([looseFile.id]),
          selectedFileIds: new Set(),
          isSynced: true,
          isLoading: false,
        }));
        replaceWorkspaceLocation({ kind: "file", path: trimmed });
        void registerWindowTarget({ kind: "file", path: trimmed });
        void syncRecentsToDock(get().recents);
      },

      closeOpened: () => {
        set({
          openTarget: "none",
          rootPath: null,
          openFilePath: null,
          transientFile: null,
          files: [],
          currentFileId: null,
          currentFolderId: null,
          loadedContentIds: new Set(),
          selectedFileIds: new Set(),
          isSynced: true,
          isLoading: false,
        });
        replaceWorkspaceLocation(null);
        void unregisterWindowTarget();
      },

      createFile: async (
        name: string,
        content: string = "",
        parentId: string | null = null,
        options?: { documentType?: "markdown" | "pdf" | "excel" }
      ) => {
        try {
          // Validate parentId (a folder) exists; fall back to root if stale
          const validParentId =
            parentId && get().files.some((f) => f.id === parentId) ? parentId : null;

          const documentType =
            options?.documentType ??
            (/\.pdf$/i.test(name) ? "pdf" : /\.(xlsx|xlsm)$/i.test(name) ? "excel" : "markdown");

          let entry;
          let storedContent = content;
          if (documentType === "pdf") {
            const { createBlankPdfBytes } = await import("@/lib/pdf/blank-pdf");
            const bytes = await createBlankPdfBytes();
            entry = await getAdapter(get()).create({
              name,
              kind: "document",
              parent: parentHandleForId(get().files, validParentId),
              documentType: "pdf",
              binary: bytes,
            });
            // PDFs aren't displayed via `content` — the editor reads the
            // binary on demand. Keep the in-memory content empty so we don't
            // accidentally feed PDF bytes into a markdown viewer.
            storedContent = "";
          } else if (documentType === "excel") {
            const { createBlankExcelBytes } = await import("@/lib/excel/blank-excel");
            const bytes = createBlankExcelBytes();
            entry = await getAdapter(get()).create({
              name,
              kind: "document",
              parent: parentHandleForId(get().files, validParentId),
              documentType: "excel",
              binary: bytes,
            });
            storedContent = "";
          } else {
            entry = await getAdapter(get()).create({
              name,
              kind: "document",
              parent: parentHandleForId(get().files, validParentId),
              content: { html: content, markdown: "" },
            });
          }
          const newFile = {
            ...fileFromEntry(entry, {
              content: storedContent,
              editorHtml: storedContent,
              browsingHtml: storedContent,
              contentMarkdown: "",
              outline: [],
            }),
            content: storedContent,
          };

          set((state) => ({
            files: sortFilesByOption([newFile, ...state.files], state.sortBy),
            currentFileId: newFile.id,
            justCreatedFileId: newFile.id,
            loadedContentIds: new Set([...state.loadedContentIds, newFile.id]),
          }));

          eventBus.emit("storage:changed");
          return newFile.id;
        } catch (error) {
          log.error("Failed to create file", error);
          throw error;
        }
      },

      updateFile: async (
        id: string,
        updates: Partial<Pick<FileItem, "name" | "content" | "contentMarkdown">>
      ) => {
        const originalFile = get().files.find((f) => f.id === id);
        if (!originalFile) return;

        // Optimistic update. Renames change the sort key, so re-sort to keep
        // the sidebar order deterministic; pure content updates leave the
        // sort key untouched but reusing the helper is cheap.
        set((state) => ({
          files: sortFilesByOption(
            state.files.map((file) =>
              file.id === id ? { ...file, ...updates, updatedAt: new Date().toISOString() } : file
            ),
            state.sortBy
          ),
          // If content is being updated, mark as loaded
          ...(updates.content !== undefined && {
            loadedContentIds: new Set([...state.loadedContentIds, id]),
          }),
        }));

        try {
          const adapter = getAdapter(get());
          const originalHandle = handleForFile(originalFile);
          const hasContentUpdate =
            updates.content !== undefined || updates.contentMarkdown !== undefined;
          let updatedEntry: WorkspaceEntry | null = null;

          if (updates.name !== undefined && updates.name !== originalFile.name) {
            updatedEntry = await adapter.rename(originalHandle, updates.name);
          }

          if (hasContentUpdate) {
            const content = await adapter.write(updatedEntry?.handle ?? originalHandle, {
              html: updates.content,
              markdown: updates.contentMarkdown,
              name: updates.name ?? originalFile.name,
            });
            set((state) => ({
              files: sortFilesByOption(
                state.files.map((item) =>
                  item.id === id
                    ? {
                        ...item,
                        id: content.handle.id,
                        name: updates.name ?? content.name,
                        ...readModelFromContent(content),
                        storageHandle: content.handle,
                        updatedAt: content.updatedAt,
                      }
                    : item
                ),
                state.sortBy
              ),
              currentFileId: state.currentFileId === id ? content.handle.id : state.currentFileId,
              loadedContentIds: new Set([...state.loadedContentIds, content.handle.id]),
            }));
          } else if (updatedEntry) {
            const newId = updatedEntry.handle.id;
            set((state) => ({
              files: sortFilesByOption(
                state.files.map((item) =>
                  item.id === id
                    ? {
                        ...item,
                        ...fileFromEntry(updatedEntry!, readModelFromFile(item)),
                      }
                    : item
                ),
                state.sortBy
              ),
              // A rename changes the path, so path-derived ids (PDF/Excel) change
              // too. Carry the open-file selection and loaded-content marker onto
              // the new id so renaming the active file doesn't deselect it when
              // the next scan drops the old id.
              currentFileId: state.currentFileId === id ? newId : state.currentFileId,
              loadedContentIds: migrateIdInSet(state.loadedContentIds, id, newId),
            }));
          }
        } catch (error) {
          log.error("Failed to update file", error);
          // Revert optimistic update on error
          await get().loadFiles();
        }
      },

      deleteFile: async (id: string) => {
        const state = get();
        const fileToDelete = state.files.find((f) => f.id === id);
        if (!fileToDelete) return;

        // The backend's workspace_delete_folder trashes the entire subtree
        // atomically (single OS-trash entry per folder). Issuing per-child
        // adapter.delete calls in parallel races the parent's trash and
        // fails the children with "not found" once the folder is gone —
        // the bug we'd been masking by swallowing throws. Resolve it by
        // talking to the adapter exactly once: for a folder, the folder
        // handle covers the whole subtree; for a regular file, just the
        // file. Optimistic state still removes every descendant so the
        // sidebar reflects what just left disk.
        const collectDescendantIds = (rootId: string): string[] => {
          const out: string[] = [];
          const stack = [rootId];
          while (stack.length > 0) {
            const parentId = stack.pop();
            for (const child of state.files) {
              if (child.parentId === parentId) {
                out.push(child.id);
                if (child.isFolder) stack.push(child.id);
              }
            }
          }
          return out;
        };

        const idsLeavingStore = new Set<string>([id]);
        if (fileToDelete.isFolder) {
          for (const descendantId of collectDescendantIds(id)) {
            idsLeavingStore.add(descendantId);
          }
        }

        const newFiles = state.files.filter((f) => !idsLeavingStore.has(f.id));
        const nextFile = newFiles.find((f) => !f.isFolder);
        const newCurrentId = idsLeavingStore.has(state.currentFileId || "")
          ? (nextFile?.id ?? null)
          : state.currentFileId;

        set({
          files: newFiles,
          currentFileId: newCurrentId,
        });

        try {
          const adapter = getAdapter(state);
          await adapter.delete(handleForFile(fileToDelete));
          eventBus.emit("storage:changed");
        } catch (error) {
          log.error("Failed to delete file(s)", error);
          // Revert on error so the sidebar reflects what's actually on disk.
          try {
            await get().loadFiles();
          } catch (revertError) {
            log.error("Failed to reload files after delete error", revertError);
          }
          // Re-throw so callers can surface a notification — this used to be
          // swallowed, which left the file silently re-appearing with no
          // explanation when the adapter rejected.
          throw error;
        }
      },

      setCurrentFile: (id: string | null) => {
        if (get().currentFileId === id) return;
        set({ currentFileId: id });
        // Documents opened inside a workspace are intentionally NOT recorded as
        // recents — they're represented by their workspace folder (recorded in
        // openFolder), VSCode-style. Only standalone files opened by path
        // (openFile) and folders are remembered.
      },

      renameFile: async (id: string, name: string) => {
        await get().updateFile(id, { name });
      },

      getFile: (id: string) => {
        return get().files.find((f) => f.id === id);
      },

      // ─── Transient (untitled) buffer ──────────────────────────────────
      // Scans current root files for the next free Untitled-N.md slot.
      // Shared by the action-bar `+ New` button and the welcome-screen
      // "Start writing" path so the numbering stays consistent.
      nextUntitledName: () => {
        const rootFiles = get().files.filter((f) => !f.isFolder && f.parentId === null);
        let maxNum = 0;
        for (const file of rootFiles) {
          const match = file.name.match(/^Untitled-(\d+)\.md$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
          }
        }
        return `Untitled-${maxNum + 1}.md`;
      },

      createTransientFile: (name: string) => {
        const id = `${TRANSIENT_ID_PREFIX}${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        const transient: TransientFile = {
          id,
          name,
          content: "",
          contentMarkdown: "",
          createdAt: now,
        };
        const synthetic: FileItem = {
          id,
          name,
          content: "",
          contentMarkdown: "",
          editorHtml: "",
          browsingHtml: "",
          outline: [],
          isFolder: false,
          parentId: null,
          position: 0,
          isFavorite: false,
          icon: null,
          coverImageUrl: null,
          coverPosition: 0.5,
          createdAt: now,
          updatedAt: now,
          wordCount: 0,
          preview: "",
          documentType: "markdown",
        };
        set((state) => {
          // Drop any existing transient — only one at a time for now.
          const filteredFiles = state.transientFile
            ? state.files.filter((f) => f.id !== state.transientFile!.id)
            : state.files;
          return {
            transientFile: transient,
            files: sortFilesByOption([synthetic, ...filteredFiles], state.sortBy),
            currentFileId: id,
            justCreatedFileId: id,
            isSynced: true,
            isLoading: false,
            loadedContentIds: new Set([...state.loadedContentIds, id]),
          };
        });
        return id;
      },

      setTransientContent: (content: string, contentMarkdown: string) => {
        const transient = get().transientFile;
        if (!transient) return;
        const updated: TransientFile = { ...transient, content, contentMarkdown };
        set((state) => ({
          transientFile: updated,
          files: state.files.map((f) =>
            f.id === transient.id
              ? {
                  ...f,
                  content,
                  editorHtml: content,
                  browsingHtml: content,
                  contentMarkdown,
                  updatedAt: new Date().toISOString(),
                }
              : f
          ),
        }));
      },

      materializeTransient: async (absolutePath: string) => {
        const transient = get().transientFile;
        if (!transient) {
          throw new Error("No transient buffer to materialize");
        }
        const trimmed = absolutePath.trim();
        const normalized = trimmed.replaceAll("\\", "/");
        const lastSlash = normalized.lastIndexOf("/");
        if (lastSlash <= 0) {
          throw new Error("materializeTransient requires an absolute path");
        }
        const parentDir = trimmed.slice(0, lastSlash);
        const fileBase = normalized.slice(lastSlash + 1);

        // Adapter scoped to the chosen parent directory so the file lands
        // exactly where the user picked, regardless of the current rootPath.
        const adapter = createStorageAdapter({ disk: { root: parentDir } });
        await adapter.create({
          name: fileBase,
          kind: "document",
          parent: undefined,
          content: { html: transient.content, markdown: transient.contentMarkdown },
        });

        // Drop the synthetic transient FileItem before openFile rebuilds
        // the files array — keeps things consistent if anything reads in
        // between.
        set((state) => ({
          files: state.files.filter((f) => f.id !== transient.id),
          transientFile: null,
        }));

        // Switch to loose-file mode on the newly written path. openFile
        // owns currentFileId / openFilePath / rootPath updates.
        await get().openFile(trimmed);
        return get().currentFileId ?? "";
      },

      discardTransient: () => {
        const transient = get().transientFile;
        if (!transient) return;
        set((state) => ({
          files: state.files.filter((f) => f.id !== transient.id),
          transientFile: null,
          currentFileId: state.currentFileId === transient.id ? null : state.currentFileId,
          loadedContentIds: new Set(
            Array.from(state.loadedContentIds).filter((id) => id !== transient.id)
          ),
        }));
      },

      // Favorites
      toggleFavorite: async (fileId: string) => {
        const file = get().files.find((f) => f.id === fileId);
        if (!file) return;

        const newFavorite = !file.isFavorite;

        // Optimistic update
        set((state) => ({
          files: state.files.map((f) => (f.id === fileId ? { ...f, isFavorite: newFavorite } : f)),
        }));

        try {
          await getAdapter(get()).write(handleForFile(file), {
            meta: { id: file.id, favorite: newFavorite },
          });
        } catch (error) {
          log.error("Failed to toggle favorite", error);
          // Revert on error
          set((state) => ({
            files: state.files.map((f) =>
              f.id === fileId ? { ...f, isFavorite: !newFavorite } : f
            ),
          }));
        }
      },

      setFileIcon: async (fileId: string, icon: string | null) => {
        const file = get().files.find((f) => f.id === fileId);
        if (!file) return;

        // Optimistic update
        set((state) => ({
          files: state.files.map((f) => (f.id === fileId ? { ...f, icon } : f)),
        }));

        const editor = useEditorStore.getState();
        editor.setSaving(true);
        try {
          await getAdapter(get()).write(handleForFile(file), {
            meta: { id: file.id, icon },
          });
          editor.setLastSavedAt(new Date().toISOString());
        } catch (error) {
          log.error("Failed to set file icon", error);
          // Revert on error
          set((state) => ({
            files: state.files.map((f) => (f.id === fileId ? { ...f, icon: file.icon } : f)),
          }));
        } finally {
          editor.setSaving(false);
        }
      },

      setCoverImage: async (fileId: string, url: string | null) => {
        const file = get().files.find((f) => f.id === fileId);
        if (!file) return;

        set((state) => ({
          files: state.files.map((f) => (f.id === fileId ? { ...f, coverImageUrl: url } : f)),
        }));

        const editor = useEditorStore.getState();
        editor.setSaving(true);
        try {
          await getAdapter(get()).write(handleForFile(file), {
            meta: { id: file.id, cover: url },
          });
          editor.setLastSavedAt(new Date().toISOString());
        } catch (error) {
          log.error("Failed to set cover image", error);
          set((state) => ({
            files: state.files.map((f) =>
              f.id === fileId ? { ...f, coverImageUrl: file.coverImageUrl } : f
            ),
          }));
        } finally {
          editor.setSaving(false);
        }
      },

      setCoverPosition: async (fileId: string, position: number) => {
        const file = get().files.find((f) => f.id === fileId);
        if (!file) return;

        const clamped = Math.max(0, Math.min(1, position));
        set((state) => ({
          files: state.files.map((f) => (f.id === fileId ? { ...f, coverPosition: clamped } : f)),
        }));

        const editor = useEditorStore.getState();
        editor.setSaving(true);
        try {
          await getAdapter(get()).write(handleForFile(file), {
            meta: { id: file.id, cover_position: clamped },
          });
          editor.setLastSavedAt(new Date().toISOString());
        } catch (error) {
          log.error("Failed to set cover position", error);
          set((state) => ({
            files: state.files.map((f) =>
              f.id === fileId ? { ...f, coverPosition: file.coverPosition } : f
            ),
          }));
        } finally {
          editor.setSaving(false);
        }
      },

      getFavorites: () => {
        const { files, sortBy } = get();
        const favorites = files.filter((f) => f.isFavorite && !f.isFolder);
        return sortFilesByOption(favorites, sortBy);
      },

      getRecentFiles: (limit = 3) => {
        const { files } = get();
        return files
          .filter((f) => !f.isFolder)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, limit);
      },

      // Folder operations
      createFolder: async (
        name: string,
        parentId?: string | null,
        options?: { silent?: boolean }
      ) => {
        try {
          const entry = await getAdapter(get()).create({
            name,
            kind: "folder",
            parent: parentHandleForId(get().files, parentId),
          });
          const newFolder = fileFromEntry(entry);

          // `silent` suppresses justCreatedFileId — used by folder import
          // where setting it on every nested folder would auto-open
          // rename mode in the sidebar for whichever folder happened to
          // come last, mid-import.
          if (options?.silent) {
            set((state) => ({
              files: sortFilesByOption([newFolder, ...state.files], state.sortBy),
            }));
          } else {
            set((state) => ({
              files: sortFilesByOption([newFolder, ...state.files], state.sortBy),
              justCreatedFileId: newFolder.id,
            }));
          }

          return newFolder.id;
        } catch (error) {
          log.error("Failed to create folder", error);
          throw error;
        }
      },

      moveFileToFolder: async (fileId: string, folderId: string | null) => {
        const originalFile = get().files.find((file) => file.id === fileId);
        // Optimistic update — re-sort because parentId moves the file into a
        // different bucket, where its position depends on name within that bucket.
        set((state) => ({
          files: sortFilesByOption(
            state.files.map((file) =>
              file.id === fileId
                ? { ...file, parentId: folderId, updatedAt: new Date().toISOString() }
                : file
            ),
            state.sortBy
          ),
        }));

        try {
          if (!originalFile) return;
          const moved = await getAdapter(get()).move(
            handleForFile(originalFile),
            parentHandleForId(get().files, folderId)
          );
          set((state) => ({
            files: sortFilesByOption(
              state.files.map((file) =>
                file.id === fileId
                  ? { ...file, ...fileFromEntry(moved, readModelFromFile(file)) }
                  : file
              ),
              state.sortBy
            ),
          }));
        } catch (error) {
          log.error("Failed to move file", error);
          // Revert optimistic update on error
          await get().loadFiles();
        }
      },

      importExternalFile: async ({ name, parentId, srcPath, bytes, mode }) => {
        const adapter = getAdapter(get());
        if (!adapter.importExternal) {
          throw new Error("Storage adapter does not support importExternal");
        }
        const validParentId =
          parentId && get().files.some((f) => f.id === parentId && f.isFolder) ? parentId : null;
        const entry = await adapter.importExternal({
          name,
          parent: parentHandleForId(get().files, validParentId),
          srcPath,
          bytes,
          mode,
        });
        // Replace mode overwrites a file that already exists in the workspace.
        // Surface that as a refreshed entry rather than a fresh insertion so
        // the sidebar doesn't end up with two rows for the same path.
        if (mode === "replace") {
          const existing = get().files.find(
            (f) => !f.isFolder && f.parentId === validParentId && f.name === name
          );
          if (existing) {
            // Touch updatedAt by replacing the entry in place; the sidecar is
            // intentionally left alone on disk so the next open trips Salvage.
            // Name doesn't change here, but re-sort to be defensive — under
            // modified-newest the touched entry should move to the top.
            set((state) => ({
              files: sortFilesByOption(
                state.files.map((f) => (f.id === existing.id ? { ...f, content: "" } : f)),
                state.sortBy
              ),
            }));
            eventBus.emit("storage:changed");
            return existing.id;
          }
        }
        const newFile = fileFromEntry(entry);
        set((state) => ({
          files: sortFilesByOption([newFile, ...state.files], state.sortBy),
          justCreatedFileId: newFile.id,
        }));
        eventBus.emit("storage:changed");
        return newFile.id;
      },

      setCurrentFolder: (folderId: string | null) => {
        set({ currentFolderId: folderId });
      },

      getFilesInFolder: (folderId: string | null) => {
        const { files, sortBy } = get();
        const filtered = files.filter((f) => !f.isFolder && f.parentId === folderId);
        return sortFilesByOption(filtered, sortBy);
      },

      getFolders: (parentId?: string | null) => {
        const { files, sortBy } = get();
        const targetParentId = parentId === undefined ? null : parentId;
        const filtered = files.filter((f) => f.isFolder && f.parentId === targetParentId);
        return sortFilesByOption(filtered, sortBy);
      },

      getFolderAncestors: (folderId: string) => {
        const { files } = get();
        const ancestors: FileItem[] = [];
        let currentId: string | null = folderId;
        const visited = new Set<string>();

        while (currentId) {
          if (visited.has(currentId)) break;
          visited.add(currentId);
          const folder = files.find((f) => f.id === currentId);
          if (!folder) break;
          ancestors.unshift(folder);
          currentId = folder.parentId;
        }

        return ancestors;
      },

      setSortBy: (sortBy) => set({ sortBy }),

      clearJustCreatedFileId: () => set({ justCreatedFileId: null }),

      toggleFolderExpanded: (folderId) =>
        set((state) => {
          const next = new Set(state.expandedFolderIds);
          if (next.has(folderId)) {
            next.delete(folderId);
          } else {
            next.add(folderId);
          }
          return { expandedFolderIds: next };
        }),

      setFolderExpanded: (folderId, expanded) =>
        set((state) => {
          const next = new Set(state.expandedFolderIds);
          if (expanded) {
            next.add(folderId);
          } else {
            next.delete(folderId);
          }
          return { expandedFolderIds: next };
        }),

      // Multi-select operations
      toggleFileSelection: (fileId) =>
        set((state) => {
          const next = new Set(state.selectedFileIds);
          if (next.has(fileId)) {
            next.delete(fileId);
          } else {
            next.add(fileId);
          }
          return { selectedFileIds: next };
        }),

      selectFileRange: (fromId, toId) => {
        const { files, currentFolderId } = get();
        const visibleFiles = files.filter((f) => !f.isFolder && f.parentId === currentFolderId);
        const fromIndex = visibleFiles.findIndex((f) => f.id === fromId);
        const toIndex = visibleFiles.findIndex((f) => f.id === toId);

        if (fromIndex === -1 || toIndex === -1) return;

        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);
        const rangeIds = visibleFiles.slice(start, end + 1).map((f) => f.id);

        set((state) => {
          const next = new Set(state.selectedFileIds);
          rangeIds.forEach((id) => next.add(id));
          return { selectedFileIds: next };
        });
      },

      clearSelection: () => set({ selectedFileIds: new Set() }),

      selectAll: () => {
        const { files, currentFolderId } = get();
        const visibleFiles = files.filter((f) => !f.isFolder && f.parentId === currentFolderId);
        set({ selectedFileIds: new Set(visibleFiles.map((f) => f.id)) });
      },

      bulkMoveFiles: async (fileIds, folderId) => {
        // Optimistic update — re-sort because parentId changes shuffle the
        // moved files into a different bucket (see moveFileToFolder).
        set((state) => ({
          files: sortFilesByOption(
            state.files.map((file) =>
              fileIds.includes(file.id)
                ? { ...file, parentId: folderId, updatedAt: new Date().toISOString() }
                : file
            ),
            state.sortBy
          ),
          selectedFileIds: new Set(), // Clear selection after move
        }));

        try {
          const adapter = getAdapter(get());
          await Promise.all(
            fileIds.map((fileId) => {
              const file = get().files.find((item) => item.id === fileId);
              return file
                ? adapter.move(handleForFile(file), parentHandleForId(get().files, folderId))
                : Promise.resolve();
            })
          );
        } catch (error) {
          log.error("Failed to bulk move files", error);
          // Revert optimistic update on error
          await get().loadFiles();
          throw error;
        }
      },

      bulkDeleteFiles: async (fileIds) => {
        const state = get();
        const newFiles = state.files.filter((f) => !fileIds.includes(f.id));
        const nextFile = newFiles.find((f) => !f.isFolder);
        const newCurrentId = fileIds.includes(state.currentFileId || "")
          ? (nextFile?.id ?? null)
          : state.currentFileId;

        // Optimistic update
        set({
          files: newFiles,
          currentFileId: newCurrentId,
          selectedFileIds: new Set(), // Clear selection after delete
        });

        try {
          const adapter = getAdapter(state);
          await Promise.all(
            fileIds.map((fileId) => {
              const file = state.files.find((item) => item.id === fileId);
              return file ? adapter.delete(handleForFile(file)) : Promise.resolve();
            })
          );
          eventBus.emit("storage:changed");
        } catch (error) {
          log.error("Failed to bulk delete files", error);
          // Revert on error
          await get().loadFiles();
          throw error;
        }
      },
    }),
    {
      name: "doxmind-files",
      // Multi-window: each window tracks its own openTarget/rootPath in memory
      // only. Persisting them would race across windows (same origin = shared
      // localStorage). Per-window state arrives via URL params (?folder=... /
      // ?file=...) at boot. Recents + UI prefs are global and shared.
      // sortBy is intentionally NOT persisted. There is no UI that mutates
      // it, so persisting only freezes whatever default was shipped in the
      // first session a user ran — making subsequent default changes
      // invisible without a manual localStorage clear. If a sort menu is
      // added later, re-include sortBy in partialize.
      partialize: (state) => ({
        recents: state.recents,
        expandedFolderIds: Array.from(state.expandedFolderIds),
      }),
      merge: (persistedState, currentState) => {
        // Explicitly pick only the fields we want to rehydrate. A naive
        // `...persisted` spread would copy any stale keys (e.g. an older
        // `sortBy: "modified-newest"`) still sitting in localStorage from
        // a previous schema, silently overriding in-code defaults. TS
        // type-narrowing on the cast doesn't filter the runtime object.
        const persisted = persistedState as Partial<{
          recents: RecentEntry[];
          expandedFolderIds: string[];
        }>;
        return {
          ...currentState,
          recents: persisted.recents ?? [],
          expandedFolderIds: new Set(persisted.expandedFolderIds ?? []),
          files: currentState.files,
        };
      },
    }
  )
);
