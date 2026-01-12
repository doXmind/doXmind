import { create } from "zustand";
import type { DiffHunk, DiffSession } from "@/types/diff";

interface Selection {
  from: number;
  to: number;
  text: string;
}

// Single context item for "Ask in Chat" feature
export type SelectionContext = {
  id: string;
  type: 'selection';
  text: string;
  from: number;
  to: number;
};

export type ImageContext = {
  id: string;
  type: 'image';
  src: string;
  alt?: string;
};

export type ChatContextItem = SelectionContext | ImageContext;

// Input type for adding context (without id)
export type ChatContextInput =
  | Omit<SelectionContext, 'id'>
  | Omit<ImageContext, 'id'>;

// Pending edit operation that should be applied through the editor (for undo support)
export interface PendingEdit {
  id: string;
  type: "str_replace" | "insert" | "replace_all";
  fileId: string;
  // For str_replace
  oldStr?: string;
  newStr?: string;
  // For insert
  insertLine?: number;
  // For replace_all
  newContent?: string;
}

// Image modal callback for slash commands
export type ImageModalCallback = (url: string, alt?: string) => void;

interface EditorState {
  isDirty: boolean;
  selection: Selection | null;
  isSaving: boolean;
  lastSavedAt: string | null;

  // Quick Edit State
  quickEditOpen: boolean;
  quickEditPosition: { x: number; y: number } | null;

  // Autocomplete State
  autocompleteEnabled: boolean;
  autocompleteSuggestion: string | null;
  autocompleteTriggerMode: "auto" | "manual";

  // Chat Context State (for "Ask in Chat" feature - shown as Context Pills)
  chatContexts: ChatContextItem[];  // Support multiple contexts

  // Pending edits from AI/Agent that need to be applied through editor
  pendingEdits: PendingEdit[];

  // Image modal state (for slash commands)
  imageModalOpen: boolean;
  imageModalCallback: ImageModalCallback | null;

  // Actions
  setDirty: (dirty: boolean) => void;
  setSelection: (selection: Selection | null) => void;
  setSaving: (saving: boolean) => void;
  setLastSavedAt: (date: string | null) => void;

  // Quick Edit Actions
  openQuickEdit: (position: { x: number; y: number }) => void;
  closeQuickEdit: () => void;

  // Autocomplete Actions
  setAutocompleteEnabled: (enabled: boolean) => void;
  setAutocompleteSuggestion: (suggestion: string | null) => void;
  setAutocompleteTriggerMode: (mode: "auto" | "manual") => void;

  // Chat Context Actions
  addChatContext: (context: ChatContextInput) => void;  // Add a new context
  removeChatContext: (id: string) => void;  // Remove a specific context
  clearAllChatContexts: () => void;  // Clear all contexts

  // Pending Edit Actions (for undo-able AI edits)
  queueEdit: (edit: PendingEdit) => void;
  clearPendingEdit: (id: string) => void;
  clearAllPendingEdits: () => void;

  // Image Modal Actions (for slash commands)
  openImageModal: (callback: ImageModalCallback) => void;
  closeImageModal: () => void;

  // Diff Review State
  diffSession: DiffSession | null;
  isReviewMode: boolean;

  // Diff Review Actions
  startDiffReview: (fileId: string, hunks: DiffHunk[], originalContent: string) => void;
  endDiffReview: () => void;
  acceptHunk: (hunkId: string) => void;
  rejectHunk: (hunkId: string) => void;
  acceptAllHunks: () => void;
  rejectAllHunks: () => void;
  addHunksToDiffSession: (hunks: DiffHunk[]) => void;

  // Text Review Panel State
  isReviewPanelOpen: boolean;
  setReviewPanelOpen: (open: boolean) => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  isDirty: false,
  selection: null,
  isSaving: false,
  lastSavedAt: null,
  quickEditOpen: false,
  quickEditPosition: null,
  autocompleteEnabled: true,
  autocompleteSuggestion: null,
  autocompleteTriggerMode: "auto",
  chatContexts: [],
  pendingEdits: [],
  imageModalOpen: false,
  imageModalCallback: null,
  diffSession: null,
  isReviewMode: false,
  isReviewPanelOpen: false,

  setDirty: (dirty) => set({ isDirty: dirty }),
  setSelection: (selection) => set({ selection }),
  setSaving: (saving) => set({ isSaving: saving }),
  setLastSavedAt: (date) => set({ lastSavedAt: date }),

  openQuickEdit: (position) =>
    set({ quickEditOpen: true, quickEditPosition: position }),
  closeQuickEdit: () =>
    set({ quickEditOpen: false, quickEditPosition: null }),

  setAutocompleteEnabled: (enabled) => set({ autocompleteEnabled: enabled }),
  setAutocompleteSuggestion: (suggestion) =>
    set({ autocompleteSuggestion: suggestion }),
  setAutocompleteTriggerMode: (mode) => set({ autocompleteTriggerMode: mode }),

  addChatContext: (context) => set((state) => ({
    chatContexts: [...state.chatContexts, { ...context, id: crypto.randomUUID() } as ChatContextItem]
  })),
  removeChatContext: (id) => set((state) => ({
    chatContexts: state.chatContexts.filter((c) => c.id !== id)
  })),
  clearAllChatContexts: () => set({ chatContexts: [] }),

  queueEdit: (edit) =>
    set((state) => ({ pendingEdits: [...state.pendingEdits, edit] })),
  clearPendingEdit: (id) =>
    set((state) => ({
      pendingEdits: state.pendingEdits.filter((e) => e.id !== id),
    })),
  clearAllPendingEdits: () => set({ pendingEdits: [] }),

  openImageModal: (callback) => set({ imageModalOpen: true, imageModalCallback: callback }),
  closeImageModal: () => set({ imageModalOpen: false, imageModalCallback: null }),

  // Diff Review Actions
  startDiffReview: (fileId, hunks, originalContent) =>
    set({
      diffSession: {
        id: crypto.randomUUID(),
        fileId,
        hunks,
        isActive: true,
        originalContent,
        createdAt: new Date().toISOString(),
      },
      isReviewMode: true,
    }),

  endDiffReview: () =>
    set({
      diffSession: null,
      isReviewMode: false,
    }),

  acceptHunk: (hunkId) =>
    set((state) => {
      if (!state.diffSession) return state;
      return {
        diffSession: {
          ...state.diffSession,
          hunks: state.diffSession.hunks.map((h) =>
            h.id === hunkId ? { ...h, status: "accepted" as const } : h
          ),
        },
      };
    }),

  rejectHunk: (hunkId) =>
    set((state) => {
      if (!state.diffSession) return state;
      return {
        diffSession: {
          ...state.diffSession,
          hunks: state.diffSession.hunks.map((h) =>
            h.id === hunkId ? { ...h, status: "rejected" as const } : h
          ),
        },
      };
    }),

  acceptAllHunks: () =>
    set((state) => {
      if (!state.diffSession) return state;
      return {
        diffSession: {
          ...state.diffSession,
          hunks: state.diffSession.hunks.map((h) => ({
            ...h,
            status: "accepted" as const,
          })),
        },
      };
    }),

  rejectAllHunks: () =>
    set((state) => {
      if (!state.diffSession) return state;
      return {
        diffSession: {
          ...state.diffSession,
          hunks: state.diffSession.hunks.map((h) => ({
            ...h,
            status: "rejected" as const,
          })),
        },
      };
    }),

  addHunksToDiffSession: (hunks) =>
    set((state) => {
      if (!state.diffSession) return state;
      return {
        diffSession: {
          ...state.diffSession,
          hunks: [...state.diffSession.hunks, ...hunks],
        },
      };
    }),

  // Text Review Panel Actions
  setReviewPanelOpen: (open) => set({ isReviewPanelOpen: open }),
}));
