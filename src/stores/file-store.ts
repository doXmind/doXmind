import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";
import type { FileItem } from "@/types";

// Re-export for convenience
export type { FileItem } from "@/types";

interface FileState {
  files: FileItem[];
  currentFileId: string | null;
  isLoading: boolean;
  isSynced: boolean;

  // Actions
  loadFiles: () => Promise<void>;
  createFile: (name: string, content?: string) => Promise<string>;
  importFile: (file: File) => Promise<string>;
  updateFile: (id: string, updates: Partial<Pick<FileItem, "name" | "content">>) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  setCurrentFile: (id: string | null) => void;
  renameFile: (id: string, name: string) => Promise<void>;
  getFile: (id: string) => FileItem | undefined;
}

export const useFileStore = create<FileState>()(
  persist(
    (set, get) => ({
      files: [],
      currentFileId: null,
      isLoading: false,
      isSynced: false,

      loadFiles: async () => {
        set({ isLoading: true });
        try {
          const serverFiles = await api.listFiles();
          const files: FileItem[] = serverFiles.map((f) => ({
            id: f.id,
            name: f.name,
            content: f.content,
            createdAt: f.created_at,
            updatedAt: f.updated_at,
          }));

          set({ files, isSynced: true, isLoading: false });
        } catch (error) {
          console.error("Failed to load files from server:", error);
          // Keep local files if server is unavailable
          set({ isSynced: false, isLoading: false });
        }
      },

      createFile: async (name: string, content: string = "") => {
        try {
          // Create on server first
          const serverFile = await api.createFile(name, content);
          const newFile: FileItem = {
            id: serverFile.id,
            name: serverFile.name,
            content: serverFile.content,
            createdAt: serverFile.created_at,
            updatedAt: serverFile.updated_at,
          };

          set((state) => ({
            files: [newFile, ...state.files],
            currentFileId: newFile.id,
          }));

          return newFile.id;
        } catch (error) {
          console.error("Failed to create file on server:", error);
          throw error;
        }
      },

      importFile: async (file: File) => {
        try {
          // Import file via API (converts PDF/DOCX/MD to markdown)
          const serverFile = await api.importFile(file);
          const newFile: FileItem = {
            id: serverFile.id,
            name: serverFile.name,
            content: serverFile.content,
            createdAt: serverFile.created_at,
            updatedAt: serverFile.updated_at,
          };

          set((state) => ({
            files: [newFile, ...state.files],
            currentFileId: newFile.id,
          }));

          return newFile.id;
        } catch (error) {
          console.error("Failed to import file:", error);
          throw error;
        }
      },

      updateFile: async (id: string, updates: Partial<Pick<FileItem, "name" | "content">>) => {
        // Optimistic update
        set((state) => ({
          files: state.files.map((file) =>
            file.id === id
              ? { ...file, ...updates, updatedAt: new Date().toISOString() }
              : file
          ),
        }));

        try {
          // Sync to server
          await api.updateFile(id, updates);
        } catch (error) {
          console.error("Failed to update file on server:", error);
          // Revert optimistic update on error
          get().loadFiles();
        }
      },

      deleteFile: async (id: string) => {
        const state = get();
        const newFiles = state.files.filter((f) => f.id !== id);
        const newCurrentId =
          state.currentFileId === id
            ? newFiles.length > 0
              ? newFiles[0].id
              : null
            : state.currentFileId;

        // Optimistic update
        set({
          files: newFiles,
          currentFileId: newCurrentId,
        });

        try {
          await api.deleteFile(id);
          // Delete associated chat conversation
          const { useChatStore } = await import("./chat-store");
          await useChatStore.getState().deleteConversation(id);
        } catch (error) {
          console.error("Failed to delete file on server:", error);
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
    }),
    {
      name: "doxmind-files",
      partialize: (state) => ({
        files: state.files,
        currentFileId: state.currentFileId,
      }),
    }
  )
);
