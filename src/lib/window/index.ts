/**
 * Multi-window helpers. Routes through the desktop shell when present;
 * silently no-ops in the browser build so the same call sites work in
 * both environments.
 */

import { hasDesktopBridge, invokeDesktop } from "@/lib/native-shell";

export interface WindowTarget {
  kind: "file" | "folder";
  path: string;
}

/** Push the current window's open target to Electron so the dock menu and
 * focus-existing-window routing know what's where. */
export async function registerWindowTarget(target: WindowTarget): Promise<void> {
  if (!hasDesktopBridge()) return;
  try {
    await invokeDesktop("register_window_target", { target });
  } catch {
    // Best-effort; the registry is a hint, not a correctness requirement.
  }
}

export async function unregisterWindowTarget(): Promise<void> {
  if (!hasDesktopBridge()) return;
  try {
    await invokeDesktop("unregister_window_target");
  } catch {
    // see above
  }
}

/** Focus an existing window with this target, or open a new one. Used by the
 *  dock recents menu where the user's intent is "show me this," not
 *  "duplicate it." */
export async function openWindowForTarget(target: WindowTarget): Promise<void> {
  if (!hasDesktopBridge()) return;
  await invokeDesktop("open_window_for_target", { target });
}

/** Always spawn a new window for `target`, even if some window already shows
 *  it. Use this for explicit "Open in New Window" affordances where the user
 *  has chosen to duplicate. */
export async function forceOpenNewWindowForTarget(target: WindowTarget): Promise<void> {
  if (!hasDesktopBridge()) return;
  await invokeDesktop("force_open_new_window_for_target", { target });
}

/** Open a fresh welcome-screen window. */
export async function openNewWindow(): Promise<void> {
  if (!hasDesktopBridge()) return;
  await invokeDesktop("open_new_window");
}

/** Push the current recents list to Electron so the macOS dock right-click
 * menu can render it. The dock menu callback reads this state every time
 * the user right-clicks, so as long as we push after every change, the
 * menu stays fresh. */
export async function syncRecentsToDock(
  recents: ReadonlyArray<{ kind: "file" | "folder"; path: string }>
): Promise<void> {
  if (!hasDesktopBridge()) return;
  try {
    await invokeDesktop("dock_set_recents", { recents: [...recents] });
  } catch {
    // Best-effort — the dock menu is decorative.
  }
}
