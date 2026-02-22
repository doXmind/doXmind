/**
 * Base API client with core request method and token management
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const TOKEN_STORAGE_KEY = "doxmind_access_token";
export const AUTH_COOKIE_NAME = "doxmind_auth";

export class ApiClient {
  protected baseUrl: string;
  protected accessToken: string | null = null;
  protected tokenExpiry: number | null = null;

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

  protected saveToken(token: string, expiresIn: number): void {
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

  protected clearToken(): void {
    this.accessToken = null;
    this.tokenExpiry = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      // Also clear the auth cookie
      document.cookie = `${AUTH_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
    }
  }

  protected isTokenValid(): boolean {
    return !!(this.accessToken && this.tokenExpiry && this.tokenExpiry > Date.now());
  }

  protected getAuthHeaders(): Record<string, string> {
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

  protected async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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
}
