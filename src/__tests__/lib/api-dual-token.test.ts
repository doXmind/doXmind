/**
 * Tests for dual-token authentication in API client
 *
 * Tests the new refresh token functionality including:
 * - Auto-refresh before expiry
 * - 401 retry with token refresh
 * - Credentials: include for cookies
 * - Concurrent refresh protection
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiClient } from "@/lib/api/client";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

// Mock document.cookie
let cookieStore = "";

// Mock window.dispatchEvent
const mockDispatchEvent = vi.fn();

describe("ApiClient - Dual-Token Authentication", () => {
  const originalFetch = global.fetch;
  const originalLocalStorage = global.localStorage;
  let client: ApiClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    localStorageMock.clear();
    cookieStore = "";

    // Mock localStorage
    Object.defineProperty(global, "localStorage", {
      value: localStorageMock,
      writable: true,
    });

    // Mock document.cookie
    Object.defineProperty(document, "cookie", {
      get: () => cookieStore,
      set: (value: string) => {
        cookieStore = value;
      },
      configurable: true,
    });

    // Mock window.dispatchEvent
    Object.defineProperty(global, "window", {
      value: { dispatchEvent: mockDispatchEvent },
      writable: true,
    });

    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    client = new ApiClient("http://test-api.com");
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    Object.defineProperty(global, "localStorage", {
      value: originalLocalStorage,
      writable: true,
    });
  });

  // ==========================================================================
  // Credentials: include
  // ==========================================================================
  describe("Credentials handling", () => {
    it("should include credentials in all requests", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: "success" }),
      });

      await client["request"]("/test");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          credentials: "include",
        })
      );
    });
  });

  // ==========================================================================
  // Auto-refresh before expiry
  // ==========================================================================
  describe("Auto-refresh mechanism", () => {
    it("should schedule auto-refresh 1 minute before token expiry", async () => {
      const expiresIn = 900; // 15 minutes
      client.setAccessToken("test-token", expiresIn);

      // Fast forward to 14 minutes (1 minute before expiry)
      vi.advanceTimersByTime(14 * 60 * 1000);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "refreshed-token",
          expires_in: 900,
        }),
      });

      // Trigger pending timers
      await vi.runAllTimersAsync();

      // Should have called refresh endpoint
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/refresh"),
        expect.objectContaining({
          method: "POST",
          credentials: "include",
        })
      );
    });

    it("should not schedule auto-refresh if no token", () => {
      client["scheduleAutoRefresh"]();

      // Fast forward 20 minutes
      vi.advanceTimersByTime(20 * 60 * 1000);

      // Should not have called fetch
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should cancel previous timer when scheduling new refresh", () => {
      client.setAccessToken("token1", 900);
      const firstTimer = client["autoRefreshTimer"];

      client.setAccessToken("token2", 900);
      const secondTimer = client["autoRefreshTimer"];

      expect(firstTimer).not.toBe(secondTimer);
    });

    it("should clear auto-refresh timer on clearToken", () => {
      client.setAccessToken("test-token", 900);
      expect(client["autoRefreshTimer"]).not.toBeNull();

      client["clearToken"]();
      expect(client["autoRefreshTimer"]).toBeNull();
    });
  });

  // ==========================================================================
  // 401 retry with refresh
  // ==========================================================================
  describe("401 error handling with token refresh", () => {
    it("should auto-refresh on 401 and retry original request", async () => {
      client.setAccessToken("old-token", 900);

      // First call: 401
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      // Refresh call: success
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "new-token",
          expires_in: 900,
        }),
      });

      // Retry original request: success
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: "success" }),
      });

      const result = await client["request"]("/test");

      expect(result).toEqual({ data: "success" });
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Verify the calls
      expect(fetchMock).toHaveBeenNthCalledWith(1, expect.any(String), expect.any(Object)); // Original
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("/api/auth/refresh"),
        expect.any(Object)
      ); // Refresh
      expect(fetchMock).toHaveBeenNthCalledWith(3, expect.any(String), expect.any(Object)); // Retry
    });

    it("should dispatch unauthorized event if refresh fails", async () => {
      client.setAccessToken("old-token", 900);

      // First call: 401
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      // Refresh call: fails
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(client["request"]("/test")).rejects.toThrow("Session expired");

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "auth:unauthorized",
        })
      );

      expect(client.isLoggedIn()).toBe(false);
    });

    it("should clear token if refresh fails", async () => {
      client.setAccessToken("old-token", 900);

      // 401 on original request
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      // Refresh fails
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(client["request"]("/test")).rejects.toThrow();

      expect(localStorageMock.removeItem).toHaveBeenCalled();
      expect(client.isLoggedIn()).toBe(false);
    });
  });

  // ==========================================================================
  // Concurrent refresh protection
  // ==========================================================================
  describe("Concurrent refresh protection", () => {
    it("should prevent concurrent refresh requests", async () => {
      client.setAccessToken("old-token", 900);

      // Mock refresh to take some time
      const refreshPromise = new Promise((resolve) => {
        setTimeout(
          () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => ({
                access_token: "new-token",
                expires_in: 900,
              }),
            }),
          100
        );
      });

      fetchMock.mockImplementation((url) => {
        if (url.includes("/api/auth/refresh")) {
          return refreshPromise as Promise<Response>;
        }
        return Promise.resolve({
          ok: false,
          status: 401,
        } as Response);
      });

      // Make multiple concurrent requests that all get 401
      const promises = [
        client["request"]("/test1"),
        client["request"]("/test2"),
        client["request"]("/test3"),
      ];

      // Advance timers to trigger the refresh promise
      vi.advanceTimersByTime(200);
      await Promise.all(promises);

      // Should only call refresh endpoint once despite multiple 401s
      const refreshCalls = fetchMock.mock.calls.filter((call) =>
        call[0].includes("/api/auth/refresh")
      );
      expect(refreshCalls.length).toBe(1);
    });

    it("should reuse ongoing refresh promise", async () => {
      // Start a manual refresh
      const firstRefreshPromise = client["refreshToken"]();

      // Try to call refresh again immediately
      const secondRefreshPromise = client["refreshToken"]();

      // Should be the same promise (reused)
      expect(firstRefreshPromise).toBe(secondRefreshPromise);
    });

    it("should reset refreshPromise after completion", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "new-token",
          expires_in: 900,
        }),
      });

      await client["refreshToken"]();

      expect(client["refreshPromise"]).toBeNull();
    });

    it("should reset refreshPromise even if refresh fails", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
      });

      await expect(client["refreshToken"]()).rejects.toThrow();

      expect(client["refreshPromise"]).toBeNull();
    });
  });

  // ==========================================================================
  // Token storage without buffer
  // ==========================================================================
  describe("Token storage (dual-token)", () => {
    it("should store token without expiry buffer", () => {
      const now = Date.now();
      const expiresIn = 900; // 15 minutes

      client.setAccessToken("test-token", expiresIn);

      // Get stored data
      const stored = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);

      // Should be exact expiry (no buffer)
      const expectedExpiry = now + expiresIn * 1000;
      expect(stored.expiry).toBeGreaterThanOrEqual(expectedExpiry - 100);
      expect(stored.expiry).toBeLessThanOrEqual(expectedExpiry + 100);
    });
  });

  // ==========================================================================
  // Session management API
  // ==========================================================================
  describe("Session management", () => {
    it("should call listSessions with credentials", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "session-1",
            device_name: "Chrome on Windows",
            is_current: true,
          },
        ],
      });

      await client.listSessions();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/sessions"),
        expect.objectContaining({
          credentials: "include",
        })
      );
    });

    it("should call revokeSession with credentials", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          message: "Session revoked",
        }),
      });

      await client.revokeSession("session-123");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/sessions/session-123"),
        expect.objectContaining({
          method: "DELETE",
          credentials: "include",
        })
      );
    });
  });

  // ==========================================================================
  // Logout
  // ==========================================================================
  describe("Logout (dual-token)", () => {
    it("should call backend logout endpoint", async () => {
      client.setAccessToken("test-token", 900);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          message: "Logged out",
        }),
      });

      await client.logout();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/logout"),
        expect.objectContaining({
          method: "POST",
          credentials: "include",
        })
      );

      expect(client.isLoggedIn()).toBe(false);
    });

    it("should clear token even if backend call fails", async () => {
      client.setAccessToken("test-token", 900);

      fetchMock.mockRejectedValue(new Error("Network error"));

      await client.logout();

      expect(client.isLoggedIn()).toBe(false);
      expect(localStorageMock.removeItem).toHaveBeenCalled();
    });
  });
});
