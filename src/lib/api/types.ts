/**
 * Type definitions for the API client
 */

// Search result types
export interface SearchResultItem {
  id: string;
  content: string;
  metadata: {
    file_id: string;
    chunk_index: number;
    name?: string;
    start?: number;
    end?: number;
  };
  distance?: number;
}

export interface SearchResults {
  results: SearchResultItem[];
}
