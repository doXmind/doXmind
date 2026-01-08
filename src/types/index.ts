// File types
export interface FileItem {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// Chat types
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  fileIds?: string[];
  createdAt: string;
  isStreaming?: boolean;
}

export interface Conversation {
  id: string;
  fileId: string | null;
  messages: ChatMessage[];
  createdAt: string;
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
