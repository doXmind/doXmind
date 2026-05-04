"use client";

import { useEditorStore } from "@/stores/editor-store";
import { useFileStore } from "@/stores/file-store";
import { forceOpenNewWindowForTarget, type WindowTarget } from "@/lib/window";

/**
 * Wait for any in-flight or queued editor save to drain before mutating
 * shared workspace state. The markdown editor uses a 1s debounce on save
 * (see EDITOR_DEBOUNCE_DELAY); the PDF editor 600ms. If the user types
 * and immediately switches workspace, the pending save would be discarded
 * when openFolder() clobbers the files array — so we wait until both the
 * "dirty" and "saving" flags clear, with a hard ceiling so a stuck save
 * never blocks the UI forever.
 */
export async function waitForSaveIdle(maxMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const { isDirty, isSaving } = useEditorStore.getState();
    if (!isDirty && !isSaving) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Open a workspace target either by replacing the current window's state
 * or by spawning/focusing a separate window.
 *
 * - newWindow=false: drain pending saves, then call openFolder/openFile in
 *   this window. Use for "Open in Current Window" and recents.
 * - newWindow=true: route through the Tauri shell; the current window is
 *   untouched, so no save drain is needed. We force-spawn a fresh window
 *   here rather than focus an existing one — the user explicitly picked
 *   "Open in New Window," so deduping by focusing an already-open instance
 *   would silently undo their choice.
 */
export async function switchWorkspace(
  target: WindowTarget,
  options: { newWindow: boolean }
): Promise<void> {
  if (options.newWindow) {
    await forceOpenNewWindowForTarget(target);
    return;
  }
  await waitForSaveIdle();
  if (target.kind === "folder") {
    await useFileStore.getState().openFolder(target.path);
  } else {
    await useFileStore.getState().openFile(target.path);
  }
}
