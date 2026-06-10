"use client";

/**
 * Register a flush-before-close handler that works across the desktop shell.
 *
 * The shell (Electron main) intercepts the window close, asks the renderer to
 * flush pending edits via the `shell://close-requested` event, we run `flush`,
 * then tell the shell to proceed (`shell_close_window`). The shell enforces a
 * max-wait timeout so a hung renderer can't block quit. No-op in browser dev.
 *
 * This replaces the former Tauri-specific `getCurrentWindow().onCloseRequested`
 * flow; the closing guard now lives in the shell, keyed by window.
 *
 * @returns an unlisten function.
 */
export async function onShellCloseRequested(
  flush: () => Promise<void> | void
): Promise<() => void> {
  if (typeof window === "undefined" || !("__TAURI_BACKEND_URL__" in window)) {
    return () => {};
  }
  try {
    const [{ listen }, { invoke }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/core"),
    ]);
    return await listen("shell://close-requested", async () => {
      try {
        await flush();
      } finally {
        await invoke("shell_close_window");
      }
    });
  } catch {
    return () => {};
  }
}
