/**
 * Error Handling Utilities
 *
 * Centralized error handling for consistent error management across the app.
 */

import { logger } from "./logger";

/**
 * Custom application error with additional context
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * API error for HTTP request failures
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Network error for connection issues
 */
export class NetworkError extends Error {
  constructor(message: string = "Network connection failed") {
    super(message);
    this.name = "NetworkError";
  }
}

/**
 * Type guard for AbortError
 */
export function isAbortError(error: unknown): error is DOMException {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Type guard for ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Type guard for NetworkError
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

/**
 * Extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unknown error occurred";
}

/**
 * Safe error handler that logs and optionally rethrows
 *
 * @param error - The error to handle
 * @param context - Additional context for logging
 * @param options - Handler options
 */
export function handleError(
  error: unknown,
  context: string,
  options: {
    rethrow?: boolean;
    silent?: boolean;
    onError?: (error: unknown) => void;
  } = {}
): void {
  const { rethrow = false, silent = false, onError } = options;

  // Skip logging for abort errors (user-initiated cancellations)
  if (isAbortError(error)) {
    return;
  }

  if (!silent) {
    logger.error(`[${context}] Error`, error);
  }

  if (onError) {
    onError(error);
  }

  if (rethrow) {
    throw error;
  }
}

/**
 * Wrap an async function with error handling
 */
export function withErrorHandling<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  context: string,
  options?: Parameters<typeof handleError>[2]
): (...args: T) => Promise<R | undefined> {
  return async (...args: T): Promise<R | undefined> => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error, context, options);
      return undefined;
    }
  };
}

/**
 * Create a safe fetch wrapper that handles common errors
 */
export async function safeFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new ApiError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        url
      );
    }

    return response;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new NetworkError("Failed to connect to server");
    }

    throw error;
  }
}
