import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";
import { markdownToHtml } from "@/lib/markdown";
import { storeLogger } from "@/lib/logger";
import { eventBus } from "@/lib/events";
import { syncDatabasesForDocument } from "@/stores/database-store";
import type { FileItem } from "@/types";
import {
  createStorageAdapter,
  type DocumentHandle,
  type StorageAdapter,
  type WorkspaceEntry,
  type WorkspaceMode,
} from "@/lib/storage";

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

interface FileState {
  files: FileItem[];
  currentFileId: string | null;
  currentFolderId: string | null; // NEW: null = root view
  workspaceMode: WorkspaceMode;
  workspaceRoot: string | null;
  recentWorkspaces: string[];
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
  openDiskWorkspace: (root: string) => Promise<void>;
  switchToDbWorkspace: () => Promise<void>;
  createFile: (name: string, content?: string, parentId?: string | null) => Promise<string>;
  importFile: (
    file: File,
    parentId?: string | null,
    options?: { silent?: boolean }
  ) => Promise<string>;
  updateFile: (
    id: string,
    updates: Partial<Pick<FileItem, "name" | "content" | "contentMarkdown">>
  ) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  setCurrentFile: (id: string | null) => void;
  renameFile: (id: string, name: string) => Promise<void>;
  getFile: (id: string) => FileItem | undefined;

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

function getAdapter(state: Pick<FileState, "workspaceMode" | "workspaceRoot">): StorageAdapter {
  return createStorageAdapter({
    mode: state.workspaceMode,
    disk: { root: state.workspaceRoot },
  });
}

function handleForFile(file: FileItem): DocumentHandle {
  return (
    file.storageHandle ?? { mode: "db", id: file.id, kind: file.isFolder ? "folder" : "document" }
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
      workspaceMode: "db",
      workspaceRoot: null,
      recentWorkspaces: [],
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
          const fullFile = await getAdapter(get()).read(handleForFile(file));
          if (get().workspaceMode === "disk") {
            syncDatabasesForDocument(fullFile.extras, fullFile.html, fullFile.markdown);
          }
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

      openDiskWorkspace: async (root: string) => {
        const trimmedRoot = root.trim();
        if (!trimmedRoot) return;
        set((state) => ({
          workspaceMode: "disk",
          workspaceRoot: trimmedRoot,
          recentWorkspaces: [
            trimmedRoot,
            ...state.recentWorkspaces.filter((item) => item !== trimmedRoot),
          ].slice(0, 8),
          files: [],
          currentFileId: null,
          currentFolderId: null,
          loadedContentIds: new Set(),
          isSynced: false,
        }));
        await get().loadFiles();
      },

      switchToDbWorkspace: async () => {
        set({
          workspaceMode: "db",
          workspaceRoot: null,
          files: [],
          currentFileId: null,
          currentFolderId: null,
          loadedContentIds: new Set(),
          isSynced: false,
        });
        await get().loadFiles();
      },

      createFile: async (name: string, content: string = "", parentId: string | null = null) => {
        try {
          // Validate parentId exists (folder or file for sub-pages); fall back to root if stale
          const validParentId =
            parentId && get().files.some((f) => f.id === parentId) ? parentId : null;

          const entry = await getAdapter(get()).create({
            name,
            kind: "document",
            parent: parentHandleForId(get().files, validParentId),
            content: { html: content, markdown: "" },
          });
          const newFile = { ...fileFromEntry(entry, content), content };

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

      importFile: async (file: File, parentId?: string | null, options?: { silent?: boolean }) => {
        // No client-side size cap — this is a local-first desktop build,
        // the sidecar is on 127.0.0.1 and the data dir is the user's own
        // disk. Big academic PDFs / scanned docs were getting silently
        // counted as "failed" in folder imports because of the legacy
        // SaaS-era 10MB limit; markitdown handles them fine, just takes
        // longer for very large files.
        try {
          if (get().workspaceMode === "disk") {
            const imported = /\.(md|markdown)$/i.test(file.name)
              ? {
                  name: file.name,
                  markdown: await file.text(),
                  html: "",
                }
              : await api.convertFile(file).then((converted) => ({
                  name: converted.name,
                  markdown: converted.content_markdown,
                  html: converted.content,
                }));
            const htmlContent = imported.html || markdownToHtml(imported.markdown);
            const entry = await getAdapter(get()).create({
              name: imported.name,
              kind: "document",
              parent: parentHandleForId(get().files, parentId),
              content: { html: htmlContent, markdown: imported.markdown },
            });
            const newFile = {
              ...fileFromEntry(entry, htmlContent),
              contentMarkdown: imported.markdown,
              wordCount: imported.markdown.split(/\s+/).filter(Boolean).length,
              preview: imported.markdown
                .replace(/[#*_`>\-[\]()]/g, "")
                .trim()
                .slice(0, 200),
            };
            if (options?.silent) {
              set((state) => ({ files: [newFile, ...state.files] }));
            } else {
              set((state) => ({
                files: [newFile, ...state.files],
                currentFileId: newFile.id,
                loadedContentIds: new Set([...state.loadedContentIds, newFile.id]),
              }));
            }
            eventBus.emit("storage:changed");
            return newFile.id;
          }

          // Import file via API (converts PDF/DOCX/MD to markdown)
          const serverFile = await api.importFile(file, parentId);

          // Use frontend markdownToHtml for proper math/mermaid/TipTap rendering
          // The backend's Python markdown library doesn't support math ($...$) or
          // mermaid blocks, but our frontend's marked config handles them correctly.
          let htmlContent = serverFile.content;
          if (serverFile.content_markdown) {
            htmlContent = markdownToHtml(serverFile.content_markdown);
          }

          const plainText = htmlContent.replace(/<[^>]*>/g, "").trim();
          const newFile: FileItem = {
            id: serverFile.id,
            name: serverFile.name,
            content: htmlContent,
            contentMarkdown: serverFile.content_markdown || null,
            isFolder: serverFile.is_folder || false,
            parentId: serverFile.parent_id || null,
            position: serverFile.position || 0,
            isFavorite: serverFile.is_favorite || false,
            icon: serverFile.icon || null,
            coverImageUrl: serverFile.cover_image_url || null,
            coverPosition: serverFile.cover_position ?? 0.5,
            createdAt: serverFile.created_at,
            updatedAt: serverFile.updated_at,
            wordCount: plainText.split(/\s+/).filter(Boolean).length,
            preview: plainText.slice(0, 200),
          };

          // `silent` skips opening the imported file — used by folder
          // import where 8 concurrent uploads would otherwise thrash the
          // active editor by flipping currentFileId on every completion.
          if (options?.silent) {
            set((state) => ({
              files: [newFile, ...state.files],
            }));
          } else {
            set((state) => ({
              files: [newFile, ...state.files],
              currentFileId: newFile.id,
              loadedContentIds: new Set([...state.loadedContentIds, newFile.id]),
            }));
          }

          // Save properly converted HTML back to server so future loads use it
          if (serverFile.content_markdown && htmlContent !== serverFile.content) {
            api.updateFile(newFile.id, { content: htmlContent }).catch((err) => {
              log.error("Failed to save re-converted HTML", err);
            });
          }

          eventBus.emit("storage:changed");
          return newFile.id;
        } catch (error) {
          log.error("Failed to import file", error);
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

          if (
            adapter.mode !== "db" &&
            updates.name !== undefined &&
            updates.name !== originalFile.name
          ) {
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
          } else if (
            adapter.mode === "db" &&
            updates.name !== undefined &&
            updates.name !== originalFile.name
          ) {
            updatedEntry = await adapter.rename(originalHandle, updates.name);
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
          get().loadFiles();
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
          get().loadFiles();
        }
      },

      setCurrentFile: (id: string | null) => {
        set({ currentFileId: id });
      },

      renameFile: async (id: string, name: string) => {
        await get().updateFile(id, { name });
      },

      getFile: (id: string) => {
        return get().files.find((f) => f.id === id);
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
          if (get().workspaceMode === "disk") {
            await getAdapter(get()).write(handleForFile(file), {
              meta: { id: file.id, favorite: newFavorite },
            });
          } else {
            await api.updateFile(fileId, { is_favorite: newFavorite });
          }
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
          if (get().workspaceMode === "disk") {
            await getAdapter(get()).write(handleForFile(file), {
              meta: { id: file.id, icon },
            });
          } else {
            await api.updateFile(fileId, { icon: icon ?? "" });
          }
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
          if (get().workspaceMode === "disk") {
            await getAdapter(get()).write(handleForFile(file), {
              meta: { id: file.id, cover: url },
            });
          } else {
            await api.updateFile(fileId, { cover_image_url: url ?? "" });
          }
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
          if (get().workspaceMode === "disk") {
            // Cover position has no markdown/frontmatter field yet; keep it local
            // until sidecar extras own page metadata.
            return;
          }
          await api.updateFile(fileId, { cover_position: clamped });
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
          get().loadFiles();
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
          get().loadFiles();
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
          get().loadFiles();
          throw error;
        }
      },

      // Trash operations
      loadTrash: async () => {
        set({ isTrashLoading: true });
        try {
          const trashItems = await api.listTrash();
          set({
            trashFiles: trashItems.map((f) => ({
              id: f.id,
              name: f.name,
              isFolder: f.is_folder,
              parentId: f.parent_id,
              deletedAt: f.deleted_at,
              createdAt: f.created_at,
              updatedAt: f.updated_at,
            })),
            isTrashLoading: false,
          });
        } catch (error) {
          log.error("Failed to load trash", error);
          set({ isTrashLoading: false });
        }
      },

      restoreFile: async (id: string) => {
        try {
          await api.restoreFile(id);
          // Remove from trash list
          set((state) => ({
            trashFiles: state.trashFiles.filter((f) => f.id !== id),
          }));
          // Reload files to get the restored file
          get().loadFiles();
        } catch (error) {
          log.error("Failed to restore file", error);
          throw error;
        }
      },

      permanentDeleteFile: async (id: string) => {
        try {
          await api.permanentDeleteFile(id);
          set((state) => ({
            trashFiles: state.trashFiles.filter((f) => f.id !== id),
          }));
          eventBus.emit("storage:changed");
        } catch (error) {
          log.error("Failed to permanently delete file", error);
          throw error;
        }
      },

      emptyTrash: async () => {
        try {
          await api.emptyTrash();
          set({ trashFiles: [] });
          eventBus.emit("storage:changed");
        } catch (error) {
          log.error("Failed to empty trash", error);
          throw error;
        }
      },
    }),
    {
      name: "doxmind-files",
      // `currentFileId` intentionally NOT persisted — every cold boot
      // should land on the WelcomeScreen instead of jumping back into
      // whatever doc was last open. In-session navigation still works
      // because the value lives in memory between renders.
      partialize: (state) => ({
        currentFolderId: state.currentFolderId,
        workspaceMode: state.workspaceMode,
        workspaceRoot: state.workspaceRoot,
        recentWorkspaces: state.recentWorkspaces,
        sortBy: state.sortBy,
        expandedFolderIds: Array.from(state.expandedFolderIds),
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<{
          currentFolderId: string | null;
          workspaceMode: WorkspaceMode;
          workspaceRoot: string | null;
          recentWorkspaces: string[];
          sortBy: SortOption;
          expandedFolderIds: string[];
        }>;
        return {
          ...currentState,
          ...persisted,
          workspaceMode: persisted.workspaceMode === "disk" ? "disk" : "db",
          workspaceRoot: persisted.workspaceRoot ?? null,
          recentWorkspaces: persisted.recentWorkspaces ?? [],
          files: currentState.files, // Always use runtime files, never from localStorage
          expandedFolderIds: new Set(persisted.expandedFolderIds || []),
        };
      },
    }
  )
);
