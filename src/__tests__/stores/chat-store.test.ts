/**
 * Tests for chat store
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useChatStore } from "@/stores/chat-store";

// Track ID counter for mock
let idCounter = 0;

// Mock dependencies - must be before imports that use them
vi.mock("@/lib/utils", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...original,
    generateId: () => `test-msg-${++idCounter}`,
  };
});

// Mock the api module
const mockGetAuthHeaders = vi.fn(() => ({ Authorization: "Bearer test-token" }));
const mockGetConversation = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    getAuthorizationHeaders: () => mockGetAuthHeaders(),
    getConversation: (...args: unknown[]) => mockGetConversation(...args),
  },
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("useChatStore", () => {
  // Reset store state before each test
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset ID counter for deterministic tests
    idCounter = 0;
    // Reset the store to initial state
    useChatStore.setState({
      conversations: {},
      activeConversationId: null,
      isLoadingHistory: false,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ============================================================================
  // ensureConversation tests
  // ============================================================================
  describe("ensureConversation", () => {
    it("creates new conversation for file ID", () => {
      const { ensureConversation } = useChatStore.getState();

      const result = ensureConversation("file-123");

      expect(result).toBe("file-123");
      const state = useChatStore.getState();
      expect(state.conversations["file-123"]).toBeDefined();
      expect(state.conversations["file-123"].fileId).toBe("file-123");
      expect(state.conversations["file-123"].messages).toEqual([]);
    });

    it("returns existing conversation if present", () => {
      // First create a conversation
      const { ensureConversation: ensure1 } = useChatStore.getState();
      ensure1("file-123");

      // Add a message to verify it's the same conversation
      useChatStore.getState().addMessage("file-123", {
        role: "user",
        content: "Hello",
      });

      // Now ensure again
      const result = useChatStore.getState().ensureConversation("file-123");

      expect(result).toBe("file-123");
      const state = useChatStore.getState();
      expect(state.conversations["file-123"].messages).toHaveLength(1);
    });

    it("throws error without file ID", () => {
      const { ensureConversation } = useChatStore.getState();

      expect(() => ensureConversation(null)).toThrow("Cannot create conversation without a file");
    });

    it("sets active conversation", () => {
      const { ensureConversation } = useChatStore.getState();

      ensureConversation("file-123");

      expect(useChatStore.getState().activeConversationId).toBe("file-123");
    });

    it("sets createdAt timestamp", () => {
      const before = new Date().toISOString();
      const { ensureConversation } = useChatStore.getState();

      ensureConversation("file-123");

      const after = new Date().toISOString();
      const conversation = useChatStore.getState().conversations["file-123"];
      expect(conversation.createdAt >= before).toBe(true);
      expect(conversation.createdAt <= after).toBe(true);
    });
  });

  // ============================================================================
  // addMessage tests
  // ============================================================================
  describe("addMessage", () => {
    beforeEach(() => {
      useChatStore.getState().ensureConversation("file-123");
    });

    it("adds message to existing conversation", () => {
      const { addMessage } = useChatStore.getState();

      const messageId = addMessage("file-123", {
        role: "user",
        content: "Hello, AI!",
      });

      expect(messageId).toBeDefined();
      const state = useChatStore.getState();
      const messages = state.conversations["file-123"].messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("Hello, AI!");
    });

    it("creates conversation if not exists", () => {
      const { addMessage } = useChatStore.getState();

      addMessage("new-file", {
        role: "user",
        content: "Hello",
      });

      const state = useChatStore.getState();
      expect(state.conversations["new-file"]).toBeDefined();
      expect(state.conversations["new-file"].messages).toHaveLength(1);
    });

    it("generates unique message ID", () => {
      const { addMessage } = useChatStore.getState();

      const id1 = addMessage("file-123", { role: "user", content: "First" });
      const id2 = addMessage("file-123", { role: "user", content: "Second" });

      expect(id1).not.toBe(id2);
    });

    it("sets correct timestamp", () => {
      const before = new Date().toISOString();
      const { addMessage } = useChatStore.getState();

      addMessage("file-123", { role: "user", content: "Hello" });

      const after = new Date().toISOString();
      const message = useChatStore.getState().conversations["file-123"].messages[0];
      expect(message.createdAt >= before).toBe(true);
      expect(message.createdAt <= after).toBe(true);
    });

    it("preserves message properties", () => {
      const { addMessage } = useChatStore.getState();

      addMessage("file-123", {
        role: "assistant",
        content: "Response",
        thinking: "Let me think...",
        toolCalls: [{ name: "search", input: "{}", output: "results", success: true }],
        model: "claude-3-5-sonnet",
      });

      const message = useChatStore.getState().conversations["file-123"].messages[0];
      expect(message.thinking).toBe("Let me think...");
      expect(message.toolCalls).toHaveLength(1);
      expect(message.model).toBe("claude-3-5-sonnet");
    });
  });

  // ============================================================================
  // updateMessage tests
  // ============================================================================
  describe("updateMessage", () => {
    let messageId: string;

    beforeEach(() => {
      useChatStore.getState().ensureConversation("file-123");
      messageId = useChatStore.getState().addMessage("file-123", {
        role: "user",
        content: "Original content",
      });
    });

    it("updates message content", () => {
      const { updateMessage } = useChatStore.getState();

      updateMessage("file-123", messageId, "Updated content");

      const message = useChatStore.getState().conversations["file-123"].messages[0];
      expect(message.content).toBe("Updated content");
    });

    it("does nothing for non-existent conversation", () => {
      const { updateMessage } = useChatStore.getState();

      // Should not throw
      updateMessage("non-existent", messageId, "Updated");

      // Original message unchanged
      const message = useChatStore.getState().conversations["file-123"].messages[0];
      expect(message.content).toBe("Original content");
    });

    it("does nothing for non-existent message", () => {
      const { updateMessage } = useChatStore.getState();

      // Should not throw
      updateMessage("file-123", "non-existent-msg", "Updated");

      // Original message unchanged
      const message = useChatStore.getState().conversations["file-123"].messages[0];
      expect(message.content).toBe("Original content");
    });
  });

  // ============================================================================
  // updateMessageFull tests
  // ============================================================================
  describe("updateMessageFull", () => {
    let messageId: string;

    beforeEach(() => {
      useChatStore.getState().ensureConversation("file-123");
      messageId = useChatStore.getState().addMessage("file-123", {
        role: "assistant",
        content: "Initial",
      });
    });

    it("updates multiple message properties", () => {
      const { updateMessageFull } = useChatStore.getState();

      updateMessageFull("file-123", messageId, {
        content: "Updated content",
        thinking: "New thinking",
        model: "claude-3-opus",
      });

      const message = useChatStore.getState().conversations["file-123"].messages[0];
      expect(message.content).toBe("Updated content");
      expect(message.thinking).toBe("New thinking");
      expect(message.model).toBe("claude-3-opus");
    });

    it("preserves unupdated properties", () => {
      const { updateMessageFull } = useChatStore.getState();

      updateMessageFull("file-123", messageId, { thinking: "Added thinking" });

      const message = useChatStore.getState().conversations["file-123"].messages[0];
      expect(message.content).toBe("Initial"); // Preserved
      expect(message.role).toBe("assistant"); // Preserved
      expect(message.thinking).toBe("Added thinking"); // Updated
    });

    it("does nothing for non-existent conversation", () => {
      const { updateMessageFull } = useChatStore.getState();

      // Should not throw
      updateMessageFull("non-existent", messageId, { content: "Updated" });
    });
  });

  // ============================================================================
  // appendToMessage tests
  // ============================================================================
  describe("appendToMessage", () => {
    let messageId: string;

    beforeEach(() => {
      useChatStore.getState().ensureConversation("file-123");
      messageId = useChatStore.getState().addMessage("file-123", {
        role: "assistant",
        content: "Hello",
      });
    });

    it("appends content to existing message", () => {
      const { appendToMessage } = useChatStore.getState();

      appendToMessage("file-123", messageId, " World");

      const message = useChatStore.getState().conversations["file-123"].messages[0];
      expect(message.content).toBe("Hello World");
    });

    it("handles streaming updates correctly", () => {
      const { appendToMessage } = useChatStore.getState();

      appendToMessage("file-123", messageId, " ");
      appendToMessage("file-123", messageId, "from");
      appendToMessage("file-123", messageId, " ");
      appendToMessage("file-123", messageId, "AI");

      const message = useChatStore.getState().conversations["file-123"].messages[0];
      expect(message.content).toBe("Hello from AI");
    });

    it("does nothing for non-existent message", () => {
      const { appendToMessage } = useChatStore.getState();

      appendToMessage("file-123", "non-existent", " World");

      const message = useChatStore.getState().conversations["file-123"].messages[0];
      expect(message.content).toBe("Hello");
    });
  });

  // ============================================================================
  // setMessageStreaming tests
  // ============================================================================
  describe("setMessageStreaming", () => {
    let messageId: string;

    beforeEach(() => {
      useChatStore.getState().ensureConversation("file-123");
      messageId = useChatStore.getState().addMessage("file-123", {
        role: "assistant",
        content: "",
      });
    });

    it("sets streaming state to true", () => {
      const { setMessageStreaming } = useChatStore.getState();

      setMessageStreaming("file-123", messageId, true);

      const message = useChatStore.getState().conversations["file-123"].messages[0];
      expect(message.isStreaming).toBe(true);
    });

    it("sets streaming state to false", () => {
      const { setMessageStreaming } = useChatStore.getState();

      setMessageStreaming("file-123", messageId, true);
      setMessageStreaming("file-123", messageId, false);

      const message = useChatStore.getState().conversations["file-123"].messages[0];
      expect(message.isStreaming).toBe(false);
    });
  });

  // ============================================================================
  // loadConversation tests
  // ============================================================================
  describe("loadConversation", () => {
    it("fetches conversation from backend", async () => {
      mockGetConversation.mockResolvedValueOnce({
        id: "conv-uuid",
        fileId: "file-123",
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "Hello",
            createdAt: "2024-01-01T00:00:00Z",
          },
          {
            id: "msg-2",
            role: "assistant",
            content: "Hi!",
            createdAt: "2024-01-01T00:00:01Z",
          },
        ],
        createdAt: "2024-01-01T00:00:00Z",
      });

      await useChatStore.getState().loadConversation("file-123");

      // Verify api.getConversation was called with the correct fileId
      expect(mockGetConversation).toHaveBeenCalledWith("file-123");

      // Verify state was updated correctly
      const state = useChatStore.getState();
      expect(state.conversations["file-123"]).toBeDefined();
      expect(state.conversations["file-123"].messages).toHaveLength(2);
      expect(state.conversations["file-123"].isLoaded).toBe(true);
      expect(state.activeConversationId).toBe("file-123");
    });

    it("marks conversation as loaded", async () => {
      mockGetConversation.mockResolvedValueOnce({
        id: "conv-uuid",
        fileId: "file-123",
        messages: [],
        createdAt: "2024-01-01T00:00:00Z",
      });

      await useChatStore.getState().loadConversation("file-123");

      expect(useChatStore.getState().conversations["file-123"].isLoaded).toBe(true);
    });

    it("skips if already loaded", async () => {
      // First load
      mockGetConversation.mockResolvedValueOnce({
        id: "conv-uuid",
        fileId: "file-123",
        messages: [],
        createdAt: "2024-01-01T00:00:00Z",
      });
      await useChatStore.getState().loadConversation("file-123");

      // Reset mock
      mockGetConversation.mockClear();

      // Try to load again
      await useChatStore.getState().loadConversation("file-123");

      expect(mockGetConversation).not.toHaveBeenCalled();
    });

    it("handles API errors gracefully", async () => {
      mockGetConversation.mockRejectedValueOnce(new Error("API error"));

      // Should not throw
      await useChatStore.getState().loadConversation("file-123");

      expect(useChatStore.getState().isLoadingHistory).toBe(false);
    });

    it("does nothing with empty fileId", async () => {
      await useChatStore.getState().loadConversation("");

      expect(mockGetConversation).not.toHaveBeenCalled();
    });

    it("sets isLoadingHistory during load", async () => {
      let loadingDuringFetch = false;
      mockGetConversation.mockImplementationOnce(() => {
        loadingDuringFetch = useChatStore.getState().isLoadingHistory;
        return Promise.resolve({
          id: "conv-uuid",
          fileId: "file-123",
          messages: [],
          createdAt: "2024-01-01T00:00:00Z",
        });
      });

      await useChatStore.getState().loadConversation("file-123");

      expect(loadingDuringFetch).toBe(true);
      expect(useChatStore.getState().isLoadingHistory).toBe(false);
    });
  });

  // ============================================================================
  // clearConversation tests
  // ============================================================================
  describe("clearConversation", () => {
    beforeEach(() => {
      useChatStore.getState().ensureConversation("file-123");
      useChatStore.getState().addMessage("file-123", {
        role: "user",
        content: "Message 1",
      });
      useChatStore.getState().addMessage("file-123", {
        role: "assistant",
        content: "Response 1",
      });
    });

    it("clears messages locally", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await useChatStore.getState().clearConversation("file-123");

      const state = useChatStore.getState();
      expect(state.conversations["file-123"].messages).toHaveLength(0);
    });

    it("calls backend to clear", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await useChatStore.getState().clearConversation("file-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chat/conversations/file-123",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });

    it("clears locally even if backend fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await useChatStore.getState().clearConversation("file-123");

      const state = useChatStore.getState();
      expect(state.conversations["file-123"].messages).toHaveLength(0);
    });
  });

  // ============================================================================
  // deleteConversation tests
  // ============================================================================
  describe("deleteConversation", () => {
    beforeEach(() => {
      useChatStore.getState().ensureConversation("file-123");
      useChatStore.getState().addMessage("file-123", {
        role: "user",
        content: "Hello",
      });
    });

    it("removes conversation from state", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await useChatStore.getState().deleteConversation("file-123");

      expect(useChatStore.getState().conversations["file-123"]).toBeUndefined();
    });

    it("clears active conversation if deleted", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(useChatStore.getState().activeConversationId).toBe("file-123");

      await useChatStore.getState().deleteConversation("file-123");

      expect(useChatStore.getState().activeConversationId).toBeNull();
    });

    it("calls backend to delete", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await useChatStore.getState().deleteConversation("file-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chat/conversations/file-123",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });

    it("does nothing with empty fileId", async () => {
      await useChatStore.getState().deleteConversation("");

      expect(mockFetch).not.toHaveBeenCalled();
      expect(useChatStore.getState().conversations["file-123"]).toBeDefined();
    });
  });

  // ============================================================================
  // setActiveConversation tests
  // ============================================================================
  describe("setActiveConversation", () => {
    it("sets active conversation id", () => {
      useChatStore.getState().ensureConversation("file-123");

      useChatStore.getState().setActiveConversation("file-123");

      expect(useChatStore.getState().activeConversationId).toBe("file-123");
    });

    it("can set to null", () => {
      useChatStore.getState().ensureConversation("file-123");

      useChatStore.getState().setActiveConversation(null);

      expect(useChatStore.getState().activeConversationId).toBeNull();
    });
  });

  // ============================================================================
  // saveMessageToBackend tests
  // ============================================================================
  describe("saveMessageToBackend", () => {
    it("sends message to backend", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const message = {
        id: "msg-1",
        role: "user" as const,
        content: "Hello",
        createdAt: "2024-01-01T00:00:00Z",
        contexts: [{ type: "selection" as const, text: "selected text" }],
      };

      await useChatStore.getState().saveMessageToBackend("file-123", message);

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chat/messages",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: expect.stringContaining('"conversationId":"file-123"'),
        })
      );
    });

    it("includes all message properties in payload", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const message = {
        id: "msg-1",
        role: "assistant" as const,
        content: "Response",
        createdAt: "2024-01-01T00:00:00Z",
        thinking: "Thinking...",
        toolCalls: [{ name: "search", input: "{}", output: "results", success: true }],
        edits: [
          {
            type: "str_replace" as const,
            old_str: "old",
            new_str: "new",
            file_id: "f1",
            file_name: "test.md",
            success: true,
          },
        ],
        model: "claude-3-5-sonnet",
      };

      await useChatStore.getState().saveMessageToBackend("file-123", message);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.thinking).toBe("Thinking...");
      expect(callBody.toolCalls).toHaveLength(1);
      expect(callBody.edits).toHaveLength(1);
      expect(callBody.model).toBe("claude-3-5-sonnet");
    });

    it("handles backend errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const message = {
        id: "msg-1",
        role: "user" as const,
        content: "Hello",
        createdAt: "2024-01-01T00:00:00Z",
      };

      // Should not throw
      await useChatStore.getState().saveMessageToBackend("file-123", message);
    });
  });
});
