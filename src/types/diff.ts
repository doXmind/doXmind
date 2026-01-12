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

  /** Original content that will be removed (empty for insert type) */
  oldContent: string;

  /** New content that will be added (empty for delete type) */
  newContent: string;

  /** Current status of this hunk */
  status: DiffHunkStatus;

  /** Timestamp when this hunk was created */
  createdAt: string;

  /** ID of the original edit operation this hunk belongs to */
  editId: string;
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
}

/**
 * Edit operation from AI agent (matches use-chat.ts EditOperation)
 */
export interface EditOperation {
  type: "str_replace" | "insert" | "replace_all";
  file_id: string;
  file_name: string;
  success: boolean;
  error?: string;
  // For str_replace
  old_str?: string;
  new_str?: string;
  // For insert
  insert_line?: number;
  // For replace_all
  new_content?: string;
}
