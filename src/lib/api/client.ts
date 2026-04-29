/**
 * Base API client — local desktop edition (no auth).
 *
 * The backend runs as a FastAPI sidecar on 127.0.0.1; the exact port is
 * injected at runtime by the Tauri shell into window.__TAURI_BACKEND_URL__.
 * See src/lib/api/base.ts for the resolution order.
 */

import { getApiBase } from "./base";

/** @deprecated Read getApiBase() at call time instead — the URL is dynamic. */
export const API_BASE = "";

export class ApiClient {
  protected baseUrl: string | null;

  /**
   * Pass an explicit baseUrl to pin a client to a specific backend (rare —
   * mostly for tests). When omitted the URL is resolved on every request so
   * the Tauri-injected value works even for clients constructed before the
   * WebView's first render.
   */
  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? null;
  }

  public resolveBaseUrl(): string {
    return this.baseUrl ?? getApiBase();
  }

  /** Kept as a no-op for legacy call sites. */
  public getAuthorizationHeaders(): Record<string, string> {
    return {};
  }

  /** Legacy alias used inside upload helpers — same no-op. */
  public getAuthHeaders(): Record<string, string> {
    return {};
  }

  public setAccessToken(_token: string, _expiresIn?: number): void {}

  // ---------------------------------------------------------------------------
  // Legacy sharing method stubs (kept so old call sites don't break the build).
  // All return empty payloads for the local desktop edition.
  // ---------------------------------------------------------------------------
  public async isLoggedIn(): Promise<boolean> {
    return true;
  }
  public async getMyShares(): Promise<{ shares: never[] }> {
    return { shares: [] };
  }
  public async getMyForks(): Promise<{ forks: never[] }> {
    return { forks: [] };
  }
  public async getBookmarks(): Promise<{ items: never[] }> {
    return { items: [] };
  }
  public async getSharedWithMe(): Promise<{ shares: never[] }> {
    return { shares: [] };
  }
  public async syncFork(
    _forkId: string
  ): Promise<{ status: string; message?: string; backup_file_id?: string }> {
    return { status: "noop" };
  }
  public async deleteFork(_forkId: string): Promise<{ status: string }> {
    return { status: "noop" };
  }
  public async unfurlUrl(
    _url: string
  ): Promise<{ title?: string; description?: string; image?: string; favicon?: string }> {
    return {};
  }
  public async toggleBookmark(_shareId: string): Promise<{ bookmarked: boolean }> {
    return { bookmarked: false };
  }
  public async listInvites(_shareId: string): Promise<{ invites: never[] }> {
    return { invites: [] };
  }
  public async inviteUsers(_shareId: string, _userIds: string[]): Promise<{ status: string }> {
    return { status: "noop" };
  }
  public async removeInvite(_shareId: string, _userId: string): Promise<{ status: string }> {
    return { status: "noop" };
  }
  public async revokeShare(_shareId: string): Promise<{ status: string }> {
    return { status: "noop" };
  }
  public async updateShareMetadata(
    _shareId: string,
    _payload: Record<string, unknown>
  ): Promise<{ status: string }> {
    return { status: "noop" };
  }

  protected async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.resolveBaseUrl()}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: options.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error(error.detail || error.error?.message || `HTTP ${response.status}`);
    }

    return response.json();
  }
}
