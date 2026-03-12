/**
 * Data Files API and KB Agent API methods - extends ApiClient prototype
 */

import { ApiClient } from "./client";

declare module "./client" {
  interface ApiClient {
    uploadDataFile(
      conversationId: string,
      file: File
    ): Promise<{
      id: string;
      filename: string;
      fileType: string;
      fileSize: number;
      mimeType?: string;
      status: string;
      previewData?: Record<string, unknown>[];
      columnNames?: string[];
      rowCount?: number;
      claudeUploadStatus?: string;
      claudeFileId?: string;
      sourceDatabaseId?: string;
    }>;
    listDataFiles(conversationId: string): Promise<{
      files: Array<{
        id: string;
        filename: string;
        fileType: string;
        fileSize: number;
        mimeType?: string;
        status: string;
        previewData?: Record<string, unknown>[];
        columnNames?: string[];
        rowCount?: number;
        claudeUploadStatus?: string;
        claudeFileId?: string;
        sourceDatabaseId?: string;
      }>;
    }>;
    getDataFile(
      conversationId: string,
      fileId: string
    ): Promise<{
      id: string;
      filename: string;
      fileType: string;
      fileSize: number;
      mimeType?: string;
      status: string;
      previewData?: Record<string, unknown>[];
      columnNames?: string[];
      rowCount?: number;
      claudeUploadStatus?: string;
      claudeFileId?: string;
      sourceDatabaseId?: string;
    }>;
    deleteDataFile(conversationId: string, fileId: string): Promise<{ status: string; id: string }>;
    kbAgentStream(
      question: string,
      conversationId?: string | null,
      signal?: AbortSignal
    ): Promise<Response>;
  }
}

// =========================================================================
// Data Files API (for Code Execution)
// =========================================================================

/**
 * Upload a data file for code execution analysis.
 * Supports CSV, XLSX, JSON, TXT, and image files.
 */
ApiClient.prototype.uploadDataFile = async function (
  this: ApiClient,
  conversationId: string,
  file: File
) {
  const formData = new FormData();
  formData.append("file", file);

  const url = `${this.baseUrl}/api/data-files/${conversationId}/files`;
  const response = await fetch(url, {
    method: "POST",
    body: formData,
    headers: this.getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json() as Promise<{
    id: string;
    filename: string;
    fileType: string;
    fileSize: number;
    mimeType?: string;
    status: string;
    previewData?: Record<string, unknown>[];
    columnNames?: string[];
    rowCount?: number;
    claudeUploadStatus?: string;
    claudeFileId?: string;
  }>;
};

/**
 * List all data files in a conversation.
 */
ApiClient.prototype.listDataFiles = async function (this: ApiClient, conversationId: string) {
  return this.request<{
    files: Array<{
      id: string;
      filename: string;
      fileType: string;
      fileSize: number;
      mimeType?: string;
      status: string;
      previewData?: Record<string, unknown>[];
      columnNames?: string[];
      rowCount?: number;
      claudeUploadStatus?: string;
      claudeFileId?: string;
      sourceDatabaseId?: string;
    }>;
  }>(`/api/data-files/${conversationId}/files`);
};

/**
 * Get a specific data file.
 */
ApiClient.prototype.getDataFile = async function (
  this: ApiClient,
  conversationId: string,
  fileId: string
) {
  return this.request<{
    id: string;
    filename: string;
    fileType: string;
    fileSize: number;
    mimeType?: string;
    status: string;
    previewData?: Record<string, unknown>[];
    columnNames?: string[];
    rowCount?: number;
    claudeUploadStatus?: string;
    claudeFileId?: string;
  }>(`/api/data-files/${conversationId}/files/${fileId}`);
};

/**
 * Delete a data file from a conversation.
 */
ApiClient.prototype.deleteDataFile = async function (
  this: ApiClient,
  conversationId: string,
  fileId: string
) {
  return this.request<{ status: string; id: string }>(
    `/api/data-files/${conversationId}/files/${fileId}`,
    { method: "DELETE" }
  );
};

// ==========================================================================
// KB Agent API
// ==========================================================================

/**
 * Stream a KB agent response. Returns the raw fetch Response for SSE processing.
 */
ApiClient.prototype.kbAgentStream = async function (
  this: ApiClient,
  question: string,
  conversationId?: string | null,
  signal?: AbortSignal
): Promise<Response> {
  const url = `${this.baseUrl}/api/kb-agent/stream`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...this.getAuthHeaders(),
    },
    body: JSON.stringify({ question, conversationId }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "KB Agent request failed" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response;
};
