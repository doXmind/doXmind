"use client";

/**
 * Register a flush-before-close handler that works across the desktop shell.
 *
 * Electron: the shell (main process) intercepts the window close, asks the
 * renderer to flush pending edits via the `shell://close-requested` event, we
 * run `flush`, then tell the shell to proceed (`shell_close_window`). The
 * shell enforces a max-wait timeout so a hung renderer can't block quit.
 *
 * Tauri (until the shell migration completes): nothing emits
 * `shell://close-requested`, so we also register the window's native
 * onCloseRequested flow — flush with a 1.5s cap, then destroy. Exactly one
 * of the two paths fires per shell; the other stays a dormant listener.
 *
 * No-op in browser dev.
 *
 * @returns an unlisten function.
 */
export async function onShellCloseRequested(
  flush: () => Promise<void> | void
): Promise<() => void> {
  if (typeof window === "undefined" || !("__TAURI_BACKEND_URL__" in window)) {
    return () => {};
  }
  const unlisteners: Array<() => void> = [];
  try {
    const [{ listen }, { invoke }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/core"),
    ]);
    unlisteners.push(
      await listen("shell://close-requested", async () => {
        try {
          await flush();
        } finally {
          await invoke("shell_close_window");
        }
      })
    );
  } catch {
    // browser dev or impersonation gap — nothing to unhook
  }
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    let closingAfterFlush = false;
    unlisteners.push(
      await appWindow.onCloseRequested(async (event) => {
        if (closingAfterFlush) return;
        closingAfterFlush = true;
        event.preventDefault();
        try {
          await Promise.race([
            flush(),
            new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
          ]);
        } catch (error) {
          console.error("[shell/close] failed to save before close", error);
        }
        await appWindow.destroy();
      })
    );
  } catch {
    // Electron impersonation does not implement the window plugin — fine,
    // the shell://close-requested path above handles close there.
  }
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}
