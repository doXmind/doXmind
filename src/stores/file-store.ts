import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";
import { storeLogger } from "@/lib/logger";
import type { FileItem } from "@/types";

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
  isLoading: boolean;
  isSynced: boolean;
  sortBy: SortOption;
  justCreatedFileId: string | null;
  expandedFolderIds: Set<string>;
  selectedFileIds: Set<string>;
  loadedContentIds: Set<string>;

  // File actions
  loadFiles: () => Promise<void>;
  loadFileContent: (fileId: string) => Promise<void>;
  createFile: (name: string, content?: string, parentId?: string | null) => Promise<string>;
  importFile: (file: File, parentId?: string | null) => Promise<string>;
  updateFile: (id: string, updates: Partial<Pick<FileItem, "name" | "content">>) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  setCurrentFile: (id: string | null) => void;
  renameFile: (id: string, name: string) => Promise<void>;
  getFile: (id: string) => FileItem | undefined;

  // Favorites & Icons
  toggleFavorite: (fileId: string) => Promise<void>;
  setFileIcon: (fileId: string, icon: string | null) => Promise<void>;
  getFavorites: () => FileItem[];
  getRecentFiles: (limit?: number) => FileItem[];

  // Folder actions
  createFolder: (name: string, parentId?: string | null) => Promise<string>;
  moveFileToFolder: (fileId: string, folderId: string | null) => Promise<void>;
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

export const useFileStore = create<FileState>()(
  persist(
    (set, get) => ({
      files: [],
      currentFileId: null,
      currentFolderId: null,
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
          const serverFiles = await api.listFiles();
          const newFileIds = new Set(serverFiles.map((f) => f.id));

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

            const files: FileItem[] = serverFiles.map((f) => ({
              id: f.id,
              name: f.name,
              // Preserve already-loaded content; list endpoint returns content=""
              content: prevContentMap.get(f.id) ?? f.content,
              isFolder: f.is_folder || false,
              parentId: f.parent_id || null,
              position: f.position || 0,
              isFavorite: f.is_favorite || false,
              icon: f.icon || null,
              createdAt: f.created_at,
              updatedAt: f.updated_at,
              wordCount: f.word_count || 0,
              preview: f.preview || "",
              fork_id: f.fork_id || undefined,
              forked_from_share_id: f.forked_from_share_id || undefined,
              forked_from_title: f.forked_from_title || undefined,
              forked_from_author: f.forked_from_author || undefined,
            }));

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

      loadFileContent: async (fileId: string) => {
        if (get().loadedContentIds.has(fileId)) return;
        // Prevent duplicate concurrent fetches for the same file
        if (pendingContentLoads.has(fileId)) return;
        pendingContentLoads.add(fileId);
        try {
          const fullFile = await api.getFile(fileId);
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
                      content: fullFile.content,
                      fork_id: fullFile.fork_id || undefined,
                      forked_from_share_id: fullFile.forked_from_share_id || undefined,
                      forked_from_title: fullFile.forked_from_title || undefined,
                      forked_from_author: fullFile.forked_from_author || undefined,
                    }
                  : f
              ),
              loadedContentIds: new Set([...state.loadedContentIds, fileId]),
            };
          });
        } catch (error) {
          log.error("Failed to load file content", error);
        } finally {
          pendingContentLoads.delete(fileId);
        }
      },

      createFile: async (name: string, content: string = "", parentId: string | null = null) => {
        try {
          // Validate parentId exists as a folder; fall back to root if stale
          const validParentId =
            parentId && get().files.some((f) => f.id === parentId && f.isFolder) ? parentId : null;

          // Create on server first
          const serverFile = await api.createFile(name, content, validParentId);
          const newFile: FileItem = {
            id: serverFile.id,
            name: serverFile.name,
            content: serverFile.content,
            isFolder: serverFile.is_folder || false,
            parentId: serverFile.parent_id || null,
            position: serverFile.position || 0,
            isFavorite: serverFile.is_favorite || false,
            icon: serverFile.icon || null,
            createdAt: serverFile.created_at,
            updatedAt: serverFile.updated_at,
            wordCount: 0,
            preview: "",
          };

          set((state) => ({
            files: [newFile, ...state.files],
            currentFileId: newFile.id,
            justCreatedFileId: newFile.id,
            loadedContentIds: new Set([...state.loadedContentIds, newFile.id]),
          }));

          return newFile.id;
        } catch (error) {
          log.error("Failed to create file on server", error);
          throw error;
        }
      },

      importFile: async (file: File, parentId?: string | null) => {
        try {
          // Import file via API (converts PDF/DOCX/MD to markdown)
          const serverFile = await api.importFile(file, parentId);
          const newFile: FileItem = {
            id: serverFile.id,
            name: serverFile.name,
            content: serverFile.content,
            isFolder: serverFile.is_folder || false,
            parentId: serverFile.parent_id || null,
            position: serverFile.position || 0,
            isFavorite: serverFile.is_favorite || false,
            icon: serverFile.icon || null,
            createdAt: serverFile.created_at,
            updatedAt: serverFile.updated_at,
            wordCount: 0,
            preview: "",
          };

          set((state) => ({
            files: [newFile, ...state.files],
            currentFileId: newFile.id,
            loadedContentIds: new Set([...state.loadedContentIds, newFile.id]),
          }));

          return newFile.id;
        } catch (error) {
          log.error("Failed to import file", error);
          throw error;
        }
      },

      updateFile: async (id: string, updates: Partial<Pick<FileItem, "name" | "content">>) => {
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
          // Sync to server
          await api.updateFile(id, updates);
        } catch (error) {
          log.error("Failed to update file on server", error);
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
          // Delete all files from server
          await Promise.all(filesToDelete.map((fileId) => api.deleteFile(fileId)));

          // Delete associated chat conversations for all deleted files
          const { useChatStore } = await import("./chat-store");
          await Promise.all(
            filesToDelete.map((fileId) => useChatStore.getState().deleteConversation(fileId))
          );
        } catch (error) {
          log.error("Failed to delete file(s) on server", error);
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
          await api.updateFile(fileId, { is_favorite: newFavorite });
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
          await api.updateFile(fileId, { icon: icon ?? "" });
        } catch (error) {
          log.error("Failed to set file icon", error);
          // Revert on error
          set((state) => ({
            files: state.files.map((f) => (f.id === fileId ? { ...f, icon: file.icon } : f)),
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
      createFolder: async (name: string, parentId?: string | null) => {
        try {
          const serverFolder = await api.createFolder(name, parentId);
          const newFolder: FileItem = {
            id: serverFolder.id,
            name: serverFolder.name,
            content: serverFolder.content,
            isFolder: serverFolder.is_folder || true,
            parentId: serverFolder.parent_id || null,
            position: serverFolder.position || 0,
            isFavorite: serverFolder.is_favorite || false,
            icon: serverFolder.icon || null,
            createdAt: serverFolder.created_at,
            updatedAt: serverFolder.updated_at,
            wordCount: 0,
            preview: "",
          };

          set((state) => ({
            files: [newFolder, ...state.files],
            justCreatedFileId: newFolder.id,
          }));

          return newFolder.id;
        } catch (error) {
          log.error("Failed to create folder on server", error);
          throw error;
        }
      },

      moveFileToFolder: async (fileId: string, folderId: string | null) => {
        // Optimistic update
        set((state) => ({
          files: state.files.map((file) =>
            file.id === fileId
              ? { ...file, parentId: folderId, updatedAt: new Date().toISOString() }
              : file
          ),
        }));

        try {
          await api.moveFile(fileId, folderId);
        } catch (error) {
          log.error("Failed to move file on server", error);
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
          await Promise.all(fileIds.map((fileId) => api.moveFile(fileId, folderId)));
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
          await Promise.all(fileIds.map((fileId) => api.deleteFile(fileId)));
          // Delete associated chat conversations
          const { useChatStore } = await import("./chat-store");
          await Promise.all(
            fileIds.map((fileId) => useChatStore.getState().deleteConversation(fileId))
          );
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
        } catch (error) {
          log.error("Failed to permanently delete file", error);
          throw error;
        }
      },

      emptyTrash: async () => {
        try {
          await api.emptyTrash();
          set({ trashFiles: [] });
        } catch (error) {
          log.error("Failed to empty trash", error);
          throw error;
        }
      },
    }),
    {
      name: "doxmind-files",
      partialize: (state) => ({
        currentFileId: state.currentFileId,
        currentFolderId: state.currentFolderId,
        sortBy: state.sortBy,
        expandedFolderIds: Array.from(state.expandedFolderIds),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zustand persist merge receives raw deserialized state
      merge: (persistedState: any, currentState: FileState) => ({
        ...currentState,
        ...persistedState,
        files: currentState.files, // Always use runtime files, never from localStorage
        expandedFolderIds: new Set(persistedState.expandedFolderIds || []),
      }),
    }
  )
);
