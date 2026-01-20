/**
 * Block Selection Store
 *
 * Zustand store for managing mobile block-based selection,
 * voice recording, and AI edit preview state.
 */

import { create } from "zustand";
import type {
  SelectableBlock,
  BlockSelectionState,
  BlockSelectionActions,
  VoiceRecordingState,
  AIEditPreview,
} from "@/types/block-selection";

const initialVoiceRecordingState: VoiceRecordingState = {
  isRecording: false,
  duration: 0,
  audioBlob: null,
  transcription: null,
  audioLevel: 0,
  error: null,
};

type BlockSelectionStore = BlockSelectionState & BlockSelectionActions;

export const useBlockSelectionStore = create<BlockSelectionStore>((set, get) => ({
  // State
  selectedBlocks: [],
  isSelectionActive: false,
  voiceRecording: initialVoiceRecordingState,
  editPreview: null,
  isProcessingAI: false,

  // Block Selection Actions
  toggleBlockSelection: (block: SelectableBlock) => {
    const { selectedBlocks } = get();

    // Check if this block (or overlapping block) is already selected
    // Use position range overlap to handle cases where same content might have different IDs
    const existingIndex = selectedBlocks.findIndex(
      (b) => b.id === block.id || (b.from === block.from && b.to === block.to)
    );

    if (existingIndex >= 0) {
      // Remove from selection
      const newBlocks = selectedBlocks.filter((_, idx) => idx !== existingIndex);
      set({
        selectedBlocks: newBlocks,
        isSelectionActive: newBlocks.length > 0,
      });
    } else {
      // Check if this block overlaps with any existing selected block
      // (e.g., selecting a list item when the whole list is already selected)
      const overlapping = selectedBlocks.some(
        (b) =>
          (block.from >= b.from && block.from < b.to) || (b.from >= block.from && b.from < block.to)
      );

      if (overlapping) {
        // Don't add overlapping blocks, treat as toggle of the overlapping block
        const newBlocks = selectedBlocks.filter(
          (b) =>
            !(
              (block.from >= b.from && block.from < b.to) ||
              (b.from >= block.from && b.from < block.to)
            )
        );
        set({
          selectedBlocks: newBlocks,
          isSelectionActive: newBlocks.length > 0,
        });
      } else {
        // Add to selection and sort by position
        const newBlocks = [...selectedBlocks, block].sort((a, b) => a.from - b.from);
        set({
          selectedBlocks: newBlocks,
          isSelectionActive: true,
        });
      }
    }
  },

  selectBlock: (block: SelectableBlock) => {
    const { selectedBlocks } = get();
    if (selectedBlocks.some((b) => b.id === block.id)) {
      return; // Already selected
    }
    const newBlocks = [...selectedBlocks, block].sort((a, b) => a.from - b.from);
    set({
      selectedBlocks: newBlocks,
      isSelectionActive: true,
    });
  },

  deselectBlock: (blockId: string) => {
    const { selectedBlocks } = get();
    const newBlocks = selectedBlocks.filter((b) => b.id !== blockId);
    set({
      selectedBlocks: newBlocks,
      isSelectionActive: newBlocks.length > 0,
    });
  },

  clearSelection: () => {
    set({
      selectedBlocks: [],
      isSelectionActive: false,
    });
  },

  getSelectedText: () => {
    const { selectedBlocks } = get();
    return selectedBlocks.map((b) => b.text).join("\n\n");
  },

  // Voice Recording Actions
  startRecording: () => {
    set({
      voiceRecording: {
        ...initialVoiceRecordingState,
        isRecording: true,
      },
    });
  },

  stopRecording: (blob: Blob) => {
    set((state) => ({
      voiceRecording: {
        ...state.voiceRecording,
        isRecording: false,
        audioBlob: blob,
      },
    }));
  },

  cancelRecording: () => {
    set({
      voiceRecording: initialVoiceRecordingState,
    });
  },

  setAudioLevel: (level: number) => {
    set((state) => ({
      voiceRecording: {
        ...state.voiceRecording,
        audioLevel: level,
      },
    }));
  },

  setTranscription: (text: string) => {
    set((state) => ({
      voiceRecording: {
        ...state.voiceRecording,
        transcription: text,
      },
    }));
  },

  setRecordingError: (error: string | null) => {
    set((state) => ({
      voiceRecording: {
        ...state.voiceRecording,
        error,
        isRecording: false,
      },
    }));
  },

  resetVoiceRecording: () => {
    set({
      voiceRecording: initialVoiceRecordingState,
    });
  },

  // AI Edit Preview Actions
  setEditPreview: (preview: AIEditPreview | null) => {
    set({ editPreview: preview });
  },

  updateEditPreviewStatus: (status: AIEditPreview["status"]) => {
    set((state) => ({
      editPreview: state.editPreview ? { ...state.editPreview, status } : null,
    }));
  },

  acceptEditPreview: () => {
    const { editPreview } = get();
    if (editPreview) {
      set({
        editPreview: { ...editPreview, status: "accepted" },
      });
    }
  },

  rejectEditPreview: () => {
    set({
      editPreview: null,
      selectedBlocks: [],
      isSelectionActive: false,
    });
  },

  setProcessingAI: (processing: boolean) => {
    set({ isProcessingAI: processing });
  },
}));
