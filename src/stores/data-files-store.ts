import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { api } from "@/lib/api";

// Threshold for inline base64 vs Files API (500KB)
// Files smaller than this are sent inline, larger files are pre-uploaded
export const INLINE_FILE_THRESHOLD = 500 * 1024;

// Claude upload status for optimized file handling
export type ClaudeUploadStatus =
  | "pending" // Waiting for background upload to start
  | "uploading" // Background upload in progress
  | "ready" // Successfully uploaded to Claude
  | "error" // Upload failed
  | "skipped"; // Small file, will use inline base64

// Data file type for code execution analysis
export interface DataFile {
  id: string;
  originalFilename: string;
  fileType: string; // csv, xlsx, json, txt, png, jpg, etc.
  fileSize: number;
  mimeType?: string;
  status: "uploading" | "ready" | "error";
  previewData?: Record<string, unknown>[];
  columnNames?: string[];
  rowCount?: number;
  errorMessage?: string;
  createdAt: string;
  uploadProgress?: number;
  // Claude Files API status
  claudeUploadStatus?: ClaudeUploadStatus;
  claudeFileId?: string;
  // Source database block ID (for auto-exported data files)
  sourceDatabaseId?: string;
}

interface DataFilesState {
  // Per-conversation data files
  filesByConversation: Record<string, DataFile[]>;
  isLoading: boolean;
  uploadingFiles: Record<string, number>; // file_id -> progress %
  // Track active polling intervals
  pollingIntervals: Record<string, ReturnType<typeof setInterval>>;
  // Track polling attempt counts per conversation
  pollingAttempts: Record<string, number>;

  // Actions
  loadDataFiles: (conversationId: string) => Promise<void>;
  uploadDataFile: (conversationId: string, file: File) => Promise<DataFile | null>;
  uploadDataFiles: (conversationId: string, files: File[]) => Promise<void>;
  deleteDataFile: (conversationId: string, fileId: string) => Promise<boolean>;
  getDataFiles: (conversationId: string) => DataFile[];
  clearDataFiles: (conversationId: string) => void;
  // Poll for Claude upload status updates
  startPollingClaudeStatus: (conversationId: string) => void;
  stopPollingClaudeStatus: (conversationId: string) => void;
  refreshFileStatus: (conversationId: string, fileId: string) => Promise<void>;
}

// Supported data file extensions
export const DATA_FILE_EXTENSIONS = new Set([
  ".csv",
  ".xlsx",
  ".xls",
  ".json",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

// Check if file is a data file (vs KB file)
export function isDataFile(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  return DATA_FILE_EXTENSIONS.has(ext);
}

// KB file extensions for reference
export const KB_FILE_EXTENSIONS = new Set([".pdf", ".docx", ".pptx"]);

export function isKBFile(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  return KB_FILE_EXTENSIONS.has(ext);
}

// Polling interval for Claude status updates (2 seconds)
const CLAUDE_STATUS_POLL_INTERVAL = 2000;
// Max polling attempts before giving up (30 attempts = 60 seconds)
const CLAUDE_STATUS_MAX_POLLS = 30;

export const useDataFilesStore = create<DataFilesState>()(
  immer((set, get) => ({
    filesByConversation: {},
    isLoading: false,
    uploadingFiles: {},
    pollingIntervals: {},
    pollingAttempts: {},

    loadDataFiles: async (conversationId: string) => {
      if (!conversationId) return;

      set({ isLoading: true });

      try {
        const data = await api.listDataFiles(conversationId);

        const files: DataFile[] = data.files.map((f) => ({
          id: f.id,
          originalFilename: f.filename,
          fileType: f.fileType,
          fileSize: f.fileSize,
          mimeType: f.mimeType,
          status: f.status as DataFile["status"],
          previewData: f.previewData,
          columnNames: f.columnNames,
          rowCount: f.rowCount,
          createdAt: new Date().toISOString(), // API doesn't include createdAt in list response
          claudeUploadStatus: f.claudeUploadStatus as ClaudeUploadStatus,
          claudeFileId: f.claudeFileId,
          sourceDatabaseId: f.sourceDatabaseId,
        }));

        set((state) => {
          state.filesByConversation[conversationId] = files;
        });

        // Start polling if any files have pending/uploading Claude status
        const hasPendingUploads = files.some(
          (f) => f.claudeUploadStatus === "pending" || f.claudeUploadStatus === "uploading"
        );
        if (hasPendingUploads) {
          get().startPollingClaudeStatus(conversationId);
        }
      } catch (error) {
        // Conversation might not exist yet, that's OK
        console.error("Failed to load data files", error);
        set((state) => {
          state.filesByConversation[conversationId] = [];
        });
      } finally {
        set({ isLoading: false });
      }
    },

    uploadDataFile: async (conversationId: string, file: File) => {
      if (!conversationId) return null;

      // Create temporary file for optimistic UI
      const tempId = `temp-${Date.now()}`;
      const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
      const tempFile: DataFile = {
        id: tempId,
        originalFilename: file.name,
        fileType: ext,
        fileSize: file.size,
        status: "uploading",
        createdAt: new Date().toISOString(),
        uploadProgress: 0,
      };

      // Add to state optimistically
      set((state) => {
        if (!state.filesByConversation[conversationId]) {
          state.filesByConversation[conversationId] = [];
        }
        state.filesByConversation[conversationId].unshift(tempFile);
        state.uploadingFiles[tempId] = 0;
      });

      try {
        // Update progress to 100% (upload happening)
        set((state) => {
          const files = state.filesByConversation[conversationId];
          const idx = files?.findIndex((f) => f.id === tempId);
          if (idx !== undefined && idx >= 0 && files) {
            files[idx].uploadProgress = 100;
          }
        });

        const data = await api.uploadDataFile(conversationId, file);

        // Replace temp file with real one
        const newFile: DataFile = {
          id: data.id,
          originalFilename: data.filename,
          fileType: data.fileType,
          fileSize: data.fileSize,
          mimeType: data.mimeType,
          status: data.status as DataFile["status"],
          previewData: data.previewData,
          columnNames: data.columnNames,
          rowCount: data.rowCount,
          createdAt: new Date().toISOString(),
          claudeUploadStatus: data.claudeUploadStatus as ClaudeUploadStatus,
          claudeFileId: data.claudeFileId,
        };

        set((state) => {
          const files = state.filesByConversation[conversationId];
          if (files) {
            const idx = files.findIndex((f) => f.id === tempId);
            if (idx >= 0) {
              files[idx] = newFile;
            }
          }
          delete state.uploadingFiles[tempId];
        });

        // Start polling if file needs Claude upload (status is pending/uploading)
        if (
          newFile.claudeUploadStatus === "pending" ||
          newFile.claudeUploadStatus === "uploading"
        ) {
          get().startPollingClaudeStatus(conversationId);
        }

        return newFile;
      } catch (error) {
        console.error("Failed to upload data file", error);

        // Update temp file to error state
        set((state) => {
          const files = state.filesByConversation[conversationId];
          if (files) {
            const idx = files.findIndex((f) => f.id === tempId);
            if (idx >= 0) {
              files[idx].status = "error";
              files[idx].errorMessage = error instanceof Error ? error.message : "Upload failed";
            }
          }
          delete state.uploadingFiles[tempId];
        });

        return null;
      }
    },

    uploadDataFiles: async (conversationId: string, files: File[]) => {
      if (!conversationId || files.length === 0) return;

      // Upload files sequentially to maintain order
      for (const file of files) {
        await get().uploadDataFile(conversationId, file);
      }
    },

    deleteDataFile: async (conversationId: string, fileId: string) => {
      if (!conversationId || !fileId) return false;

      // Optimistic delete
      const prevFiles = get().filesByConversation[conversationId] || [];

      set((state) => {
        const files = state.filesByConversation[conversationId];
        if (files) {
          const idx = files.findIndex((f) => f.id === fileId);
          if (idx >= 0) {
            files.splice(idx, 1);
          }
        }
      });

      try {
        await api.deleteDataFile(conversationId, fileId);

        // Note: deleting a data file does NOT delete the source database block.
        // The database block remains in the document; a fresh CSV will be
        // re-exported automatically on the next chat message.

        return true;
      } catch (error) {
        console.error("Failed to delete data file", error);

        // Revert on error
        set((state) => {
          state.filesByConversation[conversationId] = prevFiles;
        });

        return false;
      }
    },

    getDataFiles: (conversationId: string) => {
      return get().filesByConversation[conversationId] || [];
    },

    clearDataFiles: (conversationId: string) => {
      // Stop polling when clearing
      get().stopPollingClaudeStatus(conversationId);
      set((state) => {
        delete state.filesByConversation[conversationId];
      });
    },

    // Refresh a single file's status from the server
    refreshFileStatus: async (conversationId: string, fileId: string) => {
      try {
        const data = await api.getDataFile(conversationId, fileId);
        set((state) => {
          const files = state.filesByConversation[conversationId];
          if (files) {
            const idx = files.findIndex((f) => f.id === fileId);
            if (idx >= 0) {
              files[idx].claudeUploadStatus = data.claudeUploadStatus as ClaudeUploadStatus;
              files[idx].claudeFileId = data.claudeFileId;
            }
          }
        });
      } catch (error) {
        // File might have been deleted, ignore
        console.debug("Failed to refresh file status", error);
      }
    },

    // Start polling for files with pending/uploading Claude status
    startPollingClaudeStatus: (conversationId: string) => {
      // Don't start if already polling
      if (get().pollingIntervals[conversationId]) {
        return;
      }

      // Reset attempt counter
      set((state) => {
        state.pollingAttempts[conversationId] = 0;
      });

      const checkAndPoll = async () => {
        const currentAttempts = get().pollingAttempts[conversationId] || 0;

        // Check if max attempts reached
        if (currentAttempts >= CLAUDE_STATUS_MAX_POLLS) {
          console.warn(
            `Max polling attempts (${CLAUDE_STATUS_MAX_POLLS}) reached for conversation ${conversationId}`
          );
          // Mark remaining pending files as error
          set((state) => {
            const files = state.filesByConversation[conversationId];
            if (files) {
              files.forEach((f) => {
                if (f.claudeUploadStatus === "pending" || f.claudeUploadStatus === "uploading") {
                  f.claudeUploadStatus = "error";
                }
              });
            }
          });
          get().stopPollingClaudeStatus(conversationId);
          return;
        }

        // Increment attempt counter
        set((state) => {
          state.pollingAttempts[conversationId] = currentAttempts + 1;
        });

        const files = get().filesByConversation[conversationId] || [];
        const pendingFiles = files.filter(
          (f) => f.claudeUploadStatus === "pending" || f.claudeUploadStatus === "uploading"
        );

        if (pendingFiles.length === 0) {
          // No more pending files, stop polling
          get().stopPollingClaudeStatus(conversationId);
          return;
        }

        // Refresh status for all pending files
        await Promise.all(pendingFiles.map((f) => get().refreshFileStatus(conversationId, f.id)));
      };

      // Run immediately, then set interval
      checkAndPoll();
      const interval = setInterval(checkAndPoll, CLAUDE_STATUS_POLL_INTERVAL);

      set((state) => {
        state.pollingIntervals[conversationId] = interval;
      });
    },

    // Stop polling for a conversation
    stopPollingClaudeStatus: (conversationId: string) => {
      const interval = get().pollingIntervals[conversationId];
      if (interval) {
        clearInterval(interval);
        set((state) => {
          delete state.pollingIntervals[conversationId];
          delete state.pollingAttempts[conversationId];
        });
      }
    },
  }))
);

// Helper to format file size
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Helper to get file type display name
export function getDataFileTypeDisplay(fileType: string): string {
  switch (fileType.toLowerCase()) {
    case "csv":
      return "CSV";
    case "xlsx":
    case "xls":
      return "Excel";
    case "json":
      return "JSON";
    case "txt":
      return "Text";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return "Image";
    default:
      return fileType.toUpperCase();
  }
}

// Helper to get file icon
export function getDataFileIcon(fileType: string): string {
  switch (fileType.toLowerCase()) {
    case "csv":
      return "📊";
    case "xlsx":
    case "xls":
      return "📈";
    case "json":
      return "📋";
    case "txt":
      return "📄";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return "🖼️";
    default:
      return "📎";
  }
}
