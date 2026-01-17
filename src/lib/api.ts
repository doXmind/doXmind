/**
 * API client for communicating with the backend
 */

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
      localStorage.setItem(
        TOKEN_STORAGE_KEY,
        JSON.stringify({ token, expiry: this.tokenExpiry })
      );
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

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
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

    // Handle 401 Unauthorized - clear token and retry once
    if (response.status === 401 && this.accessToken) {
      this.clearToken();
      // Could implement auto-refresh here if needed
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
  async updateProfile(updates: { username?: string; avatar_url?: string }): Promise<User> {
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
    return this.request<Array<{
      id: string;
      name: string;
      content: string;
      created_at: string;
      updated_at: string;
    }>>("/api/files/");
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
    }>("/api/files/", {
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
   * @param minScore - Minimum similarity score 0-1 (default 0.4 for OpenAI embeddings)
   */
  async searchInDocument(query: string, fileId: string, topK: number = 10, minScore: number = 0.4, signal?: AbortSignal) {
    return this.request<SearchResults>("/api/files/search/in-document", {
      method: "POST",
      body: JSON.stringify({ query, file_id: fileId, top_k: topK, min_score: minScore }),
      signal,
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
   * @returns The created file object
   */
  async importFile(file: File) {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${this.baseUrl}/api/import/`;
    const response = await fetch(url, {
      method: 'POST',
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
    formData.append('file', file);

    const url = `${this.baseUrl}/api/kb/${conversationId}/attachments`;
    const response = await fetch(url, {
      method: 'POST',
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
      { method: 'DELETE' }
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
      method: 'POST',
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
}

// Default client instance
export const api = new ApiClient();
