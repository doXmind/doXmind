/**
 * Auth API methods - extends ApiClient prototype
 */

import { ApiClient } from "./client";
import type { TokenResponse, AuthStatus, MessageResponse, User, Session } from "./types";

declare module "./client" {
  interface ApiClient {
    getToken(clientId?: string): Promise<TokenResponse>;
    refreshToken(): Promise<TokenResponse>;
    getAuthStatus(): Promise<AuthStatus>;
    ensureAuthenticated(): Promise<void>;
    register(email: string, username: string, password: string): Promise<MessageResponse>;
    verifyEmail(email: string, code: string): Promise<TokenResponse>;
    resendCode(email: string): Promise<MessageResponse>;
    login(email: string, password: string): Promise<TokenResponse>;
    forgotPassword(email: string): Promise<MessageResponse>;
    resetPassword(token: string, newPassword: string): Promise<MessageResponse>;
    changePassword(currentPassword: string, newPassword: string): Promise<MessageResponse>;
    getGoogleAuthUrl(): Promise<{ authorization_url: string }>;
    getCurrentUser(): Promise<User>;
    updateProfile(updates: {
      username?: string;
      avatar_url?: string;
      bio?: string;
      website?: string;
      social_links?: { github?: string; twitter?: string; linkedin?: string };
    }): Promise<User>;
    uploadAvatar(file: File): Promise<User>;
    removeAvatar(): Promise<User>;
    logout(): Promise<void>; // Changed from void to Promise<void> (dual-token)
    deleteAccount(): Promise<MessageResponse>;
    isLoggedIn(): boolean;
    // Dual-token session management
    listSessions(): Promise<Session[]>;
    revokeSession(sessionId: string): Promise<MessageResponse>;
  }
}

/**
 * Get a new access token. Call this on app initialization.
 */
ApiClient.prototype.getToken = async function (
  this: ApiClient,
  clientId?: string
): Promise<TokenResponse> {
  const response = await this.request<TokenResponse>("/api/auth/token", {
    method: "POST",
    body: JSON.stringify({ client_id: clientId }),
  });

  this.saveToken(response.access_token, response.expires_in);
  return response;
};

/**
 * Refresh the current token.
 */
ApiClient.prototype.refreshToken = async function (this: ApiClient): Promise<TokenResponse> {
  const response = await this.request<TokenResponse>("/api/auth/refresh", {
    method: "POST",
  });

  this.saveToken(response.access_token, response.expires_in);
  return response;
};

/**
 * Check authentication status.
 */
ApiClient.prototype.getAuthStatus = async function (this: ApiClient): Promise<AuthStatus> {
  return this.request<AuthStatus>("/api/auth/status");
};

/**
 * Ensure we have a valid token, fetching one if needed.
 */
ApiClient.prototype.ensureAuthenticated = async function (this: ApiClient): Promise<void> {
  if (this.isTokenValid()) return;

  // Get a new token
  await this.getToken();
};

// ==========================================================================
// User Authentication API
// ==========================================================================

/**
 * Register a new user. Sends verification code to email.
 */
ApiClient.prototype.register = async function (
  this: ApiClient,
  email: string,
  username: string,
  password: string
): Promise<MessageResponse> {
  return this.request<MessageResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, username, password }),
  });
};

/**
 * Verify email with code and complete registration.
 */
ApiClient.prototype.verifyEmail = async function (
  this: ApiClient,
  email: string,
  code: string
): Promise<TokenResponse> {
  const response = await this.request<TokenResponse>("/api/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });

  this.saveToken(response.access_token, response.expires_in);
  return response;
};

/**
 * Resend verification code.
 */
ApiClient.prototype.resendCode = async function (
  this: ApiClient,
  email: string
): Promise<MessageResponse> {
  return this.request<MessageResponse>("/api/auth/resend-code", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
};

/**
 * Login with email and password.
 */
ApiClient.prototype.login = async function (
  this: ApiClient,
  email: string,
  password: string
): Promise<TokenResponse> {
  const response = await this.request<TokenResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  this.saveToken(response.access_token, response.expires_in);
  return response;
};

/**
 * Request password reset email.
 */
ApiClient.prototype.forgotPassword = async function (
  this: ApiClient,
  email: string
): Promise<MessageResponse> {
  return this.request<MessageResponse>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
};

/**
 * Reset password with token.
 */
ApiClient.prototype.resetPassword = async function (
  this: ApiClient,
  token: string,
  newPassword: string
): Promise<MessageResponse> {
  return this.request<MessageResponse>("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  });
};

/**
 * Change password for logged-in user.
 */
ApiClient.prototype.changePassword = async function (
  this: ApiClient,
  currentPassword: string,
  newPassword: string
): Promise<MessageResponse> {
  return this.request<MessageResponse>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
};

/**
 * Get Google OAuth authorization URL.
 */
ApiClient.prototype.getGoogleAuthUrl = async function (
  this: ApiClient
): Promise<{ authorization_url: string }> {
  const redirectUri = window.location.origin;
  return this.request<{ authorization_url: string }>(
    `/api/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`
  );
};

/**
 * Get current user profile.
 */
ApiClient.prototype.getCurrentUser = async function (this: ApiClient): Promise<User> {
  return this.request<User>("/api/auth/me");
};

/**
 * Update user profile.
 */
ApiClient.prototype.updateProfile = async function (
  this: ApiClient,
  updates: {
    username?: string;
    avatar_url?: string;
    bio?: string;
    website?: string;
    social_links?: { github?: string; twitter?: string; linkedin?: string };
  }
): Promise<User> {
  return this.request<User>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
};

/**
 * Upload a new avatar image. Returns updated user with new avatar_url.
 * Does NOT count against user storage quota.
 */
ApiClient.prototype.uploadAvatar = async function (this: ApiClient, file: File): Promise<User> {
  const formData = new FormData();
  formData.append("file", file);

  const authHeaders = this.getAuthHeaders();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${this.baseUrl}/api/auth/avatar`, {
      method: "POST",
      headers: authHeaders,
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 413) {
        throw new Error("Image too large (max 2MB)");
      }
      const error = await response.json().catch(() => ({ detail: "Upload failed" }));
      throw new Error(error.detail || "Failed to upload avatar");
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Upload timed out - check your connection");
    }
    throw error;
  }
};

/**
 * Remove current avatar. Returns updated user with avatar_url cleared.
 */
ApiClient.prototype.removeAvatar = async function (this: ApiClient): Promise<User> {
  return this.request<User>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify({ avatar_url: "" }),
  });
};

/**
 * Logout - revoke refresh token and clear access token (dual-token authentication).
 */
ApiClient.prototype.logout = async function (this: ApiClient): Promise<void> {
  try {
    // Call backend to revoke refresh token (HttpOnly cookie)
    await this.request<MessageResponse>("/api/auth/logout", {
      method: "POST",
      credentials: "include", // Send refresh token cookie
    });
  } catch (error) {
    console.error("[ApiClient] Logout request failed:", error);
    // Continue with local cleanup even if backend call fails
  } finally {
    // Always clear local token
    this.clearToken();
  }
};

/**
 * Delete user account.
 */
ApiClient.prototype.deleteAccount = async function (this: ApiClient): Promise<MessageResponse> {
  const result = await this.request<MessageResponse>("/api/auth/me", {
    method: "DELETE",
  });
  // Clear tokens after successful deletion
  this.clearToken();
  return result;
};

/**
 * Check if user is logged in.
 */
ApiClient.prototype.isLoggedIn = function (this: ApiClient): boolean {
  return this.isTokenValid();
};

// ==========================================================================
// Session Management API (Dual-Token Authentication)
// ==========================================================================

/**
 * List all active sessions for the current user.
 * Shows all devices with valid refresh tokens.
 */
ApiClient.prototype.listSessions = async function (this: ApiClient): Promise<Session[]> {
  return this.request<Session[]>("/api/auth/sessions", {
    credentials: "include", // Send refresh token cookie
  });
};

/**
 * Revoke a specific session (logout from another device).
 */
ApiClient.prototype.revokeSession = async function (
  this: ApiClient,
  sessionId: string
): Promise<MessageResponse> {
  return this.request<MessageResponse>(`/api/auth/sessions/${sessionId}`, {
    method: "DELETE",
    credentials: "include",
  });
};
