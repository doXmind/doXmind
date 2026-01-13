/**
 * API client for communicating with the backend
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Search result types
export interface SearchResultItem {
  id: string;
  content: string;
  metadata: {
    file_id: string;
    chunk_index: number;
    name?: string;
  };
  distance?: number;
}

export interface SearchResults {
  results: SearchResultItem[];
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Files API
  async listFiles() {
    return this.request<Array<{
      id: string;
      name: string;
      content: string;
      created_at: string;
      updated_at: string;
    }>>("/api/files");
  }

  async getFile(id: string) {
    return this.request<{
      id: string;
      name: string;
      content: string;
      created_at: string;
      updated_at: string;
    }>(`/api/files/${id}`);
  }

  async createFile(name: string, content: string = "") {
    return this.request<{
      id: string;
      name: string;
      content: string;
      created_at: string;
      updated_at: string;
    }>("/api/files", {
      method: "POST",
      body: JSON.stringify({ name, content }),
    });
  }

  async updateFile(id: string, updates: { name?: string; content?: string }) {
    return this.request<{
      id: string;
      name: string;
      content: string;
      created_at: string;
      updated_at: string;
    }>(`/api/files/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  }

  async deleteFile(id: string) {
    return this.request<{ status: string }>(`/api/files/${id}`, {
      method: "DELETE",
    });
  }

  async searchFiles(query: string, fileIds?: string[], topK: number = 5) {
    return this.request<SearchResults>("/api/files/search", {
      method: "POST",
      body: JSON.stringify({ query, file_ids: fileIds, top_k: topK }),
    });
  }

  /**
   * Search within a single document at sentence level.
   * Returns sentence-level chunks for precise in-document highlighting.
   * @param query - Search query
   * @param fileId - File to search within
   * @param topK - Maximum number of results (default 10)
   * @param minScore - Minimum similarity score 0-1 (default 0.4 for OpenAI embeddings)
   */
  async searchInDocument(query: string, fileId: string, topK: number = 10, minScore: number = 0.4) {
    return this.request<SearchResults>("/api/files/search/in-document", {
      method: "POST",
      body: JSON.stringify({ query, file_id: fileId, top_k: topK, min_score: minScore }),
    });
  }

  // Versions API
  async listVersions(fileId: string, limit: number = 50) {
    return this.request<Array<{
      id: string;
      file_id: string;
      content: string;
      diff?: string;
      edit_type?: string;
      summary?: string;
      created_at: string;
    }>>(`/api/versions/${fileId}?limit=${limit}`);
  }

  async createVersion(
    fileId: string,
    content: string,
    editType: string = "manual",
    summary?: string
  ) {
    return this.request<{
      id: string;
      file_id: string;
      content: string;
      diff?: string;
      edit_type?: string;
      summary?: string;
      created_at: string;
    }>("/api/versions", {
      method: "POST",
      body: JSON.stringify({
        file_id: fileId,
        content,
        edit_type: editType,
        summary,
      }),
    });
  }

  async restoreVersion(fileId: string, versionId: string) {
    return this.request<{ status: string; version_id: string }>(
      `/api/versions/${fileId}/${versionId}/restore`,
      { method: "POST" }
    );
  }

  // Chat API (non-streaming)
  async simpleChat(message: string, system?: string) {
    return this.request<{ response: string }>("/api/chat/simple", {
      method: "POST",
      body: JSON.stringify({ message, system }),
    });
  }

  // Health check
  async healthCheck() {
    return this.request<{ status: string }>("/health");
  }

  // Export API
  /**
   * Export a file in the specified format.
   * @param fileId - The ID of the file to export
   * @param format - The export format: 'markdown', 'pdf', or 'docx'
   * @returns A Blob containing the exported file
   */
  async exportFile(fileId: string, format: 'markdown' | 'pdf' | 'docx'): Promise<Blob> {
    const url = `${this.baseUrl}/api/export/${fileId}/${format}`;
    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Export failed" }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.blob();
  }
}

// Default client instance
export const api = new ApiClient();
