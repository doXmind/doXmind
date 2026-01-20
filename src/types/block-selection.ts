/**
 * Block Selection Types
 *
 * Types for the mobile block-based selection system.
 * Users select blocks by long-press (not traditional text selection).
 */

/**
 * Represents a selectable block in the TipTap document
 */
export interface SelectableBlock {
  /** Unique identifier based on ProseMirror position */
  id: string;
  /** ProseMirror node type (paragraph, heading, bulletList, etc.) */
  type: string;
  /** Start position in the document */
  from: number;
  /** End position in the document */
  to: number;
  /** Text content of the block */
  text: string;
  /** Heading level if applicable (1-3) */
  level?: number;
  /** Depth in document tree (for nested lists) */
  depth: number;
}

/**
 * Block types that can be selected
 */
export const SELECTABLE_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
] as const;

export type SelectableBlockType = (typeof SELECTABLE_BLOCK_TYPES)[number];

/**
 * Voice recording state for the mobile voice input
 */
export interface VoiceRecordingState {
  /** Whether currently recording */
  isRecording: boolean;
  /** Recording duration in milliseconds */
  duration: number;
  /** Recorded audio blob (null until recording stops) */
  audioBlob: Blob | null;
  /** Transcription result from STT (null until transcribed) */
  transcription: string | null;
  /** Current audio level (0-1) for waveform visualization */
  audioLevel: number;
  /** Error message if recording failed */
  error: string | null;
}

/**
 * AI edit preview state
 */
export interface AIEditPreview {
  /** Unique identifier for this edit */
  id: string;
  /** Original blocks that were selected */
  originalBlocks: SelectableBlock[];
  /** Original combined text content */
  originalText: string;
  /** Proposed new content (plain text) */
  proposedContent: string;
  /** Proposed new content (HTML for rendering) */
  proposedHtml: string;
  /** Voice instruction that triggered this edit (if any) */
  voiceInstruction?: string;
  /** AI action type (improve, shorten, expand, etc.) */
  actionType?: string;
  /** Edit status */
  status: "pending" | "streaming" | "ready" | "accepted" | "rejected";
  /** Creation timestamp */
  createdAt: string;
}

/**
 * Block selection store state
 */
export interface BlockSelectionState {
  /** Currently selected blocks (ordered by position) */
  selectedBlocks: SelectableBlock[];
  /** Whether selection mode is active (at least one block selected) */
  isSelectionActive: boolean;
  /** Voice recording state */
  voiceRecording: VoiceRecordingState;
  /** AI edit preview (shown after AI generates edit) */
  editPreview: AIEditPreview | null;
  /** Whether AI is processing an edit request */
  isProcessingAI: boolean;
}

/**
 * Block selection store actions
 */
export interface BlockSelectionActions {
  /** Toggle selection for a block (add if not selected, remove if selected) */
  toggleBlockSelection: (block: SelectableBlock) => void;
  /** Add a block to selection */
  selectBlock: (block: SelectableBlock) => void;
  /** Remove a block from selection */
  deselectBlock: (blockId: string) => void;
  /** Clear all selected blocks */
  clearSelection: () => void;
  /** Get combined text of all selected blocks */
  getSelectedText: () => string;

  /** Start voice recording */
  startRecording: () => void;
  /** Stop voice recording */
  stopRecording: (blob: Blob) => void;
  /** Cancel voice recording */
  cancelRecording: () => void;
  /** Set audio level for waveform */
  setAudioLevel: (level: number) => void;
  /** Set transcription result */
  setTranscription: (text: string) => void;
  /** Set recording error */
  setRecordingError: (error: string | null) => void;
  /** Reset voice recording state */
  resetVoiceRecording: () => void;

  /** Set AI edit preview */
  setEditPreview: (preview: AIEditPreview | null) => void;
  /** Update edit preview status */
  updateEditPreviewStatus: (status: AIEditPreview["status"]) => void;
  /** Accept the edit preview (apply to document) */
  acceptEditPreview: () => void;
  /** Reject the edit preview */
  rejectEditPreview: () => void;
  /** Set AI processing state */
  setProcessingAI: (processing: boolean) => void;
}

/**
 * Block long-press event detail
 */
export interface BlockLongPressEventDetail {
  block: SelectableBlock;
  event: MouseEvent | TouchEvent;
}

/**
 * Custom event types for block selection
 */
declare global {
  interface WindowEventMap {
    "block-long-press": CustomEvent<BlockLongPressEventDetail>;
  }
}
