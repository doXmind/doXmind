import { afterEach, describe, expect, it, vi } from "vitest";

import { onShellCloseRequested } from "@/lib/shell/close";
import type { DesktopEvent } from "@/lib/native-shell";

function installBridge() {
  const invoke = vi.fn().mockResolvedValue(undefined);
  let closeRequested: ((event: DesktopEvent<unknown>) => void) | undefined;
  const unlisten = vi.fn();
  vi.stubGlobal("__DOXMIND_DESKTOP__", {
    platform: "macos",
    invoke,
    listen: vi.fn((name: string, callback: (event: DesktopEvent<unknown>) => void) => {
      if (name === "shell://close-requested") closeRequested = callback;
      return unlisten;
    }),
    getPathForFile: vi.fn(() => null),
  });
  return {
    invoke,
    unlisten,
    requestClose: () => closeRequested?.({ event: "shell://close-requested", payload: null }),
  };
}

describe("onShellCloseRequested", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("flushes the Page before allowing Electron to close", async () => {
    const bridge = installBridge();
    const flush = vi.fn(async () => true);
    const unlisten = await onShellCloseRequested(flush);

    bridge.requestClose();
    await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith("shell_close_window", {}));
    expect(flush).toHaveBeenCalledOnce();
    unlisten();
    expect(bridge.unlisten).toHaveBeenCalledOnce();
  });

  it("keeps the window open when saving is refused", async () => {
    const bridge = installBridge();
    await onShellCloseRequested(async () => false);
    bridge.requestClose();

    await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith("shell_cancel_close", {}));
    expect(bridge.invoke).not.toHaveBeenCalledWith("shell_close_window", {});
  });

  it("keeps the window open when saving fails", async () => {
    const bridge = installBridge();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await onShellCloseRequested(async () => {
      throw new Error("disk full");
    });
    bridge.requestClose();

    await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith("shell_cancel_close", {}));
  });

  it("keeps the window open when saving times out", async () => {
    vi.useFakeTimers();
    const bridge = installBridge();
    await onShellCloseRequested(() => new Promise<boolean>(() => {}));
    bridge.requestClose();
    await vi.advanceTimersByTimeAsync(1600);

    expect(bridge.invoke).toHaveBeenCalledWith("shell_cancel_close", {});
    expect(bridge.invoke).not.toHaveBeenCalledWith("shell_close_window", {});
  });
});
