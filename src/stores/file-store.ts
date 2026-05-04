import { create } from "zustand";
import { persist } from "zustand/middleware";
import { storeLogger } from "@/lib/logger";
import { eventBus } from "@/lib/events";
import { syncDatabasesForDocument } from "@/stores/database-store";
import type { FileItem } from "@/types";
import { documentTypeFromName } from "@/lib/document-types";
import {
  createStorageAdapter,
  type DocumentHandle,
  type StorageAdapter,
  type WorkspaceEntry,
} from "@/lib/storage";
import { registerWindowTarget, syncRecentsToDock, unregisterWindowTarget } from "@/lib/window";

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

// Helper function to sort files based on sort option
export function sortFilesByOption(files: FileItem[], sortBy: SortOption): FileItem[] {
  const sorted = [...files];

  switch (sortBy) {
    case "name-asc":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "name-desc":
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case "modified-newest":
      return sorted.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    case "modified-oldest":
      return sorted.sort(
        (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      );
    case "created-newest":
      return sorted.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    case "created-oldest":
      return sorted.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    default:
      return sorted;
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
  loadFiles: () => Promise<void>;
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
  setCurrentFolder: (folderId: string | null) => void;
  getFilesInFolder: (folderId: string | null) => FileItem[];
  getSubPages: (fileId: string) => FileItem[];
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

  // Trash
  trashFiles: Array<{
    id: string;
    name: string;
    isFolder: boolean;
    parentId: string | null;
    deletedAt: string;
    createdAt: string;
    updatedAt: string;
  }>;
  isTrashLoading: boolean;
  loadTrash: () => Promise<void>;
  restoreFile: (id: string) => Promise<void>;
  permanentDeleteFile: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
}

function getAdapter(state: Pick<FileState, "rootPath">): StorageAdapter {
  return createStorageAdapter({ disk: { root: state.rootPath } });
}

const RECENTS_LIMIT = 8;

function rememberRecent(entry: RecentEntry, state: Pick<FileState, "recents">): RecentEntry[] {
  return [
    entry,
    ...state.recents.filter((r) => !(r.kind === entry.kind && r.path === entry.path)),
  ].slice(0, RECENTS_LIMIT);
}

function handleForFile(file: FileItem): DocumentHandle {
  return (
    file.storageHandle ?? { mode: "disk", id: file.id, kind: file.isFolder ? "folder" : "document" }
  );
}

function fileFromEntry(entry: WorkspaceEntry, existingContent?: string): FileItem {
  return {
    id: entry.handle.id,
    name: entry.name,
    content: existingContent ?? "",
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
      sortBy: "modified-newest" as SortOption,
      justCreatedFileId: null,
      expandedFolderIds: new Set<string>(),
      trashFiles: [],
      isTrashLoading: false,
      selectedFileIds: new Set<string>(),
      loadedContentIds: new Set<string>(),

      loadFiles: async () => {
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
        set({ isLoading: true });
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
            const prevContentMap = new Map<string, string>();
            if (preservedContentIds.size > 0) {
              for (const f of state.files) {
                if (preservedContentIds.has(f.id) && f.content) {
                  prevContentMap.set(f.id, f.content);
                }
              }
            }

            const files: FileItem[] = entries.map((entry) =>
              fileFromEntry(entry, prevContentMap.get(entry.handle.id))
            );

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
          // Keep local files if server is unavailable
          set({ isSynced: false, isLoading: false });
        }
      },

      loadFileContent: async (fileId: string, options?: { force?: boolean }) => {
        if (!options?.force && get().loadedContentIds.has(fileId)) return;
        // Prevent duplicate concurrent fetches for the same file
        if (pendingContentLoads.has(fileId)) return;
        pendingContentLoads.add(fileId);
        try {
          const file = get().files.find((f) => f.id === fileId);
          if (!file) return;
          if (file.documentType === "pdf" || file.documentType === "excel") {
            set((state) => ({
              loadedContentIds: new Set([...state.loadedContentIds, fileId]),
            }));
            return;
          }
          const fullFile = await getAdapter(get()).read(handleForFile(file));
          syncDatabasesForDocument(fullFile.extras, fullFile.html, fullFile.markdown);
          set((state) => {
            // Only update if the file exists in the files array.
            // If loadFiles() hasn't completed yet, files may be empty — in that case
            // skip the update and don't mark as loaded so it retries after loadFiles.
            const fileExists = state.files.some((f) => f.id === fileId);
            if (!fileExists) return {};

            return {
              files: state.files.map((f) =>
                f.id === fileId
                  ? {
                      ...f,
                      id: fullFile.handle.id,
                      content: fullFile.html,
                      contentMarkdown: fullFile.markdown ?? null,
                      storageHandle: fullFile.handle,
                    }
                  : f
              ),
              currentFileId:
                state.currentFileId === fileId ? fullFile.handle.id : state.currentFileId,
              loadedContentIds: new Set([...state.loadedContentIds, fullFile.handle.id]),
            };
          });
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

        if (documentType === "pdf") {
          // PDF binary is loaded on demand by the editor; we just need a
          // stable FileItem so the editor can resolve the current file.
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
            documentType: "pdf",
            storageHandle: handle,
          };
        } else {
          const content = await adapter.read(handle);
          syncDatabasesForDocument(content.extras, content.html, content.markdown);
          looseFile = {
            id: content.handle.id || handle.id,
            name: fileBase,
            content: content.html,
            contentMarkdown: content.markdown ?? null,
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
        void unregisterWindowTarget();
      },

      createFile: async (
        name: string,
        content: string = "",
        parentId: string | null = null,
        options?: { documentType?: "markdown" | "pdf" | "excel" }
      ) => {
        try {
          // Validate parentId exists (folder or file for sub-pages); fall back to root if stale
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
          const newFile = { ...fileFromEntry(entry, storedContent), content: storedContent };

          set((state) => ({
            files: [newFile, ...state.files],
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

        // Optimistic update
        set((state) => ({
          files: state.files.map((file) =>
            file.id === id ? { ...file, ...updates, updatedAt: new Date().toISOString() } : file
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
              files: state.files.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      id: content.handle.id,
                      name: updates.name ?? content.name,
                      content: content.html,
                      contentMarkdown: content.markdown,
                      storageHandle: content.handle,
                      updatedAt: content.updatedAt,
                    }
                  : item
              ),
              currentFileId: state.currentFileId === id ? content.handle.id : state.currentFileId,
              loadedContentIds: new Set([...state.loadedContentIds, content.handle.id]),
            }));
          } else if (updatedEntry) {
            set((state) => ({
              files: state.files.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      ...fileFromEntry(updatedEntry!, item.content),
                      content: item.content,
                    }
                  : item
              ),
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

        // Collect all files to delete (folder + children if it's a folder)
        const filesToDelete: string[] = [id];
        if (fileToDelete?.isFolder) {
          const childFiles = state.files.filter((f) => f.parentId === id);
          filesToDelete.push(...childFiles.map((f) => f.id));
        }

        // Filter out all files to delete
        const newFiles = state.files.filter((f) => !filesToDelete.includes(f.id));
        const nextFile = newFiles.find((f) => !f.isFolder);
        const newCurrentId = filesToDelete.includes(state.currentFileId || "")
          ? (nextFile?.id ?? null)
          : state.currentFileId;

        // Optimistic update
        set({
          files: newFiles,
          currentFileId: newCurrentId,
        });

        try {
          const adapter = getAdapter(state);
          await Promise.all(
            filesToDelete.map((fileId) => {
              const file = state.files.find((item) => item.id === fileId);
              return file ? adapter.delete(handleForFile(file)) : Promise.resolve();
            })
          );

          eventBus.emit("storage:changed");
        } catch (error) {
          log.error("Failed to delete file(s)", error);
          // Revert on error
          await get().loadFiles();
        }
      },

      setCurrentFile: (id: string | null) => {
        if (get().currentFileId === id) return;
        set({ currentFileId: id });
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
            files: [synthetic, ...filteredFiles],
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
              ? { ...f, content, contentMarkdown, updatedAt: new Date().toISOString() }
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

        try {
          await getAdapter(get()).write(handleForFile(file), {
            meta: { id: file.id, icon },
          });
        } catch (error) {
          log.error("Failed to set file icon", error);
          // Revert on error
          set((state) => ({
            files: state.files.map((f) => (f.id === fileId ? { ...f, icon: file.icon } : f)),
          }));
        }
      },

      setCoverImage: async (fileId: string, url: string | null) => {
        const file = get().files.find((f) => f.id === fileId);
        if (!file) return;

        set((state) => ({
          files: state.files.map((f) => (f.id === fileId ? { ...f, coverImageUrl: url } : f)),
        }));

        try {
          await getAdapter(get()).write(handleForFile(file), {
            meta: { id: file.id, cover: url },
          });
        } catch (error) {
          log.error("Failed to set cover image", error);
          set((state) => ({
            files: state.files.map((f) =>
              f.id === fileId ? { ...f, coverImageUrl: file.coverImageUrl } : f
            ),
          }));
        }
      },

      setCoverPosition: async (fileId: string, position: number) => {
        const file = get().files.find((f) => f.id === fileId);
        if (!file) return;

        const clamped = Math.max(0, Math.min(1, position));
        set((state) => ({
          files: state.files.map((f) => (f.id === fileId ? { ...f, coverPosition: clamped } : f)),
        }));

        try {
          await getAdapter(get()).write(handleForFile(file), {
            meta: { id: file.id, cover_position: clamped },
          });
        } catch (error) {
          log.error("Failed to set cover position", error);
          set((state) => ({
            files: state.files.map((f) =>
              f.id === fileId ? { ...f, coverPosition: file.coverPosition } : f
            ),
          }));
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
              files: [newFolder, ...state.files],
            }));
          } else {
            set((state) => ({
              files: [newFolder, ...state.files],
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
        // Optimistic update
        set((state) => ({
          files: state.files.map((file) =>
            file.id === fileId
              ? { ...file, parentId: folderId, updatedAt: new Date().toISOString() }
              : file
          ),
        }));

        try {
          if (!originalFile) return;
          const moved = await getAdapter(get()).move(
            handleForFile(originalFile),
            parentHandleForId(get().files, folderId)
          );
          set((state) => ({
            files: state.files.map((file) =>
              file.id === fileId
                ? { ...file, ...fileFromEntry(moved, file.content), content: file.content }
                : file
            ),
          }));
        } catch (error) {
          log.error("Failed to move file", error);
          // Revert optimistic update on error
          await get().loadFiles();
        }
      },

      setCurrentFolder: (folderId: string | null) => {
        set({ currentFolderId: folderId });
      },

      getFilesInFolder: (folderId: string | null) => {
        const { files, sortBy } = get();
        const filtered = files.filter((f) => !f.isFolder && f.parentId === folderId);
        return sortFilesByOption(filtered, sortBy);
      },

      getSubPages: (fileId: string) => {
        const { files, sortBy } = get();
        const filtered = files.filter((f) => !f.isFolder && f.parentId === fileId);
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
        // Optimistic update
        set((state) => ({
          files: state.files.map((file) =>
            fileIds.includes(file.id)
              ? { ...file, parentId: folderId, updatedAt: new Date().toISOString() }
              : file
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

      // Trash operations
      loadTrash: async () => {
        set({ isTrashLoading: true });
        set({ trashFiles: [], isTrashLoading: false });
      },

      restoreFile: async (id: string) => {
        set((state) => ({
          trashFiles: state.trashFiles.filter((f) => f.id !== id),
        }));
        await get().loadFiles();
      },

      permanentDeleteFile: async (id: string) => {
        set((state) => ({
          trashFiles: state.trashFiles.filter((f) => f.id !== id),
        }));
        eventBus.emit("storage:changed");
      },

      emptyTrash: async () => {
        set({ trashFiles: [] });
        eventBus.emit("storage:changed");
      },
    }),
    {
      name: "doxmind-files",
      // Multi-window: each window tracks its own openTarget/rootPath in memory
      // only. Persisting them would race across windows (same origin = shared
      // localStorage). Per-window state arrives via URL params (?folder=... /
      // ?file=...) at boot. Recents + UI prefs are global and shared.
      partialize: (state) => ({
        recents: state.recents,
        sortBy: state.sortBy,
        expandedFolderIds: Array.from(state.expandedFolderIds),
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<{
          recents: RecentEntry[];
          sortBy: SortOption;
          expandedFolderIds: string[];
        }>;
        return {
          ...currentState,
          ...persisted,
          recents: persisted.recents ?? [],
          files: currentState.files,
          expandedFolderIds: new Set(persisted.expandedFolderIds || []),
        };
      },
    }
  )
);
