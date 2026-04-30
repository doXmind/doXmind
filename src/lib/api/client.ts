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
