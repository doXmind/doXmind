// =============================================================================
// File Types
// =============================================================================

export interface FileItem {
  id: string;
  name: string;
  content: string;
  contentMarkdown?: string | null; // Cached markdown for local preview/search
  isFolder: boolean;
  parentId: string | null;
  position: number;
  isFavorite: boolean;
  icon: string | null;
  coverImageUrl: string | null;
  coverPosition: number;
  createdAt: string;
  updatedAt: string;
  // Lightweight preview fields from list endpoint (avoids loading full content)
  wordCount: number;
  preview: string;
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
