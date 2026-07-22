import { afterEach, describe, expect, it, vi } from "vitest";

import { hasDesktopBridge, invokeDesktop } from "@/lib/native-shell";
import { isNativeDialogAvailable } from "@/lib/native-dialog";

describe("Electron desktop bridge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("detects the context-isolated preload Interface", async () => {
    const invoke = vi.fn().mockResolvedValue("ok");
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke,
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });

    expect(hasDesktopBridge()).toBe(true);
    expect(isNativeDialogAvailable()).toBe(true);
    await expect(invokeDesktop("test_command", { value: 1 })).resolves.toBe("ok");
    expect(invoke).toHaveBeenCalledWith("test_command", { value: 1 });
  });

  it("does not mistake a plain browser for the Electron bridge", () => {
    expect(hasDesktopBridge()).toBe(false);
    expect(isNativeDialogAvailable()).toBe(false);
  });
});
