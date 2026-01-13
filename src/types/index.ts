// File types
export interface FileItem {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// Chat types
export interface ToolCall {
  name: string;
  toolId?: string;
  input: string;
  output: string | null;
  success: boolean | null;
}

// Context item attached to a user message (from "Ask in Chat" feature)
export type MessageContextItem =
  | {
      type: "selection";
      text: string;
    }
  | {
      type: "image";
      src: string;
      alt?: string;
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  fileIds?: string[];
  createdAt: string;
  isStreaming?: boolean;
  // User message specific fields
  contexts?: MessageContextItem[] | null;
  // AI response specific fields
  thinking?: string | null;
  toolCalls?: ToolCall[] | null;
  edits?: Record<string, unknown>[] | null;
  model?: string | null;
}

export interface Conversation {
  id: string;
  fileId: string | null;
  messages: ChatMessage[];
  createdAt: string;
  isLoaded?: boolean;
}

// Version types
export interface FileVersion {
  id: string;
  fileId: string;
  content: string;
  diff?: string;
  editType?: string;
  summary?: string;
  createdAt: string;
}

// Editor types
export interface Selection {
  from: number;
  to: number;
  text: string;
}

// API types
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

// Quick Edit types
export type QuickEditAction =
  | "fix-grammar"
  | "improve"
  | "simplify"
  | "expand"
  | "shorten"
  | "professional"
  | "casual"
  | "translate-en"
  | "translate-zh";

export interface QuickEditOption {
  id: QuickEditAction;
  label: string;
  icon: React.ReactNode;
}

// Search types
export interface SearchResult {
  id: string;
  content: string;
  metadata: {
    file_id: string;
    chunk_index: number;
    [key: string]: unknown;
  };
  distance?: number;
}
