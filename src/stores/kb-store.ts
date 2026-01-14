import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

// KB attachment type
export interface KBAttachment {
  id: string;
  originalFilename: string;
  fileType: "pdf" | "docx" | "pptx";
  fileSize: number;
  status: "uploading" | "processing" | "indexed" | "error";
  chunkCount: number;
  errorMessage?: string;
  createdAt: string;
  uploadProgress?: number; // 0-100 for upload progress
}

interface KBState {
  // Per-conversation attachments
  attachmentsByConversation: Record<string, KBAttachment[]>;
  isLoading: boolean;
  uploadingFiles: Record<string, number>; // attachment_id -> progress %

  // Actions
  loadAttachments: (conversationId: string) => Promise<void>;
  uploadAttachment: (conversationId: string, file: File) => Promise<KBAttachment | null>;
  deleteAttachment: (conversationId: string, attachmentId: string) => Promise<boolean>;
  getAttachments: (conversationId: string) => KBAttachment[];
  clearAttachments: (conversationId: string) => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const useKBStore = create<KBState>()(
  immer((set, get) => ({
    attachmentsByConversation: {},
    isLoading: false,
    uploadingFiles: {},

    loadAttachments: async (conversationId: string) => {
      if (!conversationId) return;

      set({ isLoading: true });

      try {
        const response = await fetch(
          `${API_BASE}/api/kb/${conversationId}/attachments`
        );

        if (!response.ok) {
          // Conversation might not exist yet, that's OK
          if (response.status === 404) {
            set((state) => {
              state.attachmentsByConversation[conversationId] = [];
            });
            return;
          }
          throw new Error("Failed to load attachments");
        }

        const data = await response.json();

        set((state) => {
          state.attachmentsByConversation[conversationId] = data.attachments.map(
            (att: {
              id: string;
              original_filename: string;
              file_type: string;
              file_size: number;
              status: string;
              chunk_count: number;
              error_message?: string;
              created_at: string;
            }) => ({
              id: att.id,
              originalFilename: att.original_filename,
              fileType: att.file_type as "pdf" | "docx" | "pptx",
              fileSize: att.file_size,
              status: att.status as KBAttachment["status"],
              chunkCount: att.chunk_count,
              errorMessage: att.error_message,
              createdAt: att.created_at,
            })
          );
        });
      } catch (error) {
        console.error("Failed to load KB attachments:", error);
      } finally {
        set({ isLoading: false });
      }
    },

    uploadAttachment: async (conversationId: string, file: File) => {
      if (!conversationId) return null;

      // Create temporary attachment for optimistic UI
      const tempId = `temp-${Date.now()}`;
      const tempAttachment: KBAttachment = {
        id: tempId,
        originalFilename: file.name,
        fileType: file.name.split(".").pop()?.toLowerCase() as "pdf" | "docx" | "pptx",
        fileSize: file.size,
        status: "uploading",
        chunkCount: 0,
        createdAt: new Date().toISOString(),
        uploadProgress: 0,
      };

      // Add to state optimistically
      set((state) => {
        if (!state.attachmentsByConversation[conversationId]) {
          state.attachmentsByConversation[conversationId] = [];
        }
        state.attachmentsByConversation[conversationId].unshift(tempAttachment);
        state.uploadingFiles[tempId] = 0;
      });

      try {
        const formData = new FormData();
        formData.append("file", file);

        // Update to processing state
        set((state) => {
          const attachments = state.attachmentsByConversation[conversationId];
          const idx = attachments?.findIndex((a) => a.id === tempId);
          if (idx !== undefined && idx >= 0 && attachments) {
            attachments[idx].status = "processing";
            attachments[idx].uploadProgress = 100;
          }
        });

        const response = await fetch(
          `${API_BASE}/api/kb/${conversationId}/attachments`,
          {
            method: "POST",
            body: formData,
          }
        );

        if (!response.ok) {
          const error = await response.json().catch(() => ({ detail: "Upload failed" }));
          throw new Error(error.detail || "Upload failed");
        }

        const data = await response.json();

        // Replace temp attachment with real one
        const newAttachment: KBAttachment = {
          id: data.id,
          originalFilename: data.original_filename,
          fileType: data.file_type as "pdf" | "docx" | "pptx",
          fileSize: data.file_size,
          status: data.status as KBAttachment["status"],
          chunkCount: data.chunk_count,
          errorMessage: data.error_message,
          createdAt: data.created_at,
        };

        set((state) => {
          const attachments = state.attachmentsByConversation[conversationId];
          if (attachments) {
            const idx = attachments.findIndex((a) => a.id === tempId);
            if (idx >= 0) {
              attachments[idx] = newAttachment;
            }
          }
          delete state.uploadingFiles[tempId];
        });

        return newAttachment;
      } catch (error) {
        console.error("Failed to upload KB attachment:", error);

        // Update temp attachment to error state
        set((state) => {
          const attachments = state.attachmentsByConversation[conversationId];
          if (attachments) {
            const idx = attachments.findIndex((a) => a.id === tempId);
            if (idx >= 0) {
              attachments[idx].status = "error";
              attachments[idx].errorMessage =
                error instanceof Error ? error.message : "Upload failed";
            }
          }
          delete state.uploadingFiles[tempId];
        });

        return null;
      }
    },

    deleteAttachment: async (conversationId: string, attachmentId: string) => {
      if (!conversationId || !attachmentId) return false;

      // Optimistic delete
      const prevAttachments = get().attachmentsByConversation[conversationId] || [];

      set((state) => {
        const attachments = state.attachmentsByConversation[conversationId];
        if (attachments) {
          const idx = attachments.findIndex((a) => a.id === attachmentId);
          if (idx >= 0) {
            attachments.splice(idx, 1);
          }
        }
      });

      try {
        const response = await fetch(
          `${API_BASE}/api/kb/${conversationId}/attachments/${attachmentId}`,
          { method: "DELETE" }
        );

        if (!response.ok) {
          throw new Error("Failed to delete attachment");
        }

        return true;
      } catch (error) {
        console.error("Failed to delete KB attachment:", error);

        // Revert on error
        set((state) => {
          state.attachmentsByConversation[conversationId] = prevAttachments;
        });

        return false;
      }
    },

    getAttachments: (conversationId: string) => {
      return get().attachmentsByConversation[conversationId] || [];
    },

    clearAttachments: (conversationId: string) => {
      set((state) => {
        delete state.attachmentsByConversation[conversationId];
      });
    },
  }))
);

// Helper to format file size
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Helper to get file type icon
export function getFileTypeIcon(fileType: string): string {
  switch (fileType.toLowerCase()) {
    case "pdf":
      return "📄";
    case "docx":
      return "📝";
    case "pptx":
      return "📊";
    default:
      return "📎";
  }
}
