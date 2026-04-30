/**
 * Files API methods - extends ApiClient prototype
 */

import { ApiClient } from "./client";
import type { SearchResults } from "./types";

declare module "./client" {
  interface ApiClient {
    listFiles(): Promise<
      Array<{
        id: string;
        name: string;
        content: string;
        is_folder: boolean;
        parent_id: string | null;
        position: number;
        is_favorite: boolean;
        icon: string | null;
        cover_image_url: string | null;
        cover_position: number;
        created_at: string;
        updated_at: string;
        word_count: number;
        preview: string;
      }>
    >;
    getFile(id: string): Promise<{
      id: string;
      name: string;
      content: string;
      content_markdown: string | null;
      is_folder: boolean;
      parent_id: string | null;
      position: number;
      is_favorite: boolean;
      icon: string | null;
      cover_image_url: string | null;
      cover_position: number;
      created_at: string;
      updated_at: string;
    }>;
    createFile(
      name: string,
      content?: string,
      parentId?: string | null
    ): Promise<{
      id: string;
      name: string;
      content: string;
      is_folder: boolean;
      parent_id: string | null;
      position: number;
      is_favorite: boolean;
      icon: string | null;
      cover_image_url: string | null;
      cover_position: number;
      created_at: string;
      updated_at: string;
    }>;
    updateFile(
      id: string,
      updates: {
        name?: string;
        content?: string;
        content_markdown?: string;
        is_favorite?: boolean;
        icon?: string;
        cover_image_url?: string;
        cover_position?: number;
      }
    ): Promise<{
      id: string;
      name: string;
      content: string;
      is_folder: boolean;
      parent_id: string | null;
      position: number;
      is_favorite: boolean;
      icon: string | null;
      cover_image_url: string | null;
      cover_position: number;
      created_at: string;
      updated_at: string;
    }>;
    createFolder(
      name: string,
      parentId?: string | null
    ): Promise<{
      id: string;
      name: string;
      content: string;
      is_folder: boolean;
      parent_id: string | null;
      position: number;
      is_favorite: boolean;
      icon: string | null;
      cover_image_url: string | null;
      cover_position: number;
      created_at: string;
      updated_at: string;
    }>;
    moveFile(
      fileId: string,
      targetFolderId: string | null
    ): Promise<{
      id: string;
      name: string;
      content: string;
      is_folder: boolean;
      parent_id: string | null;
      position: number;
      is_favorite: boolean;
      icon: string | null;
      cover_image_url: string | null;
      cover_position: number;
      created_at: string;
      updated_at: string;
    }>;
    deleteFile(id: string): Promise<{ status: string }>;
    listTrash(): Promise<
      Array<{
        id: string;
        name: string;
        is_folder: boolean;
        parent_id: string | null;
        deleted_at: string;
        created_at: string;
        updated_at: string;
      }>
    >;
    restoreFile(id: string): Promise<{ status: string }>;
    permanentDeleteFile(id: string): Promise<{ status: string }>;
    emptyTrash(): Promise<{ status: string; count: number }>;
    uploadImage(file: File): Promise<{ url: string; filename: string; size: number }>;
    deleteImage(imageUrl: string): Promise<void>;
    searchFiles(
      query: string,
      fileIds?: string[],
      topK?: number,
      signal?: AbortSignal
    ): Promise<SearchResults>;
    listVersions(
      fileId: string,
      limit?: number
    ): Promise<
      Array<{
        id: string;
        file_id: string;
        content: string;
        diff?: string;
        edit_type?: string;
        summary?: string;
        created_at: string;
      }>
    >;
    createVersion(
      fileId: string,
      content: string,
      editType?: string,
      summary?: string
    ): Promise<{
      id: string;
      file_id: string;
      content: string;
      diff?: string;
      edit_type?: string;
      summary?: string;
      created_at: string;
    }>;
    restoreVersion(
      fileId: string,
      versionId: string
    ): Promise<{ status: string; version_id: string }>;
    exportFile(fileId: string, format: "markdown" | "pdf" | "docx"): Promise<Blob>;
    importFile(
      file: File,
      parentId?: string | null,
      opts?: ImportOptions
    ): Promise<{
      id: string;
      name: string;
      content: string;
      content_markdown?: string | null;
      is_folder: boolean;
      parent_id: string | null;
      position: number;
      is_favorite: boolean;
      icon: string | null;
      cover_image_url: string | null;
      cover_position: number;
      created_at: string;
      updated_at: string;
    }>;
  }
}

/**
 * Per-import overrides surfaced to the user as menu options.
 * - "auto" — fast path, fall back to Marker only when nothing extracts.
 * - "ocr"  — explicitly use the Marker pipeline for the whole document.
 *   Triggers the model download prompt if the weights aren't local yet.
 */
export type ImportMode = "auto" | "ocr";

export interface ImportOptions {
  mode?: ImportMode;
}

ApiClient.prototype.listFiles = async function (this: ApiClient) {
  return this.request<
    Array<{
      id: string;
      name: string;
      content: string;
      is_folder: boolean;
      parent_id: string | null;
      position: number;
      is_favorite: boolean;
      icon: string | null;
      cover_image_url: string | null;
      cover_position: number;
      created_at: string;
      updated_at: string;
      word_count: number;
      preview: string;
    }>
  >("/api/files", { cache: "no-store" });
};

ApiClient.prototype.getFile = async function (this: ApiClient, id: string) {
  return this.request<{
    id: string;
    name: string;
    content: string;
    content_markdown: string | null;
    is_folder: boolean;
    parent_id: string | null;
    position: number;
    is_favorite: boolean;
    icon: string | null;
    cover_image_url: string | null;
    cover_position: number;
    created_at: string;
    updated_at: string;
  }>(`/api/files/${id}`);
};

ApiClient.prototype.createFile = async function (
  this: ApiClient,
  name: string,
  content: string = "",
  parentId: string | null = null
) {
  return this.request<{
    id: string;
    name: string;
    content: string;
    is_folder: boolean;
    parent_id: string | null;
    position: number;
    is_favorite: boolean;
    icon: string | null;
    cover_image_url: string | null;
    cover_position: number;
    created_at: string;
    updated_at: string;
  }>("/api/files", {
    method: "POST",
    body: JSON.stringify({ name, content, parent_id: parentId }),
  });
};

ApiClient.prototype.updateFile = async function (
  this: ApiClient,
  id: string,
  updates: {
    name?: string;
    content?: string;
    content_markdown?: string;
    is_favorite?: boolean;
    icon?: string;
  }
) {
  return this.request<{
    id: string;
    name: string;
    content: string;
    is_folder: boolean;
    parent_id: string | null;
    position: number;
    is_favorite: boolean;
    icon: string | null;
    cover_image_url: string | null;
    cover_position: number;
    created_at: string;
    updated_at: string;
  }>(`/api/files/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
};

ApiClient.prototype.createFolder = async function (
  this: ApiClient,
  name: string,
  parentId?: string | null
) {
  return this.request<{
    id: string;
    name: string;
    content: string;
    is_folder: boolean;
    parent_id: string | null;
    position: number;
    is_favorite: boolean;
    icon: string | null;
    cover_image_url: string | null;
    cover_position: number;
    created_at: string;
    updated_at: string;
  }>("/api/files/folders", {
    method: "POST",
    body: JSON.stringify({ name, parent_id: parentId ?? null }),
  });
};

ApiClient.prototype.moveFile = async function (
  this: ApiClient,
  fileId: string,
  targetFolderId: string | null
) {
  return this.request<{
    id: string;
    name: string;
    content: string;
    is_folder: boolean;
    parent_id: string | null;
    position: number;
    is_favorite: boolean;
    icon: string | null;
    cover_image_url: string | null;
    cover_position: number;
    created_at: string;
    updated_at: string;
  }>(`/api/files/${fileId}/move`, {
    method: "POST",
    body: JSON.stringify({ target_folder_id: targetFolderId }),
  });
};

ApiClient.prototype.deleteFile = async function (this: ApiClient, id: string) {
  return this.request<{ status: string }>(`/api/files/${id}`, {
    method: "DELETE",
  });
};

// Trash API
ApiClient.prototype.listTrash = async function (this: ApiClient) {
  return this.request<
    Array<{
      id: string;
      name: string;
      is_folder: boolean;
      parent_id: string | null;
      deleted_at: string;
      created_at: string;
      updated_at: string;
    }>
  >("/api/files/trash/list");
};

ApiClient.prototype.restoreFile = async function (this: ApiClient, id: string) {
  return this.request<{ status: string }>(`/api/files/${id}/restore`, {
    method: "POST",
  });
};

ApiClient.prototype.permanentDeleteFile = async function (this: ApiClient, id: string) {
  return this.request<{ status: string }>(`/api/files/${id}/permanent`, {
    method: "DELETE",
  });
};

ApiClient.prototype.emptyTrash = async function (this: ApiClient) {
  return this.request<{ status: string; count: number }>("/api/files/trash/empty", {
    method: "DELETE",
  });
};

// Image upload API
ApiClient.prototype.uploadImage = async function (
  this: ApiClient,
  file: File
): Promise<{ url: string; filename: string; size: number }> {
  const formData = new FormData();
  formData.append("file", file);

  // Add timeout controller (30 seconds)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${this.resolveBaseUrl()}/api/images/upload`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Handle specific HTTP status codes
      if (response.status === 413) {
        throw new Error("Image too large (max 10MB)");
      }
      if (response.status === 400) {
        const error = await response.json().catch(() => ({ detail: "Invalid image format" }));
        throw new Error(error.detail || "Invalid image format");
      }
      if (response.status >= 500) {
        throw new Error("Server error - please try again later");
      }

      const error = await response.json().catch(() => ({ detail: "Upload failed" }));
      throw new Error(error.detail || "Failed to upload image");
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle abort/timeout errors
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Upload timed out - check your connection");
    }

    // Handle network errors
    if (error instanceof TypeError) {
      throw new Error("Network error - check your connection");
    }

    // Re-throw other errors
    throw error;
  }
};

ApiClient.prototype.deleteImage = async function (
  this: ApiClient,
  imageUrl: string
): Promise<void> {
  // Match the canonical /api/images/{filename} shape and the legacy
  // /api/images/{user_id}/{filename} shape that older documents still embed.
  // We forward the full path through to the server, which has compat routes
  // for both layouts.
  const match = imageUrl.match(/\/api\/images\/((?:[^/]+\/)?[^/]+)$/);
  if (!match) return;

  const [, path] = match;

  const response = await fetch(`${this.resolveBaseUrl()}/api/images/${path}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Delete failed" }));
    throw new Error(error.detail || "Failed to delete image");
  }
};

ApiClient.prototype.searchFiles = async function (
  this: ApiClient,
  query: string,
  fileIds?: string[],
  topK: number = 5,
  signal?: AbortSignal
) {
  return this.request<SearchResults>("/api/files/search", {
    method: "POST",
    body: JSON.stringify({ query, file_ids: fileIds, top_k: topK }),
    signal,
  });
};

// Versions API
ApiClient.prototype.listVersions = async function (
  this: ApiClient,
  fileId: string,
  limit: number = 50
) {
  return this.request<
    Array<{
      id: string;
      file_id: string;
      content: string;
      diff?: string;
      edit_type?: string;
      summary?: string;
      created_at: string;
    }>
  >(`/api/versions/${fileId}?limit=${limit}`);
};

ApiClient.prototype.createVersion = async function (
  this: ApiClient,
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
  }>("/api/versions/", {
    method: "POST",
    body: JSON.stringify({
      file_id: fileId,
      content,
      edit_type: editType,
      summary,
    }),
  });
};

ApiClient.prototype.restoreVersion = async function (
  this: ApiClient,
  fileId: string,
  versionId: string
) {
  return this.request<{ status: string; version_id: string }>(
    `/api/versions/${fileId}/${versionId}/restore`,
    { method: "POST" }
  );
};

// Export API
/**
 * Export a file in the specified format.
 * @param fileId - The ID of the file to export
 * @param format - The export format: 'markdown', 'pdf', or 'docx'
 * @returns A Blob containing the exported file
 */
ApiClient.prototype.exportFile = async function (
  this: ApiClient,
  fileId: string,
  format: "markdown" | "pdf" | "docx"
): Promise<Blob> {
  const url = `${this.resolveBaseUrl()}/api/export/${fileId}/${format}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Export failed" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.blob();
};

/**
 * Typed error so callers can branch on the backend's error code instead of
 * pattern-matching on the message. The most important code we surface is
 * MARKER_MODELS_REQUIRED — the file-store catches that, queues the file,
 * and shows the one-time download prompt.
 */
export class ImportError extends Error {
  code: string | null;
  status: number;
  details: Record<string, unknown> | null;

  constructor(
    message: string,
    opts: { code?: string | null; status: number; details?: Record<string, unknown> | null }
  ) {
    super(message);
    this.name = "ImportError";
    this.code = opts.code ?? null;
    this.status = opts.status;
    this.details = opts.details ?? null;
  }
}

/**
 * Import a file (PDF / DOCX / PPTX / Markdown) and convert it to a new document.
 * @param file - The file to import
 * @param parentId - Optional folder ID to import into
 * @returns The created file object
 * @throws {ImportError} with `code === "MARKER_MODELS_REQUIRED"` when a
 *   scanned PDF needs the Marker fallback but its weights aren't installed.
 */
ApiClient.prototype.importFile = async function (
  this: ApiClient,
  file: File,
  parentId?: string | null,
  opts?: ImportOptions
) {
  const formData = new FormData();
  formData.append("file", file);
  if (parentId) {
    formData.append("parent_id", parentId);
  }
  // Only send `mode` when the caller explicitly opts in — the backend
  // defaults to "auto" and we want to keep the multipart body small.
  if (opts?.mode && opts.mode !== "auto") {
    formData.append("mode", opts.mode);
  }

  const url = `${this.resolveBaseUrl()}/api/import/`;
  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
    const errBlock = (
      payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
    ).error;
    const message =
      errBlock?.message ||
      (payload as { detail?: string }).detail ||
      `Import failed (HTTP ${response.status})`;
    throw new ImportError(message, {
      code: errBlock?.code ?? null,
      status: response.status,
      details: errBlock?.details ?? null,
    });
  }

  return response.json() as Promise<{
    id: string;
    name: string;
    content: string;
    content_markdown?: string | null;
    is_folder: boolean;
    parent_id: string | null;
    position: number;
    is_favorite: boolean;
    icon: string | null;
    cover_image_url: string | null;
    cover_position: number;
    created_at: string;
    updated_at: string;
  }>;
};
