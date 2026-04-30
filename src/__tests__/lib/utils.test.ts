import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cn, debounce, formatErrorForToast, getErrorMessage } from "@/lib/utils";

describe("cn", () => {
  it("merges conditional classes and resolves Tailwind conflicts", () => {
    expect(cn("px-2 py-1", false && "hidden", "px-4", { block: true })).toBe(
      "py-1 px-4 block"
    );
  });
});

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces rapid calls and passes the latest arguments", () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 100);

    debouncedFn("first");
    debouncedFn("second");
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith("second");
  });

  it("supports cancel and flush controls", () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 100);

    debouncedFn("cancelled");
    debouncedFn.cancel();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();

    debouncedFn("flushed");
    debouncedFn.flush();
    expect(fn).toHaveBeenCalledWith("flushed");
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("error formatting", () => {
  it("returns known friendly messages and preserves structured errors", () => {
    const structured = { title: "Custom", description: "Custom error" };

    expect(getErrorMessage("Failed to fetch").title).toBe("Connection Error");
    expect(getErrorMessage("401").title).toBe("Authentication Required");
    expect(getErrorMessage(structured)).toEqual(structured);
  });

  it("formats unknown errors for toast display", () => {
    expect(formatErrorForToast("Unknown issue")).toBe("Error: Unknown issue");
  });
});
