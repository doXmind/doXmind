import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { api } from "@/lib/api";
import { kbLogger } from "@/lib/logger";

const log = kbLogger;

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
  pollingIntervals: Record<string, NodeJS.Timeout>; // conversationId -> interval
  pollingInFlight: Record<string, boolean>; // prevent overlapping requests

  // Actions
  loadAttachments: (conversationId: string) => Promise<void>;
  uploadAttachment: (conversationId: string, file: File) => Promise<KBAttachment | null>;
  uploadAttachments: (conversationId: string, files: File[]) => Promise<void>;
  deleteAttachment: (conversationId: string, attachmentId: string) => Promise<boolean>;
  getAttachments: (conversationId: string) => KBAttachment[];
  clearAttachments: (conversationId: string) => void;
  startPolling: (conversationId: string) => void;
  stopPolling: (conversationId: string) => void;
}

const POLLING_INTERVAL_MS = 5000; // Poll every 5 seconds while processing

export const useKBStore = create<KBState>()(
  immer((set, get) => ({
    attachmentsByConversation: {},
    isLoading: false,
    uploadingFiles: {},
    pollingIntervals: {},
    pollingInFlight: {},

    loadAttachments: async (conversationId: string) => {
      if (!conversationId) return;

      set({ isLoading: true });

      try {
        const data = await api.listKBAttachments(conversationId);

        const attachments = data.attachments.map(
          (att) => ({
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

        set((state) => {
          state.attachmentsByConversation[conversationId] = attachments;
        });

        // Check if any attachments are still processing and start/stop polling
        const hasProcessing = attachments.some(
          (att) => att.status === "processing" || att.status === "uploading"
        );
        if (hasProcessing) {
          get().startPolling(conversationId);
        } else {
          get().stopPolling(conversationId);
        }
      } catch (error) {
        // Conversation might not exist yet, that's OK - return empty list
        log.error("Failed to load KB attachments", error);
        set((state) => {
          state.attachmentsByConversation[conversationId] = [];
        });
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
        // Update to processing state
        set((state) => {
          const attachments = state.attachmentsByConversation[conversationId];
          const idx = attachments?.findIndex((a) => a.id === tempId);
          if (idx !== undefined && idx >= 0 && attachments) {
            attachments[idx].status = "processing";
            attachments[idx].uploadProgress = 100;
          }
        });

        const data = await api.uploadKBAttachment(conversationId, file);

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
        log.error("Failed to upload KB attachment", error);

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

    uploadAttachments: async (conversationId: string, files: File[]) => {
      if (!conversationId || files.length === 0) return;

      // Create all temp attachments at once for immediate UI feedback
      const tempAttachments = files.map((file, index) => {
        const tempId = `temp-${Date.now()}-${index}`;
        return {
          tempId,
          filename: file.name,
          attachment: {
            id: tempId,
            originalFilename: file.name,
            fileType: file.name.split(".").pop()?.toLowerCase() as "pdf" | "docx" | "pptx",
            fileSize: file.size,
            status: "uploading" as const,
            chunkCount: 0,
            createdAt: new Date().toISOString(),
            uploadProgress: 0,
          } as KBAttachment,
        };
      });

      // Add all temp attachments to UI at once
      set((state) => {
        if (!state.attachmentsByConversation[conversationId]) {
          state.attachmentsByConversation[conversationId] = [];
        }
        for (const { tempId, attachment } of tempAttachments) {
          state.attachmentsByConversation[conversationId].unshift(attachment);
          state.uploadingFiles[tempId] = 0;
        }
      });

      // Update all to processing state
      set((state) => {
        const attachments = state.attachmentsByConversation[conversationId];
        if (attachments) {
          for (const { tempId } of tempAttachments) {
            const idx = attachments.findIndex((a) => a.id === tempId);
            if (idx >= 0) {
              attachments[idx].status = "processing";
              attachments[idx].uploadProgress = 100;
            }
          }
        }
      });

      try {
        // Use batch API - backend handles parallel processing
        const response = await api.uploadKBAttachmentsBatch(conversationId, files);

        // Update each attachment with results from server
        set((state) => {
          const attachments = state.attachmentsByConversation[conversationId];
          if (!attachments) return;

          for (let i = 0; i < response.results.length; i++) {
            const result = response.results[i];
            const tempId = tempAttachments[i]?.tempId;
            if (!tempId) continue;

            const idx = attachments.findIndex((a) => a.id === tempId);
            if (idx >= 0) {
              if (result.id) {
                // Success - replace with real data
                attachments[idx] = {
                  id: result.id,
                  originalFilename: result.original_filename,
                  fileType: result.file_type as "pdf" | "docx" | "pptx",
                  fileSize: result.file_size,
                  status: result.status as KBAttachment["status"],
                  chunkCount: result.chunk_count,
                  errorMessage: result.error_message,
                  createdAt: result.created_at,
                };
              } else {
                // Error
                attachments[idx].status = "error";
                attachments[idx].errorMessage = result.error_message || "Upload failed";
              }
            }
            delete state.uploadingFiles[tempId];
          }
        });

        log.info(`Batch upload completed: ${response.successful} successful, ${response.failed} failed`);

        // Refresh from server to ensure consistency (handles race condition with concurrent loadAttachments)
        await get().loadAttachments(conversationId);
      } catch (error) {
        log.error("Batch upload failed", error);

        // Mark all as error
        set((state) => {
          const attachments = state.attachmentsByConversation[conversationId];
          if (attachments) {
            for (const { tempId } of tempAttachments) {
              const idx = attachments.findIndex((a) => a.id === tempId);
              if (idx >= 0) {
                attachments[idx].status = "error";
                attachments[idx].errorMessage =
                  error instanceof Error ? error.message : "Upload failed";
              }
              delete state.uploadingFiles[tempId];
            }
          }
        });
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
        await api.deleteKBAttachment(conversationId, attachmentId);
        return true;
      } catch (error) {
        log.error("Failed to delete KB attachment", error);

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
      get().stopPolling(conversationId);
      set((state) => {
        delete state.attachmentsByConversation[conversationId];
      });
    },

    startPolling: (conversationId: string) => {
      const { pollingIntervals } = get();

      // Already polling this conversation
      if (pollingIntervals[conversationId]) return;

      log.info(`Starting status polling for conversation ${conversationId}`);

      const intervalId = setInterval(async () => {
        // Skip if previous request still in flight (prevent overlapping)
        if (get().pollingInFlight[conversationId]) {
          return;
        }

        set((state) => {
          state.pollingInFlight[conversationId] = true;
        });

        try {
          const data = await api.listKBAttachments(conversationId);

          const attachments = data.attachments.map(
            (att) => ({
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

          set((state) => {
            state.attachmentsByConversation[conversationId] = attachments;
          });

          // Stop polling if no more processing attachments
          const hasProcessing = attachments.some(
            (att) => att.status === "processing" || att.status === "uploading"
          );
          if (!hasProcessing) {
            log.info(`All attachments processed for conversation ${conversationId}, stopping polling`);
            get().stopPolling(conversationId);
          }
        } catch (error) {
          log.error("Polling failed", error);
        } finally {
          set((state) => {
            state.pollingInFlight[conversationId] = false;
          });
        }
      }, POLLING_INTERVAL_MS);

      set((state) => {
        state.pollingIntervals[conversationId] = intervalId;
      });
    },

    stopPolling: (conversationId: string) => {
      const { pollingIntervals } = get();
      const intervalId = pollingIntervals[conversationId];

      if (intervalId) {
        clearInterval(intervalId);
        set((state) => {
          delete state.pollingIntervals[conversationId];
          delete state.pollingInFlight[conversationId];
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
