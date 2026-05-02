/**
 * Multi-window helpers. Routes through the Tauri shell when present;
 * silently no-ops in the browser build so the same call sites work in
 * both environments.
 */

export interface WindowTarget {
  kind: "file" | "folder";
  path: string;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_BACKEND_URL__" in window;
}

/** Push the current window's open target to Rust so the dock menu and
 * focus-existing-window routing know what's where. */
export async function registerWindowTarget(target: WindowTarget): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("register_window_target", { target });
  } catch {
    // Best-effort; the registry is a hint, not a correctness requirement.
  }
}

export async function unregisterWindowTarget(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("unregister_window_target");
  } catch {
    // see above
  }
}

/** Focus an existing window with this target, or open a new one. */
export async function openWindowForTarget(target: WindowTarget): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_window_for_target", { target });
}

/** Open a fresh welcome-screen window. */
export async function openNewWindow(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_new_window");
}

/** Push the current recents list to Rust so the macOS dock right-click
 * menu can render it. The dock menu callback reads this state every time
 * the user right-clicks, so as long as we push after every change, the
 * menu stays fresh. */
export async function syncRecentsToDock(
  recents: ReadonlyArray<{ kind: "file" | "folder"; path: string }>
): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("dock_set_recents", { recents });
  } catch {
    // Best-effort — the dock menu is decorative.
  }
}
