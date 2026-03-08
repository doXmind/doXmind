/**
 * Document Sharing API methods - extends ApiClient prototype
 */

import { ApiClient } from "./client";
import type { Share, ShareListResponse, CreateShareRequest, SharedItemResponse } from "./types";

declare module "./client" {
  interface ApiClient {
    createShare(request: CreateShareRequest): Promise<Share>;
    listFileShares(fileId: string, includeExpired?: boolean): Promise<ShareListResponse>;
    getMyShares(offset?: number, limit?: number): Promise<ShareListResponse>;
    revokeShare(shareId: string): Promise<{ status: string; share_id: string }>;
    updateShareMetadata(
      shareId: string,
      metadata: { title?: string; description?: string; tags?: string[]; allow_fork?: boolean }
    ): Promise<{
      id: string;
      share_token: string;
      title: string;
      description: string | null;
      tags: string[] | null;
      allow_fork: boolean;
      updated_at: string | null;
    }>;
    getSharedDocument(shareToken: string, path?: string): Promise<SharedItemResponse>;
  }
}

/**
 * Create a share link for a document.
 * @param request - Share creation request with file_id, expiration, and content mode
 * @returns The created share with share_url
 */
ApiClient.prototype.createShare = async function (
  this: ApiClient,
  request: CreateShareRequest
): Promise<Share> {
  return this.request<Share>("/api/shares", {
    method: "POST",
    body: JSON.stringify(request),
  });
};

/**
 * List all shares for a specific file.
 * @param fileId - The file ID to list shares for
 * @param includeExpired - Whether to include expired shares (default: false)
 * @returns List of shares for the file
 */
ApiClient.prototype.listFileShares = async function (
  this: ApiClient,
  fileId: string,
  includeExpired: boolean = false
): Promise<ShareListResponse> {
  return this.request<ShareListResponse>(
    `/api/shares/file/${fileId}?include_expired=${includeExpired}`
  );
};

ApiClient.prototype.getMyShares = async function (
  this: ApiClient,
  offset?: number,
  limit?: number
): Promise<ShareListResponse> {
  const params = new URLSearchParams();
  if (offset !== undefined) params.set("offset", String(offset));
  if (limit !== undefined) params.set("limit", String(limit));
  const qs = params.toString();
  return this.request<ShareListResponse>(`/api/shares/my${qs ? `?${qs}` : ""}`);
};

/**
 * Revoke a share link (deactivate it).
 * @param shareId - The share ID to revoke
 * @returns Status response
 */
ApiClient.prototype.revokeShare = async function (
  this: ApiClient,
  shareId: string
): Promise<{ status: string; share_id: string }> {
  return this.request<{ status: string; share_id: string }>(`/api/shares/${shareId}`, {
    method: "DELETE",
  });
};

ApiClient.prototype.updateShareMetadata = async function (
  this: ApiClient,
  shareId: string,
  metadata: { title?: string; description?: string; tags?: string[]; allow_fork?: boolean }
): Promise<{
  id: string;
  share_token: string;
  title: string;
  description: string | null;
  tags: string[] | null;
  allow_fork: boolean;
  updated_at: string | null;
}> {
  return this.request(`/api/shares/${shareId}/metadata`, {
    method: "PATCH",
    body: JSON.stringify(metadata),
  });
};

/**
 * Get a shared document or folder.
 * Sends auth headers when available (required for private shares).
 * @param shareToken - The share token from the URL
 * @param path - Optional subfolder/file ID within a shared folder
 * @returns The shared item content
 */
ApiClient.prototype.getSharedDocument = async function (
  this: ApiClient,
  shareToken: string,
  path?: string
): Promise<SharedItemResponse> {
  let endpoint = `/api/shares/public/${shareToken}`;
  if (path) {
    endpoint += `?path=${encodeURIComponent(path)}`;
  }

  // Use raw fetch with optional auth headers (supports both public and private)
  const url = `${this.baseUrl}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...this.getAuthHeaders(),
    },
  });

  if (response.status === 401) {
    throw new Error("AUTH_REQUIRED");
  }

  if (response.status === 403) {
    throw new Error("ACCESS_DENIED");
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: "Document not found or expired",
    }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
};
