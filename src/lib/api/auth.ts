/**
 * Auth API methods - extends ApiClient prototype
 */

import { ApiClient } from "./client";
import type { TokenResponse, AuthStatus, MessageResponse, User } from "./types";

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
    logout(): void;
    deleteAccount(): Promise<MessageResponse>;
    isLoggedIn(): boolean;
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
  return this.request<{ authorization_url: string }>("/api/auth/google");
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
 * Logout - clear tokens.
 */
ApiClient.prototype.logout = function (this: ApiClient): void {
  this.clearToken();
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
