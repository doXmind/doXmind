/**
 * Local sidecar API helpers that do not own document storage.
 *
 * File/folder CRUD is handled by Tauri workspace commands. The HTTP sidecar
 * is still useful for image blob serving — DOCX / PPTX / PDF conversion was
 * removed when the workspace folder became the source of truth.
 */

import { ApiClient } from "./client";

declare module "./client" {
  interface ApiClient {
    uploadImage(file: File): Promise<{ url: string; filename: string; size: number }>;
    deleteImage(imageUrl: string): Promise<void>;
  }
}

ApiClient.prototype.uploadImage = async function (
  this: ApiClient,
  file: File
): Promise<{ url: string; filename: string; size: number }> {
  const formData = new FormData();
  formData.append("file", file);

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
      if (response.status === 413) throw new Error("Image too large (max 10MB)");
      const error = await response.json().catch(() => ({ detail: "Upload failed" }));
      throw new Error(error.detail || "Failed to upload image");
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Upload timed out");
    }
    throw error;
  }
};

ApiClient.prototype.deleteImage = async function (
  this: ApiClient,
  imageUrl: string
): Promise<void> {
  const match = imageUrl.match(/\/api\/images\/([^/]+)$/);
  if (!match) return;

  const [, filename] = match;
  const response = await fetch(`${this.resolveBaseUrl()}/api/images/${filename}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Delete failed" }));
    throw new Error(error.detail || "Failed to delete image");
  }
};
