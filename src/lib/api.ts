/**
 * API client for communicating with the backend
 */

import type { MessageContextItem, ToolCall, EditOperation } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TOKEN_STORAGE_KEY = "doxmind_access_token";
const AUTH_COOKIE_NAME = "doxmind_auth";

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

// Auth types
export interface User {
  id: string;
  email: string;
  username?: string;
  avatar_url?: string;
  bio?: string;
  website?: string;
  social_links?: { github?: string; twitter?: string; linkedin?: string };
  is_verified: boolean;
  oauth_provider?: string;
  created_at?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user?: User;
}

export interface AuthStatus {
  authenticated: boolean;
  auth_type?: string;
  user?: User;
  debug_mode: boolean;
}

export interface MessageResponse {
  success: boolean;
  message: string;
}

// Share types
export interface Share {
  id: string;
  file_id: string;
  file_name?: string | null;
  share_token: string;
  share_url: string;
  expires_at: string | null;
  is_active: boolean;
  is_published: boolean;
  visibility: "public" | "private";
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  content_mode: string;
  view_count: number;
  created_at: string;
}

export interface ShareListResponse {
  shares: Share[];
  count: number;
}

export interface CreateShareRequest {
  file_id: string;
  expires_in_days: number | null;
  content_mode: "live";
  visibility: "public" | "private";
  // Public mode fields
  title?: string;
  description?: string;
  tags?: string[];
  // Private mode fields
  invited_user_ids?: string[];
  invited_emails?: string[];
}

export interface SharedDocumentResponse {
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
  is_snapshot: boolean;
  owner_name?: string;
}

export interface SharedFolderItem {
  id: string;
  name: string;
  is_folder: boolean;
  icon: string | null;
  updated_at: string;
  created_at: string;
}

export interface SharedItemResponse {
  name: string;
  is_folder: boolean;
  created_at: string;
  updated_at: string;
  is_snapshot: boolean;
  visibility?: "public" | "private";
  owner_name?: string;
  owner_avatar_url?: string;
  // Document fields (when is_folder is false)
  content?: string;
  // Folder fields (when is_folder is true)
  items?: SharedFolderItem[];
  breadcrumbs?: SharedFolderItem[];
  root_folder_name?: string;
}

// Community types
export interface CommunityAuthor {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio?: string | null;
}

export interface CommunityItem {
  share_id: string;
  share_token: string;
  title: string;
  description: string | null;
  tags: string[];
  owner: CommunityAuthor;
  is_folder: boolean;
  view_count: number;
  fork_count: number;
  bookmark_count: number;
  comment_count: number;
  published_at: string;
  updated_at: string;
  is_bookmarked: boolean;
  is_forked: boolean;
}

export interface CommunityListResponse {
  items: CommunityItem[];
  total: number;
  has_more: boolean;
}

export interface CommunityDetailResponse extends CommunityItem {
  fork_id: string | null;
}

export interface CommentReactionSummary {
  emoji: string;
  count: number;
  has_reacted: boolean;
}

export interface CommentResponse {
  id: string;
  content: string;
  author: CommunityAuthor;
  parent_id: string | null;
  mentions: string[] | null;
  reactions: CommentReactionSummary[];
  reply_count: number;
  is_deleted: boolean;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommentsListResponse {
  comments: CommentResponse[];
  total: number;
  has_more: boolean;
}

export interface ForkResponse {
  fork_id: string;
  forked_file_id: string;
  forked_file_name: string;
  source_share_id: string;
  created_at: string;
}

export interface ForkInfo {
  id: string;
  source_share_id: string | null;
  source_file_id: string | null;
  forked_file_id: string;
  forked_file_name: string;
  source_title: string | null;
  source_author: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface UserProfileResponse {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  website: string | null;
  social_links: { github?: string; twitter?: string; linkedin?: string } | null;
  created_at: string;
  stats: {
    total_published: number;
    total_views: number;
    total_forks_received: number;
    total_bookmarks_received: number;
  };
}

export interface InviteEntry {
  id: string;
  user_id: string;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface SearchUserResult {
  id: string;
  username: string | null;
  email: string;
  avatar_url: string | null;
}

export interface SharedWithMeItem {
  share_id: string;
  share_token: string;
  title: string;
  share_url: string;
  is_folder: boolean;
  view_count: number;
  owner: CommunityAuthor;
  invited_at: string;
  created_at: string;
  updated_at: string;
}

export class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
    // Load token from storage on initialization
    this.loadToken();
  }

  // ==========================================================================
  // Token Management
  // ==========================================================================

  private loadToken(): void {
    if (typeof window === "undefined") return;

    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) {
      try {
        const { token, expiry } = JSON.parse(stored);
        if (expiry && expiry > Date.now()) {
          this.accessToken = token;
          this.tokenExpiry = expiry;
        } else {
          // Token expired, remove it
          localStorage.removeItem(TOKEN_STORAGE_KEY);
        }
      } catch {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    }
  }

  private saveToken(token: string, expiresIn: number): void {
    this.accessToken = token;
    // Set expiry with 5-minute buffer
    this.tokenExpiry = Date.now() + (expiresIn - 300) * 1000;

    if (typeof window !== "undefined") {
      localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, expiry: this.tokenExpiry }));
      // Also set a cookie for middleware auth check
      const maxAge = expiresIn - 300;
      document.cookie = `${AUTH_COOKIE_NAME}=1; path=/; max-age=${maxAge}; SameSite=Lax`;
    }
  }

  private clearToken(): void {
    this.accessToken = null;
    this.tokenExpiry = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      // Also clear the auth cookie
      document.cookie = `${AUTH_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
    }
  }

  private isTokenValid(): boolean {
    return !!(this.accessToken && this.tokenExpiry && this.tokenExpiry > Date.now());
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  /**
   * Get authorization headers for use in external fetch calls.
   * Useful for streaming endpoints that bypass the ApiClient.
   */
  public getAuthorizationHeaders(): Record<string, string> {
    return this.getAuthHeaders();
  }

  /**
   * Manually set the access token (used for OAuth callback).
   */
  public setAccessToken(token: string, expiresIn: number = 60 * 24 * 7 * 60): void {
    this.saveToken(token, expiresIn);
  }

  // ==========================================================================
  // Core Request Method
  // ==========================================================================

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...this.getAuthHeaders(),
        ...options.headers,
      },
      signal: options.signal,
    });

    // Handle 401 Unauthorized - clear token and redirect to login
    if (response.status === 401) {
      this.clearToken();
      // Dispatch event for auth store to handle
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("auth:unauthorized"));
      }
      throw new Error("Session expired. Please log in again.");
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error(error.detail || error.error?.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // ==========================================================================
  // Auth API
  // ==========================================================================

  /**
   * Get a new access token. Call this on app initialization.
   */
  async getToken(clientId?: string): Promise<TokenResponse> {
    const response = await this.request<TokenResponse>("/api/auth/token", {
      method: "POST",
      body: JSON.stringify({ client_id: clientId }),
    });

    this.saveToken(response.access_token, response.expires_in);
    return response;
  }

  /**
   * Refresh the current token.
   */
  async refreshToken(): Promise<TokenResponse> {
    const response = await this.request<TokenResponse>("/api/auth/refresh", {
      method: "POST",
    });

    this.saveToken(response.access_token, response.expires_in);
    return response;
  }

  /**
   * Check authentication status.
   */
  async getAuthStatus(): Promise<AuthStatus> {
    return this.request<AuthStatus>("/api/auth/status");
  }

  /**
   * Ensure we have a valid token, fetching one if needed.
   */
  async ensureAuthenticated(): Promise<void> {
    if (this.isTokenValid()) return;

    // Get a new token
    await this.getToken();
  }

  // ==========================================================================
  // User Authentication API
  // ==========================================================================

  /**
   * Register a new user. Sends verification code to email.
   */
  async register(email: string, username: string, password: string): Promise<MessageResponse> {
    return this.request<MessageResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, username, password }),
    });
  }

  /**
   * Verify email with code and complete registration.
   */
  async verifyEmail(email: string, code: string): Promise<TokenResponse> {
    const response = await this.request<TokenResponse>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });

    this.saveToken(response.access_token, response.expires_in);
    return response;
  }

  /**
   * Resend verification code.
   */
  async resendCode(email: string): Promise<MessageResponse> {
    return this.request<MessageResponse>("/api/auth/resend-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  /**
   * Login with email and password.
   */
  async login(email: string, password: string): Promise<TokenResponse> {
    const response = await this.request<TokenResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    this.saveToken(response.access_token, response.expires_in);
    return response;
  }

  /**
   * Request password reset email.
   */
  async forgotPassword(email: string): Promise<MessageResponse> {
    return this.request<MessageResponse>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  /**
   * Reset password with token.
   */
  async resetPassword(token: string, newPassword: string): Promise<MessageResponse> {
    return this.request<MessageResponse>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, new_password: newPassword }),
    });
  }

  /**
   * Change password for logged-in user.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<MessageResponse> {
    return this.request<MessageResponse>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  }

  /**
   * Get Google OAuth authorization URL.
   */
  async getGoogleAuthUrl(): Promise<{ authorization_url: string }> {
    return this.request<{ authorization_url: string }>("/api/auth/google");
  }

  /**
   * Get current user profile.
   */
  async getCurrentUser(): Promise<User> {
    return this.request<User>("/api/auth/me");
  }

  /**
   * Update user profile.
   */
  async updateProfile(updates: {
    username?: string;
    avatar_url?: string;
    bio?: string;
    website?: string;
    social_links?: { github?: string; twitter?: string; linkedin?: string };
  }): Promise<User> {
    return this.request<User>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  /**
   * Logout - clear tokens.
   */
  logout(): void {
    this.clearToken();
  }

  /**
   * Delete user account.
   */
  async deleteAccount(): Promise<MessageResponse> {
    const result = await this.request<MessageResponse>("/api/auth/me", {
      method: "DELETE",
    });
    // Clear tokens after successful deletion
    this.clearToken();
    return result;
  }

  /**
   * Check if user is logged in.
   */
  isLoggedIn(): boolean {
    return this.isTokenValid();
  }

  // ==========================================================================
  // Files API
  // ==========================================================================

  async listFiles() {
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
        created_at: string;
        updated_at: string;
        word_count: number;
        preview: string;
        fork_id: string | null;
        forked_from_share_id: string | null;
        forked_from_title: string | null;
        forked_from_author: string | null;
      }>
    >("/api/files/", { cache: "no-store" });
  }

  async getFile(id: string) {
    return this.request<{
      id: string;
      name: string;
      content: string;
      is_folder: boolean;
      parent_id: string | null;
      position: number;
      is_favorite: boolean;
      icon: string | null;
      created_at: string;
      updated_at: string;
      fork_id: string | null;
      forked_from_share_id: string | null;
      forked_from_title: string | null;
      forked_from_author: string | null;
    }>(`/api/files/${id}`);
  }

  async createFile(name: string, content: string = "", parentId: string | null = null) {
    return this.request<{
      id: string;
      name: string;
      content: string;
      is_folder: boolean;
      parent_id: string | null;
      position: number;
      is_favorite: boolean;
      icon: string | null;
      created_at: string;
      updated_at: string;
    }>("/api/files/", {
      method: "POST",
      body: JSON.stringify({ name, content, parent_id: parentId }),
    });
  }

  async updateFile(
    id: string,
    updates: { name?: string; content?: string; is_favorite?: boolean; icon?: string }
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
      created_at: string;
      updated_at: string;
    }>(`/api/files/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  }

  async createFolder(name: string, parentId?: string | null) {
    return this.request<{
      id: string;
      name: string;
      content: string;
      is_folder: boolean;
      parent_id: string | null;
      position: number;
      is_favorite: boolean;
      icon: string | null;
      created_at: string;
      updated_at: string;
    }>("/api/files/folders", {
      method: "POST",
      body: JSON.stringify({ name, parent_id: parentId ?? null }),
    });
  }

  async moveFile(fileId: string, targetFolderId: string | null) {
    return this.request<{
      id: string;
      name: string;
      content: string;
      is_folder: boolean;
      parent_id: string | null;
      position: number;
      is_favorite: boolean;
      icon: string | null;
      created_at: string;
      updated_at: string;
    }>(`/api/files/${fileId}/move`, {
      method: "POST",
      body: JSON.stringify({ target_folder_id: targetFolderId }),
    });
  }

  async deleteFile(id: string) {
    return this.request<{ status: string }>(`/api/files/${id}`, {
      method: "DELETE",
    });
  }

  // Trash API
  async listTrash() {
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
  }

  async restoreFile(id: string) {
    return this.request<{ status: string }>(`/api/files/${id}/restore`, {
      method: "POST",
    });
  }

  async permanentDeleteFile(id: string) {
    return this.request<{ status: string }>(`/api/files/${id}/permanent`, {
      method: "DELETE",
    });
  }

  async emptyTrash() {
    return this.request<{ status: string; count: number }>("/api/files/trash/empty", {
      method: "DELETE",
    });
  }

  // Image upload API
  async uploadImage(file: File): Promise<{ url: string; filename: string; size: number }> {
    const formData = new FormData();
    formData.append("file", file);

    const authHeaders = this.getAuthHeaders();

    const response = await fetch(`${this.baseUrl}/api/images/upload`, {
      method: "POST",
      headers: authHeaders,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Upload failed" }));
      throw new Error(error.detail || "Failed to upload image");
    }

    return response.json();
  }

  async deleteImage(imageUrl: string): Promise<void> {
    // Extract user_id/filename from URL like "/api/images/{user_id}/{filename}"
    const match = imageUrl.match(/\/api\/images\/([^/]+)\/([^/]+)$/);
    if (!match) return;

    const [, userId, filename] = match;

    const response = await fetch(`${this.baseUrl}/api/images/${userId}/${filename}`, {
      method: "DELETE",
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Delete failed" }));
      throw new Error(error.detail || "Failed to delete image");
    }
  }

  async searchFiles(query: string, fileIds?: string[], topK: number = 5, signal?: AbortSignal) {
    return this.request<SearchResults>("/api/files/search", {
      method: "POST",
      body: JSON.stringify({ query, file_ids: fileIds, top_k: topK }),
      signal,
    });
  }

  /**
   * Search within a single document at sentence level.
   * Returns sentence-level chunks for precise in-document highlighting.
   * @param query - Search query
   * @param fileId - File to search within
   * @param topK - Maximum number of results (default 10)
   * @param minScore - Minimum similarity score 0-1 (default 0.15 for sentence-level search)
   */
  async searchInDocument(
    query: string,
    fileId: string,
    topK: number = 10,
    minScore: number = 0.15,
    signal?: AbortSignal
  ) {
    return this.request<SearchResults>("/api/files/search/in-document", {
      method: "POST",
      body: JSON.stringify({ query, file_id: fileId, top_k: topK, min_score: minScore }),
      signal,
    });
  }

  // Versions API
  async listVersions(fileId: string, limit: number = 50) {
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
    }>("/api/versions/", {
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

  // Chat API

  async getConversation(fileId: string): Promise<{
    id: string;
    fileId: string;
    messages: {
      id: string;
      role: "user" | "assistant";
      content: string;
      contexts?: MessageContextItem[] | null;
      thinking?: string | null;
      toolCalls?: ToolCall[] | null;
      edits?: EditOperation[] | null;
      model?: string | null;
      createdAt: string;
    }[];
    createdAt: string;
  }> {
    return this.request(`/api/chat/conversations/${fileId}`);
  }

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
  async exportFile(fileId: string, format: "markdown" | "pdf" | "docx"): Promise<Blob> {
    const url = `${this.baseUrl}/api/export/${fileId}/${format}`;
    const response = await fetch(url, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Export failed" }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.blob();
  }

  /**
   * Import a file (PDF, DOCX, or Markdown) and convert it to a new document.
   * @param file - The file to import
   * @param parentId - Optional folder ID to import into
   * @returns The created file object
   */
  async importFile(file: File, parentId?: string | null) {
    const formData = new FormData();
    formData.append("file", file);
    if (parentId) {
      formData.append("parent_id", parentId);
    }

    const url = `${this.baseUrl}/api/import/`;
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Import failed" }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json() as Promise<{
      id: string;
      name: string;
      content: string;
      is_folder: boolean;
      parent_id: string | null;
      position: number;
      is_favorite: boolean;
      icon: string | null;
      created_at: string;
      updated_at: string;
    }>;
  }

  // =========================================================================
  // Knowledge Base API
  // =========================================================================

  /**
   * Upload a file to a conversation's knowledge base.
   */
  async uploadKBAttachment(conversationId: string, file: File) {
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
  }

  /**
   * Upload multiple files to a conversation's knowledge base in batch.
   * Backend processes files in parallel.
   */
  async uploadKBAttachmentsBatch(conversationId: string, files: File[]) {
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
  }

  /**
   * List all attachments in a conversation's knowledge base.
   */
  async listKBAttachments(conversationId: string) {
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
  }

  /**
   * Delete an attachment from a conversation's knowledge base.
   */
  async deleteKBAttachment(conversationId: string, attachmentId: string) {
    return this.request<{ status: string; id: string }>(
      `/api/kb/${conversationId}/attachments/${attachmentId}`,
      { method: "DELETE" }
    );
  }

  /**
   * Search within a conversation's knowledge base.
   */
  async searchKB(conversationId: string, query: string, topK: number = 5) {
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
  }

  /**
   * Get the extracted content of an attachment.
   */
  async getKBAttachmentContent(conversationId: string, attachmentId: string) {
    return this.request<{
      id: string;
      filename: string;
      content: string;
      chunk_count: number;
    }>(`/api/kb/${conversationId}/attachments/${attachmentId}/content`);
  }

  // =========================================================================
  // Document Sharing API
  // =========================================================================

  /**
   * Create a share link for a document.
   * @param request - Share creation request with file_id, expiration, and content mode
   * @returns The created share with share_url
   */
  async createShare(request: CreateShareRequest): Promise<Share> {
    return this.request<Share>("/api/shares/", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * List all shares for a specific file.
   * @param fileId - The file ID to list shares for
   * @param includeExpired - Whether to include expired shares (default: false)
   * @returns List of shares for the file
   */
  async listFileShares(
    fileId: string,
    includeExpired: boolean = false
  ): Promise<ShareListResponse> {
    return this.request<ShareListResponse>(
      `/api/shares/file/${fileId}?include_expired=${includeExpired}`
    );
  }

  async getMyShares(): Promise<ShareListResponse> {
    return this.request<ShareListResponse>("/api/shares/my");
  }

  /**
   * Revoke a share link (deactivate it).
   * @param shareId - The share ID to revoke
   * @returns Status response
   */
  async revokeShare(shareId: string): Promise<{ status: string; share_id: string }> {
    return this.request<{ status: string; share_id: string }>(`/api/shares/${shareId}`, {
      method: "DELETE",
    });
  }

  async updateShareMetadata(
    shareId: string,
    metadata: { title?: string; description?: string; tags?: string[] }
  ): Promise<{
    id: string;
    share_token: string;
    title: string;
    description: string | null;
    tags: string[] | null;
    updated_at: string | null;
  }> {
    return this.request(`/api/shares/${shareId}/metadata`, {
      method: "PATCH",
      body: JSON.stringify(metadata),
    });
  }

  /**
   * Get a shared document or folder.
   * Sends auth headers when available (required for private shares).
   * @param shareToken - The share token from the URL
   * @param path - Optional subfolder/file ID within a shared folder
   * @returns The shared item content
   */
  async getSharedDocument(shareToken: string, path?: string): Promise<SharedItemResponse> {
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
  }

  // =========================================================================
  // Data Files API (for Code Execution)
  // =========================================================================

  /**
   * Upload a data file for code execution analysis.
   * Supports CSV, XLSX, JSON, TXT, and image files.
   */
  async uploadDataFile(conversationId: string, file: File) {
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
  }

  /**
   * List all data files in a conversation.
   */
  async listDataFiles(conversationId: string) {
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
      }>;
    }>(`/api/data-files/${conversationId}/files`);
  }

  /**
   * Get a specific data file.
   */
  async getDataFile(conversationId: string, fileId: string) {
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
  }

  /**
   * Delete a data file from a conversation.
   */
  async deleteDataFile(conversationId: string, fileId: string) {
    return this.request<{ status: string; id: string }>(
      `/api/data-files/${conversationId}/files/${fileId}`,
      { method: "DELETE" }
    );
  }

  // ==========================================================================
  // Community API
  // ==========================================================================

  async getCommunityTags(limit = 20): Promise<{ tags: { tag: string; count: number }[] }> {
    return this.request<{ tags: { tag: string; count: number }[] }>(
      `/api/community/tags?limit=${limit}`
    );
  }

  async getCommunityItems(
    params: {
      sort?: string;
      search?: string;
      tag?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<CommunityListResponse> {
    const searchParams = new URLSearchParams();
    if (params.sort) searchParams.set("sort", params.sort);
    if (params.search) searchParams.set("search", params.search);
    if (params.tag) searchParams.set("tag", params.tag);
    if (params.limit) searchParams.set("limit", params.limit.toString());
    if (params.offset) searchParams.set("offset", params.offset.toString());

    const url = `/api/community/discover?${searchParams.toString()}`;
    return this.request<CommunityListResponse>(url);
  }

  async getCommunityDetail(shareToken: string): Promise<CommunityDetailResponse> {
    return this.request<CommunityDetailResponse>(`/api/community/discover/${shareToken}`);
  }

  // ==========================================================================
  // Invite API
  // ==========================================================================

  async searchUsersForInvite(query: string): Promise<{ users: SearchUserResult[] }> {
    return this.request<{ users: SearchUserResult[] }>(
      `/api/shares/search-users?q=${encodeURIComponent(query)}`
    );
  }

  async inviteUsers(
    shareId: string,
    userIds?: string[],
    emails?: string[]
  ): Promise<{ status: string; added: number }> {
    return this.request<{ status: string; added: number }>(`/api/shares/${shareId}/invite`, {
      method: "POST",
      body: JSON.stringify({ user_ids: userIds, emails }),
    });
  }

  async removeInvite(shareId: string, userId: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/api/shares/${shareId}/invite/${userId}`, {
      method: "DELETE",
    });
  }

  async listInvites(shareId: string): Promise<{ invites: InviteEntry[]; count: number }> {
    return this.request<{ invites: InviteEntry[]; count: number }>(
      `/api/shares/${shareId}/invites`
    );
  }

  async getSharedWithMe(): Promise<{ shares: SharedWithMeItem[]; count: number }> {
    return this.request<{ shares: SharedWithMeItem[]; count: number }>(
      "/api/shares/shared-with-me"
    );
  }

  // ==========================================================================
  // Fork API
  // ==========================================================================

  async forkDocument(shareToken: string, targetFolderId?: string): Promise<ForkResponse> {
    return this.request<ForkResponse>(`/api/community/${shareToken}/fork`, {
      method: "POST",
      body: JSON.stringify({ target_folder_id: targetFolderId || null }),
    });
  }

  async syncFork(
    forkId: string,
    options?: { force?: boolean; create_backup?: boolean }
  ): Promise<{
    status: "up_to_date" | "synced" | "conflict" | "error";
    message: string;
    has_local_changes?: boolean;
    backup_file_id?: string | null;
  }> {
    return this.request(`/api/community/forks/${forkId}/sync`, {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    });
  }

  async getMyForks(): Promise<{ forks: ForkInfo[] }> {
    return this.request<{ forks: ForkInfo[] }>("/api/community/forks");
  }

  // ==========================================================================
  // Bookmark API
  // ==========================================================================

  async toggleBookmark(
    shareToken: string
  ): Promise<{ bookmarked: boolean; bookmark_count: number }> {
    return this.request<{ bookmarked: boolean; bookmark_count: number }>(
      `/api/community/${shareToken}/bookmark`,
      { method: "POST" }
    );
  }

  async getBookmarks(limit = 50, offset = 0): Promise<{ items: CommunityItem[]; total: number }> {
    return this.request<{ items: CommunityItem[]; total: number }>(
      `/api/community/bookmarks?limit=${limit}&offset=${offset}`
    );
  }

  // ==========================================================================
  // Comments API
  // ==========================================================================

  async getComments(
    shareToken: string,
    limit = 50,
    offset = 0,
    sort: "oldest" | "newest" = "oldest"
  ): Promise<CommentsListResponse> {
    return this.request<CommentsListResponse>(
      `/api/comments/${shareToken}?limit=${limit}&offset=${offset}&sort=${sort}`
    );
  }

  async getCommentReplies(
    shareToken: string,
    commentId: string,
    limit = 50,
    offset = 0
  ): Promise<CommentsListResponse> {
    return this.request<CommentsListResponse>(
      `/api/comments/${shareToken}/${commentId}/replies?limit=${limit}&offset=${offset}`
    );
  }

  async createComment(
    shareToken: string,
    content: string,
    parentId?: string | null,
    mentions?: string[]
  ): Promise<CommentResponse> {
    return this.request<CommentResponse>(`/api/comments/${shareToken}`, {
      method: "POST",
      body: JSON.stringify({
        content,
        parent_id: parentId || null,
        mentions: mentions || null,
      }),
    });
  }

  async editComment(
    shareToken: string,
    commentId: string,
    content: string,
    mentions?: string[]
  ): Promise<CommentResponse> {
    return this.request<CommentResponse>(`/api/comments/${shareToken}/${commentId}`, {
      method: "PUT",
      body: JSON.stringify({ content, mentions: mentions || null }),
    });
  }

  async deleteComment(
    shareToken: string,
    commentId: string
  ): Promise<{ status: string; comment_id: string }> {
    return this.request<{ status: string; comment_id: string }>(
      `/api/comments/${shareToken}/${commentId}`,
      { method: "DELETE" }
    );
  }

  async toggleReaction(
    shareToken: string,
    commentId: string,
    emoji: string
  ): Promise<{ reacted: boolean; reactions: CommentReactionSummary[] }> {
    return this.request<{ reacted: boolean; reactions: CommentReactionSummary[] }>(
      `/api/comments/${shareToken}/${commentId}/react`,
      { method: "POST", body: JSON.stringify({ emoji }) }
    );
  }

  async searchMentions(query: string): Promise<{ users: CommunityAuthor[] }> {
    return this.request<{ users: CommunityAuthor[] }>(
      `/api/comments/mentions/search?q=${encodeURIComponent(query)}`
    );
  }

  // ==========================================================================
  // User Profile API
  // ==========================================================================

  async getUserProfile(userId: string): Promise<UserProfileResponse> {
    return this.request<UserProfileResponse>(`/api/community/users/${userId}`);
  }

  async getUserPublished(
    userId: string,
    sort = "newest",
    limit = 20,
    offset = 0
  ): Promise<CommunityListResponse> {
    return this.request<CommunityListResponse>(
      `/api/community/users/${userId}/published?sort=${sort}&limit=${limit}&offset=${offset}`
    );
  }

  // ==========================================================================
  // KB Agent API
  // ==========================================================================

  /**
   * Stream a KB agent response. Returns the raw fetch Response for SSE processing.
   */
  async kbAgentStream(
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
  }
}

// Default client instance
export const api = new ApiClient();
