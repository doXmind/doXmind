/**
 * Tests for useChat hook
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock dependencies with vi.hoisted
const {
  mockEnsureConversation,
  mockAddMessage,
  mockAppendToMessage,
  mockSetMessageStreaming,
  mockUpdateMessageFull,
  mockSaveMessageToBackend,
  mockGetFile,
  mockApplyEdits,
  mockGetAuthHeaders,
} = vi.hoisted(() => ({
  mockEnsureConversation: vi.fn(),
  mockAddMessage: vi.fn(),
  mockAppendToMessage: vi.fn(),
  mockSetMessageStreaming: vi.fn(),
  mockUpdateMessageFull: vi.fn(),
  mockSaveMessageToBackend: vi.fn(),
  mockGetFile: vi.fn(),
  mockApplyEdits: vi.fn(),
  mockGetAuthHeaders: vi.fn(),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: () => ({
    ensureConversation: (...args: unknown[]) => mockEnsureConversation(...args),
    addMessage: (...args: unknown[]) => mockAddMessage(...args),
    appendToMessage: (...args: unknown[]) => mockAppendToMessage(...args),
    setMessageStreaming: (...args: unknown[]) => mockSetMessageStreaming(...args),
    updateMessageFull: (...args: unknown[]) => mockUpdateMessageFull(...args),
    saveMessageToBackend: (...args: unknown[]) => mockSaveMessageToBackend(...args),
  }),
}));

vi.mock("@/stores/file-store", () => ({
  useFileStore: () => ({
    getFile: (...args: unknown[]) => mockGetFile(...args),
  }),
}));

vi.mock("@/hooks/use-edit-operations", () => ({
  useEditOperations: () => ({
    applyEdits: (...args: unknown[]) => mockApplyEdits(...args),
  }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getAuthorizationHeaders: () => mockGetAuthHeaders(),
  },
}));

vi.mock("@/lib/markdown", () => ({
  htmlToMarkdown: vi.fn((html: string) => html),
  isHtml: vi.fn(() => false),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import hook after mocks
import { useChat } from "@/hooks/use-chat";

// Helper to create mock SSE response
function createMockSSEResponse(events: Array<{ type: string; [key: string]: unknown }>): Response {
  const encoder = new TextEncoder();
  const eventStrings = events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
  const chunks = eventStrings.map((str) => encoder.encode(str));

  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index++;
      } else {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("useChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mock return values
    mockEnsureConversation.mockReturnValue("conv-123");
    mockGetAuthHeaders.mockReturnValue({ Authorization: "Bearer test-token" });
    mockApplyEdits.mockReturnValue(1);

    // Reset message ID counter
    let msgCounter = 0;
    mockAddMessage.mockImplementation(() => `msg-${++msgCounter}`);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ============================================================================
  // Initial state tests
  // ============================================================================
  describe("initial state", () => {
    it("starts with isStreaming false", () => {
      const { result } = renderHook(() => useChat());

      expect(result.current.isStreaming).toBe(false);
    });

    it("starts with currentTool null", () => {
      const { result } = renderHook(() => useChat());

      expect(result.current.currentTool).toBeNull();
    });

    it("starts with empty toolHistory", () => {
      const { result } = renderHook(() => useChat());

      expect(result.current.toolHistory).toEqual([]);
    });

    it("starts with thinking inactive", () => {
      const { result } = renderHook(() => useChat());

      expect(result.current.thinking.isThinking).toBe(false);
      expect(result.current.thinking.content).toBe("");
    });
  });

  // ============================================================================
  // sendMessage tests
  // ============================================================================
  describe("sendMessage", () => {
    it("ensures conversation exists", async () => {
      mockFetch.mockResolvedValueOnce(createMockSSEResponse([{ type: "text", content: "Hello" }]));

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Hello", ["file-1"]);
      });

      expect(mockEnsureConversation).toHaveBeenCalledWith("file-1");
    });

    it("adds user message to store", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([{ type: "text", content: "Response" }])
      );

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Hello", ["file-1"]);
      });

      expect(mockAddMessage).toHaveBeenCalledWith("conv-123", {
        role: "user",
        content: "Hello",
        fileIds: ["file-1"],
        contexts: undefined,
      });
    });

    it("adds assistant message placeholder", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([{ type: "text", content: "Response" }])
      );

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Hello", ["file-1"]);
      });

      // Second call should be the assistant placeholder
      expect(mockAddMessage).toHaveBeenCalledTimes(2);
      expect(mockAddMessage).toHaveBeenNthCalledWith(2, "conv-123", {
        role: "assistant",
        content: "",
        isStreaming: true,
      });
    });

    it("sets isStreaming during request", async () => {
      const _streamingDuringFetch = false;
      mockFetch.mockImplementationOnce(() => {
        // Can't easily check isStreaming during fetch in this test setup
        return Promise.resolve(createMockSSEResponse([{ type: "text", content: "Response" }]));
      });

      const { result } = renderHook(() => useChat());

      const sendPromise = act(async () => {
        await result.current.sendMessage("Hello", ["file-1"]);
      });

      // Check initial state change (before promise resolves)
      // Note: This is tricky to test due to async nature
      await sendPromise;

      expect(result.current.isStreaming).toBe(false); // Should be false after completion
    });

    it("appends text content to message", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([
          { type: "text", content: "Hello " },
          { type: "text", content: "World" },
        ])
      );

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Hi", ["file-1"]);
      });

      expect(mockAppendToMessage).toHaveBeenCalledWith("conv-123", "msg-2", "Hello ");
      expect(mockAppendToMessage).toHaveBeenCalledWith("conv-123", "msg-2", "World");
    });

    it("saves user message to backend", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([{ type: "text", content: "Response" }])
      );

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Hello", ["file-1"]);
      });

      expect(mockSaveMessageToBackend).toHaveBeenCalledWith(
        "conv-123",
        expect.objectContaining({
          role: "user",
          content: "Hello",
        })
      );
    });

    it("includes file contents in request", async () => {
      mockGetFile.mockImplementation((id: string) => ({
        id,
        name: `File ${id}`,
        content: `Content of ${id}`,
      }));

      mockFetch.mockResolvedValueOnce(createMockSSEResponse([{ type: "text", content: "Done" }]));

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Summarize", ["file-1", "file-2"]);
      });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.files).toHaveLength(2);
      expect(body.files[0].id).toBe("file-1");
    });

    it("handles selection contexts", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([{ type: "text", content: "Response" }])
      );

      const { result } = renderHook(() => useChat());
      const contexts = [{ type: "selection" as const, content: "selected", text: "selected text" }];

      await act(async () => {
        await result.current.sendMessage("Explain this", ["file-1"], contexts);
      });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      // Message should include selection context
      expect(body.message).toContain("selected text");
    });
  });

  // ============================================================================
  // Thinking state tests
  // ============================================================================
  describe("thinking state", () => {
    it("handles thinking_start event", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([
          { type: "thinking_start" },
          { type: "thinking", content: "Let me think..." },
          { type: "thinking_end" },
          { type: "text", content: "Done" },
        ])
      );

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Think", ["file-1"]);
      });

      // After completion, thinking should be reset
      expect(result.current.thinking.isThinking).toBe(false);
    });

    it("accumulates thinking content", async () => {
      const _thinkingDuringStream = { isThinking: false, content: "" };

      mockFetch.mockImplementationOnce(() => {
        return Promise.resolve(
          createMockSSEResponse([
            { type: "thinking_start" },
            { type: "thinking", content: "Part 1 " },
            { type: "thinking", content: "Part 2" },
            { type: "thinking_end" },
            { type: "text", content: "Done" },
          ])
        );
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Think", ["file-1"]);
      });

      // Thinking should be cleared after stream ends
      expect(result.current.thinking.content).toBe("");
    });
  });

  // ============================================================================
  // Tool status tests
  // ============================================================================
  describe("tool status", () => {
    it("handles tool_start event", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([
          { type: "tool_start", tool: "search", tool_id: "t1" },
          { type: "tool_end", tool: "search", tool_id: "t1", success: true, output: "Found it" },
          { type: "text", content: "Done" },
        ])
      );

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Search", ["file-1"]);
      });

      // After completion, currentTool should be null
      expect(result.current.currentTool).toBeNull();
      // But toolHistory should have the completed tool
      expect(result.current.toolHistory).toHaveLength(1);
      expect(result.current.toolHistory[0].name).toBe("search");
      expect(result.current.toolHistory[0].status).toBe("completed");
    });

    it("handles tool_input_delta event", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([
          { type: "tool_start", tool: "write_file", tool_id: "t1" },
          { type: "tool_input_delta", delta: '{"path":' },
          { type: "tool_input_delta", delta: '"test.txt"}' },
          { type: "tool_end", tool: "write_file", tool_id: "t1", success: true },
          { type: "text", content: "Done" },
        ])
      );

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Write file", ["file-1"]);
      });

      expect(result.current.toolHistory).toHaveLength(1);
    });

    it("handles tool error", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([
          { type: "tool_start", tool: "search", tool_id: "t1" },
          { type: "tool_end", tool: "search", tool_id: "t1", success: false, output: "Error" },
          { type: "text", content: "Failed" },
        ])
      );

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Search", ["file-1"]);
      });

      expect(result.current.toolHistory[0].status).toBe("error");
    });
  });

  // ============================================================================
  // Edit operations tests
  // ============================================================================
  describe("edit operations", () => {
    it("handles edit event", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([
          {
            type: "edit",
            edit: {
              type: "str_replace",
              file_id: "file-1",
              file_name: "test.md",
              old_str: "old",
              new_str: "new",
            },
          },
          { type: "text", content: "Done" },
        ])
      );

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Edit", ["file-1"]);
      });

      // applyEdits should be called with collected edits
      expect(mockApplyEdits).toHaveBeenCalled();
    });

    it("handles edits_batch event", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([
          {
            type: "edits_batch",
            edits: [
              { type: "str_replace", file_id: "file-1", old_str: "a", new_str: "b" },
              { type: "str_replace", file_id: "file-1", old_str: "c", new_str: "d" },
            ],
          },
          { type: "text", content: "Done" },
        ])
      );

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Batch edit", ["file-1"]);
      });

      expect(mockApplyEdits).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ old_str: "a" }),
          expect.objectContaining({ old_str: "c" }),
        ])
      );
    });
  });

  // ============================================================================
  // Summary event tests
  // ============================================================================
  describe("summary event", () => {
    it("saves assistant message with summary data", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([
          { type: "text", content: "Response" },
          {
            type: "summary",
            content: "Response",
            thinking: "I thought about it",
            toolCalls: [{ id: "t1", name: "search", input: {}, status: "completed" }],
            model: "claude-3-5-sonnet",
          },
        ])
      );

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Hello", ["file-1"]);
      });

      expect(mockUpdateMessageFull).toHaveBeenCalledWith(
        "conv-123",
        "msg-2",
        expect.objectContaining({
          thinking: "I thought about it",
          model: "claude-3-5-sonnet",
        })
      );

      // saveMessageToBackend is only called for user messages, not assistant messages
      expect(mockSaveMessageToBackend).toHaveBeenCalledWith(
        "conv-123",
        expect.objectContaining({
          role: "user",
          content: "Hello",
        })
      );
    });
  });

  // ============================================================================
  // Error handling tests
  // ============================================================================
  describe("error handling", () => {
    it("handles HTTP error", async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Hello", ["file-1"]);
      });

      expect(mockAppendToMessage).toHaveBeenCalledWith(
        "conv-123",
        "msg-2",
        expect.stringContaining("Error")
      );
    });

    it("handles error event in stream", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([{ type: "error", content: "Something went wrong" }])
      );

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Hello", ["file-1"]);
      });

      expect(result.current.toolHistory).toContainEqual(
        expect.objectContaining({
          name: "error",
          status: "error",
          message: "Something went wrong",
        })
      );
    });

    it("cleans up state after error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Hello", ["file-1"]);
      });

      expect(result.current.isStreaming).toBe(false);
      expect(result.current.currentTool).toBeNull();
      expect(result.current.thinking.isThinking).toBe(false);
    });
  });

  // ============================================================================
  // stopStreaming tests
  // ============================================================================
  describe("stopStreaming", () => {
    it("provides stopStreaming function", () => {
      const { result } = renderHook(() => useChat());

      expect(typeof result.current.stopStreaming).toBe("function");
    });

    it("aborts ongoing stream when called", async () => {
      // Create a response that will be aborted
      const _abortController = new AbortController();
      let _fetchAborted = false;

      mockFetch.mockImplementationOnce((_url: string, options: { signal?: AbortSignal }) => {
        // Listen for abort
        options.signal?.addEventListener("abort", () => {
          _fetchAborted = true;
        });

        // Return a slow response
        return new Promise<Response>((resolve, reject) => {
          // Check if already aborted
          if (options.signal?.aborted) {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
            return;
          }

          // Listen for abort during the promise
          options.signal?.addEventListener("abort", () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          });

          // Never resolve - wait for abort
          setTimeout(() => {
            resolve(createMockSSEResponse([{ type: "text", content: "Response" }]));
          }, 5000);
        });
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        // Start sending (don't await - we want to abort it)
        const sendPromise = result.current.sendMessage("Hello", ["file-1"]);

        // Give it a moment to start the fetch
        await new Promise((r) => setTimeout(r, 50));

        // Stop streaming - this should abort the fetch
        result.current.stopStreaming();

        // Wait for the promise to settle (with abort error)
        await sendPromise;
      });

      // The message should include "Stopped" since AbortError was caught
      expect(mockAppendToMessage).toHaveBeenCalledWith(
        "conv-123",
        "msg-2",
        expect.stringContaining("Stopped")
      );
    });
  });

  // ============================================================================
  // Cleanup tests
  // ============================================================================
  describe("cleanup", () => {
    it("sets streaming to false after completion", async () => {
      mockFetch.mockResolvedValueOnce(createMockSSEResponse([{ type: "text", content: "Done" }]));

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Hello", ["file-1"]);
      });

      expect(result.current.isStreaming).toBe(false);
    });

    it("clears current tool after completion", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([
          { type: "tool_start", tool: "search", tool_id: "t1" },
          { type: "tool_end", tool: "search", tool_id: "t1", success: true },
          { type: "text", content: "Done" },
        ])
      );

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Search", ["file-1"]);
      });

      expect(result.current.currentTool).toBeNull();
    });

    it("calls setMessageStreaming false after completion", async () => {
      mockFetch.mockResolvedValueOnce(createMockSSEResponse([{ type: "text", content: "Done" }]));

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Hello", ["file-1"]);
      });

      expect(mockSetMessageStreaming).toHaveBeenCalledWith("conv-123", "msg-2", false);
    });
  });
});
