/**
 * Diff Review Extension - Type Definitions
 */

import { PluginKey } from "@tiptap/pm/state";
import type { DiffHunk } from "@/types/diff";

// Plugin state interface
export interface DiffReviewPluginState {
  hunks: DiffHunk[];
  isActive: boolean;
  focusedHunkId: string | null;
}

// Plugin key for accessing state
export const DiffReviewPluginKey = new PluginKey<DiffReviewPluginState>("diffReview");

// Position mapping result
export interface TextPosition {
  from: number;
  to: number;
  blockStart: number;
  blockTypeName?: string; // e.g., "heading", "paragraph", "listItem"
}

// Declare custom commands for TypeScript
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    diffReview: {
      /**
       * Set the diff hunks to display
       */
      setDiffHunks: (hunks: DiffHunk[]) => ReturnType;
      /**
       * Clear all diff review decorations
       */
      clearDiffReview: () => ReturnType;
      /**
       * Accept a specific diff hunk (applies the change)
       */
      acceptDiffHunk: (hunkId: string) => ReturnType;
      /**
       * Reject a specific diff hunk (removes the decoration)
       */
      rejectDiffHunk: (hunkId: string) => ReturnType;
      /**
       * Set the currently focused hunk for navigation highlight
       */
      setFocusedHunk: (hunkId: string | null) => ReturnType;
    };
  }
}
