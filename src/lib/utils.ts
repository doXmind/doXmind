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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic function type requires any for proper inference
export function debounce<T extends (...args: any[]) => unknown>(
  fn: T,
  delay: number
): DebouncedFunction<T> {
  let timeoutId: NodeJS.Timeout;
  const debounced = (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timeoutId);
  return debounced;
}

export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * User-friendly error messages for common error scenarios
 */
const ERROR_MESSAGES: Record<string, { title: string; description: string }> = {
  // Network errors
  "Failed to fetch": {
    title: "Connection Error",
    description:
      "Unable to connect to the server. Please check your internet connection and try again.",
  },
  NetworkError: {
    title: "Network Error",
    description: "A network error occurred. Please check your connection and try again.",
  },
  "TypeError: Failed to fetch": {
    title: "Connection Error",
    description: "Unable to reach the server. Please check if the server is running.",
  },
  // Server errors
  "500": {
    title: "Server Error",
    description: "Something went wrong on our end. Please try again later.",
  },
  "503": {
    title: "Service Unavailable",
    description: "The service is temporarily unavailable. Please try again in a few moments.",
  },
  // Auth errors
  "401": {
    title: "Authentication Required",
    description: "Please sign in to continue.",
  },
  "403": {
    title: "Access Denied",
    description: "You don't have permission to perform this action.",
  },
  // File errors
  "File too large": {
    title: "File Too Large",
    description: "The file exceeds the maximum allowed size of 5MB.",
  },
  "Unsupported file type": {
    title: "Unsupported File",
    description: "This file type is not supported. Please use PDF, DOCX, or Markdown files.",
  },
  // AI errors
  "AI service unavailable": {
    title: "AI Service Unavailable",
    description:
      "The AI service is temporarily unavailable. Your document is safe, but AI features may not work.",
  },
  "Rate limit exceeded": {
    title: "Too Many Requests",
    description: "You've made too many requests. Please wait a moment before trying again.",
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
