"use client";

import { hasDesktopBridge, invokeDesktop, listenDesktop } from "@/lib/native-shell";

async function waitForSaveDecision(
  flush: () => Promise<boolean> | boolean,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (saved: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(saved);
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    Promise.resolve()
      .then(flush)
      .then((saved) => finish(saved === true))
      .catch((error) => {
        console.error("[shell/close] failed to save before close", error);
        finish(false);
      });
  });
}

/** Register Electron's flush-before-close handshake. No-op in browser dev. */
export async function onShellCloseRequested(
  flush: () => Promise<boolean> | boolean,
  timeoutMs = 1500
): Promise<() => void> {
  if (!hasDesktopBridge()) return () => {};

  return listenDesktop("shell://close-requested", () => {
    void (async () => {
      try {
        if (await waitForSaveDecision(flush, timeoutMs)) {
          await invokeDesktop("shell_close_window");
        } else {
          await invokeDesktop("shell_cancel_close");
        }
      } catch (error) {
        console.error("[shell/close] failed to finish close handshake", error);
        await invokeDesktop("shell_cancel_close");
      }
    })();
  });
}
