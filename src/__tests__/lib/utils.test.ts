import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cn,
  formatDate,
  formatTime,
  truncate,
  debounce,
  generateId,
  getErrorMessage,
  formatErrorForToast,
} from "@/lib/utils";

describe("cn (className utility)", () => {
  it("merges class names correctly", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("foo", false && "bar", "baz")).toBe("foo baz");
  });

  it("merges tailwind classes correctly", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("handles arrays", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("handles objects", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });
});

describe("formatDate", () => {
  it("formats Date object correctly", () => {
    const date = new Date("2024-01-15T12:00:00");
    const result = formatDate(date);
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/2024/);
  });

  it("formats date string correctly", () => {
    const result = formatDate("2024-06-20");
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/20/);
    expect(result).toMatch(/2024/);
  });
});

describe("formatTime", () => {
  it("formats time from Date object", () => {
    const date = new Date("2024-01-15T14:30:00");
    const result = formatTime(date);
    // Result should contain hour and minute
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it("formats time from string", () => {
    const result = formatTime("2024-01-15T09:15:00");
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("truncate", () => {
  it("returns original string if shorter than length", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates string and adds ellipsis", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
  });

  it("handles exact length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("handles empty string", () => {
    expect(truncate("", 5)).toBe("");
  });
});

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays function execution", () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 100);

    debouncedFn();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("only calls function once for multiple rapid calls", () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 100);

    debouncedFn();
    debouncedFn();
    debouncedFn();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("passes arguments correctly", () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 100);

    debouncedFn("arg1", "arg2");
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledWith("arg1", "arg2");
  });
});

describe("generateId", () => {
  it("generates a valid UUID", () => {
    const id = generateId();
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("generates unique IDs", () => {
    const ids = new Set([generateId(), generateId(), generateId()]);
    expect(ids.size).toBe(3);
  });
});

describe("getErrorMessage", () => {
  it("returns structured error if already formatted", () => {
    const error = { title: "Custom", description: "Custom error" };
    expect(getErrorMessage(error)).toEqual(error);
  });

  it("handles Error objects", () => {
    const error = new Error("Failed to fetch");
    const result = getErrorMessage(error);
    expect(result.title).toBe("Connection Error");
  });

  it("handles string errors", () => {
    const result = getErrorMessage("Rate limit exceeded");
    expect(result.title).toBe("Too Many Requests");
  });

  it("returns default message for unknown errors", () => {
    const result = getErrorMessage("Some random error");
    expect(result.title).toBe("Error");
    expect(result.description).toBe("Some random error");
  });

  it("handles 401 error", () => {
    const result = getErrorMessage("401");
    expect(result.title).toBe("Authentication Required");
  });

  it("handles 403 error", () => {
    const result = getErrorMessage("403");
    expect(result.title).toBe("Access Denied");
  });

  it("handles 500 error", () => {
    const result = getErrorMessage("500");
    expect(result.title).toBe("Server Error");
  });
});

describe("formatErrorForToast", () => {
  it("formats error for toast display", () => {
    const result = formatErrorForToast("Failed to fetch");
    expect(result).toBe(
      "Connection Error: Unable to connect to the server. Please check your internet connection and try again."
    );
  });

  it("handles unknown errors", () => {
    const result = formatErrorForToast("Unknown issue");
    expect(result).toBe("Error: Unknown issue");
  });
});
