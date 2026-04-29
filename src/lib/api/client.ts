/**
 * Base API client — local desktop edition (no auth).
 *
 * The backend runs on localhost:8000 and trusts every request. We just
 * proxy through Next.js rewrites and never attach any auth headers.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export class ApiClient {
  protected baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
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
    const url = `${this.baseUrl}${endpoint}`;
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
