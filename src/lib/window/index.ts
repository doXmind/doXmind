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

/** Ask the shell to watch `root` for external filesystem changes. It emits
 *  `workspace://changed` (carrying this exact root) when the folder's contents
 *  change on disk. Replaces any prior watch for this window. No-op in the
 *  browser build, where there is no native watcher. */
export async function startWorkspaceWatch(root: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("workspace_watch", { root });
  } catch {
    // Best-effort; live sync is an enhancement over the manual Refresh.
  }
}

/** Stop watching `root` (the value passed to {@link startWorkspaceWatch}).
 *  Matched by root so a folder switch — which fires this then a new watch as
 *  two un-ordered IPC calls — can't tear down the freshly-started watch. */
export async function stopWorkspaceWatch(root: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("workspace_unwatch", { root });
  } catch {
    // see above
  }
}

/** Focus an existing window with this target, or open a new one. Used by the
 *  dock recents menu where the user's intent is "show me this," not
 *  "duplicate it." */
export async function openWindowForTarget(target: WindowTarget): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_window_for_target", { target });
}

/** Always spawn a new window for `target`, even if some window already shows
 *  it. Use this for explicit "Open in New Window" affordances where the user
 *  has chosen to duplicate. */
export async function forceOpenNewWindowForTarget(target: WindowTarget): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("force_open_new_window_for_target", { target });
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
