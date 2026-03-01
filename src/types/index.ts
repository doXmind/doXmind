// =============================================================================
// File Types
// =============================================================================

export interface FileItem {
  id: string;
  name: string;
  content: string;
  contentMarkdown?: string | null; // Cached markdown for AI consumption
  isFolder: boolean;
  parentId: string | null;
  position: number;
  isFavorite: boolean;
  icon: string | null;
  presentationSimplified?: string | null;
  createdAt: string;
  updatedAt: string;
  // Lightweight preview fields from list endpoint (avoids loading full content)
  wordCount: number;
  preview: string;
  // Fork info (populated when this file was forked from a community item)
  fork_id?: string;
  forked_from_share_id?: string;
  forked_from_title?: string;
  forked_from_author?: string;
}

// =============================================================================
// Autocomplete Types
// =============================================================================

/**
 * Autocomplete mode selection
 * - short: Fast 1-line completions (1-5 words)
 * - long: Multi-line intelligent completions (manual trigger)
 * - adaptive: Auto-switches based on context
 */
export type AutocompleteMode = "short" | "long" | "adaptive";

// =============================================================================
// Edit Operation Types (unified from multiple sources)
// =============================================================================

/**
 * Edit operation from AI agent
 * Used for applying changes to files via str_replace or replace_all
 */
export interface EditOperation {
  /** Type of edit operation */
  type: "str_replace" | "replace_all";
  /** ID of the file being edited */
  file_id: string;
  /** Name of the file being edited */
  file_name: string;
  /** Whether the operation was successful */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
  /** Original string to replace (for str_replace) */
  old_str?: string;
  /** New string (for str_replace: replacement text or inserted text) */
  new_str?: string;
  /** Complete new content (for replace_all) */
  new_content?: string;
  /** Character offset in markdown where old_str was found (from backend) */
  offset?: number;
}

// =============================================================================
// Chat Types
// =============================================================================

export interface ToolCall {
  name: string;
  toolId?: string;
  input: string;
  output: string | null;
  success: boolean | null;
}

/** Context item attached to a user message (from "Ask in Chat" feature) */
export type MessageContextItem =
  | {
      type: "selection";
      text: string;
    }
  | {
      type: "image";
      src: string;
      alt?: string;
      base64?: string; // Base64 encoded image data (without data:... prefix)
      mediaType?: string; // MIME type (image/jpeg, image/png, etc.)
    };

/** Metadata for quick edit operations routed through chat */
export interface QuickEditMetadata {
  action: string;
  originalText: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  fileIds?: string[];
  createdAt: string;
  isStreaming?: boolean;
  // User message specific fields
  contexts?: MessageContextItem[] | null;
  quickEdit?: QuickEditMetadata | null;
  // AI response specific fields
  thinking?: string | null;
  toolCalls?: ToolCall[] | null;
  edits?: EditOperation[] | null;
  model?: string | null;
  /** Files created or modified by the agent during this message */
  affectedFiles?: AffectedFile[] | null;
}

export interface AffectedFile {
  fileId: string;
  fileName: string;
  action: "created" | "edited" | "referenced";
}

export interface Conversation {
  id: string;
  fileId: string | null;
  messages: ChatMessage[];
  createdAt: string;
  isLoaded?: boolean;
}

// =============================================================================
// Version Types
// =============================================================================

export interface FileVersion {
  id: string;
  fileId: string;
  content: string;
  diff?: string;
  editType?: string;
  summary?: string;
  createdAt: string;
}

// =============================================================================
// Editor Types
// =============================================================================

export interface Selection {
  from: number;
  to: number;
  text: string;
}

// =============================================================================
// API Types
// =============================================================================

export interface ApiError {
  detail: string;
  status?: number;
}

export interface StreamEvent {
  type: "text" | "tool_start" | "tool_end" | "error";
  content?: string;
  tool?: string;
  input?: string;
  output?: string;
}

// =============================================================================
// Search Types
// =============================================================================

export interface SearchResult {
  id: string;
  content: string;
  metadata: {
    file_id: string;
    chunk_index: number;
    start?: number; // Position in original document (for highlighting)
    end?: number; // Position in original document (for highlighting)
    [key: string]: unknown;
  };
  distance?: number;
}
