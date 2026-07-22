import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAppUpdate, type AppUpdateState } from "@/hooks/use-app-update";
import type { DesktopBridge, DesktopEvent } from "@/lib/native-shell";

const idleState: AppUpdateState = {
  status: "idle",
  currentVersion: "1.8.0",
  availableVersion: null,
  error: null,
  lastCheckedAt: null,
};

describe("useAppUpdate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("seeds and follows update state through the Electron preload bridge", async () => {
    let listener: ((event: DesktopEvent<AppUpdateState>) => void) | null = null;
    const unlisten = vi.fn();
    const invoke = vi.fn(async (command: string) => {
      if (command === "update_get_state") return idleState;
      return undefined;
    });
    const listen = vi.fn(
      (_event: string, callback: (event: DesktopEvent<AppUpdateState>) => void) => {
        listener = callback;
        return unlisten;
      }
    );
    const bridge: DesktopBridge = {
      platform: "macos",
      invoke: invoke as DesktopBridge["invoke"],
      listen: listen as DesktopBridge["listen"],
      getPathForFile: vi.fn(() => null),
    };
    vi.stubGlobal("__DOXMIND_DESKTOP__", bridge);

    const { result, unmount } = renderHook(() => useAppUpdate());

    await waitFor(() => expect(result.current.state).toEqual(idleState));
    expect(listen).toHaveBeenCalledWith("os://update-state", expect.any(Function));

    const downloaded: AppUpdateState = {
      ...idleState,
      status: "downloaded",
      availableVersion: "1.8.1",
    };
    act(() => listener?.({ event: "os://update-state", payload: downloaded }));
    expect(result.current.state).toEqual(downloaded);

    await act(async () => {
      await result.current.checkForUpdates();
      await result.current.restartToUpdate();
    });
    expect(invoke).toHaveBeenCalledWith("update_check");
    expect(invoke).toHaveBeenCalledWith("update_restart");

    unmount();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("stays unsupported without the Electron preload bridge", () => {
    const { result } = renderHook(() => useAppUpdate());

    expect(result.current.state.status).toBe("unsupported");
  });
});
