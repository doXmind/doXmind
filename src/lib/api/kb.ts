/**
 * Knowledge Base API methods - extends ApiClient prototype
 */

import { ApiClient } from "./client";

declare module "./client" {
  interface ApiClient {
    uploadKBAttachment(
      conversationId: string,
      file: File
    ): Promise<{
      id: string;
      original_filename: string;
      file_type: string;
      file_size: number;
      status: string;
      chunk_count: number;
      error_message?: string;
      created_at: string;
    }>;
    uploadKBAttachmentsBatch(
      conversationId: string,
      files: File[]
    ): Promise<{
      results: Array<{
        id: string;
        original_filename: string;
        file_type: string;
        file_size: number;
        status: string;
        chunk_count: number;
        error_message?: string;
        created_at: string;
      }>;
      successful: number;
      failed: number;
    }>;
    listKBAttachments(conversationId: string): Promise<{
      attachments: Array<{
        id: string;
        original_filename: string;
        file_type: string;
        file_size: number;
        status: string;
        chunk_count: number;
        error_message?: string;
        created_at: string;
      }>;
      total_size: number;
      count: number;
    }>;
    deleteKBAttachment(
      conversationId: string,
      attachmentId: string
    ): Promise<{ status: string; id: string }>;
    searchKB(
      conversationId: string,
      query: string,
      topK?: number
    ): Promise<{
      results: Array<{
        content: string;
        source_file: string;
        score: number;
      }>;
    }>;
    getKBAttachmentContent(
      conversationId: string,
      attachmentId: string
    ): Promise<{
      id: string;
      filename: string;
      content: string;
      chunk_count: number;
    }>;
  }
}

/**
 * Upload a file to a conversation's knowledge base.
 */
ApiClient.prototype.uploadKBAttachment = async function (
  this: ApiClient,
  conversationId: string,
  file: File
) {
  const formData = new FormData();
  formData.append("file", file);

  const url = `${this.baseUrl}/api/kb/${conversationId}/attachments`;
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
    original_filename: string;
    file_type: string;
    file_size: number;
    status: string;
    chunk_count: number;
    error_message?: string;
    created_at: string;
  }>;
};

/**
 * Upload multiple files to a conversation's knowledge base in batch.
 * Backend processes files in parallel.
 */
ApiClient.prototype.uploadKBAttachmentsBatch = async function (
  this: ApiClient,
  conversationId: string,
  files: File[]
) {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  const url = `${this.baseUrl}/api/kb/${conversationId}/attachments/batch`;
  const response = await fetch(url, {
    method: "POST",
    body: formData,
    headers: this.getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Batch upload failed" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json() as Promise<{
    results: Array<{
      id: string;
      original_filename: string;
      file_type: string;
      file_size: number;
      status: string;
      chunk_count: number;
      error_message?: string;
      created_at: string;
    }>;
    successful: number;
    failed: number;
  }>;
};

/**
 * List all attachments in a conversation's knowledge base.
 */
ApiClient.prototype.listKBAttachments = async function (this: ApiClient, conversationId: string) {
  return this.request<{
    attachments: Array<{
      id: string;
      original_filename: string;
      file_type: string;
      file_size: number;
      status: string;
      chunk_count: number;
      error_message?: string;
      created_at: string;
    }>;
    total_size: number;
    count: number;
  }>(`/api/kb/${conversationId}/attachments`);
};

/**
 * Delete an attachment from a conversation's knowledge base.
 */
ApiClient.prototype.deleteKBAttachment = async function (
  this: ApiClient,
  conversationId: string,
  attachmentId: string
) {
  return this.request<{ status: string; id: string }>(
    `/api/kb/${conversationId}/attachments/${attachmentId}`,
    { method: "DELETE" }
  );
};

/**
 * Search within a conversation's knowledge base.
 */
ApiClient.prototype.searchKB = async function (
  this: ApiClient,
  conversationId: string,
  query: string,
  topK: number = 5
) {
  return this.request<{
    results: Array<{
      content: string;
      source_file: string;
      score: number;
    }>;
  }>(`/api/kb/${conversationId}/search`, {
    method: "POST",
    body: JSON.stringify({ query, top_k: topK }),
  });
};

/**
 * Get the extracted content of an attachment.
 */
ApiClient.prototype.getKBAttachmentContent = async function (
  this: ApiClient,
  conversationId: string,
  attachmentId: string
) {
  return this.request<{
    id: string;
    filename: string;
    content: string;
    chunk_count: number;
  }>(`/api/kb/${conversationId}/attachments/${attachmentId}/content`);
};
