import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHoverExpand } from "@/components/sidebar/use-hover-expand";

describe("useHoverExpand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onExpand once after the 500ms hover delay", () => {
    const onExpand = vi.fn();
    const { result } = renderHook(() => useHoverExpand(onExpand));

    act(() => {
      result.current.onFolderDragOver("folder-a");
    });
    expect(onExpand).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(onExpand).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onExpand).toHaveBeenCalledWith("folder-a");

    // Steady ticks past the threshold must not re-fire — once per hover.
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("cancels the timer when dragLeave fires before the delay elapses", () => {
    const onExpand = vi.fn();
    const { result } = renderHook(() => useHoverExpand(onExpand));

    act(() => {
      result.current.onFolderDragOver("folder-a");
    });

    act(() => {
      vi.advanceTimersByTime(300);
      result.current.onFolderDragLeave();
      vi.advanceTimersByTime(500);
    });

    expect(onExpand).not.toHaveBeenCalled();
  });

  it("resets the timer when the dragged-over folder changes mid-flight", () => {
    const onExpand = vi.fn();
    const { result } = renderHook(() => useHoverExpand(onExpand));

    // Hover folder A, then switch to folder B before A's 500ms elapses.
    act(() => {
      result.current.onFolderDragOver("folder-a");
      vi.advanceTimersByTime(300);
      result.current.onFolderDragOver("folder-b");
    });

    // Crossing 500ms-from-A-start must NOT fire A — the switch reset it.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onExpand).not.toHaveBeenCalled();

    // Only after a full 500ms from B's start does B's expand fire.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onExpand).toHaveBeenCalledWith("folder-b");
  });

  it("cancel() clears any pending timer (drop / dragEnd path)", () => {
    const onExpand = vi.fn();
    const { result } = renderHook(() => useHoverExpand(onExpand));

    act(() => {
      result.current.onFolderDragOver("folder-a");
      vi.advanceTimersByTime(400);
      result.current.cancel();
      vi.advanceTimersByTime(500);
    });

    expect(onExpand).not.toHaveBeenCalled();
  });

  it("does not reset the timer when the same folder is reported again", () => {
    const onExpand = vi.fn();
    const { result } = renderHook(() => useHoverExpand(onExpand));

    // Repeated dragover events on the same folder are normal — they fire
    // continuously while the cursor sits still. The timer must keep counting.
    act(() => {
      result.current.onFolderDragOver("folder-a");
      vi.advanceTimersByTime(300);
      result.current.onFolderDragOver("folder-a");
      result.current.onFolderDragOver("folder-a");
      vi.advanceTimersByTime(200);
    });

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onExpand).toHaveBeenCalledWith("folder-a");
  });

  it("clears any pending timer when the hook unmounts", () => {
    const onExpand = vi.fn();
    const { result, unmount } = renderHook(() => useHoverExpand(onExpand));

    act(() => {
      result.current.onFolderDragOver("folder-a");
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(onExpand).not.toHaveBeenCalled();
  });
});
