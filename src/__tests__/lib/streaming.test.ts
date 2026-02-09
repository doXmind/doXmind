/**
 * Tests for streaming utilities
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseSSELine,
  processSSEStream,
  streamingFetch,
  createStreamController,
  isAbortError,
  TextAccumulator,
} from "@/lib/streaming";

// Helper to create a mock ReadableStream from string data
function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

// Helper to create a mock Response with SSE stream
function createMockSSEResponse(
  events: object[],
  options: { includeNonDataLines?: boolean; includeDoneMarker?: boolean } = {}
): Response {
  const { includeNonDataLines = false, includeDoneMarker = true } = options;

  const lines: string[] = [];

  if (includeNonDataLines) {
    lines.push(": keep-alive\n");
    lines.push("event: message\n");
  }

  for (const event of events) {
    lines.push(`data: ${JSON.stringify(event)}\n\n`);
  }

  if (includeDoneMarker) {
    lines.push("data: [DONE]\n\n");
  }

  const stream = createMockStream([lines.join("")]);

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("streaming", () => {
  // ============================================================================
  // parseSSELine tests
  // ============================================================================
  describe("parseSSELine", () => {
    it("parses valid SSE data line with JSON object", () => {
      const result = parseSSELine<{ type: string; content: string }>(
        'data: {"type":"text","content":"Hello"}'
      );
      expect(result).toEqual({ type: "text", content: "Hello" });
    });

    it("parses valid SSE data line with JSON array", () => {
      const result = parseSSELine<number[]>("data: [1,2,3]");
      expect(result).toEqual([1, 2, 3]);
    });

    it("parses valid SSE data line with primitive values", () => {
      expect(parseSSELine<string>('data: "hello"')).toBe("hello");
      expect(parseSSELine<number>("data: 42")).toBe(42);
      expect(parseSSELine<boolean>("data: true")).toBe(true);
      expect(parseSSELine<null>("data: null")).toBe(null);
    });

    it("returns null for non-data lines", () => {
      expect(parseSSELine(": keep-alive")).toBeNull();
      expect(parseSSELine("event: message")).toBeNull();
      expect(parseSSELine("id: 123")).toBeNull();
      expect(parseSSELine("retry: 1000")).toBeNull();
      expect(parseSSELine("")).toBeNull();
    });

    it("returns null for [DONE] marker", () => {
      expect(parseSSELine("data: [DONE]")).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      expect(parseSSELine("data: {invalid json}")).toBeNull();
      expect(parseSSELine("data: not json at all")).toBeNull();
      expect(parseSSELine('data: {"unclosed": ')).toBeNull();
    });

    it("handles data lines with extra whitespace correctly", () => {
      // Note: parseSSELine slices after "data: " (6 chars), so 'data:  {"type":"test"}'
      // becomes ' {"type":"test"}' which JSON.parse handles (leading space is OK)
      const result = parseSSELine('data:  {"type":"test"}');
      // JSON.parse tolerates leading whitespace
      expect(result).toEqual({ type: "test" });
    });

    it("handles empty data line", () => {
      expect(parseSSELine("data: ")).toBeNull(); // empty string is not valid JSON
    });

    it("handles nested JSON objects", () => {
      const result = parseSSELine<{ outer: { inner: string } }>(
        'data: {"outer":{"inner":"value"}}'
      );
      expect(result).toEqual({ outer: { inner: "value" } });
    });

    it("handles JSON with special characters", () => {
      const result = parseSSELine<{ text: string }>(
        'data: {"text":"Hello\\nWorld\\t\\"quoted\\""}'
      );
      expect(result).toEqual({ text: 'Hello\nWorld\t"quoted"' });
    });

    it("handles unicode in JSON", () => {
      const result = parseSSELine<{ text: string }>('data: {"text":"你好世界"}');
      expect(result).toEqual({ text: "你好世界" });
    });
  });

  // ============================================================================
  // processSSEStream tests
  // ============================================================================
  describe("processSSEStream", () => {
    it("processes stream events correctly", async () => {
      const events = [
        { type: "text", content: "Hello" },
        { type: "text", content: " World" },
      ];
      const response = createMockSSEResponse(events);

      const received: object[] = [];
      const onEvent = vi.fn((event: object) => received.push(event));
      const onDone = vi.fn();

      await processSSEStream(response, onEvent, onDone);

      expect(onEvent).toHaveBeenCalledTimes(2);
      expect(received).toEqual(events);
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("handles empty stream", async () => {
      const response = new Response(createMockStream([""]), {
        status: 200,
      });

      const onEvent = vi.fn();
      const onDone = vi.fn();

      await processSSEStream(response, onEvent, onDone);

      expect(onEvent).not.toHaveBeenCalled();
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("handles chunked data across multiple reads", async () => {
      // Simulate data split across chunks
      const chunks = [
        'data: {"type":"t',
        'ext","content":"Hel',
        'lo"}\n\ndata: {"type":"text","content":" World"}\n\n',
      ];
      const stream = createMockStream(chunks);
      const response = new Response(stream, { status: 200 });

      const received: object[] = [];
      await processSSEStream(response, (event) => received.push(event as object));

      expect(received).toEqual([
        { type: "text", content: "Hello" },
        { type: "text", content: " World" },
      ]);
    });

    it("ignores non-data lines like comments and event types", async () => {
      const events = [{ type: "text", content: "Hello" }];
      const response = createMockSSEResponse(events, { includeNonDataLines: true });

      const received: object[] = [];
      await processSSEStream(response, (event) => received.push(event as object));

      expect(received).toEqual(events);
    });

    it("stops processing at [DONE] marker", async () => {
      const events = [{ type: "text", content: "Hello" }];
      const response = createMockSSEResponse(events, { includeDoneMarker: true });

      const onEvent = vi.fn();
      await processSSEStream(response, onEvent);

      expect(onEvent).toHaveBeenCalledTimes(1);
    });

    it("throws error when response has no body", async () => {
      const response = new Response(null);

      await expect(processSSEStream(response, vi.fn())).rejects.toThrow("No response body");
    });

    it("calls onDone even if stream processing fails", async () => {
      // Create a stream that will error
      const errorStream = new ReadableStream({
        start(controller) {
          controller.error(new Error("Stream error"));
        },
      });
      const response = new Response(errorStream, { status: 200 });

      const onDone = vi.fn();

      await expect(processSSEStream(response, vi.fn(), onDone)).rejects.toThrow("Stream error");

      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("processes remaining buffer after stream ends", async () => {
      // Stream that ends without newline
      const chunks = ['data: {"final":"event"}'];
      const stream = createMockStream(chunks);
      const response = new Response(stream, { status: 200 });

      const received: object[] = [];
      await processSSEStream(response, (event) => received.push(event as object));

      expect(received).toEqual([{ final: "event" }]);
    });
  });

  // ============================================================================
  // streamingFetch tests
  // ============================================================================
  describe("streamingFetch", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      vi.resetAllMocks();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("makes POST request with JSON body by default", async () => {
      const mockResponse = createMockSSEResponse([{ type: "test" }]);
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      await streamingFetch(
        { url: "https://api.test.com/chat", body: { message: "Hello" } },
        vi.fn()
      );

      expect(global.fetch).toHaveBeenCalledWith("https://api.test.com/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: '{"message":"Hello"}',
        signal: undefined,
      });
    });

    it("supports GET method", async () => {
      const mockResponse = createMockSSEResponse([{ type: "test" }]);
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      await streamingFetch({ url: "https://api.test.com/stream", method: "GET" }, vi.fn());

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.test.com/stream",
        expect.objectContaining({ method: "GET", body: undefined })
      );
    });

    it("passes custom headers", async () => {
      const mockResponse = createMockSSEResponse([{ type: "test" }]);
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      await streamingFetch(
        {
          url: "https://api.test.com/chat",
          headers: { Authorization: "Bearer token123" },
        },
        vi.fn()
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer token123",
          },
        })
      );
    });

    it("passes abort signal", async () => {
      const mockResponse = createMockSSEResponse([{ type: "test" }]);
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const controller = new AbortController();

      await streamingFetch(
        { url: "https://api.test.com/chat", signal: controller.signal },
        vi.fn()
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal })
      );
    });

    it("throws error for non-OK response", async () => {
      const mockResponse = new Response("Not Found", {
        status: 404,
        statusText: "Not Found",
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      await expect(streamingFetch({ url: "https://api.test.com/chat" }, vi.fn())).rejects.toThrow(
        "HTTP 404: Not Found"
      );
    });

    it("throws error for server error response", async () => {
      const mockResponse = new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      await expect(streamingFetch({ url: "https://api.test.com/chat" }, vi.fn())).rejects.toThrow(
        "HTTP 500: Internal Server Error"
      );
    });

    it("processes events and calls onDone", async () => {
      const events = [{ type: "text" }, { type: "done" }];
      const mockResponse = createMockSSEResponse(events);
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const onEvent = vi.fn();
      const onDone = vi.fn();

      await streamingFetch({ url: "https://api.test.com/chat" }, onEvent, onDone);

      expect(onEvent).toHaveBeenCalledTimes(2);
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // createStreamController tests
  // ============================================================================
  describe("createStreamController", () => {
    it("creates abort signal on start", () => {
      const controller = createStreamController();

      expect(controller.isActive).toBe(false);
      expect(controller.signal).toBeUndefined();

      const signal = controller.start();

      expect(signal).toBeInstanceOf(AbortSignal);
      expect(controller.isActive).toBe(true);
      expect(controller.signal).toBe(signal);
    });

    it("aborts previous stream when starting new one", () => {
      const controller = createStreamController();

      const signal1 = controller.start();
      expect(signal1.aborted).toBe(false);

      const signal2 = controller.start();

      expect(signal1.aborted).toBe(true);
      expect(signal2.aborted).toBe(false);
      expect(controller.signal).toBe(signal2);
    });

    it("abort method stops current stream", () => {
      const controller = createStreamController();

      const signal = controller.start();
      expect(controller.isActive).toBe(true);

      controller.abort();

      expect(signal.aborted).toBe(true);
      expect(controller.isActive).toBe(false);
      expect(controller.signal).toBeUndefined();
    });

    it("abort is safe to call multiple times", () => {
      const controller = createStreamController();

      controller.start();
      controller.abort();
      controller.abort(); // Should not throw
      controller.abort();

      expect(controller.isActive).toBe(false);
    });

    it("abort is safe to call without start", () => {
      const controller = createStreamController();

      // Should not throw
      expect(() => controller.abort()).not.toThrow();
      expect(controller.isActive).toBe(false);
    });

    it("isActive reflects correct state after multiple operations", () => {
      const controller = createStreamController();

      expect(controller.isActive).toBe(false);

      controller.start();
      expect(controller.isActive).toBe(true);

      controller.start();
      expect(controller.isActive).toBe(true);

      controller.abort();
      expect(controller.isActive).toBe(false);

      controller.start();
      expect(controller.isActive).toBe(true);
    });

    it("signal property returns undefined after abort", () => {
      const controller = createStreamController();

      controller.start();
      expect(controller.signal).toBeDefined();

      controller.abort();
      expect(controller.signal).toBeUndefined();
    });
  });

  // ============================================================================
  // isAbortError tests
  // ============================================================================
  describe("isAbortError", () => {
    it("returns true for AbortError", () => {
      // DOMException may not inherit from Error in all environments,
      // but Error with name "AbortError" should work
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      expect(isAbortError(error)).toBe(true);
    });

    it("returns true for Error with name AbortError", () => {
      const error = new Error("Aborted");
      error.name = "AbortError";
      expect(isAbortError(error)).toBe(true);
    });

    it("returns false for other Error types", () => {
      expect(isAbortError(new Error("Regular error"))).toBe(false);
      expect(isAbortError(new TypeError("Type error"))).toBe(false);
      expect(isAbortError(new RangeError("Range error"))).toBe(false);
    });

    it("returns false for non-Error values", () => {
      expect(isAbortError(null)).toBe(false);
      expect(isAbortError(undefined)).toBe(false);
      expect(isAbortError("error string")).toBe(false);
      expect(isAbortError({ name: "AbortError" })).toBe(false);
      expect(isAbortError(42)).toBe(false);
    });
  });

  // ============================================================================
  // TextAccumulator tests
  // ============================================================================
  describe("TextAccumulator", () => {
    it("starts with empty text", () => {
      const accumulator = new TextAccumulator();
      expect(accumulator.text).toBe("");
      expect(accumulator.length).toBe(0);
    });

    it("appends text correctly", () => {
      const accumulator = new TextAccumulator();

      accumulator.append("Hello");
      expect(accumulator.text).toBe("Hello");
      expect(accumulator.length).toBe(5);

      accumulator.append(" World");
      expect(accumulator.text).toBe("Hello World");
      expect(accumulator.length).toBe(11);
    });

    it("resets text to empty", () => {
      const accumulator = new TextAccumulator();

      accumulator.append("Some text");
      expect(accumulator.text).toBe("Some text");

      accumulator.reset();
      expect(accumulator.text).toBe("");
      expect(accumulator.length).toBe(0);
    });

    it("handles empty appends", () => {
      const accumulator = new TextAccumulator();

      accumulator.append("");
      expect(accumulator.text).toBe("");
      expect(accumulator.length).toBe(0);

      accumulator.append("text");
      accumulator.append("");
      expect(accumulator.text).toBe("text");
    });

    it("handles unicode text", () => {
      const accumulator = new TextAccumulator();

      accumulator.append("你好");
      accumulator.append("世界");
      expect(accumulator.text).toBe("你好世界");
      expect(accumulator.length).toBe(4);
    });

    it("handles special characters", () => {
      const accumulator = new TextAccumulator();

      accumulator.append("Line 1\n");
      accumulator.append("Line 2\t");
      accumulator.append('"quoted"');

      expect(accumulator.text).toBe('Line 1\nLine 2\t"quoted"');
    });

    it("can be used for streaming text accumulation", () => {
      const accumulator = new TextAccumulator();

      // Simulate streaming text chunks
      const chunks = ["The ", "quick ", "brown ", "fox"];
      for (const chunk of chunks) {
        accumulator.append(chunk);
      }

      expect(accumulator.text).toBe("The quick brown fox");
    });

    it("reset allows reuse", () => {
      const accumulator = new TextAccumulator();

      accumulator.append("First message");
      expect(accumulator.text).toBe("First message");

      accumulator.reset();
      accumulator.append("Second message");
      expect(accumulator.text).toBe("Second message");
    });
  });
});
