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

  // Dual-token authentication support
  private refreshPromise: Promise<void> | null = null; // Prevent concurrent refreshes
  private autoRefreshTimer: NodeJS.Timeout | null = null; // Auto-refresh before expiry
  private refreshBlockedUntil: number | null = null; // Backoff after refresh rate-limit

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
          // Token expired, remove it and clear auth cookie to prevent redirect loops
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          document.cookie = `${AUTH_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
        }
      } catch {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        document.cookie = `${AUTH_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
      }
    }
  }

  protected saveToken(token: string, expiresIn: number): void {
    this.accessToken = token;
    // Dual-token: No buffer needed, auto-refresh handles expiry
    this.tokenExpiry = Date.now() + expiresIn * 1000;

    if (typeof window !== "undefined") {
      localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, expiry: this.tokenExpiry }));
      // Also set a cookie for middleware auth check
      document.cookie = `${AUTH_COOKIE_NAME}=1; path=/; max-age=${expiresIn}; SameSite=Lax`;
    }

    // Schedule auto-refresh before token expires (1 minute before)
    this.scheduleAutoRefresh();
  }

  protected clearToken(): void {
    this.accessToken = null;
    this.tokenExpiry = null;

    // Cancel auto-refresh timer
    if (this.autoRefreshTimer) {
      clearTimeout(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }

    if (typeof window !== "undefined") {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      // Also clear the auth cookie
      document.cookie = `${AUTH_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
    }
  }

  /**
   * Schedule automatic token refresh before expiry (dual-token system).
   * Refreshes 1 minute before access token expires.
   */
  private scheduleAutoRefresh(): void {
    // Clear existing timer
    if (this.autoRefreshTimer) {
      clearTimeout(this.autoRefreshTimer);
    }

    if (!this.tokenExpiry) return;

    // Refresh 1 minute before expiry
    const timeUntilRefresh = this.tokenExpiry - Date.now() - 60000;

    if (timeUntilRefresh > 0) {
      this.autoRefreshTimer = setTimeout(() => {
        this.autoRefreshToken().catch((error) => {
          console.error("[ApiClient] Auto-refresh failed:", error);
          // Don't clear token on auto-refresh failure - let user continue until manual action
        });
      }, timeUntilRefresh);
    }
  }

  /**
   * Internal method to refresh access token using refresh token (dual-token authentication).
   * Called automatically before expiry or on 401 errors.
   * For manual refresh, use the public refreshToken() method from auth.ts.
   */
  private async autoRefreshToken(): Promise<void> {
    if (this.refreshBlockedUntil && this.refreshBlockedUntil > Date.now()) {
      throw new Error("Refresh temporarily blocked due to rate limiting");
    }

    // Prevent concurrent refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
          method: "POST",
          credentials: "include", // Send HttpOnly refresh token cookie
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          if (response.status === 429) {
            this.refreshBlockedUntil = Date.now() + 60_000;
            throw new Error("Refresh rate limited");
          }
          throw new Error("Refresh token expired or invalid");
        }

        const data: { access_token: string; expires_in: number } = await response.json();
        this.refreshBlockedUntil = null;
        this.saveToken(data.access_token, data.expires_in);
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
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
      credentials: "include", // Dual-token: Send HttpOnly refresh token cookie
      headers: {
        "Content-Type": "application/json",
        ...this.getAuthHeaders(),
        ...options.headers,
      },
      signal: options.signal,
    });

    // Handle 401 Unauthorized - attempt refresh once, then retry
    // Skip refresh for auth endpoints (login, register, etc.) - those 401s are real errors
    const isAuthEndpoint = endpoint.startsWith("/api/auth/") && endpoint !== "/api/auth/refresh";
    if (response.status === 401 && !isAuthEndpoint) {
      // Try to refresh token using refresh token cookie
      try {
        if (!this.refreshPromise) {
          await this.autoRefreshToken();
        } else {
          // Wait for ongoing refresh to complete
          await this.refreshPromise;
        }

        // Retry original request with new access token
        return this.request<T>(endpoint, options);
      } catch {
        // Refresh failed - clear token and dispatch unauthorized event
        this.clearToken();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("auth:unauthorized"));
        }
        throw new Error("Session expired. Please log in again.");
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error(error.detail || error.error?.message || `HTTP ${response.status}`);
    }

    return response.json();
  }
}
