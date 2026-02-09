/**
 * Tests for API client
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiClient } from "@/lib/api";

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

describe("ApiClient", () => {
  const originalFetch = global.fetch;
  const originalLocalStorage = global.localStorage;
  let client: ApiClient;

  beforeEach(() => {
    vi.resetAllMocks();
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

    client = new ApiClient("http://test-api.com");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(global, "localStorage", {
      value: originalLocalStorage,
      writable: true,
    });
  });

  // ============================================================================
  // Token Management
  // ============================================================================
  describe("Token Management", () => {
    it("saves token with setAccessToken and reports logged in", () => {
      // Test that setAccessToken properly saves and makes isLoggedIn return true
      const newClient = new ApiClient("http://test-api.com");
      expect(newClient.isLoggedIn()).toBe(false);

      newClient.setAccessToken("new-token", 3600);

      expect(newClient.isLoggedIn()).toBe(true);
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });

    it("token expiry is calculated with buffer", () => {
      const newClient = new ApiClient("http://test-api.com");
      const expiresIn = 3600; // 1 hour

      newClient.setAccessToken("token", expiresIn);

      // Check the saved data has expiry with 5-minute buffer
      const savedCall = localStorageMock.setItem.mock.calls.find(
        (call: string[]) => call[0] === "doxmind_access_token"
      );
      expect(savedCall).toBeDefined();
      const savedData = JSON.parse(savedCall![1]);
      // Expiry should be roughly (expiresIn - 300) * 1000 from now
      const expectedExpiry = Date.now() + (expiresIn - 300) * 1000;
      expect(Math.abs(savedData.expiry - expectedExpiry)).toBeLessThan(1000);
    });

    it("isLoggedIn returns false for client without token", () => {
      const newClient = new ApiClient("http://test-api.com");
      expect(newClient.isLoggedIn()).toBe(false);
    });

    it("setAccessToken can be called on existing client", () => {
      client.setAccessToken("another-token", 7200);

      expect(localStorageMock.setItem).toHaveBeenCalled();
      expect(client.isLoggedIn()).toBe(true);
    });

    it("setAccessToken sets auth cookie", () => {
      client.setAccessToken("new-token", 3600);

      expect(cookieStore).toContain("doxmind_auth=1");
      expect(cookieStore).toContain("path=/");
    });

    it("logout clears token from memory and storage", () => {
      client.setAccessToken("token-to-clear", 3600);
      expect(client.isLoggedIn()).toBe(true);

      client.logout();

      expect(client.isLoggedIn()).toBe(false);
      expect(localStorageMock.removeItem).toHaveBeenCalledWith("doxmind_access_token");
    });

    it("logout clears auth cookie", () => {
      client.setAccessToken("token", 3600);
      client.logout();

      expect(cookieStore).toContain("max-age=0");
    });

    it("isLoggedIn returns true when token is valid", () => {
      client.setAccessToken("valid-token", 3600);
      expect(client.isLoggedIn()).toBe(true);
    });

    it("isLoggedIn returns false when no token", () => {
      expect(client.isLoggedIn()).toBe(false);
    });

    it("getAuthorizationHeaders returns auth header when logged in", () => {
      client.setAccessToken("my-token", 3600);

      const headers = client.getAuthorizationHeaders();

      expect(headers["Authorization"]).toBe("Bearer my-token");
    });

    it("getAuthorizationHeaders returns empty object when not logged in", () => {
      const headers = client.getAuthorizationHeaders();

      expect(headers).toEqual({});
    });
  });

  // ============================================================================
  // Request Handling
  // ============================================================================
  describe("Request Handling", () => {
    it("adds auth header when token present", async () => {
      client.setAccessToken("auth-token", 3600);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "healthy" }),
      });

      await client.healthCheck();

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/health",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer auth-token",
          }),
        })
      );
    });

    it("includes Content-Type header", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "healthy" }),
      });

      await client.healthCheck();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("clears token on 401 response", async () => {
      client.setAccessToken("invalid-token", 3600);
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: "Unauthorized" }),
      });

      await expect(client.healthCheck()).rejects.toThrow("Session expired. Please log in again.");
      expect(client.isLoggedIn()).toBe(false);
    });

    it("throws error with detail message", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ detail: "Bad request message" }),
      });

      await expect(client.healthCheck()).rejects.toThrow("Bad request message");
    });

    it("throws error with HTTP status when no detail", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("JSON parse error")),
      });

      await expect(client.healthCheck()).rejects.toThrow("Unknown error");
    });

    it("parses nested error message", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: "Nested error" } }),
      });

      await expect(client.healthCheck()).rejects.toThrow("Nested error");
    });
  });

  // ============================================================================
  // Auth API
  // ============================================================================
  describe("Auth API", () => {
    it("getToken saves received token", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-access-token",
            token_type: "bearer",
            expires_in: 604800,
          }),
      });

      const response = await client.getToken();

      expect(response.access_token).toBe("new-access-token");
      expect(client.isLoggedIn()).toBe(true);
    });

    it("refreshToken updates stored token", async () => {
      client.setAccessToken("old-token", 100);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "refreshed-token",
            token_type: "bearer",
            expires_in: 604800,
          }),
      });

      await client.refreshToken();

      expect(client.getAuthorizationHeaders()["Authorization"]).toBe("Bearer refreshed-token");
    });

    it("login saves token and returns user", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "login-token",
            token_type: "bearer",
            expires_in: 604800,
            user: { id: "user-1", email: "test@example.com", is_verified: true },
          }),
      });

      const response = await client.login("test@example.com", "password123");

      expect(response.access_token).toBe("login-token");
      expect(response.user?.email).toBe("test@example.com");
      expect(client.isLoggedIn()).toBe(true);
    });

    it("verifyEmail saves token", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "verified-token",
            token_type: "bearer",
            expires_in: 604800,
          }),
      });

      await client.verifyEmail("test@example.com", "123456");

      expect(client.isLoggedIn()).toBe(true);
    });

    it("register sends correct payload", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, message: "Verification code sent" }),
      });

      await client.register("test@example.com", "testuser", "password123");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/auth/register",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "test@example.com",
            username: "testuser",
            password: "password123",
          }),
        })
      );
    });

    it("forgotPassword sends email", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, message: "Reset email sent" }),
      });

      await client.forgotPassword("test@example.com");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/auth/forgot-password",
        expect.objectContaining({
          body: JSON.stringify({ email: "test@example.com" }),
        })
      );
    });

    it("resetPassword sends token and new password", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, message: "Password reset" }),
      });

      await client.resetPassword("reset-token", "newpassword123");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/auth/reset-password",
        expect.objectContaining({
          body: JSON.stringify({ token: "reset-token", new_password: "newpassword123" }),
        })
      );
    });

    it("deleteAccount clears token after success", async () => {
      client.setAccessToken("token", 3600);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, message: "Account deleted" }),
      });

      await client.deleteAccount();

      expect(client.isLoggedIn()).toBe(false);
    });

    it("ensureAuthenticated does nothing if token valid", async () => {
      client.setAccessToken("valid-token", 3600);
      global.fetch = vi.fn();

      await client.ensureAuthenticated();

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("ensureAuthenticated gets new token if not valid", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-token",
            token_type: "bearer",
            expires_in: 604800,
          }),
      });

      await client.ensureAuthenticated();

      expect(global.fetch).toHaveBeenCalled();
      expect(client.isLoggedIn()).toBe(true);
    });
  });

  // ============================================================================
  // Files API
  // ============================================================================
  describe("Files API", () => {
    beforeEach(() => {
      client.setAccessToken("token", 3600);
    });

    it("listFiles returns file array", async () => {
      const files = [
        { id: "1", name: "File 1", content: "", created_at: "", updated_at: "" },
        { id: "2", name: "File 2", content: "", created_at: "", updated_at: "" },
      ];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(files),
      });

      const result = await client.listFiles();

      expect(result).toEqual(files);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/files/",
        expect.any(Object)
      );
    });

    it("getFile fetches single file", async () => {
      const file = { id: "1", name: "File 1", content: "Content", created_at: "", updated_at: "" };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(file),
      });

      const result = await client.getFile("1");

      expect(result).toEqual(file);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/files/1",
        expect.any(Object)
      );
    });

    it("createFile sends correct payload", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "new-id",
            name: "New File",
            content: "Initial content",
            created_at: "",
            updated_at: "",
          }),
      });

      await client.createFile("New File", "Initial content");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/files/",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "New File", content: "Initial content" }),
        })
      );
    });

    it("createFile uses empty content by default", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ id: "1", name: "File", content: "", created_at: "", updated_at: "" }),
      });

      await client.createFile("File");

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ name: "File", content: "" }),
        })
      );
    });

    it("updateFile sends partial updates", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "1",
            name: "Updated Name",
            content: "old content",
            created_at: "",
            updated_at: "",
          }),
      });

      await client.updateFile("1", { name: "Updated Name" });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/files/1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ name: "Updated Name" }),
        })
      );
    });

    it("deleteFile sends DELETE request", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "deleted" }),
      });

      await client.deleteFile("1");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/files/1",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("searchFiles sends query and options", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      });

      await client.searchFiles("search query", ["file-1", "file-2"], 10);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/files/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            query: "search query",
            file_ids: ["file-1", "file-2"],
            top_k: 10,
          }),
        })
      );
    });

    it("searchInDocument sends correct parameters", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      });

      await client.searchInDocument("query", "file-1", 20, 0.5);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/files/search/in-document",
        expect.objectContaining({
          body: JSON.stringify({
            query: "query",
            file_id: "file-1",
            top_k: 20,
            min_score: 0.5,
          }),
        })
      );
    });
  });

  // ============================================================================
  // Versions API
  // ============================================================================
  describe("Versions API", () => {
    beforeEach(() => {
      client.setAccessToken("token", 3600);
    });

    it("listVersions fetches versions for file", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await client.listVersions("file-1", 100);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/versions/file-1?limit=100",
        expect.any(Object)
      );
    });

    it("createVersion sends version data", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "v1" }),
      });

      await client.createVersion("file-1", "content", "ai_edit", "AI made changes");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/versions/",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            file_id: "file-1",
            content: "content",
            edit_type: "ai_edit",
            summary: "AI made changes",
          }),
        })
      );
    });

    it("restoreVersion calls restore endpoint", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "restored", version_id: "v1" }),
      });

      await client.restoreVersion("file-1", "v1");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/versions/file-1/v1/restore",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  // ============================================================================
  // Export/Import API
  // ============================================================================
  describe("Export/Import API", () => {
    beforeEach(() => {
      client.setAccessToken("token", 3600);
    });

    it("exportFile returns blob for markdown", async () => {
      const mockBlob = new Blob(["# Content"], { type: "text/markdown" });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      const result = await client.exportFile("file-1", "markdown");

      expect(result).toBe(mockBlob);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/export/file-1/markdown",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer token",
          }),
        })
      );
    });

    it("exportFile throws on error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: "File not found" }),
      });

      await expect(client.exportFile("file-1", "pdf")).rejects.toThrow("File not found");
    });

    it("importFile sends multipart form data", async () => {
      const mockFile = new File(["content"], "test.md", { type: "text/markdown" });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "new-id",
            name: "test",
            content: "content",
            created_at: "",
            updated_at: "",
          }),
      });

      await client.importFile(mockFile);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/import/",
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData),
        })
      );
    });
  });

  // ============================================================================
  // Knowledge Base API
  // ============================================================================
  describe("Knowledge Base API", () => {
    beforeEach(() => {
      client.setAccessToken("token", 3600);
    });

    it("uploadKBAttachment sends file as multipart", async () => {
      const mockFile = new File(["pdf content"], "doc.pdf", { type: "application/pdf" });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "att-1",
            original_filename: "doc.pdf",
            file_type: "pdf",
            file_size: 11,
            status: "indexed",
            chunk_count: 5,
            created_at: "",
          }),
      });

      const result = await client.uploadKBAttachment("conv-1", mockFile);

      expect(result.id).toBe("att-1");
      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/kb/conv-1/attachments",
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData),
        })
      );
    });

    it("listKBAttachments fetches attachments", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            attachments: [],
            total_size: 0,
            count: 0,
          }),
      });

      await client.listKBAttachments("conv-1");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/kb/conv-1/attachments",
        expect.any(Object)
      );
    });

    it("deleteKBAttachment sends DELETE request", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "deleted", id: "att-1" }),
      });

      await client.deleteKBAttachment("conv-1", "att-1");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/kb/conv-1/attachments/att-1",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("searchKB sends search query", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      });

      await client.searchKB("conv-1", "search query", 10);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/kb/conv-1/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ query: "search query", top_k: 10 }),
        })
      );
    });

    it("getKBAttachmentContent fetches content", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "att-1",
            filename: "doc.pdf",
            content: "Extracted content",
            chunk_count: 5,
          }),
      });

      const result = await client.getKBAttachmentContent("conv-1", "att-1");

      expect(result.content).toBe("Extracted content");
      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/kb/conv-1/attachments/att-1/content",
        expect.any(Object)
      );
    });
  });

  // ============================================================================
  // Other API Methods
  // ============================================================================
  describe("Other API Methods", () => {
    beforeEach(() => {
      client.setAccessToken("token", 3600);
    });

    it("simpleChat sends message", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ response: "AI response" }),
      });

      const result = await client.simpleChat("Hello", "You are helpful");

      expect(result.response).toBe("AI response");
      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/chat/simple",
        expect.objectContaining({
          body: JSON.stringify({ message: "Hello", system: "You are helpful" }),
        })
      );
    });

    it("healthCheck calls health endpoint", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "healthy" }),
      });

      const result = await client.healthCheck();

      expect(result.status).toBe("healthy");
      expect(global.fetch).toHaveBeenCalledWith("http://test-api.com/health", expect.any(Object));
    });

    it("getAuthStatus checks authentication", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            authenticated: true,
            auth_type: "jwt",
            debug_mode: false,
          }),
      });

      const result = await client.getAuthStatus();

      expect(result.authenticated).toBe(true);
    });

    it("getCurrentUser fetches user profile", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "user-1",
            email: "test@example.com",
            is_verified: true,
          }),
      });

      const result = await client.getCurrentUser();

      expect(result.email).toBe("test@example.com");
    });

    it("updateProfile sends PATCH request", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "user-1",
            email: "test@example.com",
            username: "newname",
            is_verified: true,
          }),
      });

      await client.updateProfile({ username: "newname" });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/auth/me",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ username: "newname" }),
        })
      );
    });

    it("getGoogleAuthUrl fetches OAuth URL", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            authorization_url: "https://accounts.google.com/oauth...",
          }),
      });

      const result = await client.getGoogleAuthUrl();

      expect(result.authorization_url).toContain("google.com");
    });

    it("changePassword sends current and new password", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, message: "Password changed" }),
      });

      await client.changePassword("oldpass", "newpass");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/auth/change-password",
        expect.objectContaining({
          body: JSON.stringify({
            current_password: "oldpass",
            new_password: "newpass",
          }),
        })
      );
    });

    it("resendCode sends email for verification", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, message: "Code sent" }),
      });

      await client.resendCode("test@example.com");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-api.com/api/auth/resend-code",
        expect.objectContaining({
          body: JSON.stringify({ email: "test@example.com" }),
        })
      );
    });
  });
});
