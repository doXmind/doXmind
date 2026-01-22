/**
 * Diff Review Types
 *
 * Types for the Cursor-style inline diff review feature.
 * When AI edits a document, changes are shown as diff hunks
 * that users can accept or reject individually.
 */

export type DiffHunkStatus = "pending" | "accepted" | "rejected";
export type DiffChangeType = "replace" | "insert" | "delete";

/**
 * A single diff hunk representing a change in the document.
 * Each hunk can be independently accepted or rejected.
 */
export interface DiffHunk {
  /** Unique identifier for this hunk */
  id: string;

  /** Type of change: replace existing content, insert new, or delete existing */
  type: DiffChangeType;

  /** ProseMirror document position where the change starts */
  from: number;

  /** ProseMirror document position where the change ends (for insert, from === to) */
  to: number;

  /** Original content that will be removed (empty for insert type) - in markdown format for display */
  oldContent: string;

  /** Plain text version of oldContent for searching in doc.textContent */
  searchText: string;

  /** New content that will be added (empty for delete type) */
  newContent: string;

  /** Current status of this hunk */
  status: DiffHunkStatus;

  /** Timestamp when this hunk was created */
  createdAt: string;

  /** Timestamp when this hunk was first displayed to user (for decision time tracking) */
  displayedAt?: number;

  /** ID of the original edit operation this hunk belongs to */
  editId: string;

  /** Resolved ProseMirror position (computed by decorations, used by accept) */
  resolvedFrom?: number;

  /** Resolved ProseMirror position end (computed by decorations, used by accept) */
  resolvedTo?: number;

  /** Whether this hunk represents a full document replacement (from replace_all operation) */
  isFullDocumentReplace?: boolean;
}

/**
 * A diff review session containing all hunks for a file.
 * Created when AI makes edits, ended when all hunks are processed.
 */
export interface DiffSession {
  /** Unique identifier for this session */
  id: string;

  /** ID of the file being reviewed */
  fileId: string;

  /** All hunks in this session */
  hunks: DiffHunk[];

  /** Whether this session is currently active */
  isActive: boolean;

  /** Original document content before any changes (for rollback) */
  originalContent: string;

  /** Timestamp when this session was created */
  createdAt: string;

  /** Timestamp when review session started (for session duration tracking) */
  startedAt?: number;
}

// Re-export EditOperation from centralized types for backward compatibility
export type { EditOperation } from "./index";
