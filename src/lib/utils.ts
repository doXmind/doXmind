import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic function type requires any for proper inference
export interface DebouncedFunction<T extends (...args: any[]) => unknown> {
  (...args: Parameters<T>): void;
  cancel: () => void;
  flush: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic function type requires any for proper inference
export function debounce<T extends (...args: any[]) => unknown>(
  fn: T,
  delay: number
): DebouncedFunction<T> {
  let timeoutId: NodeJS.Timeout;
  let lastArgs: Parameters<T> | null = null;
  const debounced = (...args: Parameters<T>) => {
    lastArgs = args;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      lastArgs = null;
      fn(...args);
    }, delay);
  };
  debounced.cancel = () => {
    clearTimeout(timeoutId);
    lastArgs = null;
  };
  debounced.flush = () => {
    if (lastArgs !== null) {
      clearTimeout(timeoutId);
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };
  return debounced;
}

const ERROR_MESSAGES: Record<string, { title: string; description: string }> = {
  "Failed to fetch": {
    title: "Connection Error",
    description: "Unable to reach the local server. Please try again.",
  },
  NetworkError: {
    title: "Network Error",
    description: "A network error occurred. Please try again.",
  },
  "TypeError: Failed to fetch": {
    title: "Connection Error",
    description: "Unable to reach the local server. Please check if the backend is running.",
  },
  "500": {
    title: "Server Error",
    description: "Something went wrong. Please try again.",
  },
  "503": {
    title: "Service Unavailable",
    description: "The service is temporarily unavailable. Please try again in a few moments.",
  },
  "File too large": {
    title: "File Too Large",
    description: "The file exceeds the maximum allowed size.",
  },
  "Unsupported file type": {
    title: "Unsupported File",
    description: "This file type is not supported. Please use PDF, DOCX, XLSX, or Markdown files.",
  },
};

/**
 * Get a user-friendly error message from an error
 */
export function getErrorMessage(error: unknown): { title: string; description: string } {
  // If it's already a structured error message
  if (error && typeof error === "object" && "title" in error && "description" in error) {
    return error as { title: string; description: string };
  }

  // Get the error message string
  let errorMessage = "Unknown error";
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === "string") {
    errorMessage = error;
  }

  // Check for known error patterns
  for (const [pattern, message] of Object.entries(ERROR_MESSAGES)) {
    if (errorMessage.includes(pattern)) {
      return message;
    }
  }

  // Default fallback with the actual error message
  return {
    title: "Error",
    description: errorMessage || "An unexpected error occurred. Please try again.",
  };
}

/**
 * Format an error for display in toast notifications
 */
export function formatErrorForToast(error: unknown): string {
  const { title, description } = getErrorMessage(error);
  return `${title}: ${description}`;
}

/**
 * Detect if the current platform is macOS.
 * Safe to call on server (returns false).
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.platform.toUpperCase().indexOf("MAC") >= 0;
}

/** SHA-256 of arbitrary bytes, hex-encoded. Used to key parsed-document
 *  caches so an unchanged source file skips re-parsing. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Copy into a fresh ArrayBuffer so we always pass an `ArrayBuffer` (not a
  // `SharedArrayBuffer`) to subtle.digest, which TS now distinguishes.
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Format a keyboard shortcut for the current platform.
 * Converts "Ctrl" to "⌘" on macOS, "Alt" to "⌥", "Shift" to "⇧".
 * Example: formatShortcut("Ctrl+K") → "⌘K" on Mac, "Ctrl+K" on Windows
 */
export function formatShortcut(shortcut: string): string {
  const mac = isMacPlatform();
  if (!mac) return shortcut;
  return shortcut
    .replace(/Ctrl\+/g, "⌘")
    .replace(/Alt\+/g, "⌥")
    .replace(/Shift\+/g, "⇧");
}
