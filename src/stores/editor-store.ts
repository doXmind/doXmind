import { create } from "zustand";
import type { AutocompleteMode } from "@/types";

interface Selection {
  from: number;
  to: number;
  text: string;
}

// Pending edit operation that should be applied through the editor (for undo support)
export interface PendingEdit {
  id: string;
  type: "str_replace" | "replace_all";
  fileId: string;
  // For str_replace
  oldStr?: string;
  newStr?: string;
  // For replace_all
  newContent?: string;
}

// Image modal callback for slash commands
export type ImageModalCallback = (url: string, alt?: string) => void;

// Last AI operation for undo tracking
export interface LastAIOperation {
  type: "diff_accept" | "autocomplete" | "quick_edit";
  timestamp: number;
  content?: string; // For RLHF context
}

interface EditorState {
  // Core editor state
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
  autocompleteMode: AutocompleteMode;

  // Spellcheck State
  spellcheckEnabled: boolean;

  // Pending edits from AI/Agent that need to be applied through editor
  pendingEdits: PendingEdit[];

  // Image modal state (for slash commands)
  imageModalOpen: boolean;
  imageModalCallback: ImageModalCallback | null;

  // Text Review Panel State
  isReviewPanelOpen: boolean;

  // Last AI Operation (for undo tracking)
  lastAIOperation: LastAIOperation | null;

  // Review signaling (header → editor communication)
  reviewRequested: boolean;
  isReviewLoading: boolean;
  isReviewActive: boolean;

  // Core editor actions
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
  setAutocompleteMode: (mode: AutocompleteMode) => void;

  // Spellcheck Actions
  setSpellcheckEnabled: (enabled: boolean) => void;

  // Pending Edit Actions (for undo-able AI edits)
  queueEdit: (edit: PendingEdit) => void;
  clearPendingEdit: (id: string) => void;
  clearAllPendingEdits: () => void;

  // Image Modal Actions (for slash commands)
  openImageModal: (callback: ImageModalCallback) => void;
  closeImageModal: () => void;

  // Text Review Panel Actions
  setReviewPanelOpen: (open: boolean) => void;

  // Last AI Operation Actions (for undo tracking)
  setLastAIOperation: (operation: LastAIOperation | null) => void;
  clearLastAIOperation: () => void;

  // Review signaling actions
  requestReview: () => void;
  clearReviewRequest: () => void;
  setReviewState: (loading: boolean, active: boolean) => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  // Initial state
  isDirty: false,
  selection: null,
  isSaving: false,
  lastSavedAt: null,
  quickEditOpen: false,
  quickEditPosition: null,
  autocompleteEnabled: true,
  autocompleteSuggestion: null,
  autocompleteTriggerMode: "auto",
  autocompleteMode: "adaptive",
  spellcheckEnabled: false,
  pendingEdits: [],
  imageModalOpen: false,
  imageModalCallback: null,
  isReviewPanelOpen: false,
  lastAIOperation: null,
  reviewRequested: false,
  isReviewLoading: false,
  isReviewActive: false,

  // Core editor actions
  setDirty: (dirty) => set({ isDirty: dirty }),
  setSelection: (selection) => set({ selection }),
  setSaving: (saving) => set({ isSaving: saving }),
  setLastSavedAt: (date) => set({ lastSavedAt: date }),

  // Quick Edit Actions
  openQuickEdit: (position) => set({ quickEditOpen: true, quickEditPosition: position }),
  closeQuickEdit: () => set({ quickEditOpen: false, quickEditPosition: null }),

  // Autocomplete Actions
  setAutocompleteEnabled: (enabled) => set({ autocompleteEnabled: enabled }),
  setAutocompleteSuggestion: (suggestion) => set({ autocompleteSuggestion: suggestion }),
  setAutocompleteTriggerMode: (mode) => set({ autocompleteTriggerMode: mode }),
  setAutocompleteMode: (mode) => set({ autocompleteMode: mode }),

  // Spellcheck Actions
  setSpellcheckEnabled: (enabled) => set({ spellcheckEnabled: enabled }),

  // Pending Edit Actions
  queueEdit: (edit) => set((state) => ({ pendingEdits: [...state.pendingEdits, edit] })),
  clearPendingEdit: (id) =>
    set((state) => ({
      pendingEdits: state.pendingEdits.filter((e) => e.id !== id),
    })),
  clearAllPendingEdits: () => set({ pendingEdits: [] }),

  // Image Modal Actions
  openImageModal: (callback) => set({ imageModalOpen: true, imageModalCallback: callback }),
  closeImageModal: () => set({ imageModalOpen: false, imageModalCallback: null }),

  // Text Review Panel Actions
  setReviewPanelOpen: (open) => set({ isReviewPanelOpen: open }),

  // Last AI Operation Actions
  setLastAIOperation: (operation) => set({ lastAIOperation: operation }),
  clearLastAIOperation: () => set({ lastAIOperation: null }),

  // Review signaling actions
  requestReview: () => set({ reviewRequested: true }),
  clearReviewRequest: () => set({ reviewRequested: false }),
  setReviewState: (loading, active) => set({ isReviewLoading: loading, isReviewActive: active }),
}));
