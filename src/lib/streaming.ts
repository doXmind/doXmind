/**
 * Streaming Utilities
 *
 * Common utilities for handling Server-Sent Events (SSE) streaming responses.
 */

/**
 * Options for streaming request
 */
export interface StreamingRequestOptions {
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Callback for handling parsed SSE events
 */
export type SSEEventHandler<T = unknown> = (event: T) => void;

/**
 * Parse a single SSE line and return the data if valid
 * @param line - Raw SSE line (e.g., "data: {...}")
 * @returns Parsed data or null if not a valid data line
 */
export function parseSSELine<T = unknown>(line: string): T | null {
  if (!line.startsWith("data: ")) {
    return null;
  }

  const data = line.slice(6); // Remove "data: " prefix

  // Check for stream end marker
  if (data === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(data) as T;
  } catch {
    // Not valid JSON, return null
    return null;
  }
}

/**
 * Process a streaming response and call handler for each parsed event
 *
 * @param response - Fetch Response object
 * @param onEvent - Callback for each parsed event
 * @param onDone - Optional callback when stream ends
 * @returns Promise that resolves when stream is complete
 */
export async function processSSEStream<T = unknown>(
  response: Response,
  onEvent: SSEEventHandler<T>,
  onDone?: () => void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const parsed = parseSSELine<T>(line);
        if (parsed !== null) {
          onEvent(parsed);
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      const parsed = parseSSELine<T>(buffer);
      if (parsed !== null) {
        onEvent(parsed);
      }
    }
  } finally {
    onDone?.();
  }
}

/**
 * Make a streaming request and process SSE events
 *
 * @param options - Request options
 * @param onEvent - Callback for each parsed event
 * @param onDone - Optional callback when stream ends
 * @returns Promise that resolves when stream is complete
 */
export async function streamingFetch<T = unknown>(
  options: StreamingRequestOptions,
  onEvent: SSEEventHandler<T>,
  onDone?: () => void
): Promise<void> {
  const { url, method = "POST", body, signal, headers = {} } = options;

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return processSSEStream(response, onEvent, onDone);
}

/**
 * Create an AbortController helper for managing streaming requests
 */
export function createStreamController() {
  let controller: AbortController | null = null;

  return {
    /** Start a new stream (aborts any existing one) */
    start(): AbortSignal {
      if (controller) {
        controller.abort();
      }
      controller = new AbortController();
      return controller.signal;
    },

    /** Abort the current stream */
    abort(): void {
      controller?.abort();
      controller = null;
    },

    /** Check if a stream is active */
    get isActive(): boolean {
      return controller !== null && !controller.signal.aborted;
    },

    /** Get the current signal (or undefined if none) */
    get signal(): AbortSignal | undefined {
      return controller?.signal;
    },
  };
}

/**
 * Type guard to check if an error is an AbortError
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Accumulator for text chunks from streaming responses
 * Useful for building up full text content from streaming deltas
 */
export class TextAccumulator {
  private _text = "";

  /** Append text to the accumulator */
  append(chunk: string): void {
    this._text += chunk;
  }

  /** Get the accumulated text */
  get text(): string {
    return this._text;
  }

  /** Reset the accumulator */
  reset(): void {
    this._text = "";
  }

  /** Get length of accumulated text */
  get length(): number {
    return this._text.length;
  }
}
