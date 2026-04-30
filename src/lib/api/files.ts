/**
 * Local sidecar API helpers that do not own document storage.
 *
 * File/folder CRUD is handled by Tauri workspace commands. The HTTP sidecar is
 * still useful for heavyweight local conversion and image blob serving.
 */

import { ApiClient } from "./client";

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

declare module "./client" {
  interface ApiClient {
    uploadImage(file: File): Promise<{ url: string; filename: string; size: number }>;
    deleteImage(imageUrl: string): Promise<void>;
    convertFile(
      file: File,
      opts?: ImportOptions
    ): Promise<{
      name: string;
      content: string;
      content_markdown: string;
    }>;
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

ApiClient.prototype.convertFile = async function (
  this: ApiClient,
  file: File,
  opts?: ImportOptions
) {
  const formData = new FormData();
  formData.append("file", file);
  if (opts?.mode && opts.mode !== "auto") {
    formData.append("mode", opts.mode);
  }

  const response = await fetch(`${this.resolveBaseUrl()}/api/import/convert`, {
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
      `Conversion failed (HTTP ${response.status})`;
    throw new ImportError(message, {
      code: errBlock?.code ?? null,
      status: response.status,
      details: errBlock?.details ?? null,
    });
  }

  return response.json() as Promise<{
    name: string;
    content: string;
    content_markdown: string;
  }>;
};
